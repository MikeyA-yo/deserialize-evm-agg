import { DexConfig } from "../../UniswapV3Calculator";
import { AERODROME_V3_FACTORY_ABI, AerodromeV3QuoteCalculator } from "../../Aerodromev3Calculator";
import { chain } from "../chain";
import { createV3Route } from "../../v3Route";

/**
 * Aerodrome V3 Configuration for Base Network
 */
export const AERODROME_BASE_CONFIG: DexConfig = {
    name: "Aerodrome V3",
    network: "BASE",
    factoryAddress: "0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A", // Aerodrome CL Factory
    quoterAddress: "0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0", // Aerodrome CL Quoter
    fromBlock: process.env.BASE_FROM_BLOCK || "51935000", // recent block for testing
    abi: AERODROME_V3_FACTORY_ABI,
    wrappedNativeTokenAddress: "0x4200000000000000000000000000000000000006", // WETH on Base
    nativeTokenAddress: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
    stableTokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC on Base
};

const calculator = new AerodromeV3QuoteCalculator(AERODROME_BASE_CONFIG, chain)

export const AerodromeV3Route = createV3Route(
    AERODROME_BASE_CONFIG,
    chain,
    "AERODROME_V3_BASE",
    calculator
);
// Export type for convenience
export type AerodromeV3RouteType = InstanceType<typeof AerodromeV3Route>;