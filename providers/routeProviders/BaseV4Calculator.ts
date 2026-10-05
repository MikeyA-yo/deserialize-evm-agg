/**
 * Base V4 Quote Calculator
 * 
 * Calculator for Uniswap V4 singleton architecture (PoolManager + StateView + Quoter)
 * Supports dynamic PoolKey hashing, StateView slot0/liquidity reads,
 * and accurate Quoter static simulations.
 */

import { ethers, Contract, JsonRpcProvider } from "ethers";
import Decimal from "decimal.js";
import { Token } from "./type";
import { ChainConfig, createJsonRpcProvider, ERC20_ABI } from "./UniswapV3Calculator";
import { getTokenPrice, getTokenPriceByAddress } from "./price";
import { NetworkType } from "./constants";

// ==================== CONSTANTS ====================

const Q96 = new Decimal(2).pow(96);
const FEE_DENOMINATOR = new Decimal(1_000_000);

export const V4_DEFAULT_FEE_TIERS: { fee: number; tickSpacing: number }[] = [
    { fee: 500, tickSpacing: 10 },    // 0.05%
    { fee: 3000, tickSpacing: 60 },   // 0.3%
    { fee: 10000, tickSpacing: 200 }, // 1.0%
    { fee: 100, tickSpacing: 1 },     // 0.01%
];

// ==================== ABIS ====================

export const V4_STATE_VIEW_ABI = [
    {
        inputs: [{ internalType: "bytes32", name: "poolId", type: "bytes32" }],
        name: "getSlot0",
        outputs: [
            { internalType: "uint160", name: "sqrtPriceX96", type: "uint160" },
            { internalType: "int24", name: "tick", type: "int24" },
            { internalType: "uint24", name: "protocolFee", type: "uint24" },
            { internalType: "uint24", name: "lpFee", type: "uint24" },
        ],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [{ internalType: "bytes32", name: "poolId", type: "bytes32" }],
        name: "getLiquidity",
        outputs: [{ internalType: "uint128", name: "liquidity", type: "uint128" }],
        stateMutability: "view",
        type: "function",
    },
] as const;

export const V4_QUOTER_ABI = [
    {
        inputs: [
            {
                components: [
                    {
                        components: [
                            { internalType: "address", name: "currency0", type: "address" },
                            { internalType: "address", name: "currency1", type: "address" },
                            { internalType: "uint24", name: "fee", type: "uint24" },
                            { internalType: "int24", name: "tickSpacing", type: "int24" },
                            { internalType: "address", name: "hooks", type: "address" },
                        ],
                        internalType: "struct PoolKey",
                        name: "poolKey",
                        type: "tuple",
                    },
                    { internalType: "bool", name: "zeroForOne", type: "bool" },
                    { internalType: "uint128", name: "exactAmount", type: "uint128" },
                    { internalType: "bytes", name: "hookData", type: "bytes" },
                ],
                internalType: "struct IQuoter.QuoteExactSingleParams",
                name: "params",
                type: "tuple",
            },
        ],
        name: "quoteExactInputSingle",
        outputs: [
            { internalType: "uint256", name: "amountOut", type: "uint256" },
            { internalType: "uint256", name: "gasEstimate", type: "uint256" },
        ],
        stateMutability: "nonpayable",
        type: "function",
    },
] as const;

// ==================== TYPES ====================

export interface V4DexConfig {
    name: string;
    network: NetworkType;
    poolManagerAddress: string;
    stateViewAddress: string;
    quoterAddress: string;
    factoryAddress: string;
    wrappedNativeTokenAddress: string;
    nativeTokenAddress: string;
    stableTokenAddress?: string;
    feeTiers?: { fee: number; tickSpacing: number }[];
    /**
     * On-chain UniswapV4Adapter. When set, only pools that adapter can execute are quoted:
     * ERC-20 currencies (the adapter cannot settle native ETH) whose PoolKey is registered on the
     * adapter (registerPool) under the pool's handle. Unset = quote-only, no gating.
     */
    adapterAddress?: string;
}

export const V4_ADAPTER_ABI = [
    "function getPoolKeyByHandle(address) view returns (tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks))",
] as const;

/**
 * The UniswapV4Adapter addresses a pool by its "handle": the low 160 bits of the 32-byte PoolId,
 * passed in the router hop's 20-byte poolAddress field.
 */
export const v4PoolHandleFromId = (poolId: string): string => ethers.getAddress("0x" + poolId.slice(-40));

// Executability lookups are shared across calculator instances (routes are re-created per request)
const V4_EXECUTABLE_CACHE = new Map<string, { executable: boolean; at: number }>();
const V4_EXECUTABLE_TTL_MS = 5 * 60 * 1000;

export interface V4PoolKey {
    currency0: string;
    currency1: string;
    fee: number;
    tickSpacing: number;
    hooks: string;
}

export interface V4PoolData {
    poolId: string; // 32-byte hex ID
    poolAddress: string; // alias to poolId for IRoute compatibility
    poolKey: V4PoolKey;
    token0: Token;
    token1: Token;
    fee: number;
    tickSpacing: number;
    sqrtPriceX96: string;
    tick: number;
    liquidity: string;
    token0PriceUsd?: number; // set on graph edges, used as the edge cost reference price
    token1PriceUsd?: number;
}

export interface V4PoolInfo {
    pool: Contract;
    fee: number;
    liquidity: Decimal;
    address: string;
    poolData: V4PoolData;
}

export interface V4QuoteResult {
    price: number;
    amountIn: Decimal;
    amountOut: Decimal;
    poolAddress: string;
    fee: Decimal;
    liquidity: Decimal;
    tokenInDecimals: number;
    tokenOutDecimals: number;
    zeroForOne: boolean;
}

// ==================== CALCULATOR CLASS ====================

export class BaseV4QuoteCalculator {
    public dexConfig: V4DexConfig;
    public chainConfig: ChainConfig;
    public provider: JsonRpcProvider;
    private stateViewContract: Contract;
    private quoterContract: Contract;
    private tokenMetadataCache: Map<string, Token> = new Map();

    constructor(dexConfig: V4DexConfig, chainConfig: ChainConfig, provider?: JsonRpcProvider) {
        this.dexConfig = dexConfig;
        this.chainConfig = chainConfig;
        this.provider = provider || createJsonRpcProvider(chainConfig.rpcUrl, chainConfig.chainId);

        this.stateViewContract = new Contract(
            dexConfig.stateViewAddress,
            V4_STATE_VIEW_ABI as any,
            this.provider
        );
        this.quoterContract = new Contract(
            dexConfig.quoterAddress,
            V4_QUOTER_ABI as any,
            this.provider
        );
    }

    /**
     * Computes the keccak256 poolId from a V4 PoolKey
     */
    public computePoolId(poolKey: V4PoolKey): string {
        const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
            ["tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)"],
            [poolKey]
        );
        return ethers.keccak256(encoded);
    }

    /**
     * Resolves ERC-20 token metadata (decimals, symbol, name) with caching
     */
    public async getTokenMetadata(tokenAddress: string, provider?: JsonRpcProvider): Promise<Token> {
        const normalized = ethers.getAddress(tokenAddress);
        const lower = normalized.toLowerCase();
        const cached = this.tokenMetadataCache.get(lower);
        if (cached) return cached;

        if (this.dexConfig.wrappedNativeTokenAddress && lower === this.dexConfig.wrappedNativeTokenAddress.toLowerCase()) {
            const token: Token = {
                address: normalized,
                decimals: 18,
                symbol: this.chainConfig.wrappedTokenSymbol || "WETH",
                name: "Wrapped Ether",
            };
            this.tokenMetadataCache.set(lower, token);
            return token;
        }

        if (this.dexConfig.nativeTokenAddress && lower === this.dexConfig.nativeTokenAddress.toLowerCase()) {
            const token: Token = {
                address: normalized,
                decimals: 18,
                symbol: this.chainConfig.nativeTokenSymbol || "ETH",
                name: "Ether",
            };
            this.tokenMetadataCache.set(lower, token);
            return token;
        }

        if (this.dexConfig.stableTokenAddress && lower === this.dexConfig.stableTokenAddress.toLowerCase()) {
            const token: Token = {
                address: normalized,
                decimals: 6,
                symbol: "USDC",
                name: "USD Coin",
            };
            this.tokenMetadataCache.set(lower, token);
            return token;
        }

        const prov = provider || this.provider;
        const tokenContract = new Contract(normalized, ERC20_ABI, prov);

        try {
            const [decimals, symbol, name] = await Promise.all([
                tokenContract.decimals().catch(() => 18),
                tokenContract.symbol().catch(() => "UNKNOWN"),
                tokenContract.name().catch(() => "Unknown Token"),
            ]);

            const token: Token = {
                address: normalized,
                decimals: Number(decimals),
                symbol: String(symbol),
                name: String(name),
            };

            this.tokenMetadataCache.set(lower, token);
            return token;
        } catch {
            const fallbackToken: Token = {
                address: normalized,
                decimals: 18,
                symbol: "UNKNOWN",
                name: "Unknown Token",
            };
            this.tokenMetadataCache.set(lower, fallbackToken);
            return fallbackToken;
        }
    }

    private isWrappedNative(token: string): boolean {
        return !!this.dexConfig.wrappedNativeTokenAddress &&
            token.toLowerCase() === this.dexConfig.wrappedNativeTokenAddress.toLowerCase();
    }

    /**
     * Maps a V4 currency back to the graph token: native ETH (address(0)) is represented as WETH,
     * because the routing graph and the rest of the engine are WETH-denominated.
     */
    private currencyToGraphToken(currency: string): string {
        return currency.toLowerCase() === ethers.ZeroAddress.toLowerCase()
            ? ethers.getAddress(this.dexConfig.wrappedNativeTokenAddress)
            : currency;
    }

    /**
     * Builds the (hookless) PoolKey for a pair. With native = true, WETH is replaced by
     * native ETH (address(0)), which is how most V4 ETH liquidity is deployed.
     * Returns null if native is requested but neither token is WETH.
     */
    public buildPoolKey(
        tokenA: string,
        tokenB: string,
        feeTier: { fee: number; tickSpacing: number },
        native: boolean = false
    ): V4PoolKey | null {
        let a = ethers.getAddress(tokenA);
        let b = ethers.getAddress(tokenB);
        if (a.toLowerCase() === b.toLowerCase()) return null;

        if (native) {
            if (this.isWrappedNative(a)) a = ethers.ZeroAddress;
            else if (this.isWrappedNative(b)) b = ethers.ZeroAddress;
            else return null;
        }

        const aIsCurrency0 = a.toLowerCase() < b.toLowerCase();
        return {
            currency0: aIsCurrency0 ? a : b,
            currency1: aIsCurrency0 ? b : a,
            fee: feeTier.fee,
            tickSpacing: feeTier.tickSpacing,
            hooks: ethers.ZeroAddress,
        };
    }

    /**
     * Recovers the PoolKey behind a poolId (route plans only carry the poolId) by hashing the
     * candidate keys for this pair: every configured fee tier, WETH and native ETH variants.
     * Pure computation, no RPC. Returns the swap direction relative to the key.
     */
    public resolvePoolKey(
        tokenIn: string,
        tokenOut: string,
        poolId: string
    ): { poolKey: V4PoolKey; zeroForOne: boolean } | null {
        const feeTiers = this.dexConfig.feeTiers || V4_DEFAULT_FEE_TIERS;
        const target = poolId.toLowerCase();

        for (const native of [false, true]) {
            for (const tier of feeTiers) {
                const poolKey = this.buildPoolKey(tokenIn, tokenOut, tier, native);
                if (!poolKey || this.computePoolId(poolKey).toLowerCase() !== target) continue;

                const tokenInCurrency = native && this.isWrappedNative(tokenIn) ? ethers.ZeroAddress : ethers.getAddress(tokenIn);
                return {
                    poolKey,
                    zeroForOne: tokenInCurrency.toLowerCase() === poolKey.currency0.toLowerCase(),
                };
            }
        }
        return null;
    }

    /**
     * Whether the configured UniswapV4Adapter can execute a swap on this pool. The hop carries the
     * pool's handle (see v4PoolHandleFromId); the adapter resolves it to the PoolKey registered
     * under that handle, so the registered key must equal this pool's key. The adapter only
     * settles ERC-20 currencies, so native-ETH pools are never executable.
     */
    public async isExecutable(poolKey: V4PoolKey, provider?: JsonRpcProvider): Promise<boolean> {
        if (!this.dexConfig.adapterAddress) return true;
        if (
            poolKey.currency0.toLowerCase() === ethers.ZeroAddress.toLowerCase() ||
            poolKey.currency1.toLowerCase() === ethers.ZeroAddress.toLowerCase()
        ) {
            return false;
        }

        const handle = v4PoolHandleFromId(this.computePoolId(poolKey));
        const cacheKey = `${this.dexConfig.adapterAddress.toLowerCase()}:${handle.toLowerCase()}`;
        const cached = V4_EXECUTABLE_CACHE.get(cacheKey);
        if (cached && Date.now() - cached.at < V4_EXECUTABLE_TTL_MS) return cached.executable;

        try {
            const adapter = new Contract(this.dexConfig.adapterAddress, V4_ADAPTER_ABI as any, provider || this.provider);
            const registered = await adapter.getPoolKeyByHandle(handle);
            const executable =
                String(registered.currency0).toLowerCase() === poolKey.currency0.toLowerCase() &&
                String(registered.currency1).toLowerCase() === poolKey.currency1.toLowerCase() &&
                Number(registered.fee) === Number(poolKey.fee) &&
                Number(registered.tickSpacing) === Number(poolKey.tickSpacing) &&
                String(registered.hooks).toLowerCase() === poolKey.hooks.toLowerCase();
            V4_EXECUTABLE_CACHE.set(cacheKey, { executable, at: Date.now() });
            return executable;
        } catch {
            return false; // not cached, so a transient RPC failure is retried next time
        }
    }

    /**
     * Finds a single V4 pool for a pair and specific fee tier
     */
    public async findPool(
        tokenIn: string,
        tokenOut: string,
        feeTier: { fee: number; tickSpacing: number },
        provider?: JsonRpcProvider,
        native: boolean = false
    ): Promise<V4PoolInfo | null> {
        try {
            const poolKey = this.buildPoolKey(tokenIn, tokenOut, feeTier, native);
            if (!poolKey) return null;

            const currency0 = this.currencyToGraphToken(poolKey.currency0);
            const currency1 = this.currencyToGraphToken(poolKey.currency1);

            const poolId = this.computePoolId(poolKey);
            const stateView = provider
                ? new Contract(this.dexConfig.stateViewAddress, V4_STATE_VIEW_ABI as any, provider)
                : this.stateViewContract;

            const [slot0, liquidity] = await Promise.all([
                stateView.getSlot0(poolId).catch(() => null),
                stateView.getLiquidity(poolId).catch(() => 0n),
            ]);

            if (!slot0 || slot0.sqrtPriceX96 === 0n || liquidity === 0n) {
                return null;
            }

            const [token0Meta, token1Meta] = await Promise.all([
                this.getTokenMetadata(currency0, provider),
                this.getTokenMetadata(currency1, provider),
            ]);

            const poolData: V4PoolData = {
                poolId,
                poolAddress: poolId,
                poolKey,
                token0: token0Meta,
                token1: token1Meta,
                fee: feeTier.fee,
                tickSpacing: feeTier.tickSpacing,
                sqrtPriceX96: slot0.sqrtPriceX96.toString(),
                tick: Number(slot0.tick),
                liquidity: liquidity.toString(),
            };

            return {
                pool: stateView,
                fee: feeTier.fee,
                liquidity: new Decimal(liquidity.toString()),
                address: poolId,
                poolData,
            };
        } catch {
            return null;
        }
    }

    /**
     * Finds all active V4 pools for a token pair across standard fee tiers.
     * For WETH pairs, native-ETH (address(0)) pools are included and exposed as WETH in the graph.
     */
    public async findAllPools(
        tokenIn: string,
        tokenOut: string,
        provider?: JsonRpcProvider
    ): Promise<V4PoolInfo[]> {
        const feeTiers = this.dexConfig.feeTiers || V4_DEFAULT_FEE_TIERS;
        const includeNative = this.isWrappedNative(tokenIn) || this.isWrappedNative(tokenOut);
        const variants = includeNative ? [false, true] : [false];

        const results = await Promise.all(
            variants.flatMap((native) =>
                feeTiers.map((tier) => this.findPool(tokenIn, tokenOut, tier, provider, native))
            )
        );

        return results.filter((p): p is V4PoolInfo => p !== null && p.liquidity.gt(0));
    }

    /**
     * Re-reads slot0 and liquidity for a known pool (used by graph edge refresh).
     */
    public async refreshPoolData(pool: V4PoolData, provider?: JsonRpcProvider): Promise<V4PoolData> {
        const stateView = provider
            ? new Contract(this.dexConfig.stateViewAddress, V4_STATE_VIEW_ABI as any, provider)
            : this.stateViewContract;

        const [slot0, liquidity] = await Promise.all([
            stateView.getSlot0(pool.poolId),
            stateView.getLiquidity(pool.poolId),
        ]);

        return {
            ...pool,
            sqrtPriceX96: slot0.sqrtPriceX96.toString(),
            tick: Number(slot0.tick),
            liquidity: liquidity.toString(),
        };
    }

    /**
     * Calculates the execution output amount using concentrated liquidity swap math.
     * Within the active tick boundary, this matches Uniswap V3/V4 math identically.
     * amountInFormattedInDecimal is in raw base units (wei), matching the V3 calculators.
     * amountOut is returned in raw base units of tokenOut.
     */
    public getAmountOut(params: {
        pool: V4PoolData;
        aToB: boolean;
        amountInFormattedInDecimal: Decimal;
    }): V4QuoteResult {
        const { pool, aToB, amountInFormattedInDecimal } = params;
        const tokenIn = aToB ? pool.token0 : pool.token1;
        const tokenOut = aToB ? pool.token1 : pool.token0;

        const sqrtP = new Decimal(pool.sqrtPriceX96).div(Q96);
        const L = new Decimal(pool.liquidity);
        const feeRate = new Decimal(pool.fee).div(FEE_DENOMINATOR);

        const rawAmountIn = amountInFormattedInDecimal;
        const amountInAfterFee = rawAmountIn.mul(new Decimal(1).sub(feeRate));

        if (L.lte(0) || sqrtP.lte(0) || rawAmountIn.lte(0)) {
            return {
                price: 0,
                amountIn: amountInFormattedInDecimal,
                amountOut: new Decimal(0),
                poolAddress: pool.poolId,
                fee: new Decimal(pool.fee),
                liquidity: L,
                tokenInDecimals: tokenIn.decimals,
                tokenOutDecimals: tokenOut.decimals,
                zeroForOne: aToB,
            };
        }

        let rawAmountOut: Decimal;
        if (aToB) {
            // zeroForOne (currency0 -> currency1): sqrtP decreases
            const numerator = L.mul(sqrtP);
            const denominator = L.add(amountInAfterFee.mul(sqrtP));
            const sqrtPNext = numerator.div(denominator);
            rawAmountOut = L.mul(sqrtP.sub(sqrtPNext));
        } else {
            // oneForZero (currency1 -> currency0): sqrtP increases
            const sqrtPNext = sqrtP.add(amountInAfterFee.div(L));
            rawAmountOut = L.mul(new Decimal(1).div(sqrtP).sub(new Decimal(1).div(sqrtPNext)));
        }

        const amountOutRaw = Decimal.max(0, rawAmountOut).floor();

        // Spot price: price of tokenIn expressed in tokenOut (human units)
        const priceRatio = sqrtP.pow(2);
        const decimalAdjustment = new Decimal(10).pow(pool.token0.decimals - pool.token1.decimals);
        const spotPrice0in1 = priceRatio.mul(decimalAdjustment).toNumber();
        const spotPrice = aToB ? spotPrice0in1 : (spotPrice0in1 > 0 ? 1 / spotPrice0in1 : 0);

        return {
            price: spotPrice,
            amountIn: amountInFormattedInDecimal,
            amountOut: amountOutRaw,
            poolAddress: pool.poolId,
            fee: new Decimal(pool.fee),
            liquidity: L,
            tokenInDecimals: tokenIn.decimals,
            tokenOutDecimals: tokenOut.decimals,
            zeroForOne: aToB,
        };
    }

    /**
     * Simulates swap execution through the Uniswap V4 Quoter contract.
     * Falls back to analytical calculation (live slot0/liquidity) if Quoter simulation fails.
     * amountIn and the returned amountOut are raw base-unit integer strings (wei).
     * poolAddress is the poolId; the real PoolKey (fee tier, tick spacing, WETH or native ETH)
     * is recovered from it so the quote is taken on the same pool the router selected.
     */
    public async simulateTransaction(
        tokenIn: string,
        tokenOut: string,
        amountIn: string,
        poolAddress: string,
        provider?: JsonRpcProvider
    ): Promise<{ amountOut: string; pool: string }> {
        const prov = provider || this.provider;
        const rawAmountIn = new Decimal(amountIn).floor();

        const resolved = this.resolvePoolKey(tokenIn, tokenOut, poolAddress);
        if (!resolved) {
            console.error(`[V4:SIMULATE_ERR] Could not resolve PoolKey for pool ${poolAddress} (${tokenIn} -> ${tokenOut})`);
            return { amountOut: "0", pool: poolAddress };
        }
        const { poolKey, zeroForOne } = resolved;

        // A pool the on-chain adapter cannot execute must not be quoted: the swap would revert
        // (or trade a different registered fee tier than the one quoted).
        if (!(await this.isExecutable(poolKey, prov))) {
            console.log(`[V4:NOT_EXECUTABLE] Pool ${poolAddress} (fee ${poolKey.fee}, ${poolKey.currency0 === ethers.ZeroAddress ? "native ETH" : "ERC-20"}) is not executable by the V4 adapter; skipping`);
            return { amountOut: "0", pool: poolAddress };
        }

        try {
            const quoter = new Contract(
                this.dexConfig.quoterAddress,
                V4_QUOTER_ABI as any,
                prov
            );

            const quoteRes = await quoter.quoteExactInputSingle.staticCall({
                poolKey,
                zeroForOne,
                exactAmount: BigInt(rawAmountIn.toFixed(0)),
                hookData: "0x",
            });

            return { amountOut: quoteRes.amountOut.toString(), pool: poolAddress };
        } catch {
            // Analytical fallback using the live pool state
            try {
                const [token0Meta, token1Meta] = await Promise.all([
                    this.getTokenMetadata(this.currencyToGraphToken(poolKey.currency0), prov),
                    this.getTokenMetadata(this.currencyToGraphToken(poolKey.currency1), prov),
                ]);

                const livePool = await this.refreshPoolData({
                    poolId: poolAddress,
                    poolAddress,
                    poolKey,
                    token0: token0Meta,
                    token1: token1Meta,
                    fee: poolKey.fee,
                    tickSpacing: poolKey.tickSpacing,
                    sqrtPriceX96: "0",
                    tick: 0,
                    liquidity: "0",
                }, prov);

                const quote = this.getAmountOut({
                    pool: livePool,
                    aToB: zeroForOne,
                    amountInFormattedInDecimal: rawAmountIn,
                });

                return { amountOut: quote.amountOut.toFixed(0), pool: poolAddress };
            } catch (error) {
                console.error(`[V4:SIMULATE_ERR] Simulation failed for pool ${poolAddress}:`, error);
                return { amountOut: "0", pool: poolAddress };
            }
        }
    }

    /**
     * Resolves the USD price of a token via V4 pool against WETH or USDC
     */
    public async getSureTokenPrice(tokenAddress: string): Promise<number> {
        const normalized = ethers.getAddress(tokenAddress);
        const stableAddress = this.chainConfig.stableTokenAddress?.toLowerCase();
        const wrappedAddress = this.chainConfig.wrappedNativeTokenAddress?.toLowerCase();

        if (stableAddress && normalized.toLowerCase() === stableAddress) {
            return 1;
        }

        try {
            const externalPriceResult = await getTokenPriceByAddress(this.chainConfig.network, normalized);
            if (externalPriceResult.success && externalPriceResult.data && externalPriceResult.data.price > 0) {
                return externalPriceResult.data.price;
            }
        } catch {
            // continue to on-chain derivation
        }

        // Try against stable token
        if (stableAddress) {
            const stablePools = await this.findAllPools(normalized, stableAddress);
            if (stablePools.length > 0) {
                const bestPool = stablePools.reduce((a, b) => (a.liquidity.gt(b.liquidity) ? a : b));
                const aToB = bestPool.poolData.token0.address.toLowerCase() === normalized.toLowerCase();
                const quote = this.quoteOneToken(bestPool.poolData, aToB);
                if (quote.gt(0)) return quote.toNumber();
            }
        }

        // Try against wrapped native (WETH)
        if (wrappedAddress && normalized.toLowerCase() !== wrappedAddress) {
            const nativePools = await this.findAllPools(normalized, wrappedAddress);
            if (nativePools.length > 0) {
                const bestPool = nativePools.reduce((a, b) => (a.liquidity.gt(b.liquidity) ? a : b));
                const aToB = bestPool.poolData.token0.address.toLowerCase() === normalized.toLowerCase();
                const quote = this.quoteOneToken(bestPool.poolData, aToB);
                const nativePriceUsd = await this.getSureTokenPrice(wrappedAddress);
                if (quote.gt(0) && nativePriceUsd > 0) {
                    return quote.mul(nativePriceUsd).toNumber();
                }
            }
        }

        // Unknown price. Do not invent $1: it is cached and averaged into other DEXes' prices.
        return 0;
    }

    /**
     * Human amount of tokenOut received for exactly 1 whole tokenIn.
     */
    private quoteOneToken(pool: V4PoolData, aToB: boolean): Decimal {
        const tokenIn = aToB ? pool.token0 : pool.token1;
        const tokenOut = aToB ? pool.token1 : pool.token0;
        const quote = this.getAmountOut({
            pool,
            aToB,
            amountInFormattedInDecimal: new Decimal(10).pow(tokenIn.decimals),
        });
        return quote.amountOut.div(new Decimal(10).pow(tokenOut.decimals));
    }

    public formatPool(pool: any): V4PoolData {
        return {
            poolId: pool.poolId || pool.poolAddress,
            poolAddress: pool.poolAddress || pool.poolId,
            poolKey: pool.poolKey,
            token0: pool.token0,
            token1: pool.token1,
            fee: Number(pool.fee || 3000),
            tickSpacing: Number(pool.tickSpacing || 60),
            sqrtPriceX96: pool.sqrtPriceX96 || "0",
            tick: Number(pool.tick || 0),
            liquidity: pool.liquidity || "0",
            token0PriceUsd: pool.token0PriceUsd,
            token1PriceUsd: pool.token1PriceUsd,
        };
    }
}
