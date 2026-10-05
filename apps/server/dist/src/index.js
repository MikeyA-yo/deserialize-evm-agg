"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRoutePlanFromTokenStringPath = exports.getBestRoutes = exports.initAndGetCache = void 0;
const cache_1 = require("@deserialize-evm-agg/cache");
const graph_1 = require("@deserialize-evm-agg/graph");
const routes_providers_1 = require("@deserialize-evm-agg/routes-providers");
const redis_1 = require("redis");
const config_1 = require("./config");
const errors_api_1 = require("./errors/errors.api");
BigInt.prototype.toJSON = function () {
    const int = Number.parseInt(this.toString());
    return int ?? this.toString();
};
// export const getRouteJsonRpcProvider = (dexId: AllDexIdTypes) => {
//     if (dexId === DEX_IDS.ZERO_G) {
//         return ZeroGRoute;
//     } else if (dexId === DEX_IDS.ALL) {
//         return AllRoute;
//     }
//     throw new Error(`No route provider for ${dexId}`);
// };
let cache = undefined;
const initAndGetCache = async () => {
    if (cache) {
        return cache;
    }
    //TODO: switch to redis cache
    const redisClient = (0, redis_1.createClient)({
        url: config_1.config.REDIS_URL
    });
    await redisClient.connect();
    const newCache = new cache_1.DexCache({
        storageDestination: "REDIS",
        redisClient: redisClient
    });
    cache = newCache;
    return cache;
};
exports.initAndGetCache = initAndGetCache;
const getBestRoutes = async (network, fromTokenString, toTokenString, amount, _provider, options) => {
    const provider = _provider;
    const RouteJsonRpcProviderClass = (0, routes_providers_1.getChainAllRoute)(network);
    const cache = await (0, exports.initAndGetCache)();
    const RouteJsonRpcProvider = new RouteJsonRpcProviderClass(provider, cache);
    const config = RouteJsonRpcProvider.getDexConfig();
    const nativeAddress = config.nativeTokenAddress;
    if (fromTokenString.toLowerCase() === nativeAddress.toLowerCase()) {
        console.log(`      [ROUTER:NATIVE] Input is native token, wrapping to: ${config.wrappedNativeTokenAddress}`);
        fromTokenString = config.wrappedNativeTokenAddress;
    }
    if (toTokenString.toLowerCase() === nativeAddress.toLowerCase()) {
        console.log(`      [ROUTER:NATIVE] Output is native token, wrapping to: ${config.wrappedNativeTokenAddress}`);
        toTokenString = config.wrappedNativeTokenAddress;
    }
    let keyRate = 0;
    try {
        keyRate = (await RouteJsonRpcProvider.getSurePriceOfToken(fromTokenString)) ?? 0;
        console.log(`      [ROUTER:PRICE] Resolved keyRate (USD price) for ${fromTokenString}: $${keyRate}`);
    }
    catch (error) {
        console.warn(`      [ROUTER:PRICE_WARN] Token price lookup failed, continuing quote with keyRate 0:`, error?.message);
    }
    let { tokenBiMap } = await RouteJsonRpcProvider.getTokenBiMap();
    let graph = await RouteJsonRpcProvider.getGraph();
    let path = [];
    let fromIndex = tokenBiMap.getByValue(fromTokenString.toLowerCase());
    let toIndex = tokenBiMap.getByValue(toTokenString.toLowerCase());
    console.log(`      [ROUTER:BIMAP] Graph lookup: fromIndex=${fromIndex}, toIndex=${toIndex} (total tokens in graph: ${tokenBiMap.toArray().length})`);
    const syncIndexes = () => {
        fromIndex = tokenBiMap.getByValue(fromTokenString.toLowerCase());
        toIndex = tokenBiMap.getByValue(toTokenString.toLowerCase());
    };
    if (fromIndex === undefined || toIndex === undefined) {
        console.log(`      [ROUTER:AUTO_DISCOVERY] Token not found in tokenBiMap. Querying DEX factories on-chain to discover pools for ${fromTokenString} / ${toTokenString}...`);
        const updated = await RouteJsonRpcProvider.findUpdateTokenPairPools(fromTokenString, toTokenString);
        tokenBiMap = updated.newTokenBiMap;
        graph = updated.newGraph;
        syncIndexes();
        if (fromIndex === undefined || toIndex === undefined) {
            console.error(`      [ROUTER:ERROR] Token pair still not found after on-chain discovery!`);
            throw new Error(`Token pair ${fromTokenString} / ${toTokenString} not supported by any known DEX on ${network}`);
        }
        console.log(`      [ROUTER:AUTO_DISCOVERY_SUCCESS] Pools discovered & indexed. New indexes: from=${fromIndex}, to=${toIndex}`);
    }
    let fromEdges = graph[fromIndex] ?? [];
    let toEdges = graph[toIndex] ?? [];
    console.log(`      [ROUTER:EDGES] Existing edges: fromToken=${fromEdges.length}, toToken=${toEdges.length}`);
    if (fromEdges.length === 0 || toEdges.length === 0) {
        console.log(`      [ROUTER:AUTO_DISCOVERY] Zero edges found. Re-indexing on-chain pools...`);
        const updated = await RouteJsonRpcProvider.findUpdateTokenPairPools(fromTokenString, toTokenString);
        tokenBiMap = updated.newTokenBiMap;
        graph = updated.newGraph;
        syncIndexes();
        if (fromIndex === undefined || toIndex === undefined) {
            throw new Error(`Token pair ${fromTokenString} / ${toTokenString} not supported by any known DEX on ${network}`);
        }
        fromEdges = graph[fromIndex] ?? [];
        toEdges = graph[toIndex] ?? [];
        if (fromEdges.length === 0 || toEdges.length === 0) {
            console.error(`      [ROUTER:ERROR] No viable pools exist for this pair.`);
            throw new errors_api_1.ApiError(400, "No Route found for this token Pair");
        }
    }
    const func = RouteJsonRpcProvider.getFunctionToMutateEdgeCost();
    const token = await (0, routes_providers_1.getTokenDetails)((fromTokenString), provider);
    console.log(`      [ROUTER:DETAILS] Token ${fromTokenString} decimals: ${token.decimals}`);
    console.log(`      [ROUTER:DIJKSTRA] Executing Dijkstra graph traversal from node ${fromIndex} to ${toIndex} with amount: ${amount}...`);
    const { bestRoute: _path, edgeData, bestOutcome, } = (0, graph_1.findBestRouteIndex)(graph, fromIndex, toIndex, { key: amount, keyRate: keyRate ?? 0, keyDecimal: token.decimals }, options?.targetRouteNumber, func);
    path = _path;
    if (path.length < 1) {
        console.error(`      [ROUTER:ERROR] Dijkstra failed to find any path from ${fromIndex} to ${toIndex}`);
        throw new Error(`No viable swap route found from ${fromTokenString} to ${toTokenString}`);
    }
    console.log(`      [ROUTER:DIJKSTRA_SUCCESS] Found path with ${edgeData.length} hop(s)! Best outcome:`, bestOutcome);
    const tokenStringPath = convertEdgeListToTokenString(edgeData, tokenBiMap);
    const routes = await (0, exports.getRoutePlanFromTokenStringPath)(tokenStringPath);
    return { routes, RouteJsonRpcProvider: RouteJsonRpcProvider, bestOutcome };
};
exports.getBestRoutes = getBestRoutes;
const getRoutePlanFromTokenStringPath = async (tokenStringPath) => {
    const routes = [];
    for (const plan of tokenStringPath) {
        const routePlan = {
            tokenA: plan[0],
            tokenB: plan[1],
            dexId: plan[2],
            poolAddress: plan[3],
            aToB: plan[4] === "aToB" ? true : false,
            fee: parseInt(plan[5], 10)
        };
        routes.push(routePlan);
    }
    return routes;
};
exports.getRoutePlanFromTokenStringPath = getRoutePlanFromTokenStringPath;
const convertEdgeListToTokenString = (edges, tokenBiMap) => {
    // console.log("path: ", edges);
    // console.log("tokenBiMap: ", tokenBiMap);
    return edges.map((edge) => {
        return [
            tokenBiMap.get(edge.from),
            tokenBiMap.get(edge.to),
            edge.edgeData.dexId,
            edge.edgeData.poolAddress,
            edge.edgeData.aToB ? "aToB" : "bToA",
            edge.edgeData.fee.toString()
        ];
    });
};
