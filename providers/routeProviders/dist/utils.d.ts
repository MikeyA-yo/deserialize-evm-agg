import { Token } from "./type";
import { DeserializeRoutePlan } from "./IRoute";
import { JsonRpcProvider } from "ethers";
import Decimal from "decimal.js";
/**
 * Market price (human tokenOut per 1 tokenIn) derived from the USD prices stored on the pool
 * (token0PriceUsd / token1PriceUsd). Returns undefined when either price is unknown.
 */
export declare const usdReferencePrice: (pool: {
    token0PriceUsd?: number;
    token1PriceUsd?: number;
}, aToB: boolean) => number | undefined;
/**
 * Edge cost (price impact %) shared by the V2, Aerodrome V2 and V4 routes.
 * params.key.key is the raw input amount; the swap is sized in raw units of the
 * edge's from-token and quoted in raw units, then compared to a human price.
 * The comparison uses referencePrice (USD-derived market price) when available, so a
 * stale or mispriced pool scores its real loss instead of ~0% against its own spot price;
 * otherwise it falls back to the pool's spot price (params.price).
 */
export declare const rawSwapImpactCost: (params: {
    key: {
        key: number;
        keyRate: number;
        keyDecimal: number;
    };
    priceUsdc: number;
    price: number;
    tokenFromDecimals: number;
    tokenToDecimals: number;
}, quote: (amountInRaw: Decimal) => Decimal, referencePrice?: number) => number;
interface IPath {
    factory: string;
    poolAddress: string;
    tokenIn: string;
    tokenOut: string;
    fee: any;
}
export declare const transformRoutePlanToIPath: <DexIdTypes>(factoryAddress: string, routePlan: DeserializeRoutePlan<DexIdTypes>[], nativeTokenAddress: string, warpedTokenAddress: string, isNativeIn: boolean, isNativeOut: boolean) => IPath[];
export declare const getTokenDetails: (tokenAddress: string, provider: JsonRpcProvider) => Promise<Token>;
export {};
