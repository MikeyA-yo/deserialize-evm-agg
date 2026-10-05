import { DexCache } from "@deserialize-evm-agg/cache";
import { DeserializeRoutePlan, IRoute, AllDexIdTypes } from "@deserialize-evm-agg/routes-providers";
import { JsonRpcProvider } from "ethers";
import { NetworkType } from "@deserialize-evm-agg/routes-providers";
import Decimal from "decimal.js";
export interface RouteOptions {
    targetRouteNumber: number;
}
export interface SimulatedRoute {
    routes: DeserializeRoutePlan<AllDexIdTypes>[];
    amountOut: Decimal;
    hopAmountsOut: Decimal[];
    pools: string[];
}
export declare const initAndGetCache: () => Promise<DexCache<AllDexIdTypes>>;
export declare const getBestRoutes: (network: NetworkType, fromTokenString: string, toTokenString: string, amount: number, _provider: JsonRpcProvider, options?: RouteOptions) => Promise<{
    routes: DeserializeRoutePlan<AllDexIdTypes>[];
    RouteJsonRpcProvider: IRoute<any, AllDexIdTypes>;
    bestOutcome: number;
    simulated?: SimulatedRoute;
}>;
export declare const getRoutePlanFromTokenStringPath: (tokenStringPath: string[][]) => Promise<DeserializeRoutePlan<AllDexIdTypes>[]>;
