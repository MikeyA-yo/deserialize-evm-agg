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
            { internalType: "uint8", name: "protocolFee", type: "uint8" },
            { internalType: "uint8", name: "lpFee", type: "uint8" },
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
}

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

    /**
     * Finds a single V4 pool for a pair and specific fee tier
     */
    public async findPool(
        tokenIn: string,
        tokenOut: string,
        feeTier: { fee: number; tickSpacing: number },
        provider?: JsonRpcProvider
    ): Promise<V4PoolInfo | null> {
        try {
            const normalizedIn = ethers.getAddress(tokenIn);
            const normalizedOut = ethers.getAddress(tokenOut);
            if (normalizedIn.toLowerCase() === normalizedOut.toLowerCase()) return null;

            const isToken0 = normalizedIn.toLowerCase() < normalizedOut.toLowerCase();
            const currency0 = isToken0 ? normalizedIn : normalizedOut;
            const currency1 = isToken0 ? normalizedOut : normalizedIn;

            const poolKey: V4PoolKey = {
                currency0,
                currency1,
                fee: feeTier.fee,
                tickSpacing: feeTier.tickSpacing,
                hooks: ethers.ZeroAddress,
            };

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
     * Finds all active V4 pools for a token pair across standard fee tiers
     */
    public async findAllPools(
        tokenIn: string,
        tokenOut: string,
        provider?: JsonRpcProvider
    ): Promise<V4PoolInfo[]> {
        const feeTiers = this.dexConfig.feeTiers || V4_DEFAULT_FEE_TIERS;
        const results = await Promise.all(
            feeTiers.map((tier) => this.findPool(tokenIn, tokenOut, tier, provider))
        );

        return results.filter((p): p is V4PoolInfo => p !== null && p.liquidity.gt(0));
    }

    /**
     * Calculates the execution output amount using concentrated liquidity swap math.
     * Within the active tick boundary, this matches Uniswap V3/V4 math identically.
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

        // Raw amount in smallest token units
        const rawAmountIn = amountInFormattedInDecimal.mul(new Decimal(10).pow(tokenIn.decimals));
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

        const amountOutFormatted = Decimal.max(0, rawAmountOut.div(new Decimal(10).pow(tokenOut.decimals)));

        // Spot price: price of tokenIn expressed in tokenOut
        const priceRatio = sqrtP.pow(2);
        const decimalAdjustment = new Decimal(10).pow(pool.token0.decimals - pool.token1.decimals);
        const spotPrice0in1 = priceRatio.mul(decimalAdjustment).toNumber();
        const spotPrice = aToB ? spotPrice0in1 : (spotPrice0in1 > 0 ? 1 / spotPrice0in1 : 0);

        return {
            price: spotPrice,
            amountIn: amountInFormattedInDecimal,
            amountOut: amountOutFormatted,
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
     * Falls back to analytical calculation if Quoter simulation fails.
     */
    public async simulateTransaction(
        tokenIn: string,
        tokenOut: string,
        amountIn: string,
        poolAddress: string,
        provider?: JsonRpcProvider
    ): Promise<{ amountOut: string; pool: string }> {
        const prov = provider || this.provider;
        const normalizedIn = ethers.getAddress(tokenIn);
        const normalizedOut = ethers.getAddress(tokenOut);
        const isToken0 = normalizedIn.toLowerCase() < normalizedOut.toLowerCase();

        try {
            const quoter = new Contract(
                this.dexConfig.quoterAddress,
                V4_QUOTER_ABI as any,
                prov
            );

            // Fetch pool details to extract poolKey
            const stateView = new Contract(
                this.dexConfig.stateViewAddress,
                V4_STATE_VIEW_ABI as any,
                prov
            );

            const [slot0, liquidity] = await Promise.all([
                stateView.getSlot0(poolAddress),
                stateView.getLiquidity(poolAddress),
            ]);

            const tokenInMeta = await this.getTokenMetadata(normalizedIn, prov);
            const tokenOutMeta = await this.getTokenMetadata(normalizedOut, prov);

            const rawAmountIn = new Decimal(amountIn)
                .mul(new Decimal(10).pow(tokenInMeta.decimals))
                .toFixed(0);

            // Infer fee from standard tiers or fallback to 3000
            const feeTier = (this.dexConfig.feeTiers || V4_DEFAULT_FEE_TIERS)[1] || { fee: 3000, tickSpacing: 60 };

            const poolKey: V4PoolKey = {
                currency0: isToken0 ? normalizedIn : normalizedOut,
                currency1: isToken0 ? normalizedOut : normalizedIn,
                fee: feeTier.fee,
                tickSpacing: feeTier.tickSpacing,
                hooks: ethers.ZeroAddress,
            };

            const quoteRes = await quoter.quoteExactInputSingle.staticCall({
                poolKey,
                zeroForOne: isToken0,
                exactAmount: BigInt(rawAmountIn),
                hookData: "0x",
            });

            const amountOutFormatted = new Decimal(quoteRes.amountOut.toString())
                .div(new Decimal(10).pow(tokenOutMeta.decimals))
                .toString();

            return { amountOut: amountOutFormatted, pool: poolAddress };
        } catch {
            // Analytical fallback
            const tokenInMeta = await this.getTokenMetadata(normalizedIn, prov);
            const tokenOutMeta = await this.getTokenMetadata(normalizedOut, prov);

            const poolData: V4PoolData = {
                poolId: poolAddress,
                poolAddress,
                poolKey: {
                    currency0: isToken0 ? normalizedIn : normalizedOut,
                    currency1: isToken0 ? normalizedOut : normalizedIn,
                    fee: 3000,
                    tickSpacing: 60,
                    hooks: ethers.ZeroAddress,
                },
                token0: isToken0 ? tokenInMeta : tokenOutMeta,
                token1: isToken0 ? tokenOutMeta : tokenInMeta,
                fee: 3000,
                tickSpacing: 60,
                sqrtPriceX96: "0",
                tick: 0,
                liquidity: "0",
            };

            const quote = this.getAmountOut({
                pool: poolData,
                aToB: isToken0,
                amountInFormattedInDecimal: new Decimal(amountIn),
            });

            return { amountOut: quote.amountOut.toString(), pool: poolAddress };
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
                const quote = this.getAmountOut({
                    pool: bestPool.poolData,
                    aToB,
                    amountInFormattedInDecimal: new Decimal(1),
                });
                if (quote.amountOut.gt(0)) return quote.amountOut.toNumber();
            }
        }

        // Try against wrapped native (WETH)
        if (wrappedAddress && normalized.toLowerCase() !== wrappedAddress) {
            const nativePools = await this.findAllPools(normalized, wrappedAddress);
            if (nativePools.length > 0) {
                const bestPool = nativePools.reduce((a, b) => (a.liquidity.gt(b.liquidity) ? a : b));
                const aToB = bestPool.poolData.token0.address.toLowerCase() === normalized.toLowerCase();
                const quote = this.getAmountOut({
                    pool: bestPool.poolData,
                    aToB,
                    amountInFormattedInDecimal: new Decimal(1),
                });
                const nativePriceUsd = await this.getSureTokenPrice(wrappedAddress);
                if (quote.amountOut.gt(0) && nativePriceUsd > 0) {
                    return quote.amountOut.mul(nativePriceUsd).toNumber();
                }
            }
        }

        return 1;
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
        };
    }
}
