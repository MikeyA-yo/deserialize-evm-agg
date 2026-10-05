import { z } from "zod";
export declare const SwapQuoteRequestSchema: z.ZodObject<{
    body: z.ZodObject<{
        tokenA: z.ZodString;
        tokenB: z.ZodString;
        amountIn: z.ZodEffects<z.ZodUnion<[z.ZodString, z.ZodNumber]>, number, string | number>;
        dexId: z.ZodString;
        chain: z.ZodOptional<z.ZodString>;
        options: z.ZodOptional<z.ZodObject<{
            targetRouteNumber: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            targetRouteNumber: number;
        }, {
            targetRouteNumber: number;
        }>>;
    }, "strip", z.ZodTypeAny, {
        tokenA: string;
        tokenB: string;
        amountIn: number;
        dexId: string;
        options?: {
            targetRouteNumber: number;
        } | undefined;
        chain?: string | undefined;
    }, {
        tokenA: string;
        tokenB: string;
        amountIn: string | number;
        dexId: string;
        options?: {
            targetRouteNumber: number;
        } | undefined;
        chain?: string | undefined;
    }>;
    params: z.ZodOptional<z.ZodObject<{
        chain: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        chain?: string | undefined;
    }, {
        chain?: string | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    body: {
        tokenA: string;
        tokenB: string;
        amountIn: number;
        dexId: string;
        options?: {
            targetRouteNumber: number;
        } | undefined;
        chain?: string | undefined;
    };
    params?: {
        chain?: string | undefined;
    } | undefined;
}, {
    body: {
        tokenA: string;
        tokenB: string;
        amountIn: string | number;
        dexId: string;
        options?: {
            targetRouteNumber: number;
        } | undefined;
        chain?: string | undefined;
    };
    params?: {
        chain?: string | undefined;
    } | undefined;
}>;
export type SwapQuoteRequestType = z.infer<typeof SwapQuoteRequestSchema>["body"];
export declare const SwapRequestSchema: z.ZodObject<{
    body: z.ZodObject<{
        publicKey: z.ZodString;
        chain: z.ZodOptional<z.ZodString>;
        quote: z.ZodObject<{
            tokenA: z.ZodString;
            tokenB: z.ZodString;
            amountIn: z.ZodEffects<z.ZodUnion<[z.ZodString, z.ZodNumber]>, number, string | number>;
            amountOut: z.ZodEffects<z.ZodUnion<[z.ZodString, z.ZodNumber]>, number, string | number>;
            tokenPrice: z.ZodEffects<z.ZodUnion<[z.ZodString, z.ZodNumber]>, number, string | number>;
            feeRate: z.ZodOptional<z.ZodEffects<z.ZodUnion<[z.ZodString, z.ZodNumber]>, number, string | number>>;
            routePlan: z.ZodArray<z.ZodObject<{
                tokenA: z.ZodString;
                tokenB: z.ZodString;
                poolAddress: z.ZodString;
                fee: z.ZodNumber;
                aToB: z.ZodBoolean;
                dexId: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                tokenA: string;
                tokenB: string;
                dexId: string;
                poolAddress: string;
                fee: number;
                aToB: boolean;
            }, {
                tokenA: string;
                tokenB: string;
                dexId: string;
                poolAddress: string;
                fee: number;
                aToB: boolean;
            }>, "many">;
            dexFactory: z.ZodOptional<z.ZodString>;
            dexId: z.ZodString;
            isNativeIn: z.ZodBoolean;
            isNativeOut: z.ZodBoolean;
        }, "strip", z.ZodTypeAny, {
            tokenA: string;
            tokenB: string;
            amountIn: number;
            dexId: string;
            amountOut: number;
            tokenPrice: number;
            routePlan: {
                tokenA: string;
                tokenB: string;
                dexId: string;
                poolAddress: string;
                fee: number;
                aToB: boolean;
            }[];
            isNativeIn: boolean;
            isNativeOut: boolean;
            feeRate?: number | undefined;
            dexFactory?: string | undefined;
        }, {
            tokenA: string;
            tokenB: string;
            amountIn: string | number;
            dexId: string;
            amountOut: string | number;
            tokenPrice: string | number;
            routePlan: {
                tokenA: string;
                tokenB: string;
                dexId: string;
                poolAddress: string;
                fee: number;
                aToB: boolean;
            }[];
            isNativeIn: boolean;
            isNativeOut: boolean;
            feeRate?: string | number | undefined;
            dexFactory?: string | undefined;
        }>;
        slippage: z.ZodEffects<z.ZodNumber, number, number>;
        partnerFees: z.ZodOptional<z.ZodObject<{
            recipient: z.ZodString;
            fee: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            fee: number;
            recipient: string;
        }, {
            fee: number;
            recipient: string;
        }>>;
    }, "strip", z.ZodTypeAny, {
        publicKey: string;
        quote: {
            tokenA: string;
            tokenB: string;
            amountIn: number;
            dexId: string;
            amountOut: number;
            tokenPrice: number;
            routePlan: {
                tokenA: string;
                tokenB: string;
                dexId: string;
                poolAddress: string;
                fee: number;
                aToB: boolean;
            }[];
            isNativeIn: boolean;
            isNativeOut: boolean;
            feeRate?: number | undefined;
            dexFactory?: string | undefined;
        };
        slippage: number;
        chain?: string | undefined;
        partnerFees?: {
            fee: number;
            recipient: string;
        } | undefined;
    }, {
        publicKey: string;
        quote: {
            tokenA: string;
            tokenB: string;
            amountIn: string | number;
            dexId: string;
            amountOut: string | number;
            tokenPrice: string | number;
            routePlan: {
                tokenA: string;
                tokenB: string;
                dexId: string;
                poolAddress: string;
                fee: number;
                aToB: boolean;
            }[];
            isNativeIn: boolean;
            isNativeOut: boolean;
            feeRate?: string | number | undefined;
            dexFactory?: string | undefined;
        };
        slippage: number;
        chain?: string | undefined;
        partnerFees?: {
            fee: number;
            recipient: string;
        } | undefined;
    }>;
    params: z.ZodOptional<z.ZodObject<{
        chain: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        chain?: string | undefined;
    }, {
        chain?: string | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    body: {
        publicKey: string;
        quote: {
            tokenA: string;
            tokenB: string;
            amountIn: number;
            dexId: string;
            amountOut: number;
            tokenPrice: number;
            routePlan: {
                tokenA: string;
                tokenB: string;
                dexId: string;
                poolAddress: string;
                fee: number;
                aToB: boolean;
            }[];
            isNativeIn: boolean;
            isNativeOut: boolean;
            feeRate?: number | undefined;
            dexFactory?: string | undefined;
        };
        slippage: number;
        chain?: string | undefined;
        partnerFees?: {
            fee: number;
            recipient: string;
        } | undefined;
    };
    params?: {
        chain?: string | undefined;
    } | undefined;
}, {
    body: {
        publicKey: string;
        quote: {
            tokenA: string;
            tokenB: string;
            amountIn: string | number;
            dexId: string;
            amountOut: string | number;
            tokenPrice: string | number;
            routePlan: {
                tokenA: string;
                tokenB: string;
                dexId: string;
                poolAddress: string;
                fee: number;
                aToB: boolean;
            }[];
            isNativeIn: boolean;
            isNativeOut: boolean;
            feeRate?: string | number | undefined;
            dexFactory?: string | undefined;
        };
        slippage: number;
        chain?: string | undefined;
        partnerFees?: {
            fee: number;
            recipient: string;
        } | undefined;
    };
    params?: {
        chain?: string | undefined;
    } | undefined;
}>;
export type SwapRequestType = z.infer<typeof SwapRequestSchema>["body"];
export declare const TokenPriceRequestSchema: z.ZodObject<{
    params: z.ZodObject<{
        tokenAddress: z.ZodString;
        chain: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        chain: string;
        tokenAddress: string;
    }, {
        tokenAddress: string;
        chain?: string | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    params: {
        chain: string;
        tokenAddress: string;
    };
}, {
    params: {
        tokenAddress: string;
        chain?: string | undefined;
    };
}>;
export type TokenPriceRequestType = z.infer<typeof TokenPriceRequestSchema>["params"];
export declare const TokenDetailsRequestSchema: z.ZodObject<{
    params: z.ZodObject<{
        tokenAddress: z.ZodString;
        chain: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        chain: string;
        tokenAddress: string;
    }, {
        tokenAddress: string;
        chain?: string | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    params: {
        chain: string;
        tokenAddress: string;
    };
}, {
    params: {
        tokenAddress: string;
        chain?: string | undefined;
    };
}>;
export type TokenDetailsRequestType = z.infer<typeof TokenDetailsRequestSchema>["params"];
export declare const TokenSearchRequestSchema: z.ZodObject<{
    params: z.ZodOptional<z.ZodObject<{
        chain: z.ZodOptional<z.ZodString>;
        query: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        chain?: string | undefined;
        query?: string | undefined;
    }, {
        chain?: string | undefined;
        query?: string | undefined;
    }>>;
    query: z.ZodOptional<z.ZodObject<{
        query: z.ZodOptional<z.ZodString>;
        q: z.ZodOptional<z.ZodString>;
        tick: z.ZodOptional<z.ZodString>;
        symbol: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        symbol?: string | undefined;
        query?: string | undefined;
        q?: string | undefined;
        tick?: string | undefined;
    }, {
        symbol?: string | undefined;
        query?: string | undefined;
        q?: string | undefined;
        tick?: string | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    params?: {
        chain?: string | undefined;
        query?: string | undefined;
    } | undefined;
    query?: {
        symbol?: string | undefined;
        query?: string | undefined;
        q?: string | undefined;
        tick?: string | undefined;
    } | undefined;
}, {
    params?: {
        chain?: string | undefined;
        query?: string | undefined;
    } | undefined;
    query?: {
        symbol?: string | undefined;
        query?: string | undefined;
        q?: string | undefined;
        tick?: string | undefined;
    } | undefined;
}>;
export type TokenSearchRequestType = z.infer<typeof TokenSearchRequestSchema>;
