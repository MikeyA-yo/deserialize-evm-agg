import { ArrayBiMap, Edge, EdgeData, FunctionToMutateTheEdgeCostType, Graph, TokenBiMap } from "@deserialize-evm-agg/graph";
import { Decimal } from "decimal.js";
import { JsonRpcProvider, TransactionRequest } from "ethers";
import { DexCache } from "@deserialize-evm-agg/cache";
import { ChainConfig, DexConfig } from "./UniswapV3Calculator";
import { BaseV2QuoteCalculator, PairData, V2DexConfig } from "./BaseV2Calculator";
import { DeserializeRoutePlan, IRoute, SwapQuoteParamWithEdgeData, SwapQuoteParamWithEdgeDataString } from "./IRoute";
import { rawSwapImpactCost, transformRoutePlanToIPath, usdReferencePrice } from "./utils";
import { createSwapTX } from "@deserialize-evm-agg/swap-contract-sdk";
import { NetworkType } from "./constants";
import { RouteConstructor } from "./v3Route";

export type V2RouteConstructor<DexIdTypes> = new (
    provider: JsonRpcProvider,
    cache: DexCache<DexIdTypes>
) => BaseV2Route<DexIdTypes>;

export const createV2Route = <DexIdTypes>(
    config: V2DexConfig,
    chain: ChainConfig,
    dexId: DexIdTypes,
    _calculator?: BaseV2QuoteCalculator
): RouteConstructor<any, PairData> => {
    const calc = _calculator || new BaseV2QuoteCalculator(config, chain);

    return class ConfiguredV2Route extends BaseV2Route<DexIdTypes> {
        constructor(provider: JsonRpcProvider, cache: DexCache<DexIdTypes>) {
            super(provider, cache, config, chain, dexId, chain.network as NetworkType, calc);
        }
    };
};

export class BaseV2Route<DexIdTypes> implements IRoute<PairData, DexIdTypes> {
    name: DexIdTypes;
    network: NetworkType;
    chainConfig: ChainConfig;
    dexConfig: V2DexConfig;
    provider: JsonRpcProvider;
    cache: DexCache<DexIdTypes>;
    calculator: BaseV2QuoteCalculator;

    constructor(
        provider: JsonRpcProvider,
        cache: DexCache<DexIdTypes>,
        config: V2DexConfig,
        chain: ChainConfig,
        dexId: DexIdTypes,
        network: NetworkType,
        calculator: BaseV2QuoteCalculator
    ) {
        this.provider = provider;
        this.cache = cache;
        this.chainConfig = chain;
        this.dexConfig = config;
        this.calculator = calculator;
        this.name = dexId;
        this.network = network;
    }

    getDexConfig = (): DexConfig => {
        return {
            name: this.dexConfig.name,
            network: this.dexConfig.network,
            factoryAddress: this.dexConfig.factoryAddress,
            quoterAddress: this.dexConfig.routerAddress || "",
            fromBlock: this.dexConfig.fromBlock || "0",
            abi: this.dexConfig.abi || [],
            wrappedNativeTokenAddress: this.dexConfig.wrappedNativeTokenAddress,
            nativeTokenAddress: this.dexConfig.nativeTokenAddress,
            stableTokenAddress: this.dexConfig.stableTokenAddress,
        };
    };

    getTokenBiMap = async <T = PairData>(
        _provider?: JsonRpcProvider
    ): Promise<TokenBiMap<T>> => {
        const cachedData = await this.cache.getDexTokenIndexBiMapCache(
            this.name as any,
            this.formatPool as any
        );
        if (cachedData) {
            return cachedData as TokenBiMap<T>;
        }

        return {
            tokenBiMap: new ArrayBiMap<string>(),
            data: [] as T[],
            tokenPoolMap: new Map<string, string>(),
        };
    };

    getNewTokenBiMap = async <T = PairData>(
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
        _tokenBiMap?: TokenBiMap<PairData>,
        ignoreCache?: boolean
    ): Promise<Graph> => {
        if (!ignoreCache) {
            const cachedData = await this.cache.getDexGraphCache(this.name as any);
            if (cachedData) {
                return cachedData as Graph;
            }
        }

        let tokenBiMap: TokenBiMap<PairData>;
        if (_tokenBiMap) {
            tokenBiMap = _tokenBiMap;
        } else {
            tokenBiMap = (await this.getTokenBiMap<PairData>(provider)) as TokenBiMap<PairData>;
        }

        const graph = await this.getNewGraph(tokenBiMap, provider || this.provider);
        this.cache.setDexGraphCache(this.name as any, graph);
        return graph;
    };

    getNewGraph = async (
        tokenBiMap?: TokenBiMap<PairData>,
        _provider?: JsonRpcProvider
    ): Promise<Graph> => {
        const provider = _provider || this.provider;
        let tokenIndexBiMap: ArrayBiMap<string>;
        let data: PairData[];

        if (tokenBiMap) {
            tokenIndexBiMap = tokenBiMap.tokenBiMap;
            data = tokenBiMap.data as PairData[];
        } else {
            const biMap = await this.getTokenBiMap<PairData>(provider);
            tokenIndexBiMap = biMap.tokenBiMap;
            data = biMap.data as PairData[];
        }

        return await this.buildGraphFromPools(data, tokenIndexBiMap, provider);
    };

    buildGraphFromPools = async (
        pools: PairData[],
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
                const directData = await this.getEdgeDataDirect<PairData, SwapQuoteParamWithEdgeData<PairData>>(
                    provider,
                    wp,
                    false
                );
                const reverseData = await this.getEdgeDataDirect<PairData, SwapQuoteParamWithEdgeData<PairData>>(
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
            } catch (error) {
                console.error(`[V2:GRAPH_BUILD_ERR] Error processing pool ${wp.pairAddress}:`, error);
            }
        }

        return graph;
    };

    getEdgeDataDirect = async <T extends PairData, R>(
        _provider: JsonRpcProvider,
        data: T,
        r: boolean
    ): Promise<R | null> => {
        const priceUsdc = await this.getSurePriceOfToken(data.token0.address);
        const rPriceUsdc = await this.getSurePriceOfToken(data.token1.address);

        const r0Human = new Decimal(data.reserve0).div(new Decimal(10).pow(data.token0.decimals));
        const r1Human = new Decimal(data.reserve1).div(new Decimal(10).pow(data.token1.decimals));

        const price = this.calculator.calculateSpotPrice(r0Human, r1Human, !r);

        const res: SwapQuoteParamWithEdgeData<PairData> = {
            price,
            priceUsdc: r ? rPriceUsdc : priceUsdc,
            tokenFromDecimals: r ? data.token1.decimals : data.token0.decimals,
            tokenToDecimals: r ? data.token0.decimals : data.token1.decimals,
            tokenFromReserve: r ? r1Human.toNumber() : r0Human.toNumber(),
            tokenToReserve: r ? r0Human.toNumber() : r1Human.toNumber(),
            dexId: this.name,
            aToB: !r,
            poolAddress: data.pairAddress,
            fee: data.fee,
            pool: {
                pairAddress: data.pairAddress,
                poolAddress: data.pairAddress,
                token0: data.token0,
                token1: data.token1,
                reserve0: data.reserve0,
                reserve1: data.reserve1,
                fee: data.fee,
                blockTimestampLast: data.blockTimestampLast,
                token0PriceUsd: priceUsdc,
                token1PriceUsd: rPriceUsdc,
            },
        };

        return res as R | null;
    };

    findUpdateTokenPairPools = async (
        tokenA: string,
        tokenB: string
    ): Promise<{ newGraph: Graph; newTokenBiMap: ArrayBiMap<string> }> => {
        const foundPools = await this.calculator.findAllPools(tokenA, tokenB);
        const cachedBiMap = await this.cache.getDexTokenIndexBiMapCache<PairData>(
            this.name as any,
            this.formatPool
        );

        const biMap: TokenBiMap<PairData> = cachedBiMap ?? {
            tokenBiMap: new ArrayBiMap<string>(),
            data: [],
            tokenPoolMap: new Map<string, string>(),
        };

        const tokenBiMap = biMap.tokenBiMap;
        const tokenPoolMap = biMap.tokenPoolMap;
        const pools = foundPools.map((p) => p.poolData);

        pools.forEach((pool: PairData) => {
            const { token0, token1, pairAddress, fee } = pool;
            tokenBiMap.setArrayValue(token0.address.toLowerCase());
            tokenBiMap.setArrayValue(token1.address.toLowerCase());

            tokenPoolMap.set(
                `${token0.address.toLowerCase()}:${fee}:${token1.address.toLowerCase()}`,
                pairAddress
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
            const rawPool = typeof e.edgeData.pool === "string" ? JSON.parse(e.edgeData.pool) : e.edgeData.pool;
            const pool = this.formatPool(rawPool);

            return rawSwapImpactCost(
                params,
                (amountInRaw) =>
                    this.calculator.getAmountOut({
                        pool,
                        aToB: e.edgeData.aToB,
                        amountInFormattedInDecimal: amountInRaw,
                    }).amountOut,
                usdReferencePrice(pool, e.edgeData.aToB)
            );
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
                route.poolAddress
            );
            currentAmountIn = new Decimal(amountOut);
            changedPoolList.push(pool);
        }

        return { amountOut: currentAmountIn, pools: changedPoolList };
    };

    getTransactionInstructionFromRoutePlan = async (
        amountFormattedToTokenDecimal: Decimal,
        routePlan: DeserializeRoutePlan<DexIdTypes>[],
        wallet: string,
        slippage: number,
        isNativeIn: boolean,
        isNativeOut: boolean,
        partnerFees?: { recipient: string; fee: number }
    ): Promise<{ transactions: TransactionRequest[]; amountOut?: Decimal; feeAmount?: Decimal }> => {
        const { amountOut } = await this.getAmountOutFromPlan(amountFormattedToTokenDecimal, routePlan, 0, this.provider);
        return await getTransactionFromRoutePlanV2(
            this.dexConfig,
            this.chainConfig,
            amountFormattedToTokenDecimal,
            amountOut,
            routePlan,
            wallet,
            slippage,
            this.provider,
            isNativeIn,
            isNativeOut,
            partnerFees
        );
    };

    mergeTokenBiMaps(
        existing: TokenBiMap<PairData>,
        newMap: TokenBiMap<PairData>
    ): TokenBiMap<PairData> {
        const mergedBiMap = new ArrayBiMap<string>(existing.tokenBiMap.toArray());
        const existingPoolAddresses = new Set(
            (existing.data as PairData[]).map((d) => d.pairAddress?.toLowerCase?.())
        );

        newMap.tokenBiMap.toArray().forEach((token) => {
            if (mergedBiMap.getByValue(token) === undefined) {
                mergedBiMap.setArrayValue(token);
            }
        });

        const mergedData = [
            ...existing.data,
            ...(newMap.data as PairData[]).filter(
                (d) => !existingPoolAddresses.has(d.pairAddress?.toLowerCase?.())
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

        // Pad to the token map size so no node is left undefined (holes break graph traversal).
        const targetSize = tokenBiMap.toArray().length;
        for (let i = 0; i < Math.max(targetSize, merged.length); i++) {
            if (!merged[i]) merged[i] = [];
        }

        return merged;
    }

    listTokens = async (): Promise<string[]> => {
        const routeData = await this.getTokenBiMap(this.provider);
        return routeData.tokenBiMap.toArray();
    };

    refreshGraphEdges = async (
        graph: Graph,
        tokenBiMap: ArrayBiMap<string>,
        poolData: PairData[],
        _provider?: JsonRpcProvider
    ): Promise<Graph> => {
        const refreshedEdges = await this.buildGraphFromPools(poolData, tokenBiMap, _provider || this.provider);
        return this.mergeGraphs(graph, refreshedEdges, tokenBiMap);
    };

    /**
     * Returns every cached pair with live reserves (falls back to the cached pair if the read fails).
     */
    getAllExistingPoolData = async (_provider?: JsonRpcProvider): Promise<PairData[]> => {
        const biMap = await this.getTokenBiMap<PairData>(_provider);
        const cachedPairs = (biMap.data as PairData[]) || [];

        return await Promise.all(
            cachedPairs.map(async (pair) => {
                try {
                    return await this.calculator.getPairData(pair.pairAddress);
                } catch (error) {
                    console.error(`[V2:REFRESH_ERR] Error fetching reserves for ${pair.pairAddress}:`, error);
                    return pair;
                }
            })
        );
    };

    formatPool = (pool: any): PairData => {
        return {
            pairAddress: pool.pairAddress || pool.poolAddress,
            poolAddress: pool.pairAddress || pool.poolAddress,
            token0: pool.token0,
            token1: pool.token1,
            reserve0: pool.reserve0?.toString?.() || "0",
            reserve1: pool.reserve1?.toString?.() || "0",
            blockTimestampLast: pool.blockTimestampLast,
            fee: pool.fee || this.dexConfig.feeBps,
            token0PriceUsd: pool.token0PriceUsd,
            token1PriceUsd: pool.token1PriceUsd,
        };
    };

    getSurePriceOfToken = async (tokenAddress: string): Promise<number> => {
        const cachedPrice = await this.cache.getPriceFromCache(tokenAddress);
        if (cachedPrice !== null) {
            return cachedPrice;
        }
        const price = await this.calculator.getSureTokenPrice(tokenAddress);
        // Only cache real prices; the price cache is shared with every other DEX route.
        if (price > 0) {
            await this.cache.setPriceToCache(tokenAddress, price);
        }
        return price;
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

    getTokenXAndYFromPool = (pool: PairData): { tokenX: string; tokenY: string } => {
        return {
            tokenX: pool.token0.address,
            tokenY: pool.token1.address,
        };
    };
}

export const getTransactionFromRoutePlanV2 = async <DexIdTypes>(
    dexConfig: V2DexConfig,
    chainConfig: ChainConfig,
    amountIn: Decimal,
    amountOut: Decimal,
    routePlan: DeserializeRoutePlan<DexIdTypes>[],
    wallet: string,
    slippage: number,
    connection: JsonRpcProvider,
    isNativeIn: boolean,
    isNativeOut: boolean,
    partnerFees?: { recipient: string; fee: number }
): Promise<{ transactions: TransactionRequest[] }> => {
    const paths = transformRoutePlanToIPath(
        dexConfig.factoryAddress,
        routePlan as any,
        dexConfig.nativeTokenAddress,
        dexConfig.wrappedNativeTokenAddress,
        isNativeIn,
        isNativeOut
    );

    const slippageMultiplier = new Decimal(1).minus(slippage / 100);
    const minAmountOut = amountOut.mul(slippageMultiplier);

    const txs = await createSwapTX(
        {
            path: paths,
            amountInRaw: amountIn.toFixed(0),
            minAmountOut: minAmountOut.toFixed(0),
        },
        wallet,
        connection,
        { id: dexConfig.network, rpc: connection._getConnection().url || chainConfig.rpcUrl },
        partnerFees ? partnerFees : undefined
    );

    const transactions: TransactionRequest[] = txs.map((tx) => ({
        from: wallet,
        to: tx.to,
        data: tx.data,
        value: tx.value,
    }));

    return { transactions };
};
