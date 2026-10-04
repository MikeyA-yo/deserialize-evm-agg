"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getChainFromName = exports.getChainDexIds = exports.getChainDexIdList = exports.getChainAllRoute = exports.normalizeNetworkType = void 0;
__exportStar(require("./constants"), exports);
__exportStar(require("./0g"), exports);
__exportStar(require("./base"), exports);
__exportStar(require("./IRoute"), exports);
__exportStar(require("./UniswapV3Calculator"), exports);
__exportStar(require("./BaseV2Calculator"), exports);
__exportStar(require("./v2Route"), exports);
__exportStar(require("./BaseV4Calculator"), exports);
__exportStar(require("./v4Route"), exports);
__exportStar(require("./Aerodromev2Calculator"), exports);
__exportStar(require("./AerodromeV2Route"), exports);
__exportStar(require("./type"), exports);
__exportStar(require("./utils"), exports);
__exportStar(require("./AllContructor"), exports);
const _0g_1 = require("./0g");
const base_1 = require("./base");
const SUPPORTED_NETWORKS = {
    "0G": "0G",
    BASE: "BASE",
};
const normalizeNetworkType = (chainName) => {
    const normalized = (chainName ?? "").trim().toUpperCase();
    const match = SUPPORTED_NETWORKS[normalized];
    if (!match) {
        throw new Error(`Unsupported chain: ${chainName}`);
    }
    return match;
};
exports.normalizeNetworkType = normalizeNetworkType;
const getChainAllRoute = (chainName) => {
    switch ((0, exports.normalizeNetworkType)(chainName)) {
        case "0G":
            return _0g_1.AllRoute0G;
        case "BASE":
            return base_1.AllRouteBase;
        default:
            throw new Error(`Unsupported chain: ${chainName}`);
    }
};
exports.getChainAllRoute = getChainAllRoute;
const getChainDexIdList = (chainName) => {
    switch ((0, exports.normalizeNetworkType)(chainName)) {
        case "0G":
            return _0g_1.dexIdList0G;
        case "BASE":
            return base_1.dexIdListBase;
        default:
            throw new Error(`Unsupported chain: ${chainName}`);
    }
};
exports.getChainDexIdList = getChainDexIdList;
//get DEX_IDS type based on chain name
const getChainDexIds = (chainName) => {
    switch ((0, exports.normalizeNetworkType)(chainName)) {
        case "0G":
            return _0g_1.DEX_IDS_0G;
        case "BASE":
            return base_1.DEX_IDS_BASE;
        default:
            throw new Error(`Unsupported chain: ${chainName}`);
    }
};
exports.getChainDexIds = getChainDexIds;
const getChainFromName = (chainName) => {
    switch ((0, exports.normalizeNetworkType)(chainName)) {
        case "0G":
            return _0g_1.OgChain;
        case "BASE":
            return base_1.BaseChain;
        default:
            throw new Error(`Unsupported chain: ${chainName}`);
    }
};
exports.getChainFromName = getChainFromName;
