"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTokenDetails = exports.transformRoutePlanToIPath = exports.rawSwapImpactCost = exports.concentratedLiquidityAmountOutRaw = exports.usdReferencePrice = void 0;
const ethers_1 = require("ethers");
const UniswapV3Calculator_1 = require("./UniswapV3Calculator");
const decimal_js_1 = __importDefault(require("decimal.js"));
/**
 * Market price (human tokenOut per 1 tokenIn) derived from the USD prices stored on the pool
 * (token0PriceUsd / token1PriceUsd). Returns undefined when either price is unknown.
 */
const usdReferencePrice = (pool, aToB) => {
    const p0 = Number(pool?.token0PriceUsd);
    const p1 = Number(pool?.token1PriceUsd);
    if (!(p0 > 0) || !(p1 > 0))
        return undefined;
    return aToB ? p0 / p1 : p1 / p0;
};
exports.usdReferencePrice = usdReferencePrice;
const Q96 = new decimal_js_1.default(2).pow(96);
/**
 * Exact concentrated-liquidity output (raw units) for a swap that stays within the current
 * liquidity range. feePips is in hundredths of a bip (500 = 0.05%).
 * Used for edge costs only; real quotes come from the on-chain quoters.
 */
const concentratedLiquidityAmountOutRaw = (sqrtPriceX96, liquidity, feePips, zeroForOne, amountInRaw) => {
    const sqrtP = new decimal_js_1.default(sqrtPriceX96.toString()).div(Q96);
    const L = new decimal_js_1.default(liquidity.toString());
    if (sqrtP.lte(0) || L.lte(0) || amountInRaw.lte(0))
        return new decimal_js_1.default(0);
    const amountInAfterFee = amountInRaw.mul(new decimal_js_1.default(1).sub(new decimal_js_1.default(feePips).div(1000000)));
    let amountOut;
    if (zeroForOne) {
        // token0 in: sqrtP falls to L*sqrtP / (L + dx*sqrtP); token1 out = L * (sqrtP - sqrtPNext)
        const sqrtPNext = L.mul(sqrtP).div(L.add(amountInAfterFee.mul(sqrtP)));
        amountOut = L.mul(sqrtP.sub(sqrtPNext));
    }
    else {
        // token1 in: sqrtP rises by dy / L; token0 out = L * (1/sqrtP - 1/sqrtPNext)
        const sqrtPNext = sqrtP.add(amountInAfterFee.div(L));
        amountOut = L.mul(new decimal_js_1.default(1).div(sqrtP).sub(new decimal_js_1.default(1).div(sqrtPNext)));
    }
    return decimal_js_1.default.max(0, amountOut).floor();
};
exports.concentratedLiquidityAmountOutRaw = concentratedLiquidityAmountOutRaw;
/**
 * Edge cost (price impact %) shared by the V2, Aerodrome V2, V3 and V4 routes.
 * params.key.key is the raw input amount; the swap is sized in raw units of the
 * edge's from-token and quoted in raw units, then compared to a human price.
 * The comparison uses referencePrice (USD-derived market price) when available, so a
 * stale or mispriced pool scores its real loss instead of ~0% against its own spot price;
 * otherwise it falls back to the pool's spot price (params.price).
 */
const rawSwapImpactCost = (params, quote, referencePrice) => {
    const price = referencePrice && referencePrice > 0 ? referencePrice : params.price;
    if (!(params.priceUsdc > 0) || !(price > 0)) {
        return 100;
    }
    let swapAmount = (params.key.key * params.key.keyRate) / params.priceUsdc;
    swapAmount = swapAmount / Math.pow(10, Math.abs(params.key.keyDecimal));
    swapAmount = swapAmount * Math.pow(10, Math.abs(params.tokenFromDecimals));
    if (!isFinite(swapAmount) || swapAmount < 1) {
        return 100;
    }
    const amountInRaw = new decimal_js_1.default(swapAmount).floor();
    const amountOutRaw = quote(amountInRaw);
    if (!amountOutRaw || !amountOutRaw.isFinite() || amountOutRaw.lte(0)) {
        return 100;
    }
    const expectedOut = amountInRaw.div(new decimal_js_1.default(10).pow(params.tokenFromDecimals)).mul(price);
    const actualOut = amountOutRaw.div(new decimal_js_1.default(10).pow(params.tokenToDecimals));
    const swapImpact = expectedOut.sub(actualOut).div(expectedOut).mul(100).toNumber();
    return isFinite(swapImpact) ? Math.max(0, swapImpact) : 100;
};
exports.rawSwapImpactCost = rawSwapImpactCost;
const transformRoutePlanToIPath = (factoryAddress, routePlan, nativeTokenAddress, warpedTokenAddress, isNativeIn, isNativeOut) => {
    const plan = [];
    for (let i = 0; i < routePlan.length; i++) {
        const route = routePlan[i];
        const isFirstHop = i === 0;
        const isLastHop = i === routePlan.length - 1;
        const replaceIn = isNativeIn && isFirstHop && route.tokenA.toLowerCase() === warpedTokenAddress.toLowerCase();
        const replaceOut = isNativeOut && isLastHop && route.tokenB.toLowerCase() === warpedTokenAddress.toLowerCase();
        const path = {
            factory: factoryAddress,
            poolAddress: route.poolAddress,
            tokenIn: replaceIn ? nativeTokenAddress : route.tokenA,
            tokenOut: replaceOut ? nativeTokenAddress : route.tokenB,
            fee: route.fee,
        };
        plan.push(path);
    }
    return plan;
};
exports.transformRoutePlanToIPath = transformRoutePlanToIPath;
const getTokenDetails = async (tokenAddress, provider) => {
    const tokenContract = new ethers_1.Contract(tokenAddress, UniswapV3Calculator_1.ERC20_ABI, provider);
    const [decimals, symbol, name] = await Promise.all([
        tokenContract.decimals(),
        tokenContract.symbol(),
        tokenContract.name(),
    ]);
    const tokenDetails = {
        address: tokenAddress,
        decimals: Number(decimals),
        symbol: symbol,
        name: name
    };
    return tokenDetails;
};
exports.getTokenDetails = getTokenDetails;
