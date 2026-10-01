/**
 * Uniswap V3 Quote Calculator - Reusable Class Version
 *
 * A generic class for calculating swap quotes on any Uniswap V3 compatible DEX.
 * Supports multiple networks and can be easily extended for different protocols.
 */
import { ethers, Contract, JsonRpcProvider } from "ethers";
export declare const createJsonRpcProvider: (rpcUrl: string, chainId: number) => ethers.JsonRpcProvider;
import Decimal from "decimal.js";
import { Token } from "./type";
import { NetworkType } from "./constants";
import { PublicClient } from "viem";
export interface PoolInfo {
    pool: Contract;
    fee: number;
    liquidity: Decimal;
    address: string;
}
export interface ZeroDexQuoteParams {
    aToB: boolean;
    amountInFormattedInDecimal: Decimal;
    pool: PoolData;
}
export interface PoolData {
    token0: Token;
    token1: Token;
    fee: number;
    poolAddress: string;
    slot0: any;
    sqrtPriceX96: string;
    liquidity: string;
    blockNumber?: string;
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
    abi: any;
    wrappedNativeTokenAddress: string;
    nativeTokenAddress: string;
    stableTokenAddress?: string;
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
    stableTokenAddress: string;
}
export interface QuoteParams {
    tokenIn: string;
    tokenOut: string;
    amountIn: number;
    aToB?: boolean;
    amountInFormattedInDecimal?: Decimal;
    pool?: PoolData;
}
export declare const ERC20_ABI: readonly [{
    readonly inputs: readonly [];
    readonly name: "decimals";
    readonly outputs: readonly [{
        readonly internalType: "uint8";
        readonly name: "";
        readonly type: "uint8";
    }];
    readonly stateMutability: "view";
    readonly type: "function";
}, {
    readonly inputs: readonly [];
    readonly name: "symbol";
    readonly outputs: readonly [{
        readonly internalType: "string";
        readonly name: "";
        readonly type: "string";
    }];
    readonly stateMutability: "view";
    readonly type: "function";
}, {
    readonly inputs: readonly [];
    readonly name: "name";
    readonly outputs: readonly [{
        readonly internalType: "string";
        readonly name: "";
        readonly type: "string";
    }];
    readonly stateMutability: "view";
    readonly type: "function";
}];
export declare class UniswapV3QuoteCalculator {
    provider: JsonRpcProvider;
    config: DexConfig;
    chainConfig: ChainConfig;
    client: PublicClient;
    private priceCache;
    poolCache: Map<string, PoolData>;
    private readonly CACHE_DURATION;
    constructor(config: DexConfig, chainConfig: ChainConfig, _provider?: JsonRpcProvider);
    getPriceFromPriceMap: (tokenAddress: string) => number | undefined;
    setPriceInPriceMap: (tokenAddress: string, price: number) => void;
    getSureTokenPrice(tokenAddress: string, _provider?: ethers.JsonRpcProvider): Promise<number>;
    private wait;
    private isCacheValid;
    protected retryWithBackoff<T>(fn: () => Promise<T>, retries?: number, delayMs?: number): Promise<T>;
    getTokenDetails(tokenAddress: string, provider?: ethers.JsonRpcProvider): Promise<Token>;
    getTokenPrice(tokenAddress: string): Promise<number>;
    private getTokenPriceFromExternalAPI;
    private getTokenUsdPriceFromPoolUsingStableCoin;
    getTokenUsdPriceFromPoolWrappedToken(tokenAddress: string): Promise<number>;
    private getTokenUsdPriceFromPool;
    getPoolData(poolAddress: string): Promise<PoolData>;
    findBestPool(tokenA: string, tokenB: string, feeTiers?: number[]): Promise<PoolInfo & {
        poolData: PoolData;
    }>;
    findAllPools(tokenA: string, tokenB: string, feeTiers?: number[]): Promise<(PoolInfo & {
        poolData: PoolData;
    })[]>;
    calculateSpotPrice(sqrtPriceX96: Decimal, decimals0: number, decimals1: number, token0IsInput: boolean): number;
    private calculateSwapOutput;
    getQuote(params: QuoteParams): Promise<QuoteResult>;
    getAmountOut(params: {
        aToB: boolean;
        amountInFormattedInDecimal: Decimal;
        pool: PoolData;
    }): QuoteResult;
    simulateTransaction(tokenIn: string, tokenOut: string, amountIn: string, pool: string, fee: number, sqrtPriceLimitX96?: string): Promise<{
        amountOut: string;
        pool: string;
    }>;
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
    getAllPoolsFromEvents(factoryAddress: string, provider: JsonRpcProvider, fromBlockHeight: string | undefined, abi: any): Promise<any[]>;
    getAllPools(abi: any, fromBlock?: string): Promise<PoolData[]>;
    getConfig(): DexConfig;
    getProvider(): JsonRpcProvider;
    clearCache(): void;
    setCacheTimeout(durationMs: number): void;
}
export declare const wait: (time?: number) => Promise<unknown>;
