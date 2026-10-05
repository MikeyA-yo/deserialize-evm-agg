import { DexCache } from "@deserialize-evm-agg/cache";
import { ArrayBiMap, Edge, EdgeData, FunctionToMutateTheEdgeCostType, Graph, TokenBiMap } from "@deserialize-evm-agg/graph";
import { IPath } from "deserialize-evm-server-sdk";
import { JsonRpcProvider, TransactionRequest } from "ethers";
import { v4PoolHandleFromId } from "./BaseV4Calculator";

import { DeserializeRoutePlan, IRoute } from "./IRoute";
import Decimal from "decimal.js";
import { RouteConstructor } from "./v3Route";
import { ChainConfig, UniswapV3QuoteCalculator } from "./UniswapV3Calculator";
import { createSwapTX } from "@deserialize-evm-agg/swap-contract-sdk";
import { NetworkType } from "./constants";
import { wrap } from "module";

/** Pool address (or V4 poolId) of a DEX pool record, matching the edges' edgeData.poolAddress */
const poolIdentifier = (pool: any): string | undefined =>
    (pool?.poolAddress ?? pool?.pairAddress ?? pool?.poolId)?.toLowerCase?.();

/** True if the edge belongs to the given pool (if no pool id is known, any edge for the pair matches) */
const samePool = (edge: Edge<EdgeData>, poolId: string | undefined): boolean =>
    poolId === undefined || String(edge.edgeData.poolAddress).toLowerCase() === poolId;

export type AllRouteConstructor<DexIdTypes extends string> = new (
    provider: JsonRpcProvider,
    cache: DexCache<DexIdTypes>
) => AllRoute<DexIdTypes>;

export const createAllRoute = <DexIdTypes extends string>(
    name: DexIdTypes,
    chain: ChainConfig,
    routeProviders: RouteConstructor<DexIdTypes>[]
): AllRouteConstructor<DexIdTypes> => {
    return class ConfiguredAllRoute extends AllRoute<DexIdTypes> {
        constructor(provider: JsonRpcProvider, cache: DexCache<DexIdTypes>) {
            super(name, provider, cache, chain, routeProviders);
        }
    };
};

export class AllRoute<DexIdTypes extends string> implements IRoute<any, DexIdTypes> {
    name: DexIdTypes;
    provider: JsonRpcProvider;
    cache: DexCache<DexIdTypes>;
    network: NetworkType;
    chainConfig: ChainConfig

    routeProviders: RouteConstructor<DexIdTypes>[];

    constructor(
        name: DexIdTypes,
        provider: JsonRpcProvider,
        cache: DexCache<DexIdTypes>,
        chainConfig: ChainConfig,
        routeProviders: RouteConstructor<DexIdTypes>[]
    ) {
        this.name = name
        this.provider = provider;
        this.cache = cache;
        this.chainConfig = chainConfig;
        this.routeProviders = routeProviders;
        this.network = chainConfig.network;

    }
    getEdgeDataDirect?: (<T extends any, R extends EdgeData>(provider: JsonRpcProvider, data: T, r: boolean) => Promise<R | null>) | undefined;
    getEdgeDataReverse?: (<T extends any, R extends EdgeData>(provider: JsonRpcProvider, data: T, r: boolean) => Promise<R | null>) | undefined;

    // Helper to get route provider by dexId
    getRouteProviderByDexId = (dexId: string): RouteConstructor<DexIdTypes> => {
        const RouteClass = this.routeProviders.find((RouteProviderClass) => {
            const tempInstance = new RouteProviderClass(this.provider, this.cache);
            return tempInstance.name === dexId;
        });

        if (!RouteClass) {
            throw new Error(`Route provider not found for dexId: ${dexId}`);
        }

        return RouteClass;
    };
    // method to get all supported DEX IDs
    getSupportedDexIds = (): DexIdTypes[] => {
        return this.routeProviders.map((RouteClass) => {
            const tempInstance = new RouteClass(this.provider, this.cache);
            return tempInstance.name;
        });
    };
    //0x1cd0690ff9a693f5ef2dd976660a8dafc81a109c
    static formatPool = (data: [string, any], routeProviders: RouteConstructor<any>[]) => {
        const formattedPoolData: any[] = [];
        let dexId: string
        let poolData
        const [_dexId, _poolData] = data;

        if (isNaN(Number(_dexId))) {
            dexId = _dexId
            poolData = _poolData

        } else {
            const [_dexId, _poolDat] = _poolData
            dexId = _dexId
            poolData = _poolDat
        }

        //for some reason i am getting a map of a map so it just handle for it



        // Find the appropriate route provider
        const RouteProviderClass = routeProviders.find((RouteClass) => {
            const temp = new RouteClass(new JsonRpcProvider(), {} as any);
            return temp.name === dexId;
        });

        if (!RouteProviderClass) {
            throw new Error(`Route provider not found for dexId: ${dexId}`);
        }

        const routeProvider = new RouteProviderClass(new JsonRpcProvider(), {} as any);

        poolData.forEach((pool: any) => {
            const formattedData = routeProvider.formatPool(pool);
            formattedPoolData.push(formattedData);
        });

        return [dexId, formattedPoolData];
    };
    // Static method to get DEX IDs without instantiating AllRoute
    static getSupportedDexIds = <T extends string>(
        routeProviders: RouteConstructor<T>[],
        provider: JsonRpcProvider,
        cache: DexCache<T>
    ): T[] => {
        return routeProviders.map((RouteClass) => {
            const tempInstance = new RouteClass(provider, cache);
            return tempInstance.name;
        });
    };

    /**
     * Refresh aggregated graph edges with current pool state
     */
    async refreshGraphEdges(
        graph: Graph,
        tokenBiMap: ArrayBiMap<string>,
        poolData: any = [],
        _provider?: JsonRpcProvider
    ): Promise<Graph> {
        console.log("Refreshing aggregated graph edges");
        const provider = _provider || this.provider
        const refreshedGraph: Graph = graph.map(edges => [...edges]);

        await Promise.all(
            this.routeProviders.map(async (RouteProviderClass) => {
                const route = new RouteProviderClass(provider, this.cache);

                try {
                    // Get existing pool data for this DEX
                    const existingPools = await route.getAllExistingPoolData(provider);

                    if (existingPools.length === 0) {
                        console.log(`No pools to refresh for ${route.name}`);
                        return;
                    }

                    console.log(`Refreshing ${existingPools.length} pools for ${route.name}`);

                    // Get route's token BiMap
                    const routeTokenBiMap = await route.getTokenBiMap<any>();

                    // Get refreshed route graph
                    const routeGraphCache = await this.cache.getDexGraphCache(route.name);
                    if (!routeGraphCache) {
                        console.log(`No cached graph found for ${route.name}`);
                        return;
                    }

                    const refreshedRouteGraph = await route.refreshGraphEdges(
                        routeGraphCache,
                        routeTokenBiMap.tokenBiMap,
                        existingPools,
                        provider
                    );

                    // Update route cache with refreshed graph
                    await this.cache.setDexGraphCache(route.name, refreshedRouteGraph);

                    // Map refreshed edges to aggregated graph
                    existingPools.forEach((pool: any) => {
                        const { tokenX, tokenY } = route.getTokenXAndYFromPool(pool);
                        const tokenA = tokenX.toLowerCase();
                        const tokenB = tokenY.toLowerCase();

                        const fromTokenIndexInRoute = routeTokenBiMap.tokenBiMap.getByValue(tokenA);
                        const toTokenIndexInRoute = routeTokenBiMap.tokenBiMap.getByValue(tokenB);

                        if (fromTokenIndexInRoute === undefined || toTokenIndexInRoute === undefined) {
                            return;
                        }

                        const fromTokenIndexInAllGraph = tokenBiMap.getByValue(tokenA);
                        const toTokenIndexInAllGraph = tokenBiMap.getByValue(tokenB);

                        if (fromTokenIndexInAllGraph === undefined || toTokenIndexInAllGraph === undefined) {
                            return;
                        }

                        // Find and update edges in aggregated graph
                        const directEdgeInRoute = refreshedRouteGraph[fromTokenIndexInRoute]?.find(
                            e => e.to === toTokenIndexInRoute && e.edgeData.poolAddress === pool.poolAddress
                        );

                        const reverseEdgeInRoute = refreshedRouteGraph[toTokenIndexInRoute]?.find(
                            e => e.to === fromTokenIndexInRoute && e.edgeData.poolAddress === pool.poolAddress
                        );

                        if (directEdgeInRoute) {
                            const existingIndex = refreshedGraph[fromTokenIndexInAllGraph].findIndex(
                                e => e.to === toTokenIndexInAllGraph &&
                                    e.edgeData.poolAddress === pool.poolAddress &&
                                    e.edgeData.dexId === route.name
                            );

                            if (existingIndex >= 0) {
                                refreshedGraph[fromTokenIndexInAllGraph][existingIndex] = new Edge(
                                    fromTokenIndexInAllGraph,
                                    toTokenIndexInAllGraph,
                                    directEdgeInRoute.edgeData
                                );
                            }
                        }

                        if (reverseEdgeInRoute) {
                            const existingIndex = refreshedGraph[toTokenIndexInAllGraph].findIndex(
                                e => e.to === fromTokenIndexInAllGraph &&
                                    e.edgeData.poolAddress === pool.poolAddress &&
                                    e.edgeData.dexId === route.name
                            );

                            if (existingIndex >= 0) {
                                refreshedGraph[toTokenIndexInAllGraph][existingIndex] = new Edge(
                                    toTokenIndexInAllGraph,
                                    fromTokenIndexInAllGraph,
                                    reverseEdgeInRoute.edgeData
                                );
                            }
                        }
                    });

                    console.log(`Successfully refreshed edges for ${route.name} in aggregated graph`);
                } catch (error) {
                    console.error(`Error refreshing edges for ${route.name}:`, error);
                }
            })
        );

        console.log("Aggregated graph edge refresh complete");
        return refreshedGraph;
    }

    async getAllExistingPoolData(provider?: JsonRpcProvider): Promise<any[]> {
        throw new Error("Not implemented for All route")
    }


    formatPool = (pool: any) => {
        return AllRoute.formatPool(pool, this.routeProviders);
    };

    listTokens = async () => {
        const routeData = await this.getTokenBiMap(this.provider);
        return routeData.tokenBiMap.toArray();
    }

    getTokenBiMap = async <T>(
        provider?: JsonRpcProvider
    ): Promise<TokenBiMap<T>> => {
        const cachedData = await this.cache.getDexTokenIndexBiMapCache(
            this.name,
            this.formatPool as (pool: any) => T
        );

        if (cachedData) {
            return cachedData;
        }

        // A cache miss must not scan factory logs. That scan belongs to the
        // pool indexer. Quote requests discover the specific pair they need.
        return {
            tokenBiMap: new ArrayBiMap<string>(),
            data: [],
            tokenPoolMap: new Map<string, string>(),
        };
    };

    getNewTokenBiMap = async <T>(
        provider?: JsonRpcProvider
    ): Promise<{
        tokenBiMap: ArrayBiMap<string>;
        data: T;
        tokenPoolMap: Map<string, string>;
    }> => {
        const tokenBiMap = new ArrayBiMap<string>();
        const tokenPoolMap = new Map<string, string>();
        const data = new Map<string, any>();

        for (const RouteProviderClass of this.routeProviders) {
            const route = new RouteProviderClass(
                provider || this.provider,
                this.cache
            );

            const {
                tokenBiMap: routeTokenBiMap,
                tokenPoolMap: routeTokenPoolMap,
                data: routeData,
            } = await route.getTokenBiMap();
            console.log('getNewTokenBiMap tokenBiMap: ', tokenBiMap.n);

            // Merge token bi-maps
            routeTokenBiMap
                .toArray()
                .forEach((token) => tokenBiMap.setArrayValue(token.toLowerCase()));

            // Merge token pool maps with dex prefix
            routeTokenPoolMap.forEach((value, key) => {
                tokenPoolMap.set(`${key}:${route.name}`, value);
            });

            data.set(route.name as string, routeData);
        }

        return {
            data: [...data.entries()] as T,
            tokenBiMap,
            tokenPoolMap
        };
    };

    findUpdateTokenPairPools = async (tokenA: string, tokenB: string) => {
        const uniquePairs: [string, string][] = [];
        const seen = new Set<string>();

        const candidatePairs: [string, string][] = [
            [tokenA, tokenB],
            [this.chainConfig.wrappedNativeTokenAddress, tokenB],
            [this.chainConfig.stableTokenAddress, tokenB],
            [tokenA, this.chainConfig.wrappedNativeTokenAddress],
            [tokenA, this.chainConfig.stableTokenAddress]
        ];

        for (const [a, b] of candidatePairs) {
            if (!a || !b || a.toLowerCase() === b.toLowerCase()) continue;
            const key = `${a.toLowerCase()}-${b.toLowerCase()}`;
            const reverseKey = `${b.toLowerCase()}-${a.toLowerCase()}`;
            if (!seen.has(key) && !seen.has(reverseKey)) {
                seen.add(key);
                uniquePairs.push([a, b]);
            }
        }

        await Promise.all(this.routeProviders.map(async (RouteProviderClass) => {
            const route = new RouteProviderClass(this.provider, this.cache);
            try {
                for (const [a, b] of uniquePairs) {
                    try {
                        await route.findUpdateTokenPairPools(a, b);
                    } catch (err: any) {
                        // Ignore individual missing pool errors and continue
                    }
                }
            } catch (error) {
                console.error(`Error updating token pair pools for ${route.name}:`, error);
            }
        }));
        // now all the routes have updated their tokenBiMaps and Graph with this new token pair

        //we will now force the update of the all route to add this new information to the all route
        console.log("getting new tokendBiMap and new graph for AllRoute");
        const newTokenBiMap = await this.getNewTokenBiMap<any>()
        console.log('newTokenBiMap: ', newTokenBiMap.tokenBiMap.n);
        console.log("got new tokendBiMap for AllRoute");
        const newGraph = await this.getNewGraph(newTokenBiMap)
        await this.cache.setDexTokenIndexBiMapCache(this.name, newTokenBiMap);
        await this.cache.setDexGraphCache(this.name, newGraph);
        console.log('newGraph: ', newGraph.length);
        console.log("got the new graph")


        return { newGraph, newTokenBiMap: newTokenBiMap.tokenBiMap }
    };


    getGraph = async (
        provider?: JsonRpcProvider,
        _tokenBiMap?: TokenBiMap<any>,
        ignoreCache?: boolean
    ): Promise<Graph> => {
        if (!ignoreCache) {
            const cachedData = await this.cache.getDexGraphCache(this.name);
            if (cachedData) {
                return cachedData as Graph;
            }
        }

        let tokenBiMap;
        if (_tokenBiMap) {
            tokenBiMap = _tokenBiMap;
        } else {
            tokenBiMap = await this.getTokenBiMap<any>(provider);
        }

        const graph = await this.getNewGraph(
            tokenBiMap,
            provider || this.provider
        );

        this.cache.setDexGraphCache(this.name, graph);
        return graph;
    };

    getNewGraph = async (
        tokenBiMap?: TokenBiMap<any>,
        _provider?: JsonRpcProvider
    ) => {
        const provider = _provider || this.provider;

        let tokenIndexBiMap: ArrayBiMap<string>;
        let data: any[];

        if (tokenBiMap) {
            tokenIndexBiMap = tokenBiMap.tokenBiMap;
            data = tokenBiMap.data;
        } else {
            const { tokenBiMap: _tokenBiMap, data: _data } =
                await this.getTokenBiMap<any>(provider);
            data = _data;
            tokenIndexBiMap = _tokenBiMap;
        }

        const graph: Graph = Array.from({ length: tokenIndexBiMap.toArray().length }, () => []);

        console.log("Building aggregated graph with", data.length, "DEXes");

        await Promise.all(
            data.map(async ([dexId, poolData]) => {
                const RouteProviderClass = this.getRouteProviderByDexId(dexId);
                const route = new RouteProviderClass(provider, this.cache);

                const routeTokenBiMap = await route.getTokenBiMap<any>();
                const routeGraph = await route.getGraph(
                    provider,
                    routeTokenBiMap,
                    false
                );

                poolData.forEach((pool: any) => {
                    const { tokenX, tokenY } = route.getTokenXAndYFromPool(pool);

                    const tokenA = tokenX.toLowerCase();
                    const tokenB = tokenY.toLowerCase();

                    const fromTokenIndex = routeTokenBiMap.tokenBiMap.getByValue(tokenA);
                    const toTokenIndex = routeTokenBiMap.tokenBiMap.getByValue(tokenB);

                    if (fromTokenIndex === undefined || toTokenIndex === undefined) {
                        return;
                    }

                    // Match this pool's own edges (a DEX can have several pools per pair, e.g. fee tiers)
                    const poolId = poolIdentifier(pool);
                    const dexDirectEdge = routeGraph[fromTokenIndex]?.find(
                        (r) => r.from === fromTokenIndex && r.to === toTokenIndex && samePool(r, poolId)
                    );

                    const dexReverseEdge = routeGraph[toTokenIndex]?.find(
                        (r) => r.from === toTokenIndex && r.to === fromTokenIndex && samePool(r, poolId)
                    );

                    if (!dexDirectEdge || !dexReverseEdge) {
                        return;
                    }

                    const fromTokenIndexInAllGraph = tokenIndexBiMap.getByValue(tokenA);
                    const toTokenIndexInAllGraph = tokenIndexBiMap.getByValue(tokenB);

                    if (fromTokenIndexInAllGraph === undefined || toTokenIndexInAllGraph === undefined) {
                        return;
                    }

                    const directEdge = new Edge(
                        fromTokenIndexInAllGraph,
                        toTokenIndexInAllGraph,
                        dexDirectEdge.edgeData
                    );

                    const reverseEdge = new Edge(
                        toTokenIndexInAllGraph,
                        fromTokenIndexInAllGraph,
                        dexReverseEdge.edgeData
                    );

                    graph[fromTokenIndexInAllGraph].push(directEdge);
                    graph[toTokenIndexInAllGraph].push(reverseEdge);
                });
            })
        );

        console.log("Aggregated graph construction complete");
        return graph;
    };

    getFunctionToMutateEdgeCost = () => {
        const func: FunctionToMutateTheEdgeCostType<any> = (params, e) => {
            const RouteProviderClass = this.getRouteProviderByDexId(params.dexId);
            const routeProvider = new RouteProviderClass(this.provider, this.cache);

            const functionToMutateEdge = routeProvider.getFunctionToMutateEdgeCost();
            return functionToMutateEdge(params, e);
        };
        return func;
    };
    /**
    * Merge two token BiMaps (adds new tokens without duplicates)
    * @param existing - Existing token BiMap
    * @param newTokens - New tokens to add
    * @returns Merged ArrayBiMap with all unique tokens
    */
    mergeTokenBiMaps(
        existing: TokenBiMap<any>,
        newMap: TokenBiMap<any>
    ): TokenBiMap<any> {
        // Step 1: Copy the existing tokenBiMap
        const mergedBiMap = new ArrayBiMap<string>(existing.tokenBiMap.toArray());

        // Step 2: Track existing pool addresses
        const existingPoolAddresses = new Set(
            (existing.data as any[]).map((d) => d.poolAddress?.toLowerCase?.())
        );

        // Step 3: Add tokens from newMap if not already present
        newMap.tokenBiMap.toArray().forEach((token) => {
            if (mergedBiMap.getByValue(token) === undefined) {
                mergedBiMap.setArrayValue(token);
            }
        });

        // Step 4: Merge pool data — skip duplicates
        const mergedData = [
            ...existing.data,
            ...(newMap.data as any[]).filter(
                (d) => !existingPoolAddresses.has(d.poolAddress?.toLowerCase?.())
            ),
        ];

        // Step 5: Merge tokenPoolMap
        const mergedTokenPoolMap = new Map(existing.tokenPoolMap);
        newMap.tokenPoolMap.forEach((value, key) => {
            if (!mergedTokenPoolMap.has(key)) {
                mergedTokenPoolMap.set(key, value);
            }
        });

        // Step 6: Return new merged structure
        return {
            tokenBiMap: mergedBiMap,
            data: mergedData,
            tokenPoolMap: mergedTokenPoolMap,
        };
    }


    /**
     * Build graph only from specific pools across all DEXes (incremental update)
     * @param poolsByDex - Map of dexId to new pools
     * @param tokenBiMap - Merged token index mapping
     * @param provider - JSON RPC provider
     * @returns Promise<Graph> - Graph with edges only for the provided pools
     */
    async buildGraphFromPools(
        pools: any[],
        tokenBiMap: ArrayBiMap<string>,
        provider: JsonRpcProvider,
        _poolsByDex?: any[],
    ): Promise<Graph> {
        if (!_poolsByDex) {
            throw new Error("No new pools provided for graph construction");
        }
        const poolsByDex = new Map(_poolsByDex) as Map<string, any[]>
        if (poolsByDex.size === 0) {
            throw new Error("The Pool By Dex is not formatted well")
        }

        // Initialize empty graph with size based on tokenBiMap
        const graph: Graph = Array.from({ length: tokenBiMap.toArray().length }, () => []);

        console.log(`Building aggregated graph from ${poolsByDex.size} DEXes with new pools`);

        // Process each DEX's new pools
        await Promise.all(
            Array.from(poolsByDex.entries()).map(async ([dexId, poolData]) => {
                if (!poolData || poolData.length === 0) {
                    console.log(`No new pools for DEX: ${dexId}`);
                    return;
                }

                console.log(`Processing ${poolData.length} new pools for DEX: ${dexId}`);

                try {
                    const RouteProviderClass = this.getRouteProviderByDexId(dexId as DexIdTypes);
                    const route = new RouteProviderClass(provider, this.cache);

                    // Get the route's token BiMap (it should already have all tokens including new ones)
                    const routeTokenBiMap = await route.getTokenBiMap<any>();

                    // Build graph for only these new pools
                    const routeGraphForNewPools = await route.buildGraphFromPools(
                        poolData,
                        routeTokenBiMap.tokenBiMap,
                        provider
                    );

                    // Map edges from route-specific indices to aggregated graph indices
                    poolData.forEach((pool: any) => {
                        const { tokenX, tokenY } = route.getTokenXAndYFromPool(pool);

                        const tokenA = tokenX.toLowerCase();
                        const tokenB = tokenY.toLowerCase();

                        // Get indices in route-specific BiMap
                        const fromTokenIndexInRoute = routeTokenBiMap.tokenBiMap.getByValue(tokenA);
                        const toTokenIndexInRoute = routeTokenBiMap.tokenBiMap.getByValue(tokenB);

                        if (fromTokenIndexInRoute === undefined || toTokenIndexInRoute === undefined) {
                            console.warn(`Token indices not found in route BiMap for ${tokenA}/${tokenB}`);
                            return;
                        }

                        // Get edges from the route's graph
                        // Match this pool's own edges (a DEX can have several pools per pair, e.g. fee tiers)
                        const poolId = poolIdentifier(pool);
                        const dexDirectEdge = routeGraphForNewPools[fromTokenIndexInRoute]?.find(
                            (r) => r.from === fromTokenIndexInRoute && r.to === toTokenIndexInRoute && samePool(r, poolId)
                        );

                        const dexReverseEdge = routeGraphForNewPools[toTokenIndexInRoute]?.find(
                            (r) => r.from === toTokenIndexInRoute && r.to === fromTokenIndexInRoute && samePool(r, poolId)
                        );

                        if (!dexDirectEdge || !dexReverseEdge) {
                            console.warn(`Edges not found for pool ${tokenA}/${tokenB} in ${dexId}`);
                            return;
                        }

                        // Get indices in aggregated BiMap
                        const fromTokenIndexInAllGraph = tokenBiMap.getByValue(tokenA);
                        const toTokenIndexInAllGraph = tokenBiMap.getByValue(tokenB);

                        if (fromTokenIndexInAllGraph === undefined || toTokenIndexInAllGraph === undefined) {
                            console.warn(`Token indices not found in aggregated BiMap for ${tokenA}/${tokenB}`);
                            return;
                        }

                        // Create edges with aggregated graph indices
                        const directEdge = new Edge(
                            fromTokenIndexInAllGraph,
                            toTokenIndexInAllGraph,
                            dexDirectEdge.edgeData
                        );

                        const reverseEdge = new Edge(
                            toTokenIndexInAllGraph,
                            fromTokenIndexInAllGraph,
                            dexReverseEdge.edgeData
                        );

                        // Add to aggregated graph
                        graph[fromTokenIndexInAllGraph].push(directEdge);
                        graph[toTokenIndexInAllGraph].push(reverseEdge);
                    });

                    console.log(`Successfully processed new pools for DEX: ${dexId}`);
                } catch (error) {
                    console.error(`Error processing new pools for DEX ${dexId}:`, error);
                }
            })
        );

        console.log("Aggregated graph construction from new pools complete");
        return graph;
    }

    /**
     * Merge two graphs (existing + new edges)
     * @param existing - Existing graph
     * @param newEdges - Graph with new edges to add
     * @param tokenBiMap - Merged token BiMap for sizing
     * @returns Merged graph with all edges
     */
    mergeGraphs(
        existing: Graph,
        newEdges: Graph,
        tokenBiMap: ArrayBiMap<string>
    ): Graph {
        const targetSize = tokenBiMap.toArray().length;

        // Initialize merged graph with correct size
        const merged: Graph = Array.from({ length: targetSize }, (_, i) => {
            // Copy existing edges if within bounds
            return i < existing.length ? [...existing[i]] : [];
        });

        console.log(`Merging graphs: existing size=${existing.length}, new size=${newEdges.length}, target size=${targetSize}`);

        let edgesAdded = 0;
        let edgesUpdated = 0;

        // Add or update edges from newEdges
        newEdges.forEach((edges, fromIndex) => {
            if (fromIndex >= targetSize) {
                console.warn(`Edge index ${fromIndex} exceeds target size ${targetSize}`);
                return;
            }

            edges.forEach(newEdge => {
                // Check if edge already exists (same from, to, and poolAddress)
                const existingEdgeIndex = merged[fromIndex].findIndex(
                    e => e.to === newEdge.to &&
                        e.edgeData.poolAddress === newEdge.edgeData.poolAddress &&
                        e.edgeData.dexId === newEdge.edgeData.dexId
                );

                if (existingEdgeIndex >= 0) {
                    // Update existing edge with new data
                    merged[fromIndex][existingEdgeIndex] = newEdge;
                    edgesUpdated++;
                } else {
                    // Add new edge
                    merged[fromIndex].push(newEdge);
                    edgesAdded++;
                }
            });
        });

        console.log(`Graph merge complete: ${edgesAdded} edges added, ${edgesUpdated} edges updated`);
        return merged;
    }

    /**
     * Get new token BiMap with only newly created pools per DEX
     * Used for incremental updates
     */
    async getNewTokenBiMapIncremental<T>(
        provider?: JsonRpcProvider
    ): Promise<{
        tokenBiMap: ArrayBiMap<string>;
        data: T;
        tokenPoolMap: Map<string, string>;
    }> {
        const tokenBiMap = new ArrayBiMap<string>();
        const tokenPoolMap = new Map<string, string>();
        const newPoolsByDex = new Map<string, any[]>();

        for (const RouteProviderClass of this.routeProviders) {
            const route = new RouteProviderClass(
                provider || this.provider,
                this.cache
            );

            try {
                // Get only NEW pools (uses lastBlock tracking)
                const {
                    tokenBiMap: routeTokenBiMap,
                    tokenPoolMap: routeTokenPoolMap,
                    data: newPools,
                } = await route.getNewTokenBiMap(provider || this.provider);

                if (!newPools || newPools.length === 0) {
                    console.log(`No new pools for ${route.name}`);
                    continue;
                }

                console.log(`Found ${newPools.length} new pools for ${route.name}`);

                // Merge token bi-maps
                routeTokenBiMap
                    .toArray()
                    .forEach((token) => tokenBiMap.setArrayValue(token.toLowerCase()));

                // Merge token pool maps with dex prefix
                routeTokenPoolMap.forEach((value, key) => {
                    tokenPoolMap.set(`${key}:${route.name}`, value);
                });

                // Store new pools by DEX
                newPoolsByDex.set(route.name as string, newPools);
            } catch (error) {
                console.error(`Error getting new pools for ${route.name}:`, error);
            }
        }

        return {
            data: Array.from(newPoolsByDex.entries()) as T,
            tokenBiMap,
            tokenPoolMap
        };
    }

    getTransactionInstructionFromRoutePlan = async (
        amountFormattedToTokenDecimal: Decimal,
        routePlan: DeserializeRoutePlan<DexIdTypes>[],
        wallet: string,
        slippage: number,
        isNativeIn: boolean,
        isNativeOut: boolean,
        partnerFees?: { recipient: string; fee: number }
    ) => {
        const { amountOut } = await this.getAmountOutFromPlan(amountFormattedToTokenDecimal, routePlan, 0, this.provider)

        // for (let i = 0; i < routePlan.length; i++) {
        //     const plan = routePlan[i];

        //     const RouteProviderClass = this.getRouteProviderByDexId(plan.dexId as string);
        //     const route = new RouteProviderClass(this.provider, this.cache);

        //     const transaction = await route.getTransactionInstructionFromRoutePlan(
        //         currentAmountIn,
        //         [plan],
        //         wallet,
        //         slippage,
        //         i === 0 ? isNativeIn : false,
        //         i === routePlan.length - 1 ? isNativeOut : false,
        //         i === 0 ? partnerFees : undefined
        //     );

        //     allTransactions.push(transaction);

        //     const { amountOut } = await route.getAmountOutFromPlan(
        //         currentAmountIn,
        //         [plan],
        //         0,
        //         this.provider
        //     );
        //     currentAmountIn = amountOut;
        // }

        const plan: IPath[] = [];
        for (let i = 0; i < routePlan.length; i++) {
            const route = routePlan[i];
            const isFirstHop = i === 0;
            const isLastHop = i === routePlan.length - 1;
            const RouteProviderClass = this.getRouteProviderByDexId(route.dexId as string);
            const dexRoute = new RouteProviderClass(this.provider, this.cache);
            const config = dexRoute.getDexConfig();
            const warpedTokenAddress = config.wrappedNativeTokenAddress;
            const nativeTokenAddress = config.nativeTokenAddress;
            if (!warpedTokenAddress || !nativeTokenAddress) {
                throw new Error("Dex config must have wrappedNativeTokenAddress and nativeTokenAddress");
            }
            const replaceIn = isNativeIn && isFirstHop && route.tokenA.toLowerCase() === warpedTokenAddress.toLowerCase();
            const replaceOut = isNativeOut && isLastHop && route.tokenB.toLowerCase() === warpedTokenAddress.toLowerCase();
            // Uniswap V4 pools are identified by a 32-byte poolId, not a contract address. The
            // UniswapV4Adapter takes the pool's handle (low 160 bits of the poolId) in the hop's
            // 20-byte pool field and resolves it to the registered PoolKey.
            const isV4PoolId = route.poolAddress.length === 66;
            const path: IPath = {
                factory: config.factoryAddress,
                poolAddress: isV4PoolId ? v4PoolHandleFromId(route.poolAddress) : route.poolAddress,
                tokenIn: replaceIn ? nativeTokenAddress : route.tokenA,
                tokenOut: replaceOut ? nativeTokenAddress : route.tokenB,
                fee: route.fee,
            };
            plan.push(path);
        }
        const paths = plan;
        const slippageMultiplier = new Decimal(1).minus(slippage / 100);
        const minAmountOut = amountOut.mul(slippageMultiplier);
        console.log(`      [TX_BUILD:1/4] Constructing swap path for wallet ${wallet} on ${this.network}...`);
        console.log(`      [TX_BUILD:2/4] Total hops: ${paths.length}, isNativeIn=${isNativeIn}, isNativeOut=${isNativeOut}`);
        console.log(`      [TX_BUILD:3/4] amountInRaw=${amountFormattedToTokenDecimal.toFixed(0)}, expectedOut=${amountOut.toFixed(0)}, minAmountOut=${minAmountOut.toFixed(0)} (slippage: ${slippage}%)`);
        console.log(`      [TX_BUILD:4/4] Invoking createSwapTX with swapProxy and adapter tracker...`);

        const txs = await createSwapTX(
            {
                path: paths,
                amountInRaw: amountFormattedToTokenDecimal.toFixed(0),
                minAmountOut: minAmountOut.toFixed(0),
            },
            wallet, this.provider, { id: this.network, rpc: this.chainConfig.rpcUrl }, partnerFees
        );

        const transactions: TransactionRequest[] = txs.map((tx) => ({
            from: wallet,
            to: tx.to,
            data: tx.data,
            value: tx.value,
        }));
        console.log(`      [TX_BUILD:SUCCESS] createSwapTX returned ${transactions.length} transaction(s)`);
        return { transactions };



    };

    getAmountOutFromPlan = async (
        amountFormattedToTokenDecimal: Decimal,
        routePlan: DeserializeRoutePlan<DexIdTypes>[],
        devFeeRate: number,
        provider?: JsonRpcProvider
    ) => {
        let currentAmountIn = new Decimal(amountFormattedToTokenDecimal);
        const changedPoolList = []
        const hopAmountsOut: Decimal[] = [] // raw amountOut of each hop, in route order
        for (const plan of routePlan) {
            const RouteProviderClass = this.getRouteProviderByDexId(plan.dexId as string);
            const route = new RouteProviderClass(provider || this.provider, this.cache);

            const { amountOut, pools } = await route.getAmountOutFromPlan(
                currentAmountIn,
                [plan], //that is because of this
                devFeeRate,
                provider
            );

            console.log('this has to be one item or else the logic breaks pools: ', pools);
            currentAmountIn = amountOut;
            changedPoolList.push(pools[0])
            hopAmountsOut.push(amountOut)
        }

        return { amountOut: currentAmountIn, pools: changedPoolList, hopAmountsOut };
    };

    getTokenPairEdgeData = async (tokenA: string, tokenB: string) => {
        const routeData = await this.getTokenBiMap(this.provider);
        const tokenAIndex = routeData.tokenBiMap.getByValue(tokenA.toLowerCase());
        const tokenBIndex = routeData.tokenBiMap.getByValue(tokenB.toLowerCase());

        if (tokenAIndex === undefined || tokenBIndex === undefined) {
            throw new Error("DEX_ERRORS.PAIR_NOT_AVAILABLE_ON_DEX");
        }

        const graph = await this.getGraph();
        const edges = graph[tokenAIndex];
        const edgeData = edges.find((e) => e.to === tokenBIndex);

        return edgeData || null;
    };

    calculateRoutePrice = async (
        route: DeserializeRoutePlan<DexIdTypes>[]
    ): Promise<number> => {
        let finalPrice = 1;

        for (const segment of route) {
            const edgeData = await this.getTokenPairEdgeData(
                segment.tokenA,
                segment.tokenB
            );

            if (!edgeData) {
                throw new Error(
                    `Price not available for token pair ${segment.tokenA} - ${segment.tokenB}`
                );
            }

            finalPrice *= edgeData.edgeData.price;
        }

        return finalPrice;
    };

    getTokenXAndYFromPool = (pool: any) => {
        throw new Error(
            "This method should only be called by individual route providers"
        );
    };

    getDexConfig = () => {
        return {
            wrappedNativeTokenAddress: this.chainConfig.wrappedNativeTokenAddress,
            nativeTokenAddress: this.chainConfig.nativeTokenAddress,
            stableTokenAddress: this.chainConfig.stableTokenAddress,
            factoryAddress: "",
            routerAddress: "",
            name: "ALL",
            dexId: "ALL" as DexIdTypes,
            supportsNativeToken: true,
            logoURI: "",
            quoterAddress: "",
            network: this.network,
            abi: []
        }
    };

    getSurePriceOfToken = async (tokenAddress: string) => {
        let price = await this.cache.getPriceFromCache(tokenAddress);

        if (price !== null) {
            return price;
        }
        // TODO: NOT SURE IF I SHOULD AVERAGE OR TAKE FIRST NON NULL / HIGHEST PRICE
        let aggregatedPrice = 0;
        let count = 0;

        for (const RouteProviderClass of this.routeProviders) {
            const route = new RouteProviderClass(this.provider, this.cache);
            const routePrice = await route.getSurePriceOfToken(tokenAddress);

            if (routePrice !== null && routePrice > 0) {
                aggregatedPrice += routePrice;
                count++;
            }
        }

        if (count === 0) {
            return null; // Price not found in any DEX
        }

        price = aggregatedPrice / count;
        await this.cache.setPriceToCache(tokenAddress, price);
        return price;
    };
}
