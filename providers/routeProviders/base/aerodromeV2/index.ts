import { chain } from "../chain";
import { AerodromeV2DexConfig } from "../../Aerodromev2Calculator";
import { createAerodromeV2Route } from "../../AerodromeV2Route";

export const AERODROME_V2_BASE_CONFIG: AerodromeV2DexConfig = {
    name: "Aerodrome V2",
    network: "BASE",
    factoryAddress: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da",
    routerAddress: "0xcF77a3Ba9A5CA399B7c97c74856154998ED377b9",
    stableTokenAddress: chain.stableTokenAddress,
    wrappedNativeTokenAddress: chain.wrappedNativeTokenAddress,
    nativeTokenAddress: chain.nativeTokenAddress,
};

export const AerodromeV2BaseRoute = createAerodromeV2Route(
    "AERODROME_V2_BASE",
    AERODROME_V2_BASE_CONFIG,
    chain
);

export type AerodromeV2BaseRouteType = InstanceType<typeof AerodromeV2BaseRoute>;
