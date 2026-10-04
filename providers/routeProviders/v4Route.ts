/**
 * Base V4 Route Provider
 * 
 * Implements IRoute for Uniswap V4 architectures (PoolManager singleton)
 * providing on-demand pool discovery, bidirectional graph edges,
 * Dijkstra routing, and live Quoter simulations.
 */

import {
    ArrayBiMap,
    Edge,
    EdgeData,
    FunctionToMutateTheEdgeCostType,
    Graph,
    TokenBiMap,
} from "@deserialize-evm-agg/graph";
import { Decimal } from "decimal.js";
import { ethers, JsonRpcProvider, TransactionRequest } from "ethers";
import {
    DeserializeRoutePlan,
    IRoute,
    SwapQuoteParamWithEdgeData,
    SwapQuoteParamWithEdgeDataString,
} from "./IRoute";
import { ChainConfig, DexConfig } from "./UniswapV3Calculator";
import {
    BaseV4QuoteCalculator,
    V4DexConfig,
    V4PoolData,
} from "./BaseV4Calculator";
import { DexCache } from "@deserialize-evm-agg/cache";

export class BaseV4Route<DexIdTypes> implements IRoute<V4PoolData, DexIdTypes> {
    public name: DexIdTypes;
    public network: string;
    public chainConfig: ChainConfig;
    public dexConfig: V4DexConfig;
    public cache: DexCache<any>;
    public provider: JsonRpcProvider;
    public calculator: BaseV4QuoteCalculator;

    constructor(
        name: DexIdTypes,
        dexConfig: V4DexConfig,
        chainConfig: ChainConfig,
        provider: JsonRpcProvider,
        cache: DexCache<any>
    ) {
        this.name = name;
        this.network = chainConfig.network;
        this.chainConfig = chainConfig;
        this.dexConfig = dexConfig;
        this.provider = provider;
        this.cache = cache;
        this.calculator = new BaseV4QuoteCalculator(dexConfig, chainConfig, provider);
    }

    formatPool = (pool: any): V4PoolData => {
        return this.calculator.formatPool(pool);
    };

    getDexConfig = (): DexConfig => {
        return {
            name: this.dexConfig.name,
            network: this.dexConfig.network,
            factoryAddress: this.dexConfig.factoryAddress,
            quoterAddress: this.dexConfig.quoterAddress,
            wrappedNativeTokenAddress: this.dexConfig.wrappedNativeTokenAddress,
            nativeTokenAddress: this.dexConfig.nativeTokenAddress,
            stableTokenAddress: this.dexConfig.stableTokenAddress,
            abi: [],
        };
    };

    getTokenBiMap = async <T = V4PoolData>(
        _provider?: JsonRpcProvider
    ): Promise<TokenBiMap<T>> => {
        const cachedData = await this.cache.getDexTokenIndexBiMapCache(
            this.name as any,
            this.formatPool
        );
        if (cachedData) {
            return cachedData as TokenBiMap<T>;
        }

        const biMap = new ArrayBiMap<string>();
        const data: V4PoolData[] = [];
        const tokenPoolMap = new Map<string, string>();

        const tokenA = this.chainConfig.wrappedNativeTokenAddress;
        const tokenB = this.chainConfig.stableTokenAddress;

        if (tokenA && tokenB) {
            try {
                const foundPools = await this.calculator.findAllPools(tokenA, tokenB, _provider || this.provider);
                for (const p of foundPools) {
                    const pool = p.poolData;
                    biMap.setArrayValue(pool.token0.address.toLowerCase());
                    biMap.setArrayValue(pool.token1.address.toLowerCase());
                    data.push(pool);
                    tokenPoolMap.set(
                        `${pool.token0.address.toLowerCase()}:${pool.fee}:${pool.token1.address.toLowerCase()}`,
                        pool.poolId
                    );
                }
            } catch {
                // Discovery will happen on-demand
            }
        }

        const result: TokenBiMap<T> = {
            tokenBiMap: biMap,
            data: data as unknown as T[],
            tokenPoolMap,
        };

        await this.cache.setDexTokenIndexBiMapCache(this.name as any, result);
        return result;
    };

    getNewTokenBiMap = async <T = V4PoolData>(
        _provider: JsonRpcProvider
    ): Promise<TokenBiMap<T>> => {
        return {
            tokenBiMap: new ArrayBiMap<string>(),
            data: [] as T[],
            tokenPoolMap: new Map<string, string>(),
        };
    };

    getGraph = async (
        provider?: JsonRpcProvider,
        _tokenBiMap?: TokenBiMap<V4PoolData>,
        ignoreCache?: boolean
    ): Promise<Graph> => {
        if (!ignoreCache) {
            const cachedData = await this.cache.getDexGraphCache(this.name as any);
            if (cachedData) {
                return cachedData as Graph;
            }
        }

        let tokenBiMap: TokenBiMap<V4PoolData>;
        if (_tokenBiMap) {
            tokenBiMap = _tokenBiMap;
        } else {
            tokenBiMap = (await this.getTokenBiMap<V4PoolData>(provider)) as TokenBiMap<V4PoolData>;
        }

        const graph = await this.getNewGraph(tokenBiMap, provider || this.provider);
        this.cache.setDexGraphCache(this.name as any, graph);
        return graph;
    };

    getNewGraph = async (
        tokenBiMap?: TokenBiMap<V4PoolData>,
        _provider?: JsonRpcProvider
    ): Promise<Graph> => {
        const provider = _provider || this.provider;
        let tokenIndexBiMap: ArrayBiMap<string>;
        let data: V4PoolData[];

        if (tokenBiMap) {
            tokenIndexBiMap = tokenBiMap.tokenBiMap;
            data = tokenBiMap.data as V4PoolData[];
        } else {
            const biMap = await this.getTokenBiMap<V4PoolData>(provider);
            tokenIndexBiMap = biMap.tokenBiMap;
            data = biMap.data as V4PoolData[];
        }

        return await this.buildGraphFromPools(data, tokenIndexBiMap, provider);
    };

    buildGraphFromPools = async (
        pools: V4PoolData[],
        tokenBiMap: ArrayBiMap<string>,
        provider: JsonRpcProvider
    ): Promise<Graph> => {
        const graph: Graph = Array.from({ length: tokenBiMap.toArray().length }, () => []);
        if (!pools || pools.length === 0) return graph;

        for (const wp of pools) {
            const fromTokenString = wp.token0.address.toLowerCase();
            const fromTokenIndex = tokenBiMap.getByValue(fromTokenString);
            const toTokenString = wp.token1.address.toLowerCase();
            const toTokenIndex = tokenBiMap.getByValue(toTokenString);

            if (fromTokenIndex === undefined || toTokenIndex === undefined) {
                continue;
            }

            try {
                const directData = await this.getEdgeDataDirect<V4PoolData, SwapQuoteParamWithEdgeData<V4PoolData>>(
                    provider,
                    wp,
                    false
                );
                const reverseData = await this.getEdgeDataDirect<V4PoolData, SwapQuoteParamWithEdgeData<V4PoolData>>(
                    provider,
                    wp,
                    true
                );

                if (!directData || !reverseData) continue;

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

                graph[Number(fromTokenIndex)].push(directEdge);
                graph[Number(toTokenIndex)].push(reverseEdge);
            } catch {
                // Ignore single edge failure
            }
        }

        return graph;
    };

    getEdgeDataDirect = async <T extends V4PoolData, R extends EdgeData>(
        _provider: JsonRpcProvider,
        wp: T,
        isReverse: boolean
    ): Promise<R | null> => {
        try {
            const tokenIn = isReverse ? wp.token1 : wp.token0;
            const tokenOut = isReverse ? wp.token0 : wp.token1;

            const quote = this.calculator.getAmountOut({
                pool: wp,
                aToB: !isReverse,
                amountInFormattedInDecimal: new Decimal(1),
            });

            const price = quote.price || 0;
            const priceUsdc = await this.getPrice(tokenIn.address);

            const result: SwapQuoteParamWithEdgeData<V4PoolData> = {
                price,
                fee: wp.fee,
                priceUsdc,
                tokenFromReserve: Number(wp.liquidity) || 0,
                tokenToReserve: Number(wp.liquidity) || 0,
                tokenFromDecimals: tokenIn.decimals,
                tokenToDecimals: tokenOut.decimals,
                pool: wp,
                aToB: !isReverse,
                dexId: this.name as any,
                poolAddress: wp.poolId,
            };

            return result as unknown as R;
        } catch {
            return null;
        }
    };

    findUpdateTokenPairPools = async (
        tokenA: string,
        tokenB: string
    ): Promise<{ newGraph: Graph; newTokenBiMap: ArrayBiMap<string> }> => {
        const foundPools = await this.calculator.findAllPools(tokenA, tokenB, this.provider);
        const biMap = await this.getTokenBiMap<V4PoolData>(this.provider);

        if (foundPools.length === 0) {
            const currentGraph = await this.getGraph(this.provider, biMap, false);
            return { newGraph: currentGraph, newTokenBiMap: biMap.tokenBiMap };
        }

        const tokenBiMap = new ArrayBiMap<string>();
        const tokenPoolMap = new Map<string, string>();
        const pools = foundPools.map((p) => p.poolData);

        pools.forEach((pool: V4PoolData) => {
            const { token0, token1, poolId, fee } = pool;
            tokenBiMap.setArrayValue(token0.address.toLowerCase());
            tokenBiMap.setArrayValue(token1.address.toLowerCase());

            tokenPoolMap.set(
                `${token0.address.toLowerCase()}:${fee}:${token1.address.toLowerCase()}`,
                poolId
            );
        });

        const graph = await this.buildGraphFromPools(pools, tokenBiMap, this.provider);
        const existingGraph = await this.getGraph(this.provider, biMap, false);
        const mergedGraph = this.mergeGraphs(existingGraph, graph, tokenBiMap);
        const mergedTokenBiMap = this.mergeTokenBiMaps(biMap, {
            tokenBiMap,
            tokenPoolMap,
            data: pools,
        });

        await this.cache.setDexGraphCache(this.name as any, mergedGraph);
        await this.cache.setDexTokenIndexBiMapCache(this.name as any, mergedTokenBiMap);

        return { newGraph: mergedGraph, newTokenBiMap: mergedTokenBiMap.tokenBiMap };
    };

    getFunctionToMutateEdgeCost = <T extends EdgeData>(): FunctionToMutateTheEdgeCostType<T> => {
        const func: FunctionToMutateTheEdgeCostType<any> = (params, e) => {
            let swapAmount = (params.key.key * params.key.keyRate) / params.priceUsdc;
            swapAmount = swapAmount / Math.pow(10, Math.abs(params.key.keyDecimal));
            swapAmount = swapAmount * Math.pow(10, Math.abs(params.tokenFromDecimals));

            const rawPool = typeof e.edgeData.pool === "string" ? JSON.parse(e.edgeData.pool) : e.edgeData.pool;
            const pool = this.formatPool(rawPool);

            const res = this.calculator.getAmountOut({
                pool,
                aToB: e.edgeData.aToB,
                amountInFormattedInDecimal: new Decimal(swapAmount),
            });

            if (!res || res.amountOut.lte(0)) {
                return 100;
            }

            const amountIn = new Decimal(swapAmount);
            const amountOut = res.amountOut;
            const amountOutInTokenA = amountOut.div(params.price || 1);
            const swapImpact = amountIn.sub(amountOutInTokenA).div(amountIn).mul(100).toNumber();

            return Math.max(0, swapImpact);
        };
        return func;
    };

    getAmountOutFromPlan = async (
        amountFormattedToTokenDecimal: Decimal,
        routePlan: DeserializeRoutePlan<DexIdTypes>[],
        _devFeeRate: number,
        _provider?: JsonRpcProvider
    ): Promise<{ amountOut: Decimal; pools: string[] }> => {
        let currentAmountIn = new Decimal(amountFormattedToTokenDecimal);
        const changedPoolList: string[] = [];

        for (const route of routePlan) {
            const { amountOut, pool } = await this.calculator.simulateTransaction(
                route.tokenA,
                route.tokenB,
                currentAmountIn.toString(),
                route.poolAddress,
                _provider || this.provider
            );
            currentAmountIn = new Decimal(amountOut);
            changedPoolList.push(pool);
        }

        return { amountOut: currentAmountIn, pools: changedPoolList };
    };

    getTransactionInstructionFromRoutePlan = async (
        _amountFormattedToTokenDecimal: Decimal,
        _routePlan: DeserializeRoutePlan<DexIdTypes>[],
        _wallet: string,
        _slippage: number,
        _isNativeIn: boolean,
        _isNativeOut: boolean,
        _partnerFees?: { recipient: string; fee: number }
    ): Promise<{ transactions: TransactionRequest[]; amountOut?: Decimal; feeAmount?: Decimal }> => {
        throw new Error(
            `No on-chain adapter registered in AdapterTracker for ${this.dexConfig.name}. Please register an adapter before executing on-chain transactions.`
        );
    };

    mergeTokenBiMaps(
        existing: TokenBiMap<V4PoolData>,
        newMap: TokenBiMap<V4PoolData>
    ): TokenBiMap<V4PoolData> {
        const mergedBiMap = new ArrayBiMap<string>(existing.tokenBiMap.toArray());
        const existingPoolIds = new Set(
            (existing.data as V4PoolData[]).map((d) => d.poolId?.toLowerCase?.())
        );

        newMap.tokenBiMap.toArray().forEach((token) => {
            if (mergedBiMap.getByValue(token) === undefined) {
                mergedBiMap.setArrayValue(token);
            }
        });

        const mergedData = [
            ...existing.data,
            ...(newMap.data as V4PoolData[]).filter(
                (d) => !existingPoolIds.has(d.poolId?.toLowerCase?.())
            ),
        ];

        const mergedTokenPoolMap = new Map(existing.tokenPoolMap);
        newMap.tokenPoolMap.forEach((value, key) => {
            if (!mergedTokenPoolMap.has(key)) {
                mergedTokenPoolMap.set(key, value);
            }
        });

        return {
            tokenBiMap: mergedBiMap,
            data: mergedData,
            tokenPoolMap: mergedTokenPoolMap,
        };
    }

    mergeGraphs(existing: Graph, newEdges: Graph, tokenBiMap: ArrayBiMap<string>): Graph {
        const merged = existing.length > 0
            ? existing.map((edges) => [...edges])
            : Array.from({ length: tokenBiMap.toArray().length }, () => []);

        newEdges.forEach((edges, fromIndex) => {
            if (!merged[fromIndex]) {
                merged[fromIndex] = [];
            }
            edges.forEach((edge) => {
                const existingIndex = merged[fromIndex].findIndex(
                    (e) => e.to === edge.to && e.edgeData.poolAddress === edge.edgeData.poolAddress
                );
                if (existingIndex >= 0) {
                    merged[fromIndex][existingIndex] = edge;
                } else {
                    merged[fromIndex].push(edge);
                }
            });
        });

        return merged;
    }

    listTokens = async (): Promise<string[]> => {
        const routeData = await this.getTokenBiMap(this.provider);
        return routeData.tokenBiMap.toArray();
    };

    refreshGraphEdges = async (
        graph: Graph,
        _tokenBiMap: ArrayBiMap<string>,
        _poolData: V4PoolData[],
        _provider?: JsonRpcProvider
    ): Promise<Graph> => {
        return graph;
    };

    getAllExistingPoolData = async (_provider?: JsonRpcProvider): Promise<V4PoolData[]> => {
        const biMap = await this.getTokenBiMap<V4PoolData>(_provider);
        return (biMap.data || []) as V4PoolData[];
    };

    getPrice = async (tokenAddress: string): Promise<number> => {
        const cached = await this.cache.getPriceFromCache(tokenAddress);
        if (cached && cached > 0) {
            return cached;
        }
        const price = await this.calculator.getSureTokenPrice(tokenAddress);
        await this.cache.setPriceToCache(tokenAddress, price);
        return price;
    };

    getSurePriceOfToken = async (tokenAddress: string): Promise<number | null> => {
        return await this.getPrice(tokenAddress);
    };

    getTokenPairEdgeData = async (tokenA: string, tokenB: string): Promise<Edge<EdgeData> | null> => {
        const routeData = await this.getTokenBiMap(this.provider);
        const tokenAIndex = routeData.tokenBiMap.getByValue(tokenA.toLowerCase());
        const tokenBIndex = routeData.tokenBiMap.getByValue(tokenB.toLowerCase());
        if (tokenAIndex === undefined || tokenBIndex === undefined) {
            return null;
        }
        const graph = await this.getGraph();
        const edges = graph[tokenAIndex];
        return edges?.find((e) => e.to === tokenBIndex) || null;
    };

    calculateRoutePrice = async (route: DeserializeRoutePlan<DexIdTypes>[]): Promise<number> => {
        let finalPrice = 1;
        for (const segment of route) {
            const edgeData = await this.getTokenPairEdgeData(segment.tokenA, segment.tokenB);
            if (!edgeData) {
                throw new Error(`Price not available for token pair ${segment.tokenA} - ${segment.tokenB}`);
            }
            finalPrice *= edgeData.edgeData.price;
        }
        return finalPrice;
    };

    getTokenXAndYFromPool = (pool: V4PoolData): { tokenX: string; tokenY: string } => {
        return {
            tokenX: pool.token0.address,
            tokenY: pool.token1.address,
        };
    };
}

export const createV4Route = <DexIdTypes>(
    name: DexIdTypes,
    dexConfig: V4DexConfig,
    chainConfig: ChainConfig
) => {
    return class ConfiguredV4Route extends BaseV4Route<DexIdTypes> {
        constructor(provider: JsonRpcProvider, cache: DexCache<any>) {
            super(name, dexConfig, chainConfig, provider, cache);
        }
    };
};
