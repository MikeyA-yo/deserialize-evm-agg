export * from "./constants";
import { NetworkType } from "./constants";


export * from "./0g"
export * from "./base"
export * from "./IRoute"
export * from "./UniswapV3Calculator"
export * from "./BaseV2Calculator"
export * from "./v2Route"
export * from "./type"
export * from "./utils"
export * from "./AllContructor"

import { AllRoute0G, DEX_IDS_0G, dexIdList0G, DexIdTypes0G, OgChain } from "./0g"
import { AllRouteBase, dexIdListBase, DEX_IDS_BASE, DexIdTypesBase, BaseChain } from "./base"


const SUPPORTED_NETWORKS: Record<string, NetworkType> = {
    "0G": "0G",
    BASE: "BASE",
};

export const normalizeNetworkType = (chainName?: string | null): NetworkType => {
    const normalized = (chainName ?? "").trim().toUpperCase();
    const match = SUPPORTED_NETWORKS[normalized];
    if (!match) {
        throw new Error(`Unsupported chain: ${chainName}`);
    }
    return match;
};

export const getChainAllRoute = (chainName: NetworkType) => {
    switch (normalizeNetworkType(chainName)) {
        case "0G":
            return AllRoute0G
        case "BASE":
            return AllRouteBase
        default:
            throw new Error(`Unsupported chain: ${chainName}`);
    }
}

export const getChainDexIdList = (chainName: NetworkType) => {
    switch (normalizeNetworkType(chainName)) {
        case "0G":
            return dexIdList0G
        case "BASE":
            return dexIdListBase
        default:
            throw new Error(`Unsupported chain: ${chainName}`);
    }
}

//get DEX_IDS type based on chain name


export const getChainDexIds = (chainName: NetworkType) => {
    switch (normalizeNetworkType(chainName)) {
        case "0G":
            return DEX_IDS_0G;
        case "BASE":
            return DEX_IDS_BASE;
        default:
            throw new Error(`Unsupported chain: ${chainName}`);
    }
}

export const getChainFromName = (chainName: NetworkType) => {
    switch (normalizeNetworkType(chainName)) {
        case "0G":
            return OgChain;
        case "BASE":
            return BaseChain;
        default:
            throw new Error(`Unsupported chain: ${chainName}`);
    }
}

export type AllDexIdTypes = DexIdTypes0G | DexIdTypesBase;