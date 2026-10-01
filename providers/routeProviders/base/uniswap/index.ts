
import { chain } from "../chain";
import { DexConfig, } from "../../UniswapV3Calculator";

import { v3PoolAbi } from "../../v3FactoryAbi";

import { createV3Route } from "../../v3Route";
import { UniswapV3QuoteCalculatorV2 } from "../../UniswapV3CalculatorV2";


export const UNISWAP_V3_BASE_CONFIG: DexConfig = {
    name: "Uniswap V3",
    factoryAddress: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
    quoterAddress: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
    fromBlock: process.env.BASE_FROM_BLOCK || "51935000",
    network: "BASE",
    stableTokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    abi: v3PoolAbi,
    wrappedNativeTokenAddress: "0x4200000000000000000000000000000000000006",
    nativeTokenAddress: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
}
const calculator = new UniswapV3QuoteCalculatorV2(UNISWAP_V3_BASE_CONFIG, chain)
export const UniswapV3BaseRoute = createV3Route(
    UNISWAP_V3_BASE_CONFIG,
    chain,
    "UNISWAP_V3_BASE",
    calculator
);
// Export type for convenience
export type UniswapV3BaseRouteType = InstanceType<typeof UniswapV3BaseRoute>;