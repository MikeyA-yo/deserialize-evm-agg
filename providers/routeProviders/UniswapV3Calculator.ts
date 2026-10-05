/**
 * Uniswap V3 Quote Calculator - Reusable Class Version
 * 
 * A generic class for calculating swap quotes on any Uniswap V3 compatible DEX.
 * Supports multiple networks and can be easily extended for different protocols.
 */

import { ethers, Contract, JsonRpcProvider } from "ethers";

export const createJsonRpcProvider = (rpcUrl: string, chainId: number) => {
    const request = new ethers.FetchRequest(rpcUrl);
    request.timeout = 25_000;
    return new ethers.JsonRpcProvider(request, chainId, {
        staticNetwork: true,
        batchMaxCount: 1,
    });
};
import Decimal from "decimal.js";
import { get0gPrice, getTokenPrice } from "./price";

import { Token } from "./type";

import { NetworkType } from "./constants";
import { createPublicClient, http, PublicClient } from "viem";

// ==================== TYPES ====================



export interface PoolInfo {
    pool: Contract;
    fee: number;
    liquidity: Decimal;
    address: string;
}
export interface ZeroDexQuoteParams {
    aToB: boolean; // true if swapping token0 for token1, false if swapping token1 for token0
    amountInFormattedInDecimal: Decimal; // Amount of input token in human-readable format
    pool: PoolData; // Pool data containing token metadata and liquidity
}
export interface PoolData {
    token0: Token;
    token1: Token;
    fee: number;
    poolAddress: string;
    slot0: any;
    sqrtPriceX96: string;
    liquidity: string;
    blockNumber?: string
    token0PriceUsd?: number; // set on graph edges, used as the edge cost reference price
    token1PriceUsd?: number;
}

export interface SwapResult {
    amountOut: Decimal;
    sqrtPNext: Decimal;
    feeAmount: Decimal;
    amountInAfterFee: Decimal;
}

export interface QuoteResult {
    price: number;
    amountIn: Decimal;
    amountOut: Decimal;
    poolAddress: string;
    fee: Decimal;
    sqrtPriceStart: Decimal;
    sqrtPriceNext: Decimal;
    liquidity: Decimal;
    tokenInDecimals: number;
    tokenOutDecimals: number;
    zeroForOne: boolean;
}

export interface PoolCreatedEvent {
    token0: string;
    token1: string;
    fee: string;
    poolAddress: string;
    blockNumber: number;
}

export interface DexConfig {
    name: string;
    network: NetworkType;
    factoryAddress: string;
    quoterAddress: string;
    fromBlock?: string;
    abi: any
    wrappedNativeTokenAddress: string;
    nativeTokenAddress: string
    stableTokenAddress?: string; // For USD price calculations
}

export interface ChainConfig {
    name: string;
    network: NetworkType;
    chainId: number;
    rpcUrl: string;
    wrappedNativeTokenAddress: string;
    wrappedTokenSymbol: string;
    nativeTokenAddress: string;
    nativeTokenSymbol: string;
    stableTokenAddress: string; // For USD price calculations
}

export interface QuoteParams {
    tokenIn: string;
    tokenOut: string;
    amountIn: number;
    aToB?: boolean;
    amountInFormattedInDecimal?: Decimal;
    pool?: PoolData;
}

// ==================== CONSTANTS ====================

const FEE_TIERS: number[] = [100, 500, 3000, 10000];
const FEE_DENOMINATOR = new Decimal(1_000_000);
const Q96: Decimal = new Decimal(2).pow(new Decimal(96));

// ==================== ABI DEFINITIONS ====================

const FACTORY_ABI = [
    {
        inputs: [
            { internalType: "address", name: "tokenA", type: "address" },
            { internalType: "address", name: "tokenB", type: "address" },
            { internalType: "uint24", name: "fee", type: "uint24" },
        ],
        name: "getPool",
        outputs: [{ internalType: "address", name: "", type: "address" }],
        stateMutability: "view",
        type: "function",
    },
] as const;

const POOL_ABI = [
    {
        inputs: [],
        name: "liquidity",
        outputs: [{ internalType: "uint128", name: "", type: "uint128" }],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [],
        name: "slot0",
        outputs: [
            { internalType: "uint160", name: "sqrtPriceX96", type: "uint160" },
            { internalType: "int24", name: "tick", type: "int24" },
            { internalType: "uint16", name: "observationIndex", type: "uint16" },
            { internalType: "uint16", name: "observationCardinality", type: "uint16" },
            { internalType: "uint16", name: "observationCardinalityNext", type: "uint16" },
            { internalType: "bool", name: "unlocked", type: "bool" },
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
        name: "fee",
        outputs: [{ internalType: "uint24", name: "", type: "uint24" }],
        stateMutability: "view",
        type: "function",
    },
] as const;

export const ERC20_ABI = [
    {
        inputs: [],
        name: "decimals",
        outputs: [{ internalType: "uint8", name: "", type: "uint8" }],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [],
        name: "symbol",
        outputs: [{ internalType: "string", name: "", type: "string" }],
        stateMutability: "view",
        type: "function",
    },
    {
        inputs: [],
        name: "name",
        outputs: [{ internalType: "string", name: "", type: "string" }],
        stateMutability: "view",
        type: "function",
    },
] as const;

const QUOTER_ABI = [
    {
        inputs: [
            { internalType: "address", name: "tokenIn", type: "address" },
            { internalType: "address", name: "tokenOut", type: "address" },
            { internalType: "uint24", name: "fee", type: "uint24" },
            { internalType: "uint256", name: "amountIn", type: "uint256" },
            { internalType: "uint160", name: "sqrtPriceLimitX96", type: "uint160" },
        ],
        name: "quoteExactInputSingle",
        outputs: [{ internalType: "uint256", name: "amountOut", type: "uint256" }],
        stateMutability: "view",
        type: "function",
    },
] as const;





// ==================== MAIN CLASS ====================
const priceCache = new Map()
export class UniswapV3QuoteCalculator {
    provider: JsonRpcProvider;
    config: DexConfig;
    chainConfig: ChainConfig;
    client: PublicClient
    private priceCache: Map<string, { price: number; timestamp: number }>;
    poolCache: Map<string, PoolData>;
    private readonly CACHE_DURATION = 0.5 * 60 * 1000; // 5 minutes

    constructor(config: DexConfig, chainConfig: ChainConfig, _provider?: JsonRpcProvider) {
        const provider = _provider ? _provider : createJsonRpcProvider(chainConfig.rpcUrl, chainConfig.chainId);
        this.config = config;
        this.provider = provider
        this.priceCache = new Map();
        this.poolCache = new Map();
        this.chainConfig = chainConfig
        this.client = createPublicClient(
            {
                chain: {
                    rpcUrls: {
                        default: {
                            http: [chainConfig.rpcUrl]
                        }
                    },
                    id: chainConfig.chainId,
                    name: config.name,
                    nativeCurrency: {
                        name: chainConfig.nativeTokenSymbol,
                        symbol: chainConfig.nativeTokenSymbol,
                        decimals: 18
                    },



                },
                transport: http(chainConfig.rpcUrl, {
                    batch: false,
                    timeout: 10_000,
                    retryCount: 2,
                    retryDelay: 400,
                })
            },

        )

    }
    // ==================== PRICE METHODS ======================


    getPriceFromPriceMap = (tokenAddress: string): number | undefined => {

        const cached = priceCache.get(tokenAddress);
        if (cached && this.isCacheValid(cached.timestamp)) {
            return cached.price;
        }
        return undefined;
    };
    setPriceInPriceMap = (tokenAddress: string, price: number) => {
        priceCache.set(tokenAddress, { price, timestamp: Date.now() });

    };
    async getSureTokenPrice(tokenAddress: string, _provider = this.provider): Promise<number> {
        // we should add the cache here
        if (tokenAddress.toLowerCase() === this.config.nativeTokenAddress.toLowerCase()) {
            tokenAddress = this.config.wrappedNativeTokenAddress
        }
        try {
            const cachedPrice = this.getPriceFromPriceMap(tokenAddress);
            // console.log('cachedPrice: ', cachedPrice);
            if (cachedPrice !== undefined) {
                return cachedPrice;
            }
            const price = await this.getTokenUsdPriceFromPool(tokenAddress);
            this.setPriceInPriceMap(tokenAddress, price);
            return price;
        } catch (error) {
            console.error("Error fetching token price from pool using crypto compare....:");
        }
        const tokenData = await this.getTokenDetails(tokenAddress);
        if (!tokenData) {
            throw new Error(`Token details not found for address: ${tokenAddress}`);
        }
        const tokenSymbol = tokenData.symbol.toUpperCase();
        console.log(`Fetching price for token: ${tokenSymbol}`);
        if (tokenSymbol.toLowerCase() === "usdt_v1") return 1 //for the custom USDT token
        const cPrice = await this.getTokenPriceFromExternalAPI(tokenSymbol, tokenAddress);
        this.setPriceInPriceMap(tokenAddress, cPrice);
        return cPrice;
    }

    // ==================== UTILITY METHODS ====================

    private async wait(seconds: number = 2): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, seconds * 1000));
    }

    private isCacheValid(timestamp: number): boolean {
        return Date.now() - timestamp < this.CACHE_DURATION;
    }

    protected async retryWithBackoff<T>(fn: () => Promise<T>, retries = 3, delayMs = 400): Promise<T> {
        for (let i = 0; i < retries; i++) {
            try {
                return await fn();
            } catch (err: any) {
                if (i === retries - 1) throw err;
                await new Promise(r => setTimeout(r, delayMs * (i + 1)));
            }
        }
        throw new Error('Retries exceeded');
    }

    public async getTokenDetails(tokenAddress: string, provider = this.provider): Promise<Token> {
        if (tokenAddress.toLowerCase() === this.config.nativeTokenAddress.toLowerCase()) {
            tokenAddress = this.config.wrappedNativeTokenAddress;
        }
        const cacheKey = `token_${tokenAddress}`;
        const cached = this.poolCache.get(cacheKey);

        if (cached) {
            return cached as any;
        }

        const tokenContract = new Contract(tokenAddress, ERC20_ABI, provider);
        let decimals = 18;
        let symbol = tokenAddress.slice(0, 6);
        let name = symbol;

        try {
            decimals = Number(await this.retryWithBackoff(() => tokenContract.decimals()));
        } catch {}
        try {
            symbol = await this.retryWithBackoff(() => tokenContract.symbol());
        } catch {}
        try {
            name = await this.retryWithBackoff(() => tokenContract.name());
        } catch {
            name = symbol;
        }

        const tokenDetails: Token = {
            address: tokenAddress,
            decimals,
            symbol,
            name
        };

        this.poolCache.set(cacheKey, tokenDetails as any);
        return tokenDetails;
    }

    public async getTokenPrice(tokenAddress: string): Promise<number> {
        const cached = priceCache.get(tokenAddress);
        if (cached && this.isCacheValid(cached.timestamp)) {
            return cached.price;
        }

        try {
            // Try to get price from pool if stable token is configured
            if (this.config.stableTokenAddress) {
                const price = await this.getTokenUsdPriceFromPool(tokenAddress);
                priceCache.set(tokenAddress, { price, timestamp: Date.now() });
                return price;
            }
        } catch (error) {
            console.warn(`Failed to get pool price for ${tokenAddress}:`, error);
        }

        // Fallback to external API
        try {
            const tokenData = await this.getTokenDetails(tokenAddress);
            const price = await this.getTokenPriceFromExternalAPI(tokenData.symbol, tokenAddress);
            priceCache.set(tokenAddress, { price, timestamp: Date.now() });
            return price;
        } catch (error) {
            console.error(`Failed to get price for token ${tokenAddress}:`, error);
            throw new Error(`Unable to fetch price for token ${tokenAddress}`);
        }
    }

    private async getTokenPriceFromExternalAPI(symbol: string, tokenAddress?: string): Promise<number> {
        const nativeSymbol = this.chainConfig?.nativeTokenSymbol?.toUpperCase() || "ETH";
        const wrappedSymbol = this.chainConfig?.wrappedTokenSymbol?.toUpperCase() || "WETH";

        if (symbol.toUpperCase() === wrappedSymbol || symbol.toUpperCase() === nativeSymbol) {
            const p = (await getTokenPrice(nativeSymbol)).data?.price;
            if (p) return p;
        }

        // Try getting price by symbol from DeFiLlama
        try {
            const res = await getTokenPrice(symbol);
            if (res.success && res.data?.price) {
                return res.data.price;
            }
        } catch {}

        // Fallback: Query by token contract address if provided
        if (tokenAddress) {
            const network = (this.chainConfig?.network || "base").toLowerCase();
            try {
                const llamaRes = await fetch(`https://coins.llama.fi/prices/current/${network}:${tokenAddress.toLowerCase()}`, { signal: AbortSignal.timeout(8_000) });
                if (llamaRes.ok) {
                    const data = (await llamaRes.json()) as any;
                    const coin = data?.coins?.[`${network}:${tokenAddress.toLowerCase()}`];
                    if (coin && typeof coin.price === "number") {
                        return coin.price;
                    }
                }
            } catch {}

            try {
                const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`, { signal: AbortSignal.timeout(8_000) });
                if (dexRes.ok) {
                    const dexData = (await dexRes.json()) as any;
                    const pair = dexData?.pairs?.[0];
                    if (pair && pair.priceUsd) {
                        const price = parseFloat(pair.priceUsd);
                        if (!isNaN(price)) return price;
                    }
                }
            } catch {}
        }

        return 0;
    }

    private async getTokenUsdPriceFromPoolUsingStableCoin(tokenAddress: string): Promise<number> {
        if (!this.config.stableTokenAddress) {
            throw new Error("Stable token address not configured");
        }
        if (tokenAddress.toLowerCase() === this.config.stableTokenAddress.toLowerCase()) {

            return 1;
        }

        const { poolData } = await this.findBestPool(
            tokenAddress,
            this.config.stableTokenAddress
        );

        const aToB = this.config.stableTokenAddress.toLowerCase() ===
            poolData.token1.address.toLowerCase();

        return this.calculateSpotPrice(
            new Decimal(poolData.slot0.sqrtPriceX96),
            poolData.token0.decimals,
            poolData.token1.decimals,
            aToB
        );
    }
    async getTokenUsdPriceFromPoolWrappedToken(tokenAddress: string): Promise<number> {
        if (!this.config.wrappedNativeTokenAddress) {
            throw new Error("Wrapped native token address not configured");
        }
        let price: number
        if (tokenAddress.toLowerCase() === this.config.wrappedNativeTokenAddress.toLowerCase()) {
            price = 1;
        } else {
            try {

                const { poolData } = await this.findBestPool(
                    tokenAddress,
                    this.config.wrappedNativeTokenAddress
                );

                const aToB = this.config.wrappedNativeTokenAddress.toLowerCase() ===
                    poolData.token1.address.toLowerCase();

                price = this.calculateSpotPrice(
                    new Decimal(poolData.slot0.sqrtPriceX96),
                    poolData.token0.decimals,
                    poolData.token1.decimals,
                    aToB
                );
            } catch (error) {
                price = 0

            }
        }


        // Dynamic chain-aware native token price (ETH on Base, 0G on 0G, BNB on BSC, etc.)
        const nativeSymbol = this.chainConfig?.nativeTokenSymbol?.toUpperCase() || "ETH";
        let wrappedTokenPrice: number | undefined;

        try {
            const nativePriceResult = await getTokenPrice(nativeSymbol);
            if (nativePriceResult.success && nativePriceResult.data?.price) {
                wrappedTokenPrice = nativePriceResult.data.price;
            }
        } catch {}

        if (!wrappedTokenPrice) {
            wrappedTokenPrice = await this.getTokenPriceFromExternalAPI(
                this.chainConfig?.wrappedTokenSymbol || "WETH",
                this.config.wrappedNativeTokenAddress
            );
        }

        if (!wrappedTokenPrice) {
            throw new Error(`Unable to fetch native/wrapped token price for ${nativeSymbol}`);
        }
        return price * wrappedTokenPrice;
    }
    private async getTokenUsdPriceFromPool(tokenAddress: string): Promise<number> {
        // Fallback to wrapped native token
        try {
            return await this.getTokenUsdPriceFromPoolWrappedToken(tokenAddress);
        } catch (error) {
            console.error(`Failed to get USD price from wrapped native token for ${tokenAddress}:`, error);

        }

        try {
            return await this.getTokenUsdPriceFromPoolUsingStableCoin(tokenAddress);
        } catch (error) {
            console.warn(`Failed to get USD price from pool for ${tokenAddress}:`);
            throw new Error(`Unable to fetch USD price for token ${tokenAddress}`);
        }

    }
    // ==================== POOL METHODS ====================
    public async getPoolData(poolAddress: string): Promise<PoolData> {
        const cached = this.poolCache.get(poolAddress);
        if (cached) {
            return cached;
        }

        const pool = new Contract(poolAddress, POOL_ABI, this.provider);



        const [slot0, liquidity, token0Address, token1Address, fee] = await Promise.all([
            this.retryWithBackoff(() => pool.slot0()),
            this.retryWithBackoff(() => pool.liquidity()),
            this.retryWithBackoff(() => pool.token0()),
            this.retryWithBackoff(() => pool.token1()),
            this.retryWithBackoff(() => pool.fee()),
        ]);

        // console.log('token0Address: ', token0Address);
        // console.log('token1Address: ', token1Address);
        const [token0Details, token1Details] = await Promise.all([
            this.getTokenDetails(token0Address),
            this.getTokenDetails(token1Address),
        ]);

        const poolData: PoolData = {
            token0: token0Details,
            token1: token1Details,
            fee: Number(fee),
            poolAddress,
            slot0,
            sqrtPriceX96: slot0.sqrtPriceX96.toString(),
            liquidity: liquidity.toString(),
        };

        this.poolCache.set(poolAddress, poolData);
        return poolData;
    }
    public async findBestPool(tokenA: string, tokenB: string, feeTiers = FEE_TIERS): Promise<PoolInfo & { poolData: PoolData }> {
        const factory = new Contract(this.config.factoryAddress, FACTORY_ABI, this.provider);
        let bestPool: PoolInfo | null = null;
        if (tokenA.toLowerCase() === this.config.nativeTokenAddress.toLowerCase()) {
            tokenA = this.config.wrappedNativeTokenAddress;
        }
        if (tokenB.toLowerCase() === this.config.nativeTokenAddress.toLowerCase()) {
            tokenB = this.config.wrappedNativeTokenAddress;
        }
        if (tokenA.toLowerCase() === tokenB.toLowerCase()) {
            throw new Error("TokenA and TokenB cannot be the same");
        }
        for (const fee of feeTiers) {
            try {
                const poolAddress: string = await factory.getPool(tokenA, tokenB, fee);

                if (poolAddress === "0x0000000000000000000000000000000000000000") {
                    continue;
                }

                const pool = new Contract(poolAddress, POOL_ABI, this.provider);
                const liquidity = new Decimal(await pool.liquidity());

                if (liquidity.gt(0) && (!bestPool || liquidity.gt(bestPool.liquidity))) {
                    bestPool = {
                        pool,
                        fee,
                        liquidity,
                        address: poolAddress,
                    };
                }
            } catch (error) {
                console.warn(`Error checking pool for fee ${fee}: FOR DEX {${this.config.name}}`, error);
            }
        }

        if (!bestPool) {
            throw new Error(`No viable pool found for token pair ${tokenA}/${tokenB}`);
        }

        const poolData = await this.getPoolData(bestPool.address);
        const res = { ...bestPool, poolData };
        return res
    }

    public async findAllPools(
        tokenA: string,
        tokenB: string,
        feeTiers = FEE_TIERS
    ): Promise<(PoolInfo & { poolData: PoolData })[]> {
        const factory = new Contract(this.config.factoryAddress, FACTORY_ABI, this.provider);

        // Normalize wrapped/native
        if (tokenA.toLowerCase() === this.config.nativeTokenAddress.toLowerCase()) {
            tokenA = this.config.wrappedNativeTokenAddress;
        }
        if (tokenB.toLowerCase() === this.config.nativeTokenAddress.toLowerCase()) {
            tokenB = this.config.wrappedNativeTokenAddress;
        }
        if (tokenA.toLowerCase() === tokenB.toLowerCase()) {
            return [];
        }

        console.log(`findAllPools ${this.config.name} ${tokenA}/${tokenB}`);
        const foundPools: (PoolInfo & { poolData: PoolData })[] = [];
        for (const fee of feeTiers) {
            try {
                const poolAddress: string = await this.retryWithBackoff(() => factory.getPool(tokenA, tokenB, fee));

                if (
                    !poolAddress ||
                    poolAddress.toLowerCase() === "0x0000000000000000000000000000000000000000"
                ) {
                    continue;
                }

                const pool = new Contract(poolAddress, POOL_ABI, this.provider);
                const liquidityRaw = await this.retryWithBackoff(() => pool.liquidity());
                const liquidity = new Decimal(liquidityRaw.toString());

                if (!liquidity || liquidity.lte(0)) continue;

                const poolData = await this.getPoolData(poolAddress);
                foundPools.push({
                    pool,
                    fee,
                    liquidity,
                    address: poolAddress,
                    poolData,
                });
            } catch (error) {
                console.warn(`Error checking pool for fee ${fee} on DEX {${this.config.name}}`, error);
            }
        }

        return foundPools;
    }


    // ==================== CALCULATION METHODS ====================

    public calculateSpotPrice(
        sqrtPriceX96: Decimal,
        decimals0: number,
        decimals1: number,
        token0IsInput: boolean
    ): number {
        const sqrtPrice = Number(sqrtPriceX96) / Number(Q96);
        let price = sqrtPrice * sqrtPrice;

        const decimalAdjustment = 10 ** (decimals0 - decimals1);
        price = price * decimalAdjustment;

        return token0IsInput ? price : 1 / price;
    }

    private calculateSwapOutput(params: {
        amountInRaw: Decimal;
        sqrtPriceX96: Decimal;
        liquidity: Decimal;
        fee: number;
        zeroForOne: boolean;
        decimalsIn: number;
        decimalsOut: number;
    }): SwapResult {
        const { amountInRaw, sqrtPriceX96, liquidity, fee, zeroForOne, decimalsIn, decimalsOut } = params;

        const feeDecimal = new Decimal(fee);
        //!FIX : not all dexes calculate fees like this, the fee field itself might not be the fee, it might be the tick spacing, eg, aerodrome
        const feeAmount = amountInRaw.mul(feeDecimal).div(FEE_DENOMINATOR);
        const amountInAfterFee = amountInRaw.sub(feeAmount);

        let sqrtPNext: Decimal;

        if (zeroForOne) {
            const numerator = amountInAfterFee.mul(Q96);
            const delta = numerator.div(liquidity);
            sqrtPNext = sqrtPriceX96.add(delta);
        } else {
            const numerator = amountInAfterFee.mul(sqrtPriceX96).mul(sqrtPriceX96);
            const denominator = liquidity.mul(Q96);
            sqrtPNext = sqrtPriceX96.sub(numerator.div(denominator));
        }

        let amountOut: Decimal;

        if (zeroForOne) {
            const delta = sqrtPNext.sub(sqrtPriceX96);
            const numerator = liquidity.mul(Q96).mul(delta);
            const denominator = sqrtPNext.mul(sqrtPriceX96);
            amountOut = numerator.div(denominator);
        } else {
            const delta = sqrtPriceX96.sub(sqrtPNext);
            amountOut = liquidity.mul(delta).div(Q96);
        }


        return {
            amountOut,
            sqrtPNext,
            feeAmount,
            amountInAfterFee,

        };
    }

    // ==================== QUOTE METHODS ====================

    public async getQuote(params: QuoteParams): Promise<QuoteResult> {
        let pool: PoolData;
        let aToB: boolean;
        let amountInDecimal: Decimal;

        if (params.pool) {
            pool = params.pool;
        } else {
            const bestPool = await this.findBestPool(params.tokenIn, params.tokenOut);
            pool = bestPool.poolData;
        }

        if (params.aToB !== undefined) {
            aToB = params.aToB;
        } else {
            // Determine direction based on token addresses
            aToB = params.tokenIn.toLowerCase() === pool.token0.address.toLowerCase();
        }

        if (params.amountInFormattedInDecimal) {
            amountInDecimal = params.amountInFormattedInDecimal;
        } else {
            amountInDecimal = new Decimal(params.amountIn);
        }

        return this.getAmountOut({ aToB, amountInFormattedInDecimal: amountInDecimal, pool });
    }

    public getAmountOut(params: {
        aToB: boolean;
        amountInFormattedInDecimal: Decimal;
        pool: PoolData;
    }): QuoteResult {
        const { aToB, amountInFormattedInDecimal, pool } = params;
        const { liquidity, token0, token1, fee, poolAddress, sqrtPriceX96 } = pool;

        const tokenInObj = aToB ? token0 : token1;
        const tokenOutObj = aToB ? token1 : token0;
        const decimalsIn = Number(tokenInObj.decimals);
        const decimalsOut = Number(tokenOutObj.decimals);

        const zeroForOne = aToB;

        const { sqrtPNext, amountOut, feeAmount } = this.calculateSwapOutput({
            amountInRaw: amountInFormattedInDecimal,
            sqrtPriceX96: new Decimal(sqrtPriceX96),
            liquidity: new Decimal(liquidity),
            fee,
            zeroForOne: !zeroForOne,
            decimalsIn,
            decimalsOut,
        });

        const spotPrice = this.calculateSpotPrice(
            new Decimal(sqrtPriceX96),
            zeroForOne ? decimalsIn : decimalsOut,
            zeroForOne ? decimalsOut : decimalsIn,
            zeroForOne
        );


        return {
            price: spotPrice,
            amountIn: amountInFormattedInDecimal,
            amountOut: amountOut,
            poolAddress,
            fee: feeAmount,
            sqrtPriceStart: new Decimal(sqrtPriceX96),
            sqrtPriceNext: sqrtPNext,
            liquidity: new Decimal(liquidity),
            tokenInDecimals: decimalsIn,
            tokenOutDecimals: decimalsOut,
            zeroForOne,
        };
    }

    // ==================== QUOTER CONTRACT METHODS ====================

    public async simulateTransaction(
        tokenIn: string,
        tokenOut: string,
        amountIn: string,
        pool: string,
        fee: number,
        sqrtPriceLimitX96: string = "0"
    ): Promise<{ amountOut: string, pool: string }> {
        if (!this.config.quoterAddress) {
            throw new Error("Quoter address not configured for this DEX");
        }

        const quoter = new Contract(this.config.quoterAddress, QUOTER_ABI, this.provider);
        // console.log('this.config.quoterAddress: ', this.config.quoterAddress);

        // console.log('this.provider._getConnection().url: ', this.provider._getConnection().url);
        // console.log('tokenIn: ', tokenIn);
        // console.log('tokenOut: ', tokenOut);
        // console.log('amountIn: ', amountIn);
        try {
            const amountOut = await quoter.quoteExactInputSingle(
                tokenIn,
                tokenOut,
                fee,
                new Decimal(amountIn).toFixed(),
                sqrtPriceLimitX96
            );
            return { amountOut: amountOut.toString(), pool: pool };
        } catch (error) {
            console.error("Quote simulation failed:", error);
            return { amountOut: "0", pool }
        }
    }
    // ==================== POOL DISCOVERY ====================

    /**
     * Initializes and fetches all pool creation events from the factory
     * This function scans the blockchain for PoolCreated events to build a pool registry
     * 
     * @param factoryAddress - Address of the Uniswap V3 factory
     * @param fromBlockHeight - Starting block height for event scanning
     * @param provider - blockchain connection
     * @returns Promise<PoolCreatedEvent[]> - Array of pool creation events
     */

    /**
     * Override getAllPoolsFromEvents to batch requests for RPC providers
     * that have block range limitations (typically 10,000 blocks per request)
     */
    public async getAllPoolsFromEvents(
        factoryAddress: string,
        provider: JsonRpcProvider,
        fromBlockHeight: string = this.config.fromBlock || "0",
        abi: any
    ) {
        console.log(
            "Getting all pools for chain:",
            this.config.network,
            "RPC:",
            this.chainConfig.rpcUrl,
            "Provider RPC:",
            provider._getConnection().url
        );


        const factory = new Contract(factoryAddress, abi, provider);

        const latestBlock = await provider.getBlockNumber();
        console.log('latestBlock: ', latestBlock);
        const startBlock = parseInt(fromBlockHeight);
        console.log('fromBlockHeight: ', fromBlockHeight);
        const BATCH_SIZE = Number(process.env.BATCH_SIZE) || 1999; // Standard 2000-block RPC limit

        console.log(
            `Scanning from block ${startBlock} to ${latestBlock} (${latestBlock - startBlock} blocks)`
        );

        let allPools: any[] = [];
        let currentBlock = startBlock;
        let batchCount = 0;

        // Batch the requests to respect RPC provider limits
        while (currentBlock <= latestBlock) {
            const endBlock = Math.min(currentBlock + BATCH_SIZE, latestBlock);
            batchCount++;

            console.log(
                `Batch ${batchCount}: Fetching events from block ${currentBlock} to ${endBlock} (${endBlock - currentBlock + 1} blocks)`
            );

            try {
                const filter = factory.filters.PoolCreated();

                // Get events for this batch
                const events = await factory.queryFilter(filter, currentBlock, endBlock);

                console.log(`Batch ${batchCount}: Found ${events.length} pool creation events`);

                // Map events to PoolCreatedEvent format
                const batchPools = events.map((event: any) => ({
                    token0: event.args.token0,
                    token1: event.args.token1,
                    fee: event.args.fee?.toString(),
                    poolAddress: event.args.pool,
                    blockNumber: event.blockNumber.toString(),
                    tickSpacing: event.args.tickSpacing?.toString(), // Aerodrome specific
                }));

                allPools = allPools.concat(batchPools);

                // Add a small delay between batches to avoid rate limiting
                if (currentBlock + BATCH_SIZE < latestBlock) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            } catch (error: any) {
                console.error(
                    `Error fetching events for batch ${batchCount} (blocks ${currentBlock}-${endBlock}):`,
                    error.message
                );

                // If we still hit rate limits, add exponential backoff
                if (error.message.includes("rate limit") || error.message.includes("429")) {
                    console.log("Rate limit detected, waiting 2 seconds before retry...");
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    continue; // Retry this batch
                }

                // For other errors, continue to next batch
            }

            currentBlock = endBlock + 1;
        }

        console.log(`Total pools found across all batches: ${allPools.length}`);

        return allPools;
    }

    // ==================== POOL DISCOVERY METHODS ====================

    public async getAllPools(abi: any, fromBlock?: string): Promise<PoolData[]> {
        // Map events to a more convenient format
        const pools: PoolCreatedEvent[] = await this.getAllPoolsFromEvents(this.config.factoryAddress, this.provider, fromBlock, abi);
        console.log('pools: ', pools.length);
        // console.log('pools: ', pools);
        const poolsData: PoolData[] = []
        // TODO: use .map to make it faster, right now we can't because of the rpc rate limit
        let count = 0
        for (const pool of pools) {
            try {
                // Fetch pool data for each created pool
                //verify liquidity first before fetching full data
                const poolContract = new Contract(pool.poolAddress, POOL_ABI, this.provider);
                const liquidityRaw = await poolContract.liquidity();
                const liquidity = new Decimal(liquidityRaw.toString());


                if (liquidity.lte(0)) {
                    console.log(`Liquidity is zero for pool at ${pool.poolAddress}`);
                    continue; // skip pools with zero liquidity
                }


                const poolData = await this.getPoolData(pool.poolAddress);
                if (poolData.liquidity === '0') {
                    continue; // skip pools with zero liquidity
                }

                console.log('poolData: ', poolData.poolAddress);
                poolData.blockNumber = pool.blockNumber.toString()
                poolsData.push(poolData);
            } catch (error: any) {
                console.log('error: ', error);
                console.error(`Error fetching data for pool ${pool.poolAddress}: ${error.message}`);
            }

            // if (count > 9) {
            //     await wait(5)
            //     count = 0
            // }
            // await wait(10)
        }

        // console.log('poolsData: ', poolsData);
        return poolsData // no longer filtering by liquidity
    }

    // ==================== GETTER METHODS ====================

    public getConfig(): DexConfig {
        return { ...this.config };
    }

    public getProvider(): JsonRpcProvider {
        return this.provider;
    }

    public clearCache(): void {
        priceCache.clear();
        this.poolCache.clear();
    }

    public setCacheTimeout(durationMs: number): void {
        // @ts-ignore
        this.CACHE_DURATION = durationMs;
    }
}




export const wait = (time = 2) => {
    return new Promise((resolve) => setTimeout(resolve, time * 1000));
};




