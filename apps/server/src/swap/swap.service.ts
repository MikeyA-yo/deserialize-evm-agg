import { JsonRpcProvider } from "ethers";
import { SwapQuoteRequestType, SwapRequestType } from "./swap.schema";
import { getBestRoutes, initAndGetCache } from "../index";
import Decimal from "decimal.js";
import { ApiError } from "../errors/errors.api";
import { DESERIALIZE_FEE } from "../constants";
import { getSwapRequestFeeRate } from "../utils";
import { AllDexIdTypes, getChainAllRoute, getTokenDetails, UniswapV3QuoteCalculator, ZeroGRoute } from "@deserialize-evm-agg/routes-providers";
import { NetworkType } from "@deserialize-evm-agg/routes-providers";




export const swapQuoteService = async (params: SwapQuoteRequestType, provider: JsonRpcProvider, network: NetworkType) => {

    try {
        console.log(`    [QUOTE_SVC:1/5] Initiating route search: Network=${network}, Pair=${params.tokenA} -> ${params.tokenB}, Amount=${params.amountIn}`);

        const { routes, bestOutcome, RouteJsonRpcProvider } = await getBestRoutes(
            network,
            params.tokenA,
            params.tokenB,
            (params.amountIn),
            provider,
            {
                targetRouteNumber: 5,
            });

        const isNativeIn = params.tokenA.toLowerCase() === RouteJsonRpcProvider.getDexConfig().nativeTokenAddress.toLowerCase();
        const isNativeOut = params.tokenB.toLowerCase() === RouteJsonRpcProvider.getDexConfig().nativeTokenAddress.toLowerCase();
        console.log(`    [QUOTE_SVC:2/5] Best routes retrieved (${routes.length} hop(s)):`, routes.map(r => `${r.dexId} (${r.tokenA.slice(0, 8)}... -> ${r.tokenB.slice(0, 8)}...) via pool ${r.poolAddress}`));

        console.log(`    [QUOTE_SVC:3/5] Simulating on-chain amountOut from route plan...`);
        const { amountOut, pools } =
            await RouteJsonRpcProvider.getAmountOutFromPlan(
                new Decimal(params.amountIn),
                routes,
                0,
                provider
            );
        console.log(`    [QUOTE_SVC:4/5] amountOut result: ${amountOut.toString()}`);

        // Get token price
        let tokenPrice = new Decimal(0);

        const finalRoutes = routes.map((r, i) => {
            return {
                ...r,
                poolAddress: pools[i]
            }
        });

        try {
            const p = await RouteJsonRpcProvider.calculateRoutePrice(finalRoutes);
            tokenPrice = new Decimal(p);
            console.log(`    [QUOTE_SVC:5/5] Token route price calculated: ${tokenPrice.toString()}`);
        } catch (error: any) {
            console.warn(`    [QUOTE_SVC:5/5] Route price lookup fallback (non-fatal):`, error?.message);
        }

        const dexConfig = RouteJsonRpcProvider.getDexConfig();
        return {
            tokenA: params.tokenA,
            tokenB: params.tokenB,
            amountIn: params.amountIn.toString(),
            amountOut: amountOut,
            tokenPrice: tokenPrice.toString(),
            routePlan: finalRoutes,
            dexId: params.dexId,
            dexFactory: dexConfig.factoryAddress,
            isNativeIn,
            isNativeOut
        };
    }
    catch (error: any) {
        console.error("❌ [QUOTE_SVC:ERROR] swapQuoteService failed:", {
            pair: `${params.tokenA} -> ${params.tokenB}`,
            amountIn: params.amountIn,
            network,
            message: error?.message,
            stack: error?.stack,
        });
        if (error instanceof ApiError) {
            throw error;
        }
        throw new ApiError(500, `Failed to process swap quote: ${error?.message || "Unknown error"}`);
    }

}

export const swapService = async (params: SwapRequestType, provider: JsonRpcProvider, network: NetworkType) => {
    try {
        console.log(`    [SWAP_SVC:1/4] Preparing swap for wallet=${params.publicKey} on network=${network}, slippage=${params.slippage}%`);

        let defaultFeeRate = DESERIALIZE_FEE;
        defaultFeeRate =
            getSwapRequestFeeRate(
                params.quote.tokenA,
                params.quote.tokenB
            )?.feeRate ?? defaultFeeRate;

        const cache = await initAndGetCache();
        console.log(`    [SWAP_SVC:2/4] Initialized route provider for ${network}...`);
        const RouteJsonRpcProvider = new (getChainAllRoute(network))(provider, cache);

        console.log(`    [SWAP_SVC:3/4] Requesting transaction instructions for ${params.quote.routePlan?.length || 0} hop(s)...`);
        const transaction = await RouteJsonRpcProvider.getTransactionInstructionFromRoutePlan(
            new Decimal(params.quote.amountIn),
            params.quote.routePlan,
            params.publicKey,
            params.slippage,
            params.quote.isNativeIn,
            params.quote.isNativeOut,
            params.partnerFees
        );

        console.log(`    [SWAP_SVC:4/4] Successfully constructed ${transaction.transactions.length} transaction payload(s)`);

        return {
            transaction
        };
    } catch (error: any) {
        console.error("❌ [SWAP_SVC:ERROR] swapService failed:", {
            wallet: params.publicKey,
            network,
            message: error?.message,
            stack: error?.stack,
        });
        if (error instanceof ApiError) {
            throw error;
        }
        throw new ApiError(500, `Failed to process swap: ${error?.message || "Unknown error"}`);
    }
};




export const tokenList = async (provider: JsonRpcProvider, network: NetworkType) => {
    const router = getChainAllRoute(network ?? "0G")
    const cache = await initAndGetCache()
    const routeInstance = new router(provider, cache)

    return await routeInstance.listTokens()
}

export const tokenListWithDetailsService = async (provider: JsonRpcProvider, network: NetworkType) => {
    const router = getChainAllRoute(network)
    const cache = await initAndGetCache()
    const routeInstance = new router(provider, cache)

    const tokens = await routeInstance.listTokens()
    const detailedTokens = await Promise.all(tokens.map(async (token) => {
        try {
            const cacheDetails = await cache.getMintFromCache(`ALL_${network}` as AllDexIdTypes, token)

            if (!cacheDetails) {
                const details = await getTokenDetails(token, provider);
                await cache.setMintToCache(`ALL_${network}` as AllDexIdTypes, { ...details, contractAddress: token });
                return details;
            }

            return cacheDetails;
        } catch (error) {
            console.log("Error in tokenListWithDetailsService", { error });
            return null
        }



    }))

    return detailedTokens.filter((token) => token !== null);
}

export const getTokenPriceService = async (tokenAddress: string, provider: JsonRpcProvider, network: NetworkType) => {
    const router = getChainAllRoute(network)
    const cache = await initAndGetCache()
    const routeInstance = new router(provider, cache)

    // return calculator.getPoolData("0x224D0891D63Ca83e6DD98B4653C27034503a5E76")
    return await routeInstance.getSurePriceOfToken(tokenAddress);
}

export const getTokenDetailsService = async (tokenAddress: string, provider: JsonRpcProvider, network: NetworkType) => {
    const router = getChainAllRoute(network)
    const cache = await initAndGetCache()
    const routeInstance = new router(provider, cache)


    const cacheDetails = await cache.getMintFromCache(`ALL_${network}` as AllDexIdTypes, tokenAddress)

    if (!cacheDetails) {
        const details = await getTokenDetails(tokenAddress, provider);
        await cache.setMintToCache(`ALL_${network}` as AllDexIdTypes, { ...details, contractAddress: tokenAddress });
        return details;
    }

    return cacheDetails;
}

export interface SearchTokenResult {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    network?: string;
}

const KNOWN_BASE_TOKENS: SearchTokenResult[] = [
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

const KNOWN_0G_TOKENS: SearchTokenResult[] = [
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

export const tokenSearchService = async (
    searchQuery: string | undefined,
    provider: JsonRpcProvider,
    network: NetworkType
): Promise<SearchTokenResult[]> => {
    const q = searchQuery ? searchQuery.trim().toLowerCase() : "";
    const tokenMap = new Map<string, SearchTokenResult>();

    // 1. Seed with known tokens for the requested network
    const knownTokens = network === "BASE" ? KNOWN_BASE_TOKENS : KNOWN_0G_TOKENS;
    for (const t of knownTokens) {
        tokenMap.set(t.address.toLowerCase(), t);
    }

    // 2. Fetch and merge tokens from the live graph/cache
    try {
        const liveTokens: any = await tokenListWithDetailsService(provider, network);
        if (Array.isArray(liveTokens)) {
            for (const t of liveTokens) {
                const addr = (t?.address || t?.contractAddress) as string | undefined;
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
    } catch (err: any) {
        console.warn("  [TOKEN_SEARCH:WARN] Could not retrieve live graph tokens:", err?.message);
    }

    // 3. If query is a valid 42-character contract address not in list, fetch on-chain details directly
    if (q.startsWith("0x") && q.length === 42 && !tokenMap.has(q)) {
        try {
            const onchain: any = await getTokenDetails(searchQuery!.trim(), provider);
            if (onchain && onchain.symbol) {
                const item: SearchTokenResult = {
                    address: onchain.address || searchQuery!.trim(),
                    symbol: onchain.symbol,
                    name: onchain.name,
                    decimals: onchain.decimals,
                    network,
                };
                tokenMap.set((onchain.address || searchQuery!.trim()).toLowerCase(), item);
            }
        } catch (err: any) {
            console.warn(`  [TOKEN_SEARCH:WARN] Could not resolve CA ${searchQuery} on-chain:`, err?.message);
        }
    }

    const allTokens = Array.from(tokenMap.values());

    // 4. If no query, return the known & indexed tokens
    if (!q) {
        return allTokens;
    }

    // 5. Score and filter tokens by ticker/symbol, name, and address
    interface ScoredToken {
        token: SearchTokenResult;
        score: number;
    }

    const scored: ScoredToken[] = [];

    for (const token of allTokens) {
        const sym = (token.symbol || "").toLowerCase();
        const name = (token.name || "").toLowerCase();
        const addr = (token.address || "").toLowerCase();

        let score = 0;

        if (sym === q) {
            score += 100; // Exact ticker match
        } else if (addr === q) {
            score += 95; // Exact CA match
        } else if (sym.startsWith(q)) {
            score += 80; // Ticker starts with search
        } else if (sym.includes(q)) {
            score += 60; // Ticker contains search
        } else if (name.startsWith(q)) {
            score += 40; // Name starts with search
        } else if (name.includes(q)) {
            score += 20; // Name contains search
        } else if (addr.startsWith(q)) {
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


