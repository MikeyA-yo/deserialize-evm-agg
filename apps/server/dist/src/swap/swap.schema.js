"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TokenSearchRequestSchema = exports.TokenDetailsRequestSchema = exports.TokenPriceRequestSchema = exports.SwapRequestSchema = exports.SwapQuoteRequestSchema = void 0;
const zod_1 = require("zod");
exports.SwapQuoteRequestSchema = zod_1.z.object({
    body: zod_1.z.object({
        tokenA: zod_1.z.string(),
        tokenB: zod_1.z.string(),
        amountIn: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]).transform((arg) => {
            return typeof arg === "number" ? arg : parseFloat(arg);
        }),
        dexId: zod_1.z.string(),
        chain: zod_1.z.string().optional(),
        options: zod_1.z
            .object({
            targetRouteNumber: zod_1.z.number(),
        })
            .optional(),
    }),
    params: zod_1.z.object({
        chain: zod_1.z.string().optional(),
    }).optional(),
});
exports.SwapRequestSchema = zod_1.z.object({
    body: zod_1.z.object({
        publicKey: zod_1.z.string(),
        chain: zod_1.z.string().optional(),
        quote: zod_1.z.object({
            tokenA: zod_1.z.string(),
            tokenB: zod_1.z.string(),
            amountIn: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]).transform((arg) => {
                return typeof arg === "number" ? arg : parseFloat(arg);
            }),
            amountOut: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]).transform((arg) => {
                return typeof arg === "number" ? arg : parseFloat(arg);
            }),
            tokenPrice: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]).transform((arg) => {
                return typeof arg === "number" ? arg : parseFloat(arg);
            }),
            feeRate: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]).transform((arg) => {
                return typeof arg === "number" ? arg : parseFloat(arg);
            }).optional(),
            routePlan: zod_1.z.array(zod_1.z.object({
                tokenA: zod_1.z.string(),
                tokenB: zod_1.z.string(),
                poolAddress: zod_1.z.string(),
                fee: zod_1.z.number(),
                aToB: zod_1.z.boolean(),
                dexId: zod_1.z.string(),
            })),
            dexFactory: zod_1.z.string().optional(),
            dexId: zod_1.z.string(),
            isNativeIn: zod_1.z.boolean(),
            isNativeOut: zod_1.z.boolean(),
        }),
        slippage: zod_1.z.number().transform((arg) => {
            if (arg < 0 || arg > 10) {
                throw new Error("Slippage must be between 0 and 10");
            }
            return arg;
        }),
        partnerFees: zod_1.z.object({
            recipient: zod_1.z.string(),
            fee: zod_1.z.number().min(0),
        }).optional()
    }),
    params: zod_1.z.object({
        chain: zod_1.z.string().optional(),
    }).optional(),
});
exports.TokenPriceRequestSchema = zod_1.z.object({
    params: zod_1.z.object({
        tokenAddress: zod_1.z.string(),
        chain: zod_1.z.string().optional().default("BASE"),
    }),
});
exports.TokenDetailsRequestSchema = zod_1.z.object({
    params: zod_1.z.object({
        tokenAddress: zod_1.z.string(),
        chain: zod_1.z.string().optional().default("BASE"),
    }),
});
exports.TokenSearchRequestSchema = zod_1.z.object({
    params: zod_1.z.object({
        chain: zod_1.z.string().optional(),
        query: zod_1.z.string().optional(),
    }).optional(),
    query: zod_1.z.object({
        query: zod_1.z.string().optional(),
        q: zod_1.z.string().optional(),
        tick: zod_1.z.string().optional(),
        symbol: zod_1.z.string().optional(),
    }).optional(),
});
