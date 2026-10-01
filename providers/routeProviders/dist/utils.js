"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTokenDetails = exports.transformRoutePlanToIPath = void 0;
const ethers_1 = require("ethers");
const UniswapV3Calculator_1 = require("./UniswapV3Calculator");
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
