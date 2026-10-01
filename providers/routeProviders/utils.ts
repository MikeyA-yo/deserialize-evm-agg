import { Token } from "./type";
import { DeserializeRoutePlan } from "./IRoute";
import { Contract, JsonRpcProvider } from "ethers";
import { ERC20_ABI } from "./UniswapV3Calculator";

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