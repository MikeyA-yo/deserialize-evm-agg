
import { DexCache } from "@deserialize-evm-agg/cache";
import { ArrayBiMap, Edge, EdgeData, findBestRouteIndex } from "@deserialize-evm-agg/graph";
import { getChainDexIdList, DeserializeRoutePlan, getChainAllRoute, getChainDexIds, getTokenDetails, IRoute, ZeroGRoute, AllDexIdTypes } from "@deserialize-evm-agg/routes-providers"
import { JsonRpcApiProvider, JsonRpcProvider } from "ethers";
import { createClient, RedisClientType } from "redis"
import { config } from "./config";
import { NetworkType } from "@deserialize-evm-agg/routes-providers";
import { ApiError } from "./errors/errors.api";
import Decimal from "decimal.js";
import { DISABLED_DEX_IDS } from "./constants";



(BigInt.prototype as any).toJSON = function () {
    const int = Number.parseInt(this.toString());
    return int ?? this.toString();
};





export interface RouteOptions {
    targetRouteNumber: number;
}

// ---------- On-chain pool discovery coordination (per server process) ----------
// Discovery read-modify-writes the shared per-DEX caches, so two running at once can drop each
// other's pools. They are run one at a time, and a quote that needs a token already being
// discovered waits for that discovery instead of starting the same ~20s scan again.
let discoveryQueue: Promise<unknown> = Promise.resolve();
const discoveriesInFlight = new Map<string, Promise<void>>(); // lowercased token -> settled marker

const runDiscoveryExclusive = <T>(task: () => Promise<T>): Promise<T> => {
    const run = discoveryQueue.then(task, task);
    discoveryQueue = run.catch(() => undefined);
    return run;
};

const discoverTokenPairPools = (
    route: IRoute<any, AllDexIdTypes>,
    tokenA: string,
    tokenB: string
) => {
    const tokens = [tokenA.toLowerCase(), tokenB.toLowerCase()];
    const run = runDiscoveryExclusive(() => route.findUpdateTokenPairPools(tokenA, tokenB));
    const settled = run.then(() => undefined, () => undefined);
    tokens.forEach((t) => discoveriesInFlight.set(t, settled));
    void settled.then(() => tokens.forEach((t) => {
        if (discoveriesInFlight.get(t) === settled) discoveriesInFlight.delete(t);
    }));
    return run;
};

const waitForDiscoveries = async (tokens: string[]) => {
    const pending = tokens.map((t) => discoveriesInFlight.get(t.toLowerCase())).filter(Boolean);
    if (pending.length > 0) {
        console.log(`      [ROUTER:AUTO_DISCOVERY] Waiting for ${pending.length} in-flight discovery(ies) for these tokens...`);
        await Promise.all(pending);
    }
};

/**
 * Starts pool discovery for a token in the background if it is not indexed yet, so that the
 * first quote for a freshly imported token does not have to wait for it. Called when the
 * frontend loads a token's details (e.g. a pasted contract address). Never throws.
 */
export const warmUpTokenDiscovery = (network: NetworkType, token: string, provider: JsonRpcProvider) => {
    void (async () => {
        try {
            const RouteClass = getChainAllRoute(network);
            const route = new RouteClass(provider, await initAndGetCache()) as IRoute<any, AllDexIdTypes>;
            const { wrappedNativeTokenAddress, nativeTokenAddress } = route.getDexConfig();
            const lower = token.toLowerCase();
            if (lower === nativeTokenAddress.toLowerCase() || discoveriesInFlight.has(lower)) return;
            const { tokenBiMap } = await route.getTokenBiMap<any>();
            if (tokenBiMap.getByValue(lower) !== undefined) return;
            console.log(`      [WARMUP] Discovering pools for newly requested token ${token} on ${network}...`);
            // Candidate pairs cover the token against WETH and the stable token
            await discoverTokenPairPools(route, token, wrappedNativeTokenAddress);
            console.log(`      [WARMUP] Pools for ${token} indexed`);
        } catch (error: any) {
            console.warn(`      [WARMUP] Discovery for ${token} failed (non-fatal):`, error?.message);
        }
    })();
};

export interface SimulatedRoute {
    routes: DeserializeRoutePlan<AllDexIdTypes>[];
    amountOut: Decimal; // raw units of the output token
    hopAmountsOut: Decimal[]; // raw amountOut of each hop
    pools: string[];
}

// Max pools simulated per hop when checking candidate routes against the on-chain quoters
const MAX_POOLS_PER_HOP = 6;

/**
 * Drops edges of DEXes whose adapters cannot execute (DISABLED_DEX_IDS) so they are never
 * quoted. Returns a filtered copy; the cached graph is not modified.
 */
const withoutDisabledDexes = (graph: Edge<EdgeData>[][]): Edge<EdgeData>[][] => {
    if (DISABLED_DEX_IDS.length === 0) return graph;
    const disabled = new Set(DISABLED_DEX_IDS);
    return graph.map((edges) => (edges ?? []).filter((e) => !disabled.has(e.edgeData.dexId)));
};

/**
 * The graph's edge costs use in-range math and cannot see tick boundaries or stale pools, so
 * Dijkstra can pick a pool that looks deep but returns very little (e.g. a thin WETH/DAI pool
 * returning ~5 DAI for 1 WETH). This re-checks candidate token paths with the real quoters:
 * Dijkstra's path, the direct pair, and two-hop paths via the hub tokens (WETH, stable).
 * For each path the pool with the highest simulated output is chosen hop by hop (optimal for a
 * fixed token path, as each hop's output only grows with its input), and the path with the
 * highest final output wins.
 */
const selectRouteBySimulation = async (
    RouteJsonRpcProvider: IRoute<any, AllDexIdTypes>,
    graph: Edge<EdgeData>[][],
    tokenBiMap: ArrayBiMap<string>,
    amountIn: Decimal,
    candidatePaths: number[][],
    costFunc: (params: any, e: Edge<EdgeData>) => number,
    costKey: { key: number; keyRate: number; keyDecimal: number },
    provider: JsonRpcProvider
): Promise<SimulatedRoute | undefined> => {
    const simulations = new Map<string, Promise<Decimal>>();
    const simulateHop = (plan: DeserializeRoutePlan<AllDexIdTypes>, hopAmountIn: Decimal): Promise<Decimal> => {
        const id = `${plan.dexId}:${plan.poolAddress}:${plan.tokenA}:${hopAmountIn.toFixed(0)}`;
        if (!simulations.has(id)) {
            simulations.set(id, RouteJsonRpcProvider.getAmountOutFromPlan(hopAmountIn, [plan], 0, provider)
                .then(({ amountOut }) => (amountOut && amountOut.isFinite() ? amountOut : new Decimal(0)))
                .catch(() => new Decimal(0)));
        }
        return simulations.get(id)!;
    };

    const simulatePath = async (path: number[]): Promise<SimulatedRoute | undefined> => {
        let hopAmountIn = amountIn;
        const routes: DeserializeRoutePlan<AllDexIdTypes>[] = [];
        const hopAmountsOut: Decimal[] = [];

        for (let i = 0; i < path.length - 1; i++) {
            const from = path[i], to = path[i + 1];
            const seen = new Set<string>();
            const edges = (graph[from] ?? [])
                .filter((e) => e.to === to)
                .filter((e) => {
                    const id = `${e.edgeData.dexId}:${e.edgeData.poolAddress}`.toLowerCase();
                    if (seen.has(id)) return false;
                    seen.add(id);
                    return true;
                })
                .map((e) => {
                    let cost = 100;
                    try { cost = costFunc({ ...e.edgeData, key: costKey }, e); } catch { }
                    return { e, cost: Number.isFinite(cost) ? cost : 100 };
                })
                .sort((a, b) => a.cost - b.cost)
                .slice(0, MAX_POOLS_PER_HOP);
            if (edges.length === 0) return undefined;

            const plans = edges.map(({ e }) => ({
                tokenA: tokenBiMap.get(from)!,
                tokenB: tokenBiMap.get(to)!,
                dexId: e.edgeData.dexId as AllDexIdTypes,
                poolAddress: e.edgeData.poolAddress,
                aToB: e.edgeData.aToB,
                fee: Number(e.edgeData.fee),
            }));
            const outs = await Promise.all(plans.map((plan) => simulateHop(plan, hopAmountIn)));

            let best = -1;
            outs.forEach((out, j) => { if (out.gt(0) && (best < 0 || out.gt(outs[best]))) best = j; });
            if (best < 0) return undefined;

            routes.push(plans[best]);
            hopAmountsOut.push(outs[best]);
            hopAmountIn = outs[best];
        }

        return { routes, amountOut: hopAmountIn, hopAmountsOut, pools: routes.map((r) => r.poolAddress) };
    };

    const results = await Promise.all(candidatePaths.map((path) => simulatePath(path).catch(() => undefined)));
    let winner: SimulatedRoute | undefined;
    results.forEach((result, i) => {
        const label = candidatePaths[i].map((t) => tokenBiMap.get(t)?.slice(0, 8)).join(" -> ");
        console.log(`      [ROUTER:SIMULATE] ${label}: ${result ? `${result.amountOut.toFixed(0)} via ${result.routes.map((r) => r.dexId).join(" -> ")}` : "no viable pools"}`);
        if (result && (!winner || result.amountOut.gt(winner.amountOut))) winner = result;
    });
    return winner;
};

// export const getRouteJsonRpcProvider = (dexId: AllDexIdTypes) => {
//     if (dexId === DEX_IDS.ZERO_G) {
//         return ZeroGRoute;
//     } else if (dexId === DEX_IDS.ALL) {
//         return AllRoute;
//     }
//     throw new Error(`No route provider for ${dexId}`);
// };

let cache: DexCache<AllDexIdTypes> | undefined = undefined

export const initAndGetCache = async (): Promise<DexCache<AllDexIdTypes>> => {
    if (cache) {
        return cache
    }
    //TODO: switch to redis cache
    const redisClient = createClient({
        url: config.REDIS_URL
    })

    await redisClient.connect()


    const newCache = new DexCache({
        storageDestination: "REDIS",
        redisClient: redisClient as any as RedisClientType

    })
    cache = newCache
    return cache

}

export const getBestRoutes = async (
    network: NetworkType,
    fromTokenString: string,
    toTokenString: string,
    amount: number,
    _provider: JsonRpcProvider,
    options?: RouteOptions
): Promise<{
    routes: DeserializeRoutePlan<AllDexIdTypes>[];
    RouteJsonRpcProvider: IRoute<any, AllDexIdTypes>;
    bestOutcome: number;
    simulated?: SimulatedRoute; // set when routes were chosen by on-chain simulation
}> => {
    const provider = _provider
    const RouteJsonRpcProviderClass = getChainAllRoute(network);

    const cache = await initAndGetCache()
    const RouteJsonRpcProvider = new RouteJsonRpcProviderClass(provider, cache);
    const config = RouteJsonRpcProvider.getDexConfig()

    const nativeAddress = config.nativeTokenAddress

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
    } catch (error: any) {
        console.warn(`      [ROUTER:PRICE_WARN] Token price lookup failed, continuing quote with keyRate 0:`, error?.message);
    }

    // A discovery already running for either token (e.g. warm-up after import) is awaited first
    await waitForDiscoveries([fromTokenString, toTokenString]);

    let { tokenBiMap } = await RouteJsonRpcProvider.getTokenBiMap();
    let graph = withoutDisabledDexes(await RouteJsonRpcProvider.getGraph());

    let path: number[][] = [];

    let fromIndex = tokenBiMap.getByValue(fromTokenString.toLowerCase());
    let toIndex = tokenBiMap.getByValue(toTokenString.toLowerCase());
    console.log(`      [ROUTER:BIMAP] Graph lookup: fromIndex=${fromIndex}, toIndex=${toIndex} (total tokens in graph: ${tokenBiMap.toArray().length})`);

    const syncIndexes = () => {
        fromIndex = tokenBiMap.getByValue(fromTokenString.toLowerCase());
        toIndex = tokenBiMap.getByValue(toTokenString.toLowerCase());
    };

    if (fromIndex === undefined || toIndex === undefined) {
        console.log(
            `      [ROUTER:AUTO_DISCOVERY] Token not found in tokenBiMap. Querying DEX factories on-chain to discover pools for ${fromTokenString} / ${toTokenString}...`
        );
        const updated = await discoverTokenPairPools(RouteJsonRpcProvider as IRoute<any, AllDexIdTypes>, fromTokenString, toTokenString);
        tokenBiMap = updated.newTokenBiMap;
        graph = withoutDisabledDexes(updated.newGraph);
        syncIndexes();
        if (fromIndex === undefined || toIndex === undefined) {
            console.error(`      [ROUTER:ERROR] Token pair still not found after on-chain discovery!`);
            throw new ApiError(400, `No liquidity found for ${fromTokenString} / ${toTokenString} on any supported ${network} DEX (directly or via WETH/USDC)`);
        }
        console.log(`      [ROUTER:AUTO_DISCOVERY_SUCCESS] Pools discovered & indexed. New indexes: from=${fromIndex}, to=${toIndex}`);
    }

    let fromEdges = graph[fromIndex] ?? [];
    let toEdges = graph[toIndex] ?? [];
    console.log(`      [ROUTER:EDGES] Existing edges: fromToken=${fromEdges.length}, toToken=${toEdges.length}`);

    if (fromEdges.length === 0 || toEdges.length === 0) {
        console.log(`      [ROUTER:AUTO_DISCOVERY] Zero edges found. Re-indexing on-chain pools...`);
        const updated = await discoverTokenPairPools(RouteJsonRpcProvider as IRoute<any, AllDexIdTypes>, fromTokenString, toTokenString);
        tokenBiMap = updated.newTokenBiMap;
        graph = withoutDisabledDexes(updated.newGraph);
        syncIndexes();
        if (fromIndex === undefined || toIndex === undefined) {
            throw new ApiError(400, `No liquidity found for ${fromTokenString} / ${toTokenString} on any supported ${network} DEX (directly or via WETH/USDC)`);
        }
        fromEdges = graph[fromIndex] ?? [];
        toEdges = graph[toIndex] ?? [];
        if (fromEdges.length === 0 || toEdges.length === 0) {
            console.error(`      [ROUTER:ERROR] No viable pools exist for this pair.`);
            throw new ApiError(400, "No Route found for this token Pair");
        }
    }

    const func = RouteJsonRpcProvider.getFunctionToMutateEdgeCost();
    const token = await getTokenDetails(
        (fromTokenString), provider
    );
    console.log(`      [ROUTER:DETAILS] Token ${fromTokenString} decimals: ${token.decimals}`);

    console.log(`      [ROUTER:DIJKSTRA] Executing Dijkstra graph traversal from node ${fromIndex} to ${toIndex} with amount: ${amount}...`);
    const {
        bestRoute: _path,
        edgeData,
        bestOutcome,
    } = findBestRouteIndex(
        graph,
        fromIndex,
        toIndex,
        { key: amount, keyRate: keyRate ?? 0, keyDecimal: token.decimals },
        options?.targetRouteNumber,
        func
    );

    path = _path;
    if (path.length < 1) {
        console.error(`      [ROUTER:ERROR] Dijkstra failed to find any path from ${fromIndex} to ${toIndex}`);
        throw new Error(`No viable swap route found from ${fromTokenString} to ${toTokenString}`);
    }
    console.log(`      [ROUTER:DIJKSTRA_SUCCESS] Found path with ${edgeData.length} hop(s)! Best outcome:`, bestOutcome);

    const tokenStringPath = convertEdgeListToTokenString(edgeData, tokenBiMap);

    const routes: DeserializeRoutePlan<AllDexIdTypes>[] = await getRoutePlanFromTokenStringPath(
        tokenStringPath,
    );

    // Re-check candidate paths with the on-chain quoters (see selectRouteBySimulation)
    const candidatePaths: number[][] = [];
    const addCandidate = (p: number[]) => {
        if (p.length < 2 || p.some((i) => i === undefined)) return;
        if (!candidatePaths.some((c) => c.join(",") === p.join(","))) candidatePaths.push(p);
    };
    if (edgeData.length > 0) addCandidate([edgeData[0].from, ...edgeData.map((e) => e.to)]);
    addCandidate([fromIndex, toIndex]);
    for (const hub of [config.wrappedNativeTokenAddress, config.stableTokenAddress]) {
        const hubIndex = hub ? tokenBiMap.getByValue(hub.toLowerCase()) : undefined;
        if (hubIndex !== undefined && hubIndex !== fromIndex && hubIndex !== toIndex) {
            addCandidate([fromIndex, hubIndex, toIndex]);
        }
    }

    console.log(`      [ROUTER:SIMULATE] Checking ${candidatePaths.length} candidate path(s) against on-chain quoters...`);
    const simulated = await selectRouteBySimulation(
        RouteJsonRpcProvider as IRoute<any, AllDexIdTypes>,
        graph,
        tokenBiMap,
        new Decimal(amount),
        candidatePaths,
        func,
        { key: amount, keyRate: keyRate ?? 0, keyDecimal: token.decimals },
        provider
    );

    if (simulated) {
        console.log(`      [ROUTER:SIMULATE_SUCCESS] Selected ${simulated.routes.map((r) => r.dexId).join(" -> ")} with amountOut ${simulated.amountOut.toFixed(0)}`);
        return { routes: simulated.routes, RouteJsonRpcProvider: RouteJsonRpcProvider as IRoute<any, AllDexIdTypes>, bestOutcome, simulated };
    }

    console.warn(`      [ROUTER:SIMULATE_WARN] No candidate path simulated successfully; falling back to the Dijkstra route`);
    return { routes, RouteJsonRpcProvider: RouteJsonRpcProvider as IRoute<any, AllDexIdTypes>, bestOutcome };
};

export const getRoutePlanFromTokenStringPath = async (
    tokenStringPath: string[][],
): Promise<DeserializeRoutePlan<AllDexIdTypes>[]> => {
    const routes: DeserializeRoutePlan<AllDexIdTypes>[] = [];
    for (const plan of tokenStringPath) {
        const routePlan: DeserializeRoutePlan<AllDexIdTypes> = {
            tokenA: plan[0],
            tokenB: plan[1],
            dexId: plan[2] as AllDexIdTypes,
            poolAddress: plan[3],
            aToB: plan[4] === "aToB" ? true : false,
            fee: parseInt(plan[5], 10)
        };
        routes.push(routePlan);
    }

    return routes;
};

const convertEdgeListToTokenString = (
    edges: Edge<EdgeData>[],
    tokenBiMap: ArrayBiMap<string>
): string[][] => {
    // console.log("path: ", edges);
    // console.log("tokenBiMap: ", tokenBiMap);
    return edges.map((edge) => {
        return [
            tokenBiMap.get(edge.from)!,
            tokenBiMap.get(edge.to)!,
            edge.edgeData.dexId,
            edge.edgeData.poolAddress,
            edge.edgeData.aToB ? "aToB" : "bToA",
            edge.edgeData.fee.toString()
        ];
    });
};
