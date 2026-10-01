import { DexCache } from "@deserialize-evm-agg/cache";
import { createSwapTX } from "@deserialize-evm-agg/swap-contract-sdk";
import Decimal from "decimal.js";
import { NetworkType } from "deserialize-evm-server-sdk";
import { JsonRpcProvider, TransactionRequest } from "ethers";
import { DeserializeRoutePlan, IRoute, SwapQuoteParamWithEdgeData, SwapQuoteParamWithEdgeDataString } from "./IRoute";
import { ChainConfig, createJsonRpcProvider, DexConfig, PoolData, PoolInfo, UniswapV3QuoteCalculator, ZeroDexQuoteParams } from "./UniswapV3Calculator";
import { ArrayBiMap, Edge, EdgeData, FunctionToMutateTheEdgeCostType, Graph, TokenBiMap } from "@deserialize-evm-agg/graph";
import { transformRoutePlanToIPath } from "./utils";

export type RouteConstructor<DexIdTypes, T = any> = new (
    provider: JsonRpcProvider,
    cache: DexCache<DexIdTypes>
) => IRoute<T, DexIdTypes>;


type V3RouteConstructor<DexIdTypes> = new (
    provider: JsonRpcProvider,
    cache: DexCache<DexIdTypes>
) => BaseV3Route<DexIdTypes>;

export const createV3Route = <DexIdTypes>(
    config: DexConfig,
    chain: ChainConfig,
    dexId: DexIdTypes,
    calculator: UniswapV3QuoteCalculator = new UniswapV3QuoteCalculator(config, chain, createJsonRpcProvider(chain.rpcUrl, chain.chainId))
): V3RouteConstructor<DexIdTypes> => {
    return class ConfiguredV3Route extends BaseV3Route<DexIdTypes> {
        constructor(provider: JsonRpcProvider, cache: DexCache<DexIdTypes>) {
            super(provider, cache, config, chain, dexId, chain.network as NetworkType, calculator);
        }
    };
}



export class BaseV3Route<DexIdTypes> implements IRoute<PoolData, DexIdTypes> {
    name: DexIdTypes;
    provider: JsonRpcProvider;
    cache: DexCache<DexIdTypes>;
    dexConfig: DexConfig;
    chainConfig: ChainConfig;
    calculator: UniswapV3QuoteCalculator;
    network: NetworkType;
    constructor(provider: JsonRpcProvider,
        cache: DexCache<DexIdTypes>,
        config: DexConfig,
        chain: ChainConfig,
        dexId: DexIdTypes,
        network: NetworkType,
        calculator: UniswapV3QuoteCalculator
    ) {
        this.provider = provider;
        this.cache = cache;
        this.chainConfig = chain;
        this.dexConfig = config;
        this.calculator = calculator;
        this.name = dexId;
        this.network = network;
    }
    getDexConfig = () => {
        return this.dexConfig
    };
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
        //here we will get the transaction here
        return await getTransactionFromRoutePlanZeroG(this.dexConfig, amountFormattedToTokenDecimal, amountOut, routePlan, wallet, slippage, this.provider, isNativeIn, isNativeOut, partnerFees)
    };
    getAmountOutFromPlan = async (
        amountFormattedToTokenDecimal: Decimal,
        routePlan: DeserializeRoutePlan<DexIdTypes>[],
        devFeeRate: number,
        provider?: JsonRpcProvider
    ) => {
        return await getTransactionInstructionFromRoutePlanV3(
            this.dexConfig,
            this.chainConfig,
            amountFormattedToTokenDecimal,
            routePlan,
            provider || this.provider,
            this.calculator

        );
    };

    getEdgeDataReverse?: (<T extends PoolData, R extends EdgeData>(provider: JsonRpcProvider, data: T, r: boolean) => Promise<R | null>) | undefined;
    formatPool = (pool: any) => {
        return BaseV3Route.formatPool(pool);
    };
    static formatPool = (pool: PoolData): PoolData => {
        // console.log('pool: ', pool);

        return {
            token0: pool.token0,
            token1: pool.token1,
            poolAddress: pool.poolAddress,
            slot0: pool.slot0,
            sqrtPriceX96: pool.sqrtPriceX96,
            fee: pool.fee,
            liquidity: pool.liquidity,
        };
    };
    getTokenBiMap = async <PoolData>(
        provider?: JsonRpcProvider
    ): Promise<TokenBiMap<PoolData>> => {
        //TODO: NO MEMORY CACHE FOR NOW
        const cachedData = await this.cache.getDexTokenIndexBiMapCache(
            this.name,
            this.formatPool
        );
        if (cachedData) {
            return cachedData as TokenBiMap<PoolData>;
        }
        console.log("No cached data found, getting a new one...");
        const tokenBiMap = await this.getNewTokenBiMap<PoolData>(
            provider || this.provider
        );
        this.cache.setDexTokenIndexBiMapCache(this.name, tokenBiMap);

        return tokenBiMap;
    }


    getNewTokenBiMap = async <T>(
        provider: JsonRpcProvider
    ): Promise<{
        tokenBiMap: ArrayBiMap<string>;
        data: T[];
        tokenPoolMap: Map<string, string>;
    }> => {
        // Fetch token data
        const lastBlock = await this.cache.getLastBlockFetched(this.name)
        const data = await this.calculator.getAllPools(this.dexConfig.abi, lastBlock ? lastBlock.toString() : undefined)
        const newLastBlock = data && data.length > 0 ? data[data.length - 1]?.blockNumber : undefined;
        console.log('newLastBlock: ', newLastBlock);
        // console.log('data: ', data);
        const tokenBiMap = new ArrayBiMap<string>();
        const tokenPoolMap = new Map<string, string>();
        // Add tokens from the pool data
        data.forEach((pool: PoolData) => {
            const { token0, token1, poolAddress, fee } = pool;
            tokenBiMap.setArrayValue(token0.address.toLowerCase());
            tokenBiMap.setArrayValue(token1.address.toLowerCase());

            tokenPoolMap.set(
                `${token0.address.toLowerCase()}:${fee}:${token1.address.toLowerCase()}`,
                poolAddress);
            // }
        });
        console.log('newLastBlock: ', newLastBlock);
        if (newLastBlock) {
            await this.cache.setLastBlockFetched(this.name, Number(newLastBlock))
        }
        return { data: data as T[], tokenBiMap, tokenPoolMap };
    };
    mergeTokenBiMaps(
        existing: TokenBiMap<PoolData>,
        newMap: TokenBiMap<PoolData>
    ): TokenBiMap<PoolData> {
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

    mergeGraphs(existing: Graph, newEdges: Graph, tokenBiMap: ArrayBiMap<string>): Graph {
        const merged = existing.length > 0
            ? existing.map(edges => [...edges])
            : Array.from({ length: tokenBiMap.toArray().length }, () => []);

        newEdges.forEach((edges, fromIndex) => {
            if (!merged[fromIndex]) {
                merged[fromIndex] = [];
            }
            edges.forEach(edge => {
                // Check if edge already exists, update or add
                const existingIndex = merged[fromIndex].findIndex(
                    e => e.to === edge.to && e.edgeData.poolAddress === edge.edgeData.poolAddress
                );
                if (existingIndex >= 0) {
                    merged[fromIndex][existingIndex] = edge; // Update
                } else {
                    merged[fromIndex].push(edge); // Add new
                }
            });
        });

        return merged;
    }


    listTokens = async () => {
        const routeData = await this.getTokenBiMap(this.provider);
        return routeData.tokenBiMap.toArray();
    }
    getGraph = async (
        provider?: JsonRpcProvider,
        _tokenBiMap?: TokenBiMap<PoolData>,
        ignoreCache?: boolean
    ): Promise<Graph> => {
        //TODO: NO MEMORY CACHE FOR NOW
        if (!ignoreCache) {
            const cachedData = await this.cache.getDexGraphCache(this.name);
            if (cachedData) {
                // console.log("Cache Exit....");
                // if (!checkIfGraphIsEmpty(cachedData)) { //TODO: NO CHECK FOR NOW

                return cachedData as Graph;
                // }
                console.log("Cached graph is  empty");
            }
        }
        let tokenBiMap;
        if (_tokenBiMap) {
            tokenBiMap = _tokenBiMap;
        } else {
            tokenBiMap = await this.getTokenBiMap<PoolData>(provider);
        }

        const graph = await this.getNewGraph(
            tokenBiMap,
            provider || this.provider
        );
        this.cache.setDexGraphCache(this.name, graph);
        return graph;
    };
    getNewGraph = async (
        tokenBiMap?: TokenBiMap<PoolData>,
        _provider?: JsonRpcProvider
    ) => {
        const provider = _provider || this.provider;

        let tokenIndexBiMap: ArrayBiMap<string>
        let data;
        if (tokenBiMap) {
            tokenIndexBiMap = tokenBiMap.tokenBiMap;
            data = tokenBiMap.data;
        } else {
            const { tokenBiMap, data: _data } =
                await this.getTokenBiMap<PoolData>(provider);
            data = _data;

            if (tokenBiMap instanceof ArrayBiMap) {
                console.log("Using existing ArrayBiMap.....");
                tokenIndexBiMap = tokenBiMap;
            } else if (typeof tokenBiMap === "object" && !Array.isArray(tokenBiMap)) {
                console.log("Converting tokenBiMap to ArrayBiMap");
                tokenIndexBiMap = new ArrayBiMap<string>(tokenBiMap);
            } else {
                throw new Error("Invalid tokenBiMap type");
            }
        }
        // Initialize graph
        // console.log('data: ', data);
        const graph: Graph = Array.from({ length: tokenIndexBiMap.toArray().length }, () => []);
        // Set the concurrency limit (number of pools processed concurrently)
        const CONCURRENCY_LIMIT = 1;

        // Helper: process one pool
        console.log('tokenIndexBiMap: ', tokenIndexBiMap);
        tokenIndexBiMap = Array.isArray(tokenIndexBiMap) ? new ArrayBiMap<string>(tokenIndexBiMap as any as Array<string>) : tokenIndexBiMap;


        const processPool = async (wp: PoolData) => {
            console.log('wp: ', wp.token0.address, wp.token1.address, wp.poolAddress);

            const fromTokenString = wp.token0.address.toLowerCase()
            const fromTokenIndex = tokenIndexBiMap.getByValue(fromTokenString);
            const toTokenString = wp.token1.address.toLowerCase()
            const toTokenIndex = tokenIndexBiMap.getByValue(toTokenString);

            if (fromTokenIndex === undefined || toTokenIndex === undefined) {
                return;
            }

            try {
                const directData = await this.getEdgeDataDirect<
                    PoolData,
                    SwapQuoteParamWithEdgeData<PoolData>
                >(provider, wp, false).catch((err: any) => {
                    console.error(
                        `Error fetching direct data for ${wp.token0.address}:${wp.token1.address}:`,
                        err
                    );
                    return null;
                });

                const reverseData = await this.getEdgeDataDirect<
                    PoolData,
                    SwapQuoteParamWithEdgeData<PoolData>
                >(provider, wp, true).catch((err) => {
                    console.error(
                        `Error fetching reverse data for ${wp.token1.address}:${wp.token0.address}:`,
                        err
                    );
                    return null;
                });

                if (!directData || !reverseData) {
                    console.warn(
                        `Skipping pool ${wp.token1.address}:${wp.token0.address} due to incomplete data`
                    );
                    return;
                }


                const directEdge = new Edge<SwapQuoteParamWithEdgeDataString>(
                    Number(fromTokenIndex),
                    Number(toTokenIndex),
                    {
                        price: directData.price,
                        fee: directData.fee,
                        priceUsdc: directData.priceUsdc,
                        tokenFromReserve: directData.tokenFromReserve,
                        tokenToReserve: directData.tokenToReserve,
                        tokenFromDecimals: directData.tokenFromDecimals,
                        tokenToDecimals: directData.tokenToDecimals,
                        pool: directData.pool,
                        aToB: directData.aToB,
                        dexId: directData.dexId,
                        poolAddress: directData.poolAddress,
                    }
                );



                const reverseEdge = new Edge(
                    Number(toTokenIndex),
                    Number(fromTokenIndex),
                    {
                        price: reverseData.price,
                        priceUsdc: reverseData.priceUsdc,
                        tokenFromReserve: reverseData.tokenToReserve,
                        tokenToReserve: reverseData.tokenFromReserve,
                        tokenFromDecimals: directData.tokenToDecimals,
                        tokenToDecimals: directData.tokenFromDecimals,
                        pool: directData.pool,
                        fee: reverseData.fee,
                        poolAddress: reverseData.poolAddress,
                        aToB: reverseData.aToB,
                        dexId: directData.dexId,
                    }
                );

                // Append edges to the graph
                graph[Number(fromTokenIndex)].push(directEdge);
                graph[Number(toTokenIndex)].push(reverseEdge);
            } catch (error) {
                console.error("Error processing pool:", wp, error);
                return;
            }
        };
        let count = 0;
        // Process the pools in chunks to limit concurrent requests.
        for (let i = 0; i < data.length; i += CONCURRENCY_LIMIT) {
            const chunk = data.slice(i, i + CONCURRENCY_LIMIT);
            await Promise.all(chunk.map((wp) => processPool(wp)));
            console.log("count: ", count++);
        }


        return graph;
    };
    findUpdateTokenPairPools = async (tokenA: string, tokenB: string): Promise<{ newGraph: Graph, newTokenBiMap: ArrayBiMap<string> }> => {
        const foundPools = await this.calculator.findAllPools(tokenA, tokenB);
        const cachedBiMap = await this.cache.getDexTokenIndexBiMapCache<PoolData>(this.name, this.formatPool);
        const biMap: TokenBiMap<PoolData> = cachedBiMap ?? {
            tokenBiMap: new ArrayBiMap<string>(),
            data: [],
            tokenPoolMap: new Map<string, string>(),
        };
        const tokenBiMap = biMap.tokenBiMap
        const tokenPoolMap = biMap.tokenPoolMap

        const pools = foundPools.map((pool) => pool.poolData);
        console.log('pools: ', pools);
        //update the biMap with the new tokens if any
        pools.forEach((_pool: PoolData) => {
            const pool = _pool;
            const { token0, token1, poolAddress, fee } = pool;
            tokenBiMap.setArrayValue(token0.address.toLowerCase());
            tokenBiMap.setArrayValue(token1.address.toLowerCase());

            tokenPoolMap.set(
                `${token0.address.toLowerCase()}:${fee}:${token1.address.toLowerCase()}`,
                poolAddress);
            // }
        });
        const graph = await this.buildGraphFromPools(pools, tokenBiMap, this.provider);
        const mergedGraph = this.mergeGraphs(await this.getGraph(this.provider, biMap, false), graph, tokenBiMap)
        const mergedTokenBiMap = this.mergeTokenBiMaps(biMap, { tokenBiMap: tokenBiMap, tokenPoolMap: tokenPoolMap, data: pools })

        await this.cache.setDexGraphCache(this.name, mergedGraph);
        await this.cache.setDexTokenIndexBiMapCache(this.name, mergedTokenBiMap)
        return { newGraph: mergedGraph, newTokenBiMap: mergedTokenBiMap.tokenBiMap };

    };
    /**
 * Refresh edge data for existing pools to get updated liquidity, prices, etc.
 * This is separate from adding new pools - it updates the state of existing pools
 */

    // ============== For BaseV3Route ==============

    /**
     * Refresh all edges in the graph with current pool state
     * @param graph - Existing graph to refresh
     * @param tokenBiMap - Token BiMap for lookups
     * @param provider - JSON RPC provider
     * @param poolData - All pool data (existing + new)
     * @returns Updated graph with refreshed edge data
     */
    async refreshGraphEdges(
        graph: Graph,
        tokenBiMap: ArrayBiMap<string>,
        poolData: PoolData[],
        _provider?: JsonRpcProvider
    ): Promise<Graph> {
        console.log(`Refreshing ${poolData.length} pools for ${this.name}`);
        const provider = _provider || this.provider
        const CONCURRENCY_LIMIT = 5; // Can be higher for refreshes
        const refreshedGraph: Graph = graph.map(edges => [...edges]); // Deep copy

        // Create a map of poolAddress -> edges for quick lookup
        const poolAddressToEdges = new Map<string, {
            directEdgeIndex: { fromIndex: number; edgeIndex: number } | null;
            reverseEdgeIndex: { fromIndex: number; edgeIndex: number } | null;
        }>();

        // Build lookup map
        graph.forEach((edges, fromIndex) => {
            edges.forEach((edge, edgeIndex) => {
                const poolAddress = edge.edgeData.poolAddress.toLowerCase();
                const existing = poolAddressToEdges.get(poolAddress) || {
                    directEdgeIndex: null,
                    reverseEdgeIndex: null
                };

                // Determine if this is direct or reverse based on aToB
                if (edge.edgeData.aToB) {
                    existing.directEdgeIndex = { fromIndex, edgeIndex };
                } else {
                    existing.reverseEdgeIndex = { fromIndex, edgeIndex };
                }

                poolAddressToEdges.set(poolAddress, existing);
            });
        });

        const processPool = async (pool: PoolData) => {
            const poolAddress = pool.poolAddress.toLowerCase();
            const edgeLocations = poolAddressToEdges.get(poolAddress);

            if (!edgeLocations) {
                // This is a new pool, not a refresh
                return;
            }

            try {
                // Fetch fresh edge data
                const directData = await this.getEdgeDataDirect<
                    PoolData,
                    SwapQuoteParamWithEdgeData<PoolData>
                >(provider, pool, false).catch(() => null);

                const reverseData = await this.getEdgeDataDirect<
                    PoolData,
                    SwapQuoteParamWithEdgeData<PoolData>
                >(provider, pool, true).catch(() => null);

                if (!directData || !reverseData) {
                    console.warn(`Failed to refresh data for pool ${poolAddress}`);
                    return;
                }

                // Update direct edge if it exists
                if (edgeLocations.directEdgeIndex) {
                    const { fromIndex, edgeIndex } = edgeLocations.directEdgeIndex;
                    const existingEdge = refreshedGraph[fromIndex][edgeIndex];

                    refreshedGraph[fromIndex][edgeIndex] = new Edge(
                        existingEdge.from,
                        existingEdge.to,
                        {
                            price: directData.price,
                            fee: directData.fee,
                            priceUsdc: directData.priceUsdc,
                            tokenFromReserve: directData.tokenFromReserve,
                            tokenToReserve: directData.tokenToReserve,
                            tokenFromDecimals: directData.tokenFromDecimals,
                            tokenToDecimals: directData.tokenToDecimals,
                            pool: directData.pool,
                            aToB: directData.aToB,
                            dexId: directData.dexId,
                            poolAddress: directData.poolAddress,
                        }
                    );
                }

                // Update reverse edge if it exists
                if (edgeLocations.reverseEdgeIndex) {
                    const { fromIndex, edgeIndex } = edgeLocations.reverseEdgeIndex;
                    const existingEdge = refreshedGraph[fromIndex][edgeIndex];

                    refreshedGraph[fromIndex][edgeIndex] = new Edge(
                        existingEdge.from,
                        existingEdge.to,
                        {
                            price: reverseData.price,
                            priceUsdc: reverseData.priceUsdc,
                            tokenFromReserve: reverseData.tokenToReserve,
                            tokenToReserve: reverseData.tokenFromReserve,
                            tokenFromDecimals: directData.tokenToDecimals,
                            tokenToDecimals: directData.tokenFromDecimals,
                            pool: directData.pool,
                            fee: reverseData.fee,
                            poolAddress: reverseData.poolAddress,
                            aToB: reverseData.aToB,
                            dexId: directData.dexId,
                        }
                    );
                }
            } catch (error) {
                console.error(`Error refreshing pool ${poolAddress}:`, error);
            }
        };

        // Process in batches
        let count = 0;
        for (let i = 0; i < poolData.length; i += CONCURRENCY_LIMIT) {
            const chunk = poolData.slice(i, i + CONCURRENCY_LIMIT);
            await Promise.all(chunk.map(pool => processPool(pool)));
            count++;
            if (count % 10 === 0) {
                console.log(`Refreshed ${Math.min(i + CONCURRENCY_LIMIT, poolData.length)}/${poolData.length} pools`);
            }
        }

        console.log(`Edge refresh complete for ${this.name}`);
        return refreshedGraph;
    }

    /**
     * Get all existing pool data (for refresh)
     * This fetches current state of all known pools
     */
    async getAllExistingPoolData(provider?: JsonRpcProvider): Promise<PoolData[]> {
        const cachedTokenBiMap = await this.cache.getDexTokenIndexBiMapCache(
            this.name,
            this.formatPool
        );

        if (!cachedTokenBiMap || !cachedTokenBiMap.data) {
            console.log("No existing pool data found in cache");
            return [];
        }

        console.log(`Fetching current state for ${cachedTokenBiMap.data.length} existing pools`);

        const poolDataPromises = cachedTokenBiMap.data.map(async (pool: PoolData) => {
            try {
                // Fetch fresh pool data from blockchain
                return await this.calculator.getPoolData(pool.poolAddress);
            } catch (error) {
                console.error(`Error fetching pool data for ${pool.poolAddress}:`, error);
                return pool; // Fallback to cached data
            }
        });

        return await Promise.all(poolDataPromises);
    }

    /**
 * Build graph edges only from specific pools (incremental update)
 * @param pools - Array of pool data to process
 * @param tokenBiMap - Token index mapping
 * @param provider - JSON RPC provider
 * @returns Promise<Graph> - Graph with edges only for the provided pools
 */
    async buildGraphFromPools(
        pools: PoolData[],
        tokenBiMap: ArrayBiMap<string>,
        provider: JsonRpcProvider
    ): Promise<Graph> {

        // Initialize empty graph with size based on tokenBiMap
        const graph: Graph = Array.from({ length: tokenBiMap.toArray().length }, () => []);


        // Set the concurrency limit (number of pools processed concurrently)
        const CONCURRENCY_LIMIT = 1;

        console.log(`Building graph from ${pools.length} pools`);

        // Ensure tokenBiMap is proper ArrayBiMap instance
        const tokenIndexBiMap = Array.isArray(tokenBiMap)
            ? new ArrayBiMap<string>(tokenBiMap as any as Array<string>)
            : tokenBiMap;

        // Helper: process one pool
        const processPool = async (wp: PoolData) => {
            console.log('Processing pool:', wp.token0.address, wp.token1.address, wp.poolAddress);

            const fromTokenString = wp.token0.address.toLowerCase();
            const fromTokenIndex = tokenIndexBiMap.getByValue(fromTokenString);
            const toTokenString = wp.token1.address.toLowerCase();
            const toTokenIndex = tokenIndexBiMap.getByValue(toTokenString);

            if (fromTokenIndex === undefined || toTokenIndex === undefined) {
                console.warn(`Token index not found for pool ${wp.poolAddress}`);
                return;
            }

            try {
                // Fetch direct edge data (token0 -> token1)
                const directData = await this.getEdgeDataDirect<
                    PoolData,
                    SwapQuoteParamWithEdgeData<PoolData>
                >(provider, wp, false).catch((err: any) => {
                    console.error(
                        `Error fetching direct data for ${wp.token0.address}:${wp.token1.address}:`,
                        err
                    );
                    return null;
                });
                // Fetch reverse edge data (token1 -> token0)
                const reverseData = await this.getEdgeDataDirect<
                    PoolData,
                    SwapQuoteParamWithEdgeData<PoolData>
                >(provider, wp, true).catch((err) => {
                    console.error(
                        `Error fetching reverse data for ${wp.token1.address}:${wp.token0.address}:`,
                        err
                    );
                    return null;
                });

                if (!directData || !reverseData) {
                    console.warn(
                        `Skipping pool ${wp.poolAddress} due to incomplete data`
                    );
                    return;
                }

                // Create direct edge (token0 -> token1)
                const directEdge = new Edge<SwapQuoteParamWithEdgeDataString>(
                    Number(fromTokenIndex),
                    Number(toTokenIndex),
                    {
                        price: directData.price,
                        fee: directData.fee,
                        priceUsdc: directData.priceUsdc,
                        tokenFromReserve: directData.tokenFromReserve,
                        tokenToReserve: directData.tokenToReserve,
                        tokenFromDecimals: directData.tokenFromDecimals,
                        tokenToDecimals: directData.tokenToDecimals,
                        pool: directData.pool,
                        aToB: directData.aToB,
                        dexId: directData.dexId,
                        poolAddress: directData.poolAddress,
                    }
                );

                // Create reverse edge (token1 -> token0)
                const reverseEdge = new Edge<SwapQuoteParamWithEdgeDataString>(
                    Number(toTokenIndex),
                    Number(fromTokenIndex),
                    {
                        price: reverseData.price,
                        priceUsdc: reverseData.priceUsdc,
                        tokenFromReserve: reverseData.tokenToReserve,
                        tokenToReserve: reverseData.tokenFromReserve,
                        tokenFromDecimals: directData.tokenToDecimals,
                        tokenToDecimals: directData.tokenFromDecimals,
                        pool: directData.pool,
                        fee: reverseData.fee,
                        poolAddress: reverseData.poolAddress,
                        aToB: reverseData.aToB,
                        dexId: directData.dexId,
                    }
                );

                // Add edges to the graph
                graph[Number(fromTokenIndex)].push(directEdge);
                graph[Number(toTokenIndex)].push(reverseEdge);
            } catch (error) {
                console.error("Error processing pool:", wp.poolAddress, error);
                return;
            }
        };

        // Process the pools in chunks to limit concurrent requests
        let count = 0;
        for (let i = 0; i < pools.length; i += CONCURRENCY_LIMIT) {
            const chunk = pools.slice(i, i + CONCURRENCY_LIMIT);
            await Promise.all(chunk.map((wp) => processPool(wp)));
            console.log(`Processed chunk: ${count++}/${Math.ceil(pools.length / CONCURRENCY_LIMIT)}`);
        }

        console.log(`Graph building complete. Processed ${pools.length} pools`);

        return graph;

    }
    getEdgeDataDirect = async <T extends PoolData, R>(
        provider: JsonRpcProvider,
        data: T,
        r: boolean
    ): Promise<R | null> => {
        const priceUsdc = await this.getSurePriceOfToken(
            data.token0.address,
        );
        // console.log('priceUsdc: ', priceUsdc);

        const rPriceUsdc = await this.getSurePriceOfToken(
            data.token1.address,
        );

        const price = this.calculator.calculateSpotPrice(
            new Decimal(data.sqrtPriceX96),
            data.token0.decimals,
            data.token1.decimals,
            !r
        );
        // console.log('price: ', price);
        const res: SwapQuoteParamWithEdgeData<PoolData> = {
            price,
            priceUsdc: r ? rPriceUsdc : priceUsdc,
            tokenFromDecimals: r ? data.token1.decimals : data.token0.decimals,
            tokenToDecimals: r ? data.token0.decimals : data.token1.decimals,
            dexId: this.name,
            aToB: !r,
            poolAddress: data.poolAddress,
            fee: data.fee,
            pool: {
                liquidity: data.liquidity.toString(),
                fee: data.fee,
                sqrtPriceX96: data.sqrtPriceX96,
                token0: data.token0,
                token1: data.token1,
                poolAddress: data.poolAddress,
                slot0: data.slot0,
            }
        }
        return res as R | null
    };
    getSurePriceOfToken = async (tokenAddress: string) => {
        //check if it is cache and return early
        const cachedPrice = await this.cache.getPriceFromCache(tokenAddress)
        if (cachedPrice !== null) {
            return cachedPrice
        }
        const priceUsdc = await this.calculator.getSureTokenPrice(
            tokenAddress,
        );
        await this.cache.setPriceToCache(tokenAddress, priceUsdc)
        return priceUsdc
    }
    getFunctionToMutateEdgeCost = () => {
        //?i should find a way to properly type the below generic instead of using "any"
        let func: FunctionToMutateTheEdgeCostType<any>;
        func = (params, e) => {
            // console.log('params: ', params);
            let swapAmount = (params.key.key * params.key.keyRate) / params.priceUsdc;

            // console.log('params.priceUsdc: ', e.edgeData.priceUsdc);
            // console.log('params.priceUsdc: ', e.edgeData.aToB);


            // console.log('key : ', params.key.key, 'keyRate: ', params.key.keyRate, "dollar value :", (params.key.key * params.key.keyRate), 'params.priceUsdc: ', params.priceUsdc, 'swapAmount: ', swapAmount);


            //divide it by the decimal of the key and then multiply by the current token input decimal

            swapAmount = swapAmount / Math.pow(10, Math.abs(params.key.keyDecimal));
            swapAmount =
                swapAmount * Math.pow(10, Math.abs(params.tokenFromDecimals));
            // console.log('swapAmount: ', swapAmount);
            // console.log('e.edgeData.pool: ', e.edgeData.pool);
            // console.log('e: ', e);
            const swapParams: ZeroDexQuoteParams = {
                pool: this.formatPool(typeof e.edgeData.pool === "string" ? JSON.parse(e.edgeData.pool) : e.edgeData.pool),
                aToB: e.edgeData.aToB,
                amountInFormattedInDecimal: new Decimal(swapAmount),
            };

            // swapParams.ticks;
            // console.log("swap direction : ", swapParams.aToB ? swapParams.pool.token0.symbol : swapParams.pool.token1.symbol, " => ", swapParams.aToB ? swapParams.pool.token1.symbol : swapParams.pool.token0.symbol, "aToB : ", swapParams.aToB, "fee: ", swapParams.pool.fee);
            const res = this.calculator.getAmountOut(swapParams);
            // console.log('swapParams: ', swapParams);
            // console.log('res: ', res);
            if (!res) {
                return 100;
            }

            const amountOut = res.amountOut;

            if (amountOut.lt(new Decimal(0))) {
                return 100;
            }

            const amountIn =
                new Decimal(swapAmount)

            const amountBOut = amountOut

            let amountOutInTokenA = amountBOut.div(params.price ?? 0)
            // Calculate swap impact
            const _swapImpact = (((amountIn.sub(amountOutInTokenA)).div(amountIn)).mul(100)).toNumber()
            if (isNaN(_swapImpact)) {
                // console.warn("Swap impact is NaN, returning 100");
                return 100;
            }
            // console.log(
            //     "DEX ID", e.edgeData.dexId,
            //     "_swapImpact: ", _swapImpact,
            //     "from", e?.from,
            //     "to", e?.to,
            //     "from decimals", params.tokenFromDecimals,
            //     "to decimals", params.tokenToDecimals,
            // );

            // console.log(
            //     "amountBOut: =>", amountBOut.toNumber(),
            //     "params.price: ", params.price,
            //     "amountIn", amountIn.toNumber(),
            //     "amountOutInTokenA: ", amountOutInTokenA.toNumber()
            // );
            // console.log("======================================")


            return Math.max(0, _swapImpact);
        };

        return func;
    };
    getTokenPairEdgeData = async (tokenA: string, tokenB: string) => {
        const routeData = await this.getTokenBiMap(this.provider);
        const tokenAIndex = routeData.tokenBiMap.getByValue(tokenA);
        // console.log("tokenAIndex: ", tokenAIndex);
        const tokenBIndex = routeData.tokenBiMap.getByValue(tokenB);
        // console.log("tokenBIndex: ", tokenBIndex);
        if (tokenAIndex === undefined || tokenBIndex === undefined) {
            throw new Error("DEX_ERRORS.PAIR_NOT_AVAILABLE_ON_DEX");
        }
        const graph = await this.getGraph();
        const edges = graph[tokenAIndex];
        const edgeData = edges.find((e) => e.to === tokenBIndex);
        if (!edgeData) {
            return null;
        }

        return edgeData;
    };
    calculateRoutePrice = async (
        route: DeserializeRoutePlan<DexIdTypes>[]
    ): Promise<number> => {
        let finalPrice = 1;

        // Iterate over each segment in the route.
        for (const segment of route) {
            try {
                // Try to get the price from the edge data between the tokens.
                // This function may throw if no edge exists.
                const edgeData = await this.getTokenPairEdgeData(
                    (segment.tokenA),
                    (segment.tokenB)
                );
                if (!edgeData) {
                    throw new Error(
                        `Price not available for token pair ${segment.tokenA} - ${segment.tokenB}`
                    );
                }
                // Assume that edgeData contains a 'price' field.
                finalPrice *= edgeData.edgeData.price;
            } catch (error) {
                // If the edge data isn't available, fall back to using a price provided on the segment.

                throw new Error(
                    `Price not available for token pair ${segment.tokenA} - ${segment.tokenB}`
                );
            }
        }

        return finalPrice;
    };
    getTokenXAndYFromPool = (pool: PoolData) => {
        const { token0, token1 } = pool;
        return {
            tokenX: token0.address,
            tokenY: token1.address,
        };
    };
}

export const getTransactionInstructionFromRoutePlanV3 = async <DexIdTypes>(
    dexConfig: DexConfig,
    chainConfig: ChainConfig,
    amountFormattedToTokenDecimal: Decimal,
    routePlan: DeserializeRoutePlan<DexIdTypes>[],
    connection: JsonRpcProvider,
    calculator: UniswapV3QuoteCalculator

) => {
    //TODO: SKIPPING VALIDATION FOR NOW
    // routePlan.map((r) => {
    //     if (r.dexId !== "ZERO_G") {
    //         throw new Error(
    //             "One or all of the passed route is not a ZERO_G route path"
    //         );
    //     }
    // });

    let currentAmountIn = new Decimal(amountFormattedToTokenDecimal);
    const changedPoolList = []

    for (let i = 0; i < routePlan.length; i++) {
        const route = routePlan[i];

        const { amountOut, pool } = await calculator.simulateTransaction(
            route.tokenA,
            route.tokenB,
            currentAmountIn.toString(),
            route.poolAddress,
            route.fee,
        );

        currentAmountIn = new Decimal(amountOut)
        changedPoolList.push(pool)
    }

    return { amountOut: currentAmountIn, pools: changedPoolList };
};


export const getTransactionFromRoutePlanZeroG = async <DexIdTypes>(
    dexConfig: DexConfig,
    amountIn: Decimal,
    amountOut: Decimal,
    routePlan: DeserializeRoutePlan<DexIdTypes>[],
    wallet: string,
    slippage: number,
    connection: JsonRpcProvider,
    isNativeIn: boolean,
    isNativeOut: boolean,
    partnerFees?: { recipient: string; fee: number }
) => {
    // console.log('routePlan: ', routePlan);
    const paths = transformRoutePlanToIPath(dexConfig.factoryAddress, routePlan, dexConfig.nativeTokenAddress, dexConfig.wrappedNativeTokenAddress, isNativeIn, isNativeOut);
    const slippageMultiplier = new Decimal(1).minus(slippage / 100);
    const minAmountOut = amountOut.mul(slippageMultiplier)
    // console.log('minAmountOut: ', minAmountOut);

    // console.log('amountIn: ', amountIn);
    // console.log('amountIn.toFixed(0),: ', amountIn.toFixed(0),);
    // console.log('minAmountOut.toFixed(0): ', minAmountOut.toFixed(0));
    // console.log('paths: ', paths);
    const txs = await createSwapTX(
        {
            path: paths,
            amountInRaw: amountIn.toFixed(0),
            minAmountOut: minAmountOut.toFixed(0),
        },
        wallet, connection, { id: dexConfig.network, rpc: connection._getConnection().url }, partnerFees ? partnerFees : undefined
    );

    const transactions: TransactionRequest[] = txs.map((tx) => ({
        from: wallet,
        to: tx.to,
        data: tx.data,
        value: tx.value, // make sure this is BigNumberish (string, number, or BigNumber)
    }));

    return { transactions };

};