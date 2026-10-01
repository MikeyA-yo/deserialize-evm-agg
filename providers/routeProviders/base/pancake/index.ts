
import { PancakeSwapV3Calculator } from "../../PancakeSwapV3Calculator";
import { DexConfig, } from "../../UniswapV3Calculator";

import { v3PoolAbi } from "../../v3FactoryAbi";

import { createV3Route } from "../../v3Route";

import { chain } from "../chain";


export const PANCAKE_BASE_CONFIG: DexConfig = {
    name: "PancakeSwap V3",
    factoryAddress: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865",
    quoterAddress: "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997",
    fromBlock: process.env.BASE_FROM_BLOCK || "51935000",
    network: "BASE",
    abi: v3PoolAbi,
    stableTokenAddress: chain.stableTokenAddress,
    wrappedNativeTokenAddress: chain.wrappedNativeTokenAddress,
    nativeTokenAddress: chain.nativeTokenAddress
}
const calculator = new PancakeSwapV3Calculator(PANCAKE_BASE_CONFIG, chain);

export const PancakeV3Route = createV3Route(
    PANCAKE_BASE_CONFIG,
    chain,
    "PANCAKE_V3_BASE",
    calculator
);
// Export type for convenience
export type PancakeV3RouteType = InstanceType<typeof PancakeV3Route>;