"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.tokenSearchService = exports.getTokenDetailsService = exports.getTokenPriceService = exports.tokenListWithDetailsService = exports.tokenList = exports.swapService = exports.swapQuoteService = void 0;
const index_1 = require("../index");
const decimal_js_1 = __importDefault(require("decimal.js"));
const errors_api_1 = require("../errors/errors.api");
const constants_1 = require("../constants");
const utils_1 = require("../utils");
const routes_providers_1 = require("@deserialize-evm-agg/routes-providers");
const swapQuoteService = async (params, provider, network) => {
    try {
        console.log(`    [QUOTE_SVC:1/5] Initiating route search: Network=${network}, Pair=${params.tokenA} -> ${params.tokenB}, Amount=${params.amountIn}`);
        const { routes, bestOutcome, RouteJsonRpcProvider } = await (0, index_1.getBestRoutes)(network, params.tokenA, params.tokenB, (params.amountIn), provider, {
            targetRouteNumber: 5,
        });
        const isNativeIn = params.tokenA.toLowerCase() === RouteJsonRpcProvider.getDexConfig().nativeTokenAddress.toLowerCase();
        const isNativeOut = params.tokenB.toLowerCase() === RouteJsonRpcProvider.getDexConfig().nativeTokenAddress.toLowerCase();
        console.log(`    [QUOTE_SVC:2/5] Best routes retrieved (${routes.length} hop(s)):`, routes.map(r => `${r.dexId} (${r.tokenA.slice(0, 8)}... -> ${r.tokenB.slice(0, 8)}...) via pool ${r.poolAddress}`));
        console.log(`    [QUOTE_SVC:3/5] Simulating on-chain amountOut from route plan...`);
        const { amountOut, pools, hopAmountsOut } = await RouteJsonRpcProvider.getAmountOutFromPlan(new decimal_js_1.default(params.amountIn), routes, 0, provider);
        console.log(`    [QUOTE_SVC:4/5] amountOut result: ${amountOut.toString()}`);
        // Get token price
        let tokenPrice = new decimal_js_1.default(0);
        const finalRoutes = routes.map((r, i) => {
            return {
                ...r,
                poolAddress: pools[i]
            };
        });
        try {
            const p = await RouteJsonRpcProvider.calculateRoutePrice(finalRoutes);
            tokenPrice = new decimal_js_1.default(p);
            console.log(`    [QUOTE_SVC:5/5] Token route price calculated: ${tokenPrice.toString()}`);
        }
        catch (error) {
            console.warn(`    [QUOTE_SVC:5/5] Route price lookup fallback (non-fatal):`, error?.message);
        }
        const dexConfig = RouteJsonRpcProvider.getDexConfig();
        let route;
        try {
            route = await buildQuoteRouteView(RouteJsonRpcProvider, finalRoutes, new decimal_js_1.default(params.amountIn), hopAmountsOut ?? [], isNativeIn, isNativeOut, provider, network);
            console.log(`    [QUOTE_SVC:ROUTE] ${route.summary}`);
        }
        catch (error) {
            console.warn(`    [QUOTE_SVC:ROUTE] Route view could not be built (non-fatal):`, error?.message);
        }
        return {
            tokenA: params.tokenA,
            tokenB: params.tokenB,
            amountIn: params.amountIn.toString(),
            amountOut: amountOut,
            tokenPrice: tokenPrice.toString(),
            routePlan: finalRoutes,
            route,
            dexId: params.dexId,
            dexFactory: dexConfig.factoryAddress,
            isNativeIn,
            isNativeOut
        };
    }
    catch (error) {
        console.error("❌ [QUOTE_SVC:ERROR] swapQuoteService failed:", {
            pair: `${params.tokenA} -> ${params.tokenB}`,
            amountIn: params.amountIn,
            network,
            message: error?.message,
            stack: error?.stack,
        });
        if (error instanceof errors_api_1.ApiError) {
            throw error;
        }
        throw new errors_api_1.ApiError(500, `Failed to process swap quote: ${error?.message || "Unknown error"}`);
    }
};
exports.swapQuoteService = swapQuoteService;
const formatRawAmount = (raw, decimals) => {
    if (decimals === null)
        return null;
    return raw.div(new decimal_js_1.default(10).pow(decimals)).toFixed();
};
/**
 * Builds the human-readable route (token path, DEX per hop, per-hop amounts) shown with a quote.
 * Uses the per-hop amounts already simulated for the quote, so it adds no swap simulations;
 * token metadata comes from the mint cache, falling back to an on-chain read.
 */
const buildQuoteRouteView = async (allRoute, routePlan, amountIn, hopAmountsOut, isNativeIn, isNativeOut, provider, network) => {
    const chainConfig = allRoute.chainConfig;
    const wrapped = chainConfig.wrappedNativeTokenAddress.toLowerCase();
    const nativeToken = {
        address: chainConfig.nativeTokenAddress,
        symbol: chainConfig.nativeTokenSymbol || "ETH",
        decimals: 18,
    };
    const tokenMeta = new Map();
    const addresses = Array.from(new Set(routePlan.flatMap((r) => [r.tokenA.toLowerCase(), r.tokenB.toLowerCase()])));
    await Promise.all(addresses.map(async (address) => {
        try {
            const details = await (0, exports.getTokenDetailsService)(address, provider, network);
            tokenMeta.set(address, {
                address: details?.address || details?.contractAddress || address,
                symbol: details?.symbol ?? null,
                decimals: typeof details?.decimals === "number" ? details.decimals : null,
            });
        }
        catch {
            tokenMeta.set(address, { address, symbol: null, decimals: null });
        }
    }));
    // Show the native token where the user actually sends/receives it instead of WETH
    const displayToken = (address, isFirst, isLast) => {
        const lower = address.toLowerCase();
        if (lower === wrapped && ((isFirst && isNativeIn) || (isLast && isNativeOut))) {
            return nativeToken;
        }
        return tokenMeta.get(lower) ?? { address, symbol: null, decimals: null };
    };
    const dexNames = new Map();
    const dexName = (dexId) => {
        if (!dexNames.has(dexId)) {
            try {
                const RouteClass = allRoute.getRouteProviderByDexId(dexId);
                dexNames.set(dexId, new RouteClass(provider, allRoute.cache).getDexConfig().name);
            }
            catch {
                dexNames.set(dexId, dexId);
            }
        }
        return dexNames.get(dexId);
    };
    let hopAmountIn = amountIn;
    const hops = routePlan.map((r, i) => {
        const tokenIn = displayToken(r.tokenA, i === 0, false);
        const tokenOut = displayToken(r.tokenB, false, i === routePlan.length - 1);
        const hopAmountOut = hopAmountsOut[i] ?? new decimal_js_1.default(0);
        const hop = {
            hop: i + 1,
            dexId: r.dexId,
            dexName: dexName(r.dexId),
            poolAddress: r.poolAddress,
            fee: r.fee,
            tokenIn,
            tokenOut,
            amountIn: hopAmountIn.toFixed(0),
            amountOut: hopAmountOut.toFixed(0),
            amountInFormatted: formatRawAmount(hopAmountIn, tokenIn.decimals),
            amountOutFormatted: formatRawAmount(hopAmountOut, tokenOut.decimals),
            percent: 100,
        };
        hopAmountIn = hopAmountOut;
        return hop;
    });
    const path = hops.length > 0 ? [hops[0].tokenIn, ...hops.map((h) => h.tokenOut)] : [];
    const label = (t) => t.symbol || t.address;
    const summary = hops.length > 0
        ? [label(hops[0].tokenIn), ...hops.map((h) => `${label(h.tokenOut)} (${h.dexName})`)].join(" → ")
        : "";
    return { path, hops, summary };
};
const swapService = async (params, provider, network) => {
    try {
        console.log(`    [SWAP_SVC:1/4] Preparing swap for wallet=${params.publicKey} on network=${network}, slippage=${params.slippage}%`);
        let defaultFeeRate = constants_1.DESERIALIZE_FEE;
        defaultFeeRate =
            (0, utils_1.getSwapRequestFeeRate)(params.quote.tokenA, params.quote.tokenB)?.feeRate ?? defaultFeeRate;
        const cache = await (0, index_1.initAndGetCache)();
        console.log(`    [SWAP_SVC:2/4] Initialized route provider for ${network}...`);
        const RouteJsonRpcProvider = new ((0, routes_providers_1.getChainAllRoute)(network))(provider, cache);
        console.log(`    [SWAP_SVC:3/4] Requesting transaction instructions for ${params.quote.routePlan?.length || 0} hop(s)...`);
        const transaction = await RouteJsonRpcProvider.getTransactionInstructionFromRoutePlan(new decimal_js_1.default(params.quote.amountIn), params.quote.routePlan, params.publicKey, params.slippage, params.quote.isNativeIn, params.quote.isNativeOut, params.partnerFees);
        console.log(`    [SWAP_SVC:4/4] Successfully constructed ${transaction.transactions.length} transaction payload(s)`);
        return {
            transaction
        };
    }
    catch (error) {
        console.error("❌ [SWAP_SVC:ERROR] swapService failed:", {
            wallet: params.publicKey,
            network,
            message: error?.message,
            stack: error?.stack,
        });
        if (error instanceof errors_api_1.ApiError) {
            throw error;
        }
        throw new errors_api_1.ApiError(500, `Failed to process swap: ${error?.message || "Unknown error"}`);
    }
};
exports.swapService = swapService;
const tokenList = async (provider, network) => {
    const router = (0, routes_providers_1.getChainAllRoute)(network ?? "BASE");
    const cache = await (0, index_1.initAndGetCache)();
    const routeInstance = new router(provider, cache);
    return await routeInstance.listTokens();
};
exports.tokenList = tokenList;
const tokenListWithDetailsService = async (provider, network) => {
    const router = (0, routes_providers_1.getChainAllRoute)(network);
    const cache = await (0, index_1.initAndGetCache)();
    const routeInstance = new router(provider, cache);
    const tokens = await routeInstance.listTokens();
    const detailedTokens = await Promise.all(tokens.map(async (token) => {
        try {
            const cacheDetails = await cache.getMintFromCache(`ALL_${network}`, token);
            if (!cacheDetails) {
                const details = await (0, routes_providers_1.getTokenDetails)(token, provider);
                await cache.setMintToCache(`ALL_${network}`, { ...details, contractAddress: token });
                return details;
            }
            return cacheDetails;
        }
        catch (error) {
            console.log("Error in tokenListWithDetailsService", { error });
            return null;
        }
    }));
    return detailedTokens.filter((token) => token !== null);
};
exports.tokenListWithDetailsService = tokenListWithDetailsService;
const getTokenPriceService = async (tokenAddress, provider, network) => {
    const router = (0, routes_providers_1.getChainAllRoute)(network);
    const cache = await (0, index_1.initAndGetCache)();
    const routeInstance = new router(provider, cache);
    // return calculator.getPoolData("0x224D0891D63Ca83e6DD98B4653C27034503a5E76")
    return await routeInstance.getSurePriceOfToken(tokenAddress);
};
exports.getTokenPriceService = getTokenPriceService;
const getTokenDetailsService = async (tokenAddress, provider, network) => {
    const router = (0, routes_providers_1.getChainAllRoute)(network);
    const cache = await (0, index_1.initAndGetCache)();
    const routeInstance = new router(provider, cache);
    const cacheDetails = await cache.getMintFromCache(`ALL_${network}`, tokenAddress);
    if (!cacheDetails) {
        const details = await (0, routes_providers_1.getTokenDetails)(tokenAddress, provider);
        await cache.setMintToCache(`ALL_${network}`, { ...details, contractAddress: tokenAddress });
        return details;
    }
    return cacheDetails;
};
exports.getTokenDetailsService = getTokenDetailsService;
const KNOWN_BASE_TOKENS = [
    {
        address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
        symbol: "ETH",
        name: "Ethereum",
        decimals: 18,
        network: "BASE",
    },
    {
        address: "0x4200000000000000000000000000000000000006",
        symbol: "WETH",
        name: "Wrapped Ether",
        decimals: 18,
        network: "BASE",
    },
    {
        address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        symbol: "USDC",
        name: "USD Coin",
        decimals: 6,
        network: "BASE",
    },
    {
        address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
        symbol: "USDbC",
        name: "USD Base Coin",
        decimals: 6,
        network: "BASE",
    },
    {
        address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
        symbol: "DAI",
        name: "Dai Stablecoin",
        decimals: 18,
        network: "BASE",
    },
    {
        address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
        symbol: "cbBTC",
        name: "Coinbase Wrapped BTC",
        decimals: 8,
        network: "BASE",
    },
    {
        address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
        symbol: "cbETH",
        name: "Coinbase Wrapped Staked ETH",
        decimals: 18,
        network: "BASE",
    },
    {
        address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
        symbol: "AERO",
        name: "Aerodrome",
        decimals: 18,
        network: "BASE",
    },
    {
        address: "0x532f27101965dd16442E59d40670FaF5eBB142E4",
        symbol: "BRETT",
        name: "Brett",
        decimals: 18,
        network: "BASE",
    },
    {
        address: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed",
        symbol: "DEGEN",
        name: "Degen",
        decimals: 18,
        network: "BASE",
    },
    {
        address: "0x1bc0c42215582d5A085795f4baDbaC3ff36d1Bcb",
        symbol: "CLANKER",
        name: "tokenbot",
        decimals: 18,
        network: "BASE",
    },
    {
        address: "0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4",
        symbol: "TOSHI",
        name: "Toshi",
        decimals: 18,
        network: "BASE",
    },
    {
        address: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b",
        symbol: "VIRTUAL",
        name: "Virtual Protocol",
        decimals: 18,
        network: "BASE",
    },
    {
        address: "0x0578d8A44db98B23BF096A382e016e29a5Ce0ffe",
        symbol: "HIGHER",
        name: "higher",
        decimals: 18,
        network: "BASE",
    },
];
const KNOWN_0G_TOKENS = [
    {
        address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
        symbol: "A0GI",
        name: "0G Native Token",
        decimals: 18,
        network: "0G",
    },
    {
        address: "0x1cd0690ff9a693f5ef2dd976660a8dafc81a109c",
        symbol: "W0G",
        name: "Wrapped 0G",
        decimals: 18,
        network: "0G",
    },
    {
        address: "0x59ef6f3943bbdfe2fb19565037ac85071223e94c",
        symbol: "USDT",
        name: "Tether USD",
        decimals: 18,
        network: "0G",
    },
];
const DYNAMIC_BASE_TOKEN_CACHE = new Map();
async function searchExternalBaseTokens(query, provider) {
    const q = query.trim().toLowerCase();
    if (!q || q.startsWith("0x"))
        return [];
    try {
        const url = `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query.trim())}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok)
            return [];
        const data = await res.json();
        const pairs = data?.pairs || [];
        const basePairs = pairs.filter((p) => p?.chainId === "base");
        const candidates = [];
        const seenAddresses = new Set();
        for (const pair of basePairs) {
            for (const candidate of [pair?.baseToken, pair?.quoteToken]) {
                const addr = candidate?.address?.toLowerCase();
                if (!addr || addr === "0x0000000000000000000000000000000000000000" || seenAddresses.has(addr))
                    continue;
                const sym = (candidate?.symbol || "").toLowerCase();
                const name = (candidate?.name || "").toLowerCase();
                if (sym.includes(q) || name.includes(q)) {
                    seenAddresses.add(addr);
                    candidates.push(candidate);
                    if (candidates.length >= 6)
                        break;
                }
            }
            if (candidates.length >= 6)
                break;
        }
        const resolveCandidate = async (candidate) => {
            const addr = candidate.address.toLowerCase();
            if (DYNAMIC_BASE_TOKEN_CACHE.has(addr)) {
                return DYNAMIC_BASE_TOKEN_CACHE.get(addr);
            }
            let decimals = 18;
            try {
                const onchainPromise = (0, routes_providers_1.getTokenDetails)(candidate.address, provider);
                const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("RPC timeout")), 1500));
                const onchain = await Promise.race([onchainPromise, timeoutPromise]);
                if (onchain && typeof onchain.decimals === "number") {
                    decimals = onchain.decimals;
                }
            }
            catch {
                // fallback to 18
            }
            const tokenItem = {
                address: candidate.address,
                symbol: candidate.symbol,
                name: candidate.name,
                decimals,
                network: "BASE",
            };
            DYNAMIC_BASE_TOKEN_CACHE.set(addr, tokenItem);
            return tokenItem;
        };
        return await Promise.all(candidates.map(resolveCandidate));
    }
    catch (err) {
        console.warn("  [TOKEN_SEARCH:WARN] Dynamic token discovery error:", err?.message);
        return [];
    }
}
const tokenSearchService = async (searchQuery, provider, network) => {
    const q = searchQuery ? searchQuery.trim().toLowerCase() : "";
    const tokenMap = new Map();
    // 1. Seed with known tokens for the requested network
    const knownTokens = network === "BASE" ? KNOWN_BASE_TOKENS : KNOWN_0G_TOKENS;
    for (const t of knownTokens) {
        tokenMap.set(t.address.toLowerCase(), t);
    }
    // 2. Fetch and merge tokens from the live graph/cache
    try {
        const liveTokens = await (0, exports.tokenListWithDetailsService)(provider, network);
        if (Array.isArray(liveTokens)) {
            for (const t of liveTokens) {
                const addr = (t?.address || t?.contractAddress);
                if (addr && !tokenMap.has(addr.toLowerCase())) {
                    tokenMap.set(addr.toLowerCase(), {
                        address: addr,
                        symbol: t.symbol,
                        name: t.name,
                        decimals: t.decimals,
                        network,
                    });
                }
            }
        }
    }
    catch (err) {
        console.warn("  [TOKEN_SEARCH:WARN] Could not retrieve live graph tokens:", err?.message);
    }
    // 3. If query is a valid 42-character contract address not in list, fetch on-chain details directly
    if (q.startsWith("0x") && q.length === 42 && !tokenMap.has(q)) {
        try {
            const onchain = await (0, routes_providers_1.getTokenDetails)(searchQuery.trim(), provider);
            if (onchain && onchain.symbol) {
                const item = {
                    address: onchain.address || searchQuery.trim(),
                    symbol: onchain.symbol,
                    name: onchain.name,
                    decimals: onchain.decimals,
                    network,
                };
                tokenMap.set((onchain.address || searchQuery.trim()).toLowerCase(), item);
            }
        }
        catch (err) {
            console.warn(`  [TOKEN_SEARCH:WARN] Could not resolve CA ${searchQuery} on-chain:`, err?.message);
        }
    }
    // 4. Dynamic discovery for non-default tickers/symbols on Base
    if (network === "BASE" && q && !q.startsWith("0x")) {
        for (const cached of DYNAMIC_BASE_TOKEN_CACHE.values()) {
            if (!tokenMap.has(cached.address.toLowerCase())) {
                tokenMap.set(cached.address.toLowerCase(), cached);
            }
        }
        const hasExactLocalMatch = Array.from(tokenMap.values()).some((t) => (t.symbol || "").toLowerCase() === q);
        if (!hasExactLocalMatch) {
            try {
                const externalTokens = await searchExternalBaseTokens(searchQuery, provider);
                for (const t of externalTokens) {
                    if (!tokenMap.has(t.address.toLowerCase())) {
                        tokenMap.set(t.address.toLowerCase(), t);
                    }
                }
            }
            catch (err) {
                console.warn("  [TOKEN_SEARCH:WARN] External ticker discovery failed:", err?.message);
            }
        }
    }
    const allTokens = Array.from(tokenMap.values());
    // 4. If no query, return the known & indexed tokens
    if (!q) {
        return allTokens;
    }
    const scored = [];
    for (const token of allTokens) {
        const sym = (token.symbol || "").toLowerCase();
        const name = (token.name || "").toLowerCase();
        const addr = (token.address || "").toLowerCase();
        let score = 0;
        if (sym === q) {
            score += 100; // Exact ticker match
        }
        else if (addr === q) {
            score += 95; // Exact CA match
        }
        else if (sym.startsWith(q)) {
            score += 80; // Ticker starts with search
        }
        else if (sym.includes(q)) {
            score += 60; // Ticker contains search
        }
        else if (name.startsWith(q)) {
            score += 40; // Name starts with search
        }
        else if (name.includes(q)) {
            score += 20; // Name contains search
        }
        else if (addr.startsWith(q)) {
            score += 15; // CA prefix match
        }
        if (score > 0) {
            scored.push({ token, score });
        }
    }
    // Sort descending by relevance score
    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.token);
};
exports.tokenSearchService = tokenSearchService;
