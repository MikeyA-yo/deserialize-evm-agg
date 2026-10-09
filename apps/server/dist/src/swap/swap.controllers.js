"use strict";
//controller logics here
Object.defineProperty(exports, "__esModule", { value: true });
exports.tokenSearchController = exports.trendingTokensController = exports.tokenMarketController = exports.allTokensController = exports.tokenListWithDetailsController = exports.tokenDetailsController = exports.tokenPriceController = exports.tokenListController = exports.testnetSwapTransactionController = exports.swapTransactionController = exports.swapQuoteController = void 0;
const swap_schema_1 = require("./swap.schema");
const swap_service_1 = require("./swap.service");
const index_1 = require("../index");
const market_1 = require("./market");
const errors_api_1 = require("../errors/errors.api");
const routes_providers_1 = require("@deserialize-evm-agg/routes-providers");
const chainFromRequest = (paramChain, bodyChain) => {
    return (0, routes_providers_1.normalizeNetworkType)(paramChain || bodyChain || "BASE");
};
const providerForChain = (chainName) => {
    const chain = (0, routes_providers_1.getChainFromName)(chainName);
    return (0, routes_providers_1.createJsonRpcProvider)(chain.rpcUrl, chain.chainId);
};
const swapQuoteController = async (req, res, next) => {
    console.log("\n--- [QUOTE:START] Swap Quote Request Initiated ---");
    try {
        console.log("  [QUOTE:STEP 1] Validating quote request schema...");
        const { body, params } = swap_schema_1.SwapQuoteRequestSchema.parse(req);
        const chainName = chainFromRequest(params?.chain, body.chain);
        console.log(`  [QUOTE:STEP 2] Network identified: ${chainName} (URL param: "${params?.chain}", Body: "${body.chain}")`);
        console.log(`  [QUOTE:STEP 3] Quote parameters: tokenA=${body.tokenA}, tokenB=${body.tokenB}, amountIn=${body.amountIn}, dexId=${body.dexId}`);
        const provider = providerForChain(chainName);
        console.log(`  [QUOTE:STEP 4] Calling swapQuoteService...`);
        const swap = await (0, swap_service_1.swapQuoteService)(body, provider, chainName);
        console.log(`  [QUOTE:SUCCESS] Quote calculated successfully:`, {
            tokenA: swap.tokenA,
            tokenB: swap.tokenB,
            amountIn: swap.amountIn,
            amountOut: swap.amountOut?.toString(),
            tokenPrice: swap.tokenPrice,
            routeHops: swap.routePlan?.length,
            isNativeIn: swap.isNativeIn,
            isNativeOut: swap.isNativeOut,
        });
        console.log("--- [QUOTE:END] Swap Quote Request Completed ---\n");
        res.send(swap);
    }
    catch (error) {
        console.error("❌ [QUOTE:ERROR] Error in swapQuoteController:", {
            message: error?.message,
            stack: error?.stack,
            issues: error?.issues,
        });
        next(error);
    }
};
exports.swapQuoteController = swapQuoteController;
const swapTransactionController = async (req, res, next) => {
    console.log("\n--- [SWAP_TX:START] Swap Transaction Request Initiated ---");
    try {
        console.log("  [SWAP_TX:STEP 1] Validating swap transaction request schema...");
        const { body, params } = swap_schema_1.SwapRequestSchema.parse(req);
        const chainName = chainFromRequest(params?.chain, body.chain || (body.quote?.dexId?.includes("BASE") ? "BASE" : undefined));
        console.log(`  [SWAP_TX:STEP 2] Network identified: ${chainName} (URL param: "${params?.chain}", Body: "${body.chain}", quote.dexId: "${body.quote?.dexId}")`);
        console.log(`  [SWAP_TX:STEP 3] User wallet: ${body.publicKey}, slippage: ${body.slippage}%, pair: ${body.quote.tokenA} -> ${body.quote.tokenB}`);
        const provider = providerForChain(chainName);
        console.log(`  [SWAP_TX:STEP 4] Calling swapService to generate transaction payloads...`);
        const { transaction } = await (0, swap_service_1.swapService)(body, provider, chainName);
        console.log(`  [SWAP_TX:SUCCESS] Generated ${transaction.transactions.length} transaction(s):`, transaction.transactions.map((t, idx) => ({
            index: idx,
            to: t.to,
            value: t.value?.toString() || "0",
            dataLength: t.data?.length || 0,
        })));
        console.log("--- [SWAP_TX:END] Swap Transaction Request Completed ---\n");
        res.send(transaction);
    }
    catch (error) {
        console.error("❌ [SWAP_TX:ERROR] Error in swapTransactionController:", {
            message: error?.message,
            stack: error?.stack,
            issues: error?.issues,
        });
        next(error);
    }
};
exports.swapTransactionController = swapTransactionController;
const testnetSwapTransactionController = async (req, res, next) => {
    console.log("\n--- [TESTNET_SWAP:START] Testnet Swap Transaction Request ---");
    try {
        const { body, params } = swap_schema_1.SwapRequestSchema.parse(req);
        const chainName = chainFromRequest(params?.chain);
        const provider = providerForChain(chainName);
        const { transaction } = await (0, swap_service_1.swapService)(body, provider, chainName);
        console.log("  [TESTNET_SWAP:SUCCESS] Transactions generated:", transaction.transactions.length);
        res.send(transaction);
    }
    catch (error) {
        console.error("❌ [TESTNET_SWAP:ERROR]:", error);
        next(error);
    }
};
exports.testnetSwapTransactionController = testnetSwapTransactionController;
const tokenListController = async (req, res, next) => {
    try {
        const { params } = req;
        const chainName = chainFromRequest(typeof params.chain === "string" ? params.chain : undefined);
        console.log(`  [TOKEN_LIST] Fetching token list for network: ${chainName}...`);
        const provider = providerForChain(chainName);
        const result = await (0, swap_service_1.tokenList)(provider, chainName);
        console.log(`  [TOKEN_LIST:SUCCESS] Found ${result.length} token(s) for ${chainName}`);
        res.send({ result });
    }
    catch (error) {
        console.error("❌ [TOKEN_LIST:ERROR]:", error?.message);
        next(error);
    }
};
exports.tokenListController = tokenListController;
const tokenPriceController = async (req, res, next) => {
    try {
        const { params } = swap_schema_1.TokenPriceRequestSchema.parse(req);
        const chainName = chainFromRequest(params.chain);
        console.log(`  [TOKEN_PRICE] Fetching price for token: ${params.tokenAddress} on ${chainName}...`);
        const provider = providerForChain(chainName);
        const result = await (0, swap_service_1.getTokenPriceService)(params.tokenAddress, provider, chainName);
        console.log(`  [TOKEN_PRICE:SUCCESS] Price for ${params.tokenAddress}: $${result}`);
        res.send({ result });
    }
    catch (error) {
        console.error(`❌ [TOKEN_PRICE:ERROR] Token ${req.params?.tokenAddress}:`, error?.message);
        next(error);
    }
};
exports.tokenPriceController = tokenPriceController;
const tokenDetailsController = async (req, res, next) => {
    try {
        const { params } = swap_schema_1.TokenDetailsRequestSchema.parse(req);
        const chainName = chainFromRequest(params.chain);
        console.log(`  [TOKEN_DETAILS] Fetching details for token: ${params.tokenAddress} on ${chainName}...`);
        const provider = providerForChain(chainName);
        const result = await (0, swap_service_1.getTokenDetailsService)(params.tokenAddress, provider, chainName);
        console.log(`  [TOKEN_DETAILS:SUCCESS] Token: ${result?.symbol} (${result?.name}, Decimals: ${result?.decimals})`);
        // A token looked up by address is usually about to be quoted: index its pools now
        (0, index_1.warmUpTokenDiscovery)(chainName, params.tokenAddress, provider);
        res.send({ result });
    }
    catch (error) {
        console.error(`❌ [TOKEN_DETAILS:ERROR] Token ${req.params?.tokenAddress}:`, error?.message);
        next(error);
    }
};
exports.tokenDetailsController = tokenDetailsController;
const tokenListWithDetailsController = async (req, res, next) => {
    try {
        const { params } = req;
        const chainName = chainFromRequest(typeof params.chain === "string" ? params.chain : undefined);
        console.log(`  [TOKEN_LIST_DETAILS] Fetching detailed token list for ${chainName}...`);
        const provider = providerForChain(chainName);
        const result = await (0, swap_service_1.tokenListWithDetailsService)(provider, chainName);
        console.log(`  [TOKEN_LIST_DETAILS:SUCCESS] Resolved ${result.length} detailed token(s)`);
        res.send({ result });
    }
    catch (error) {
        console.error("❌ [TOKEN_LIST_DETAILS:ERROR]:", error?.message);
        next(error);
    }
};
exports.tokenListWithDetailsController = tokenListWithDetailsController;
const allTokensController = async (req, res, next) => {
    try {
        const chainName = chainFromRequest((typeof req.params.chain === "string" ? req.params.chain : undefined) ||
            (typeof req.query.chain === "string" ? req.query.chain : undefined));
        const toInt = (v) => {
            const n = typeof v === "string" ? Number.parseInt(v, 10) : NaN;
            return Number.isFinite(n) && n >= 0 ? n : undefined;
        };
        const q = typeof req.query.q === "string" ? req.query.q : typeof req.query.query === "string" ? req.query.query : undefined;
        const limit = toInt(req.query.limit);
        const offset = toInt(req.query.offset) ?? 0;
        const provider = providerForChain(chainName);
        const { tokens, total } = await (0, swap_service_1.allTokensService)(provider, chainName, { q, limit, offset });
        console.log(`  [TOKENS:SUCCESS] ${tokens.length} of ${total} token(s) on ${chainName}${q ? ` matching "${q}"` : ""}`);
        res.send({ result: tokens, data: tokens, total, offset, limit: limit ?? null, network: chainName });
    }
    catch (error) {
        console.error("❌ [TOKENS:ERROR]:", error?.message);
        next(error);
    }
};
exports.allTokensController = allTokensController;
const tokenMarketController = async (req, res, next) => {
    try {
        const chainName = chainFromRequest((typeof req.params.chain === "string" ? req.params.chain : undefined) ||
            (typeof req.query.chain === "string" ? req.query.chain : undefined));
        const raw = req.query.addresses ?? req.query.address;
        const addresses = (Array.isArray(raw) ? raw : [raw])
            .filter((v) => typeof v === "string")
            .flatMap((v) => v.split(","))
            .map((v) => v.trim())
            .filter(Boolean);
        if (addresses.length === 0) {
            throw new errors_api_1.ApiError(400, "Pass token addresses as ?addresses=0xabc,0xdef");
        }
        if (addresses.length > market_1.MAX_ADDRESSES_PER_REQUEST) {
            throw new errors_api_1.ApiError(400, `At most ${market_1.MAX_ADDRESSES_PER_REQUEST} addresses per request`);
        }
        const result = await (0, market_1.getTokenMarkets)(chainName, addresses);
        res.send({ result, data: result, network: chainName, cacheSeconds: market_1.MARKET_TTL_MS / 1000, sources: (0, market_1.getUpstreamStatus)() });
    }
    catch (error) {
        console.error("❌ [TOKEN_MARKET:ERROR]:", error?.message);
        next(error);
    }
};
exports.tokenMarketController = tokenMarketController;
const trendingTokensController = async (req, res, next) => {
    try {
        const chainName = chainFromRequest((typeof req.params.chain === "string" ? req.params.chain : undefined) ||
            (typeof req.query.chain === "string" ? req.query.chain : undefined));
        const provider = providerForChain(chainName);
        // If GeckoTerminal is unavailable, rank curated + routable tokens by 24h volume instead
        const fallback = async () => {
            const { tokens } = await (0, swap_service_1.allTokensService)(provider, chainName);
            return tokens
                .filter((t) => (t.verified || t.indexed) && !t.address.toLowerCase().startsWith("0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"))
                .map((t) => t.address)
                .slice(0, market_1.MAX_ADDRESSES_PER_REQUEST);
        };
        const result = await (0, market_1.getTrendingTokens)(chainName, fallback);
        res.send({ result, data: result, total: result.length, network: chainName, cacheSeconds: market_1.MARKET_TTL_MS / 1000, sources: (0, market_1.getUpstreamStatus)() });
    }
    catch (error) {
        console.error("❌ [TOKEN_TRENDING:ERROR]:", error?.message);
        next(error);
    }
};
exports.trendingTokensController = trendingTokensController;
const tokenSearchController = async (req, res, next) => {
    try {
        const chainName = chainFromRequest((typeof req.params.chain === "string" ? req.params.chain : undefined) ||
            (typeof req.query.chain === "string" ? req.query.chain : undefined) ||
            (typeof req.query.network === "string" ? req.query.network : undefined) ||
            "BASE");
        const searchQuery = (req.query.query ||
            req.query.q ||
            req.query.tick ||
            req.query.symbol ||
            req.params.query ||
            "");
        console.log(`  [TOKEN_SEARCH] Searching tokens for query="${searchQuery}" on network=${chainName}...`);
        const provider = providerForChain(chainName);
        const result = await (0, swap_service_1.tokenSearchService)(searchQuery, provider, chainName);
        console.log(`  [TOKEN_SEARCH:SUCCESS] Found ${result.length} matching token(s) for query="${searchQuery}" on ${chainName}`);
        res.send({ result, data: result });
    }
    catch (error) {
        console.error("❌ [TOKEN_SEARCH:ERROR]:", error?.message);
        next(error);
    }
};
exports.tokenSearchController = tokenSearchController;
