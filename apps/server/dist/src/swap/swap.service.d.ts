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
    dexId: string;
    dexFactory: any;
    isNativeIn: boolean;
    isNativeOut: boolean;
}>;
export declare const swapService: (params: SwapRequestType, provider: JsonRpcProvider, network: NetworkType) => Promise<{
    transaction: {
        transactions: import("ethers").TransactionRequest[];
    };
}>;
export declare const tokenList: (provider: JsonRpcProvider, network: NetworkType) => Promise<string[]>;
export declare const tokenListWithDetailsService: (provider: JsonRpcProvider, network: NetworkType) => Promise<{}[]>;
export declare const getTokenPriceService: (tokenAddress: string, provider: JsonRpcProvider, network: NetworkType) => Promise<number | null>;
export declare const getTokenDetailsService: (tokenAddress: string, provider: JsonRpcProvider, network: NetworkType) => Promise<{}>;
