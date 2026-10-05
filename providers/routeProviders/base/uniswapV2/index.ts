import { chain } from "../chain";
import { BaseV2QuoteCalculator, V2DexConfig } from "../../BaseV2Calculator";
import { createV2Route } from "../../v2Route";

export const UNISWAP_V2_BASE_CONFIG: V2DexConfig = {
    name: "Uniswap V2",
    factoryAddress: "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6",
    routerAddress: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24",
    network: "BASE",
    feeBps: 30, // 0.3%
    stableTokenAddress: chain.stableTokenAddress,
    wrappedNativeTokenAddress: chain.wrappedNativeTokenAddress,
    nativeTokenAddress: chain.nativeTokenAddress,
};

const calculator = new BaseV2QuoteCalculator(UNISWAP_V2_BASE_CONFIG, chain);

export const UniswapV2BaseRoute = createV2Route(
    UNISWAP_V2_BASE_CONFIG,
    chain,
    "UNISWAP_V2_BASE",
    calculator
);

export type UniswapV2BaseRouteType = InstanceType<typeof UniswapV2BaseRoute>;
