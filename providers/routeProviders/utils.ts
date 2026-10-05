import { Token } from "./type";
import { DeserializeRoutePlan } from "./IRoute";
import { Contract, JsonRpcProvider } from "ethers";
import { ERC20_ABI } from "./UniswapV3Calculator";
import Decimal from "decimal.js";

/**
 * Market price (human tokenOut per 1 tokenIn) derived from the USD prices stored on the pool
 * (token0PriceUsd / token1PriceUsd). Returns undefined when either price is unknown.
 */
export const usdReferencePrice = (
    pool: { token0PriceUsd?: number; token1PriceUsd?: number },
    aToB: boolean
): number | undefined => {
    const p0 = Number(pool?.token0PriceUsd);
    const p1 = Number(pool?.token1PriceUsd);
    if (!(p0 > 0) || !(p1 > 0)) return undefined;
    return aToB ? p0 / p1 : p1 / p0;
};

/**
 * Edge cost (price impact %) shared by the V2, Aerodrome V2 and V4 routes.
 * params.key.key is the raw input amount; the swap is sized in raw units of the
 * edge's from-token and quoted in raw units, then compared to a human price.
 * The comparison uses referencePrice (USD-derived market price) when available, so a
 * stale or mispriced pool scores its real loss instead of ~0% against its own spot price;
 * otherwise it falls back to the pool's spot price (params.price).
 */
export const rawSwapImpactCost = (
    params: { key: { key: number; keyRate: number; keyDecimal: number }; priceUsdc: number; price: number; tokenFromDecimals: number; tokenToDecimals: number },
    quote: (amountInRaw: Decimal) => Decimal,
    referencePrice?: number
): number => {
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

    const amountInRaw = new Decimal(swapAmount).floor();
    const amountOutRaw = quote(amountInRaw);
    if (!amountOutRaw || !amountOutRaw.isFinite() || amountOutRaw.lte(0)) {
        return 100;
    }

    const expectedOut = amountInRaw.div(new Decimal(10).pow(params.tokenFromDecimals)).mul(price);
    const actualOut = amountOutRaw.div(new Decimal(10).pow(params.tokenToDecimals));
    const swapImpact = expectedOut.sub(actualOut).div(expectedOut).mul(100).toNumber();

    return isFinite(swapImpact) ? Math.max(0, swapImpact) : 100;
};

interface IQuoteData {
    path: IPath[];
    amountInRaw: string;
    minAmountOut: string;
    amountIn: string;
}
interface IPath {
    factory: string;
    poolAddress: string;
    tokenIn: string;
    tokenOut: string;
    fee: any;
}
type IQuoteDataWithoutAmountIn = Omit<IQuoteData, "amountIn">;
export const transformRoutePlanToIPath = <DexIdTypes>(factoryAddress: string, routePlan: DeserializeRoutePlan<DexIdTypes>[], nativeTokenAddress: string, warpedTokenAddress: string, isNativeIn: boolean, isNativeOut: boolean): IPath[] => {
    const plan: IPath[] = [];
    for (let i = 0; i < routePlan.length; i++) {
        const route = routePlan[i];
        const isFirstHop = i === 0;
        const isLastHop = i === routePlan.length - 1;
        const replaceIn = isNativeIn && isFirstHop && route.tokenA.toLowerCase() === warpedTokenAddress.toLowerCase();
        const replaceOut = isNativeOut && isLastHop && route.tokenB.toLowerCase() === warpedTokenAddress.toLowerCase();
        const path: IPath = {
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



export const getTokenDetails = async (tokenAddress: string, provider: JsonRpcProvider): Promise<Token> => {
    const tokenContract = new Contract(tokenAddress, ERC20_ABI, provider);
    const [decimals, symbol, name] = await Promise.all([
        tokenContract.decimals(),
        tokenContract.symbol(),
        tokenContract.name(),
    ]);

    const tokenDetails: Token = {
        address: tokenAddress,
        decimals: Number(decimals),
        symbol: symbol,
        name: name
    };
    return tokenDetails;
}