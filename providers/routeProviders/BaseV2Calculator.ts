/**
 * Base V2 Quote Calculator
 * 
 * Generic calculator for Uniswap V2-style DEXes (Uniswap V2, PancakeSwap V2, etc.)
 * based on constant product invariant: x * y = k
 */

import { ethers, Contract, JsonRpcProvider } from "ethers";
import Decimal from "decimal.js";
import { Token } from "./type";
import { ChainConfig, createJsonRpcProvider, ERC20_ABI } from "./UniswapV3Calculator";
import { getTokenPrice, getTokenPriceByAddress } from "./price";
import { NetworkType } from "./constants";

// ==================== ABIS ====================

export const V2_FACTORY_ABI = [
    {
        constant: true,
        inputs: [
            { internalType: "address", name: "tokenA", type: "address" },
            { internalType: "address", name: "tokenB", type: "address" },
        ],
        name: "getPair",
        outputs: [{ internalType: "address", name: "pair", type: "address" }],
        payable: false,
        stateMutability: "view",
        type: "function",
    },
] as const;

export const V2_PAIR_ABI = [
    {
        constant: true,
        inputs: [],
        name: "getReserves",
        outputs: [
            { internalType: "uint112", name: "_reserve0", type: "uint112" },
            { internalType: "uint112", name: "_reserve1", type: "uint112" },
            { internalType: "uint32", name: "_blockTimestampLast", type: "uint32" },
        ],
        payable: false,
        stateMutability: "view",
        type: "function",
    },
    {
        constant: true,
        inputs: [],
        name: "token0",
        outputs: [{ internalType: "address", name: "", type: "address" }],
        payable: false,
        stateMutability: "view",
        type: "function",
    },
    {
        constant: true,
        inputs: [],
        name: "token1",
        outputs: [{ internalType: "address", name: "", type: "address" }],
        payable: false,
        stateMutability: "view",
        type: "function",
    },
] as const;

// ==================== TYPES ====================

export interface V2DexConfig {
    name: string;
    network: NetworkType;
    factoryAddress: string;
    routerAddress?: string;
    feeBps: number; // e.g. 30 for 0.3% (Uniswap V2) or 25 for 0.25% (PancakeSwap V2)
    wrappedNativeTokenAddress: string;
    nativeTokenAddress: string;
    stableTokenAddress?: string;
    fromBlock?: string;
    abi?: any;
}

export interface PairData {
    pairAddress: string;
    poolAddress?: string; // alias of pairAddress, AllRoute matches pools by poolAddress
    token0: Token;
    token1: Token;
    reserve0: string; // raw BigInt string
    reserve1: string; // raw BigInt string
    blockNumber?: string;
    blockTimestampLast?: number;
    fee: number; // fee in basis points (e.g. 30 = 0.3%)
    token0PriceUsd?: number; // set on graph edges, used as the edge cost reference price
    token1PriceUsd?: number;
}

export interface V2PoolInfo {
    pool: Contract;
    fee: number;
    liquidity: Decimal;
    address: string;
    poolData: PairData;
}

export interface V2QuoteResult {
    price: number;
    amountIn: Decimal;
    amountOut: Decimal;
    poolAddress: string;
    fee: Decimal;
    reserveIn: Decimal;
    reserveOut: Decimal;
    tokenInDecimals: number;
    tokenOutDecimals: number;
    zeroForOne: boolean;
}

// ==================== BASE V2 CALCULATOR ====================

export class BaseV2QuoteCalculator {
    public config: V2DexConfig;
    public chainConfig: ChainConfig;
    public provider: JsonRpcProvider;

    private tokenCache = new Map<string, Token>();
    private priceCache = new Map<string, { price: number; timestamp: number }>();
    private readonly PRICE_CACHE_DURATION = 60 * 1000; // 1 min

    constructor(
        config: V2DexConfig,
        chainConfig: ChainConfig,
        provider?: JsonRpcProvider
    ) {
        this.config = config;
        this.chainConfig = chainConfig;
        this.provider = provider || createJsonRpcProvider(chainConfig.rpcUrl, chainConfig.chainId);
    }

    // ==================== TOKEN METHODS ====================

    public async getTokenDetails(tokenAddress: string): Promise<Token> {
        const normalized = tokenAddress.toLowerCase();
        if (normalized === this.config.nativeTokenAddress.toLowerCase()) {
            return {
                address: this.config.nativeTokenAddress,
                decimals: 18,
                symbol: this.chainConfig.nativeTokenSymbol || "ETH",
                name: this.chainConfig.nativeTokenSymbol || "Ether",
            };
        }

        const cached = this.tokenCache.get(normalized);
        if (cached) return cached;

        const tokenContract = new Contract(tokenAddress, ERC20_ABI, this.provider);
        const [decimals, symbol, name] = await Promise.all([
            tokenContract.decimals(),
            tokenContract.symbol().catch(() => "UNKNOWN"),
            tokenContract.name().catch(() => "Unknown Token"),
        ]);

        const token: Token = {
            address: tokenAddress,
            decimals: Number(decimals),
            symbol: String(symbol),
            name: String(name),
        };

        this.tokenCache.set(normalized, token);
        return token;
    }

    // ==================== PAIR METHODS ====================

    public async getPairAddress(tokenA: string, tokenB: string): Promise<string> {
        let normA = tokenA.toLowerCase() === this.config.nativeTokenAddress.toLowerCase()
            ? this.config.wrappedNativeTokenAddress
            : tokenA;
        let normB = tokenB.toLowerCase() === this.config.nativeTokenAddress.toLowerCase()
            ? this.config.wrappedNativeTokenAddress
            : tokenB;

        const factory = new Contract(this.config.factoryAddress, V2_FACTORY_ABI, this.provider);
        const pair = await factory.getPair(normA, normB);
        return pair;
    }

    public async getPairData(pairAddress: string): Promise<PairData> {
        const pair = new Contract(pairAddress, V2_PAIR_ABI, this.provider);
        const [reserves, token0Address, token1Address] = await Promise.all([
            pair.getReserves(),
            pair.token0(),
            pair.token1(),
        ]);

        const [token0, token1] = await Promise.all([
            this.getTokenDetails(token0Address),
            this.getTokenDetails(token1Address),
        ]);

        return {
            pairAddress,
            poolAddress: pairAddress,
            token0,
            token1,
            reserve0: reserves[0].toString(),
            reserve1: reserves[1].toString(),
            blockTimestampLast: Number(reserves[2]),
            fee: this.config.feeBps,
        };
    }

    /**
     * Find pool for a token pair (dynamic discovery)
     */
    public async findAllPools(
        tokenA: string,
        tokenB: string
    ): Promise<V2PoolInfo[]> {
        let normA = tokenA.toLowerCase() === this.config.nativeTokenAddress.toLowerCase()
            ? this.config.wrappedNativeTokenAddress
            : tokenA;
        let normB = tokenB.toLowerCase() === this.config.nativeTokenAddress.toLowerCase()
            ? this.config.wrappedNativeTokenAddress
            : tokenB;

        if (normA.toLowerCase() === normB.toLowerCase()) {
            return [];
        }

        try {
            const pairAddress = await this.getPairAddress(normA, normB);
            if (!pairAddress || pairAddress.toLowerCase() === ethers.ZeroAddress.toLowerCase()) {
                return [];
            }

            const pairData = await this.getPairData(pairAddress);

            // Check if reserves are greater than 0
            if (new Decimal(pairData.reserve0).lte(0) || new Decimal(pairData.reserve1).lte(0)) {
                return [];
            }

            const pairContract = new Contract(pairAddress, V2_PAIR_ABI, this.provider);
            const r0Human = new Decimal(pairData.reserve0).div(new Decimal(10).pow(pairData.token0.decimals));
            const r1Human = new Decimal(pairData.reserve1).div(new Decimal(10).pow(pairData.token1.decimals));
            const liquidity = r0Human.mul(r1Human).sqrt();

            return [{
                pool: pairContract,
                fee: this.config.feeBps,
                liquidity,
                address: pairAddress,
                poolData: pairData
            }];
        } catch (error) {
            console.warn(`[V2:DISCOVERY_WARN] Error finding pair for ${this.config.name} (${tokenA}/${tokenB}):`, error);
            return [];
        }
    }

    // ==================== CALCULATION METHODS ====================

    /**
     * Constant product formula: amountOut = (amountIn * (10000 - feeBps) * reserveOut) / (reserveIn * 10000 + amountIn * (10000 - feeBps))
     */
    public calculateAmountOut(
        amountIn: Decimal,
        reserveIn: Decimal,
        reserveOut: Decimal,
        feeBps: number = this.config.feeBps
    ): Decimal {
        if (amountIn.lte(0) || reserveIn.lte(0) || reserveOut.lte(0)) {
            return new Decimal(0);
        }

        const feeMultiplier = new Decimal(10000 - feeBps);
        const amountInWithFee = amountIn.mul(feeMultiplier);
        const numerator = amountInWithFee.mul(reserveOut);
        const denominator = reserveIn.mul(10000).add(amountInWithFee);

        if (denominator.isZero()) return new Decimal(0);
        return numerator.div(denominator);
    }

    /**
     * Spot price in human units (amount of tokenOut per 1 tokenIn)
     */
    public calculateSpotPrice(
        reserve0Human: Decimal,
        reserve1Human: Decimal,
        aToB: boolean
    ): number {
        if (reserve0Human.isZero() || reserve1Human.isZero()) return 0;
        // aToB: token0 -> token1 => price = reserve1 / reserve0
        // !aToB: token1 -> token0 => price = reserve0 / reserve1
        const price = aToB ? reserve1Human.div(reserve0Human) : reserve0Human.div(reserve1Human);
        return price.toNumber();
    }

    /**
     * amountInFormattedInDecimal is in raw base units (wei), matching the V3 calculators.
     * amountOut is returned in raw base units of tokenOut.
     */
    public getAmountOut(params: {
        aToB: boolean;
        amountInFormattedInDecimal: Decimal;
        pool: PairData;
    }): V2QuoteResult {
        const { aToB, amountInFormattedInDecimal, pool } = params;
        const { token0, token1, reserve0, reserve1, fee, pairAddress } = pool;

        const tokenIn = aToB ? token0 : token1;
        const tokenOut = aToB ? token1 : token0;
        const decimalsIn = Number(tokenIn.decimals);
        const decimalsOut = Number(tokenOut.decimals);

        const r0Human = new Decimal(reserve0).div(new Decimal(10).pow(token0.decimals));
        const r1Human = new Decimal(reserve1).div(new Decimal(10).pow(token1.decimals));

        const reserveIn = aToB ? new Decimal(reserve0) : new Decimal(reserve1);
        const reserveOut = aToB ? new Decimal(reserve1) : new Decimal(reserve0);

        const amountOut = this.calculateAmountOut(
            amountInFormattedInDecimal,
            reserveIn,
            reserveOut,
            fee
        );

        const spotPrice = this.calculateSpotPrice(r0Human, r1Human, aToB);
        const feeAmount = amountInFormattedInDecimal.mul(fee).div(10000);

        return {
            price: spotPrice,
            amountIn: amountInFormattedInDecimal,
            amountOut: amountOut.floor(),
            poolAddress: pairAddress,
            fee: feeAmount,
            reserveIn,
            reserveOut,
            tokenInDecimals: decimalsIn,
            tokenOutDecimals: decimalsOut,
            zeroForOne: aToB,
        };
    }

    /**
     * amountIn and the returned amountOut are raw base-unit integer strings (wei).
     */
    public async simulateTransaction(
        tokenIn: string,
        tokenOut: string,
        amountIn: string,
        pairAddress: string
    ): Promise<{ amountOut: string; pool: string }> {
        try {
            const pairData = await this.getPairData(pairAddress);
            const aToB = tokenIn.toLowerCase() === pairData.token0.address.toLowerCase();

            const res = this.getAmountOut({
                aToB,
                amountInFormattedInDecimal: new Decimal(amountIn),
                pool: pairData,
            });

            return {
                amountOut: res.amountOut.toFixed(0),
                pool: pairAddress,
            };
        } catch (error) {
            console.error(`[V2:SIMULATE_ERR] Simulation failed for pair ${pairAddress}:`, error);
            return { amountOut: "0", pool: pairAddress };
        }
    }

    // ==================== PRICE METHODS ====================

    public async getSureTokenPrice(tokenAddress: string): Promise<number> {
        const norm = tokenAddress.toLowerCase();
        const cached = this.priceCache.get(norm);
        if (cached && Date.now() - cached.timestamp < this.PRICE_CACHE_DURATION) {
            return cached.price;
        }

        if (
            this.config.stableTokenAddress &&
            norm === this.config.stableTokenAddress.toLowerCase()
        ) {
            return 1.0;
        }

        if (
            norm === this.config.nativeTokenAddress.toLowerCase() ||
            norm === this.config.wrappedNativeTokenAddress.toLowerCase()
        ) {
            const ethPriceResult = await getTokenPrice(this.chainConfig.wrappedTokenSymbol || "WETH");
            if (ethPriceResult.success && ethPriceResult.data) {
                this.priceCache.set(norm, { price: ethPriceResult.data.price, timestamp: Date.now() });
                return ethPriceResult.data.price;
            }
        }

        // Try lookup by address
        const addrPriceResult = await getTokenPriceByAddress(this.config.network, tokenAddress);
        if (addrPriceResult.success && addrPriceResult.data) {
            this.priceCache.set(norm, { price: addrPriceResult.data.price, timestamp: Date.now() });
            return addrPriceResult.data.price;
        }

        // Try lookup by symbol
        try {
            const token = await this.getTokenDetails(tokenAddress);
            const symbolResult = await getTokenPrice(token.symbol);
            if (symbolResult.success && symbolResult.data) {
                this.priceCache.set(norm, { price: symbolResult.data.price, timestamp: Date.now() });
                return symbolResult.data.price;
            }
        } catch {}

        return 0;
    }
}
