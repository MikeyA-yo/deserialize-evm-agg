import { JsonRpcProvider } from "ethers";
import { SwapQuoteRequestType, SwapRequestType } from "./swap.schema";
import Decimal from "decimal.js";
import { AllDexIdTypes } from "@deserialize-evm-agg/routes-providers";
import { NetworkType } from "@deserialize-evm-agg/routes-providers";
export declare const swapQuoteService: (params: SwapQuoteRequestType, provider: JsonRpcProvider, network: NetworkType) => Promise<{
    tokenA: string;
    tokenB: string;
    amountIn: string;
    amountOut: Decimal;
    tokenPrice: string;
    routePlan: {
        poolAddress: string;
        tokenA: string;
        tokenB: string;
        fee: number;
        aToB: boolean;
        dexId: AllDexIdTypes;
    }[];
    route: QuoteRouteView | undefined;
    dexId: string;
    dexFactory: string;
    isNativeIn: boolean;
    isNativeOut: boolean;
}>;
export interface QuoteRouteToken {
    address: string;
    symbol: string | null;
    decimals: number | null;
}
export interface QuoteRouteHop {
    hop: number;
    dexId: string;
    dexName: string;
    poolAddress: string;
    fee: number;
    tokenIn: QuoteRouteToken;
    tokenOut: QuoteRouteToken;
    amountIn: string;
    amountOut: string;
    amountInFormatted: string | null;
    amountOutFormatted: string | null;
    percent: number;
}
export interface QuoteRouteView {
    path: QuoteRouteToken[];
    hops: QuoteRouteHop[];
    summary: string;
}
export declare const swapService: (params: SwapRequestType, provider: JsonRpcProvider, network: NetworkType) => Promise<{
    transaction: {
        transactions: import("ethers").TransactionRequest[];
    };
}>;
export declare const tokenList: (provider: JsonRpcProvider, network: NetworkType) => Promise<string[]>;
export declare const tokenListWithDetailsService: (provider: JsonRpcProvider, network: NetworkType) => Promise<{}[]>;
export declare const getTokenPriceService: (tokenAddress: string, provider: JsonRpcProvider, network: NetworkType) => Promise<number | null>;
export declare const getTokenDetailsService: (tokenAddress: string, provider: JsonRpcProvider, network: NetworkType) => Promise<{}>;
export interface SearchTokenResult {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    network?: string;
}
export declare const tokenSearchService: (searchQuery: string | undefined, provider: JsonRpcProvider, network: NetworkType) => Promise<SearchTokenResult[]>;
