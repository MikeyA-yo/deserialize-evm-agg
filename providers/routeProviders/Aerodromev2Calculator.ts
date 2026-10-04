/**
 * Aerodrome V2 (Classic AMM) Quote Calculator
 * 
 * Supports both Volatile (x * y = k) and Stable (x^3*y + y^3*x = k) pool curves
 * with live on-chain getAmountOut verification and dynamic fee resolution.
 */

import { ethers, Contract, JsonRpcProvider } from "ethers";
import Decimal from "decimal.js";
import { Token } from "./type";
import { ChainConfig, createJsonRpcProvider, ERC20_ABI } from "./UniswapV3Calculator";
import { getTokenPrice, getTokenPriceByAddress } from "./price";
import { NetworkType } from "./constants";

// ==================== ABIS ====================

export const AERODROME_V2_FACTORY_ABI = [
    {
        inputs: [
            { internalType: "address", name: "tokenA", type: "address" },
            { internalType: "address", name: "tokenB", type: "address" },
            { internalType: "bool", name: "stable", type: "bool" },
        ],
        name: "getPool",
        outputs: [{ internalType: "address", name: "", type: "address" }],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [
            { internalType: "address", name: "pool", type: "address" },
            { internalType: "bool", name: "stable", type: "bool" },
        ],
        name: "getFee",
        outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [],
        name: "volatileFee",
        outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [],
        name: "stableFee",
        outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [],
        name: "allPoolsLength",
        outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
        stateMutability: "view",
        type: "function",
    },
] as const;

export const AERODROME_V2_POOL_ABI = [
    {
        inputs: [],
        name: "getReserves",
        outputs: [
            { internalType: "uint256", name: "_reserve0", type: "uint256" },
            { internalType: "uint256", name: "_reserve1", type: "uint256" },
            { internalType: "uint256", name: "_blockTimestampLast", type: "uint256" },
        ],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [],
        name: "token0",
        outputs: [{ internalType: "address", name: "", type: "address" }],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [],
        name: "token1",
        outputs: [{ internalType: "address", name: "", type: "address" }],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [],
        name: "stable",
        outputs: [{ internalType: "bool", name: "", type: "bool" }],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [
            { internalType: "uint256", name: "amountIn", type: "uint256" },
            { internalType: "address", name: "tokenIn", type: "address" },
        ],
        name: "getAmountOut",
        outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
        stateMutability: "view",
        type: "function",
    },
] as const;

// ==================== TYPES ====================

export interface AerodromeV2DexConfig {
    name: string;
    network: NetworkType;
    factoryAddress: string;
    routerAddress?: string;
    wrappedNativeTokenAddress: string;
    nativeTokenAddress: string;
    stableTokenAddress?: string;
}

export interface AerodromePoolData {
    poolAddress: string;
    token0: Token;
    token1: Token;
    stable: boolean;
    reserve0: string;
    reserve1: string;
    fee: number; // in basis points (e.g. 30 = 0.3%, 5 = 0.05%)
    blockTimestampLast?: number;
}

export interface AerodromePoolInfo {
    pool: Contract;
    fee: number;
    stable: boolean;
    liquidity: Decimal;
    address: string;
    poolData: AerodromePoolData;
}

export interface AerodromeQuoteResult {
    price: number;
    amountIn: Decimal;
    amountOut: Decimal;
    poolAddress: string;
    fee: Decimal;
    stable: boolean;
    tokenInDecimals: number;
    tokenOutDecimals: number;
    zeroForOne: boolean;
}

// ==================== CALCULATOR CLASS ====================

export class AerodromeV2QuoteCalculator {
    public dexConfig: AerodromeV2DexConfig;
    public chainConfig: ChainConfig;
    public provider: JsonRpcProvider;
    private factoryContract: Contract;
    private tokenMetadataCache: Map<string, Token> = new Map();

    constructor(
        dexConfig: AerodromeV2DexConfig,
        chainConfig: ChainConfig,
        provider?: JsonRpcProvider
    ) {
        this.dexConfig = dexConfig;
        this.chainConfig = chainConfig;
        this.provider = provider || createJsonRpcProvider(chainConfig.rpcUrl, chainConfig.chainId);
        this.factoryContract = new Contract(
            dexConfig.factoryAddress,
            AERODROME_V2_FACTORY_ABI as any,
            this.provider
        );
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
     * Resolves a single Aerodrome V2 pool for (tokenIn, tokenOut, stable)
     */
    public async findPool(
        tokenIn: string,
        tokenOut: string,
        stable: boolean,
        provider?: JsonRpcProvider
    ): Promise<AerodromePoolInfo | null> {
        try {
            const normIn = ethers.getAddress(tokenIn);
            const normOut = ethers.getAddress(tokenOut);
            if (normIn.toLowerCase() === normOut.toLowerCase()) return null;

            const prov = provider || this.provider;
            const factory = provider
                ? new Contract(this.dexConfig.factoryAddress, AERODROME_V2_FACTORY_ABI as any, provider)
                : this.factoryContract;

            const poolAddress = await factory.getPool(normIn, normOut, stable).catch(() => ethers.ZeroAddress);
            if (!poolAddress || poolAddress.toLowerCase() === ethers.ZeroAddress.toLowerCase()) {
                return null;
            }

            const poolContract = new Contract(poolAddress, AERODROME_V2_POOL_ABI as any, prov);
            const [reserves, t0Address, t1Address, feeRaw] = await Promise.all([
                poolContract.getReserves().catch(() => null),
                poolContract.token0().catch(() => null),
                poolContract.token1().catch(() => null),
                factory.getFee(poolAddress, stable).catch(() => (stable ? 5n : 30n)),
            ]);

            if (!reserves || !t0Address || !t1Address) return null;

            const r0 = new Decimal(reserves[0].toString());
            const r1 = new Decimal(reserves[1].toString());
            if (r0.lte(0) || r1.lte(0)) return null;

            const [token0, token1] = await Promise.all([
                this.getTokenMetadata(t0Address, prov),
                this.getTokenMetadata(t1Address, prov),
            ]);

            const fee = Number(feeRaw || (stable ? 5 : 30));
            const poolData: AerodromePoolData = {
                poolAddress,
                token0,
                token1,
                stable,
                reserve0: r0.toFixed(0),
                reserve1: r1.toFixed(0),
                fee,
                blockTimestampLast: Number(reserves[2] || 0),
            };

            const liquidity = r0.mul(r1).sqrt();

            return {
                pool: poolContract,
                fee,
                stable,
                liquidity,
                address: poolAddress,
                poolData,
            };
        } catch {
            return null;
        }
    }

    /**
     * Finds both Volatile and Stable Aerodrome pools for a token pair
     */
    public async findAllPools(
        tokenIn: string,
        tokenOut: string,
        provider?: JsonRpcProvider
    ): Promise<AerodromePoolInfo[]> {
        const [volatilePool, stablePool] = await Promise.all([
            this.findPool(tokenIn, tokenOut, false, provider),
            this.findPool(tokenIn, tokenOut, true, provider),
        ]);

        const results: AerodromePoolInfo[] = [];
        if (volatilePool) results.push(volatilePool);
        if (stablePool) results.push(stablePool);
        return results;
    }

    /**
     * Calculates the output amount using analytical curve math (volatile or stable)
     */
    public getAmountOut(params: {
        pool: AerodromePoolData;
        aToB: boolean;
        amountInFormattedInDecimal: Decimal;
    }): AerodromeQuoteResult {
        const { pool, aToB, amountInFormattedInDecimal } = params;
        const tokenIn = aToB ? pool.token0 : pool.token1;
        const tokenOut = aToB ? pool.token1 : pool.token0;

        const rawAmountIn = amountInFormattedInDecimal.mul(new Decimal(10).pow(tokenIn.decimals));
        const feeRate = new Decimal(pool.fee).div(10000);
        const amountInAfterFee = rawAmountIn.mul(new Decimal(1).sub(feeRate));

        const rInRaw = aToB ? new Decimal(pool.reserve0) : new Decimal(pool.reserve1);
        const rOutRaw = aToB ? new Decimal(pool.reserve1) : new Decimal(pool.reserve0);

        if (rInRaw.lte(0) || rOutRaw.lte(0) || rawAmountIn.lte(0)) {
            return {
                price: 0,
                amountIn: amountInFormattedInDecimal,
                amountOut: new Decimal(0),
                poolAddress: pool.poolAddress,
                fee: new Decimal(pool.fee),
                stable: pool.stable,
                tokenInDecimals: tokenIn.decimals,
                tokenOutDecimals: tokenOut.decimals,
                zeroForOne: aToB,
            };
        }

        let rawAmountOut: Decimal;

        if (!pool.stable) {
            // Volatile: standard constant product formula dx * y / (x + dx)
            rawAmountOut = amountInAfterFee.mul(rOutRaw).div(rInRaw.add(amountInAfterFee));
        } else {
            // Stable curve: x^3*y + y^3*x = k (normalized to 18 decimals)
            rawAmountOut = this.calculateStableAmountOut(
                rawAmountIn,
                rInRaw,
                rOutRaw,
                tokenIn.decimals,
                tokenOut.decimals,
                pool.fee
            );
        }

        const amountOutFormatted = Decimal.max(0, rawAmountOut.div(new Decimal(10).pow(tokenOut.decimals)));

        // Spot price
        let spotPrice = 0;
        if (!pool.stable) {
            const rInHuman = rInRaw.div(new Decimal(10).pow(tokenIn.decimals));
            const rOutHuman = rOutRaw.div(new Decimal(10).pow(tokenOut.decimals));
            spotPrice = rInHuman.gt(0) ? rOutHuman.div(rInHuman).toNumber() : 0;
        } else {
            // For stable, spot price is near 1 adjusted for peg
            const testAmount = new Decimal(1);
            const testOut = this.calculateStableAmountOut(
                testAmount.mul(new Decimal(10).pow(tokenIn.decimals)),
                rInRaw,
                rOutRaw,
                tokenIn.decimals,
                tokenOut.decimals,
                0 // no fee for spot price
            ).div(new Decimal(10).pow(tokenOut.decimals));
            spotPrice = testOut.toNumber();
        }

        return {
            price: spotPrice,
            amountIn: amountInFormattedInDecimal,
            amountOut: amountOutFormatted,
            poolAddress: pool.poolAddress,
            fee: new Decimal(pool.fee),
            stable: pool.stable,
            tokenInDecimals: tokenIn.decimals,
            tokenOutDecimals: tokenOut.decimals,
            zeroForOne: aToB,
        };
    }

    /**
     * Solves Solidly stable curve x^3*y + y^3*x = k via Newton-Raphson
     */
    private calculateStableAmountOut(
        amountInRaw: Decimal,
        reserveInRaw: Decimal,
        reserveOutRaw: Decimal,
        decimalsIn: number,
        decimalsOut: number,
        feeBps: number
    ): Decimal {
        try {
            const dIn = new Decimal(10).pow(18 - decimalsIn);
            const dOut = new Decimal(10).pow(18 - decimalsOut);

            const x0 = reserveInRaw.mul(dIn);
            const y0 = reserveOutRaw.mul(dOut);
            const k = x0.pow(3).mul(y0).add(y0.pow(3).mul(x0));

            const fee = new Decimal(feeBps).div(10000);
            const dx = amountInRaw.mul(dIn).mul(new Decimal(1).sub(fee));
            const x1 = x0.add(dx);

            let y = y0;
            for (let i = 0; i < 255; i++) {
                const yPrev = y;
                const numerator = new Decimal(2).mul(x1).mul(y.pow(3)).add(k);
                const denominator = x1.pow(3).add(new Decimal(3).mul(x1).mul(y.pow(2)));
                if (denominator.lte(0)) break;
                y = numerator.div(denominator);
                if (y.sub(yPrev).abs().lte(1)) break;
            }

            const dy = y0.sub(y);
            return dy.div(dOut);
        } catch {
            // Fallback to constant product if numerical error occurs
            const feeRate = new Decimal(feeBps).div(10000);
            const dxAfterFee = amountInRaw.mul(new Decimal(1).sub(feeRate));
            return dxAfterFee.mul(reserveOutRaw).div(reserveInRaw.add(dxAfterFee));
        }
    }

    /**
     * Simulates swap execution directly through the pool's on-chain getAmountOut view method
     */
    public async simulateTransaction(
        tokenIn: string,
        tokenOut: string,
        amountIn: string,
        poolAddress: string,
        provider?: JsonRpcProvider
    ): Promise<{ amountOut: string; pool: string }> {
        const prov = provider || this.provider;
        const normIn = ethers.getAddress(tokenIn);
        const normOut = ethers.getAddress(tokenOut);

        try {
            const poolContract = new Contract(poolAddress, AERODROME_V2_POOL_ABI as any, prov);
            const tokenInMeta = await this.getTokenMetadata(normIn, prov);
            const tokenOutMeta = await this.getTokenMetadata(normOut, prov);

            const rawAmountIn = new Decimal(amountIn)
                .mul(new Decimal(10).pow(tokenInMeta.decimals))
                .toFixed(0);

            const rawAmountOut = await poolContract.getAmountOut(BigInt(rawAmountIn), normIn);

            const amountOutFormatted = new Decimal(rawAmountOut.toString())
                .div(new Decimal(10).pow(tokenOutMeta.decimals))
                .toString();

            return { amountOut: amountOutFormatted, pool: poolAddress };
        } catch {
            // Fallback to analytical calculation
            const poolContract = new Contract(poolAddress, AERODROME_V2_POOL_ABI as any, prov);
            const [reserves, isStable, token0Address] = await Promise.all([
                poolContract.getReserves().catch(() => [0n, 0n]),
                poolContract.stable().catch(() => false),
                poolContract.token0().catch(() => normIn),
            ]);

            const aToB = normIn.toLowerCase() === token0Address.toLowerCase();
            const tokenInMeta = await this.getTokenMetadata(normIn, prov);
            const tokenOutMeta = await this.getTokenMetadata(normOut, prov);

            const poolData: AerodromePoolData = {
                poolAddress,
                token0: aToB ? tokenInMeta : tokenOutMeta,
                token1: aToB ? tokenOutMeta : tokenInMeta,
                stable: isStable,
                reserve0: aToB ? reserves[0].toString() : reserves[1].toString(),
                reserve1: aToB ? reserves[1].toString() : reserves[0].toString(),
                fee: isStable ? 5 : 30,
            };

            const quote = this.getAmountOut({
                pool: poolData,
                aToB,
                amountInFormattedInDecimal: new Decimal(amountIn),
            });

            return { amountOut: quote.amountOut.toString(), pool: poolAddress };
        }
    }

    /**
     * Resolves the USD price of a token via Aerodrome V2 pools
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

    public formatPool(pool: any): AerodromePoolData {
        return {
            poolAddress: pool.poolAddress,
            token0: pool.token0,
            token1: pool.token1,
            stable: Boolean(pool.stable),
            reserve0: pool.reserve0 || "0",
            reserve1: pool.reserve1 || "0",
            fee: Number(pool.fee || (pool.stable ? 5 : 30)),
            blockTimestampLast: pool.blockTimestampLast ? Number(pool.blockTimestampLast) : undefined,
        };
    }
}
