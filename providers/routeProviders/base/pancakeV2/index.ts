import { chain } from "../chain";
import { BaseV2QuoteCalculator, V2DexConfig } from "../../BaseV2Calculator";
import { createV2Route } from "../../v2Route";

export const PANCAKE_V2_BASE_CONFIG: V2DexConfig = {
    name: "PancakeSwap V2",
    factoryAddress: "0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E",
    routerAddress: "0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb",
    network: "BASE",
    feeBps: 25, // 0.25%
    stableTokenAddress: chain.stableTokenAddress,
    wrappedNativeTokenAddress: chain.wrappedNativeTokenAddress,
    nativeTokenAddress: chain.nativeTokenAddress,
};

const calculator = new BaseV2QuoteCalculator(PANCAKE_V2_BASE_CONFIG, chain);

export const PancakeV2BaseRoute = createV2Route(
    PANCAKE_V2_BASE_CONFIG,
    chain,
    "PANCAKE_V2_BASE",
    calculator
);

export type PancakeV2BaseRouteType = InstanceType<typeof PancakeV2BaseRoute>;
