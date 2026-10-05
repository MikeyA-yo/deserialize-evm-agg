
import { createAllRoute } from "../../AllContructor";
import { ZeroGRoute, ZiaRoute } from "../../0g";
import { chain } from "../chain";
import { PancakeV3Route } from "../pancake";
import { UniswapV3BaseRoute } from "../uniswap";
import { AerodromeV3Route } from "../aerodrome";
import { UniswapV2BaseRoute } from "../uniswapV2";
import { PancakeV2BaseRoute } from "../pancakeV2";
import { UniswapV4BaseRoute } from "../uniswapV4";
import { AerodromeV2BaseRoute } from "../aerodromeV2";


// Export the configured AllRoute class for Base Mainnet
export const AllRouteBase = createAllRoute(
    "ALL_BASE",
    chain,
    [PancakeV3Route, UniswapV3BaseRoute, AerodromeV3Route, UniswapV2BaseRoute, PancakeV2BaseRoute, UniswapV4BaseRoute, AerodromeV2BaseRoute]
);

export const DEX_IDS_BASE = {
    PANCAKE_V3: "PANCAKE_V3_BASE",
    UNISWAP_V3: "UNISWAP_V3_BASE",
    AERODROME_V3: "AERODROME_V3_BASE",
    UNISWAP_V2: "UNISWAP_V2_BASE",
    PANCAKE_V2: "PANCAKE_V2_BASE",
    UNISWAP_V4: "UNISWAP_V4_BASE",
    AERODROME_V2: "AERODROME_V2_BASE",
    ALL: "ALL_BASE",
} as const

export const dexIdListBase = Object.keys(DEX_IDS_BASE);
export type DexIdTypesBase = (typeof DEX_IDS_BASE)[keyof typeof DEX_IDS_BASE];
