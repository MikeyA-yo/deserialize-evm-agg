import { chain } from "../chain";
import { V4DexConfig, V4_DEFAULT_FEE_TIERS } from "../../BaseV4Calculator";
import { createV4Route } from "../../v4Route";

export const UNISWAP_V4_BASE_CONFIG: V4DexConfig = {
    name: "Uniswap V4",
    network: "BASE",
    poolManagerAddress: "0x498581fF718922c3f8e6A244956aF099B2652b2b",
    stateViewAddress: "0xa3c0c9b65bad0b08107aa264b0f3db444b867a71",
    quoterAddress: "0x0d5e0f971ed27fbff6c2837bf31316121532048d",
    factoryAddress: "0x498581fF718922c3f8e6A244956aF099B2652b2b",
    stableTokenAddress: chain.stableTokenAddress,
    wrappedNativeTokenAddress: chain.wrappedNativeTokenAddress,
    nativeTokenAddress: chain.nativeTokenAddress,
    feeTiers: V4_DEFAULT_FEE_TIERS,
    adapterAddress: "0xb5fD1C6122db94e52EBc697cca971C5759A54598", // UniswapV4Adapter with pool handles (Oct 5 2026 migration)
};

export const UniswapV4BaseRoute = createV4Route(
    "UNISWAP_V4_BASE",
    UNISWAP_V4_BASE_CONFIG,
    chain
);

export type UniswapV4BaseRouteType = InstanceType<typeof UniswapV4BaseRoute>;
