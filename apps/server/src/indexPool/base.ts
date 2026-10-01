import "dotenv/config";
import { DexCache } from "@deserialize-evm-agg/cache";
import { wait, ZeroGRoute, getChainAllRoute, ZiaRoute, getChainDexIds, getChainDexIdList, PancakeV3Route, AerodromeV3Route, UniswapV3BaseRoute, } from "@deserialize-evm-agg/routes-providers";
import { config } from "../config";
import { JsonRpcProvider } from "ethers";
import { createClient, RedisClientType } from "redis";
import { checkIfGraphIsEmpty, Edge, EdgeData, Graph } from "@deserialize-evm-agg/graph";
import { AllRoute, BaseChain } from "@deserialize-evm-agg/routes-providers";



(BigInt.prototype as any).toJSON = function () {
    const int = Number.parseInt(this.toString());
    return int ?? this.toString();
};

let cache: DexCache<any> | undefined = undefined

const initAndGetCache = async <T>(): Promise<DexCache<T>> => {
    if (cache) {
        return cache
    }
    const redisClient = createClient({
        url: config.REDIS_URL
    })

    await redisClient.connect()


    const newCache = new DexCache({
        storageDestination: "REDIS",
        redisClient: redisClient as any as RedisClientType

    })
    cache = newCache
    return cache

}

/**
 * COMPREHENSIVE UPDATE STRATEGY
 * 
 * This handles three types of updates:
 * 1. NEW POOLS: Add new pools discovered since last update
 * 2. EDGE REFRESH: Update existing pool state (liquidity, prices, etc.)
 * 3. HYBRID: Combine both for optimal performance
 */

// Configuration
const UPDATE_CONFIG = {
    // How often to check for new pools (minutes)
    NEW_POOLS_INTERVAL: 3000,

    // How often to refresh existing edge data (minutes)
    EDGE_REFRESH_INTERVAL: 2000,

    // Full rebuild interval as safety fallback (minutes)
    FULL_REBUILD_INTERVAL: 90000,

    // Batch size for edge refreshes
    REFRESH_BATCH_SIZE: 1000,
};

let lastNewPoolsUpdate = 0;
let lastEdgeRefresh = 0;
let lastFullRebuild = 0;

/**
 * Smart update that decides what needs to be done
 */
const updateCacheDataSmart = async (rpc: string) => {
    const provider = new JsonRpcProvider(rpc, BaseChain.chainId, {
        staticNetwork: true,
        batchMaxCount: 1,
    });
    provider._getConnection().timeout = 10_000;
    const cache = await initAndGetCache();
    const AllRoute = getChainAllRoute("BASE");
    const allRoute = new AllRoute(provider, cache);

    const now = Date.now();
    const shouldCheckNewPools = (now - lastNewPoolsUpdate) >= UPDATE_CONFIG.NEW_POOLS_INTERVAL * 60 * 1000;
    const shouldRefreshEdges = (now - lastEdgeRefresh) >= UPDATE_CONFIG.EDGE_REFRESH_INTERVAL * 60 * 1000;
    const shouldFullRebuild = (now - lastFullRebuild) >= UPDATE_CONFIG.FULL_REBUILD_INTERVAL * 60 * 1000;

    console.log("=== Smart Cache Update ===");
    console.log(`Check new pools: ${shouldCheckNewPools}`);
    console.log(`Refresh edges: ${shouldRefreshEdges}`);
    console.log(`Full rebuild: ${shouldFullRebuild}`);

    try {
        if (shouldFullRebuild) {
            // Safety fallback: complete rebuild
            await fullRebuildCache(allRoute, provider, cache);
            lastFullRebuild = now;
            lastNewPoolsUpdate = now;
            lastEdgeRefresh = now;
            return;
        }

        // Strategy: Do new pools first, then refresh edges
        let hasNewPools = false;

        if (shouldCheckNewPools) {
            hasNewPools = await addNewPoolsToCache(allRoute, provider, cache);
            lastNewPoolsUpdate = now;
        }

        if (shouldRefreshEdges) {
            await refreshExistingEdges(allRoute, provider, cache);
            lastEdgeRefresh = now;
        }

        // If we only did one operation, log it
        if (!shouldCheckNewPools && !shouldRefreshEdges) {
            console.log("No updates needed at this time");
        }

    } catch (error) {
        console.error("Error in smart cache update:", error);
        throw error;
    }
};

/**
 * Add only new pools to the cache (incremental)
 */
const addNewPoolsToCache = async (
    allRoute: AllRoute<any>,
    provider: JsonRpcProvider,
    cache: DexCache<any>
): Promise<boolean> => {
    console.log("\n--- Adding New Pools ---");
    let hasNewPools = false;

    // Update individual routes
    await Promise.all(allRoute.routeProviders.map(async (RouteProviderClass) => {
        const route = new RouteProviderClass(provider, cache);

        try {
            const existingTokenBiMap = await cache.getDexTokenIndexBiMapCache(
                route.name,
                route.formatPool
            );
            const existingGraph = await cache.getDexGraphCache(route.name);

            // Get ONLY new pools
            const newPoolData = await route.getNewTokenBiMap(provider);

            if (!newPoolData.data || newPoolData.data.length === 0) {
                console.log(`No new pools for ${route.name}`);
                return;
            }

            hasNewPools = true;
            console.log(`Found ${newPoolData.data.length} new pools for ${route.name}`);

            // Merge token BiMaps
            const mergedTokenBiMap = existingTokenBiMap
                ? route.mergeTokenBiMaps(existingTokenBiMap, newPoolData)
                : newPoolData;

            // Build edges for new pools only
            const newEdgesGraph = await route.buildGraphFromPools(
                newPoolData.data,
                mergedTokenBiMap.tokenBiMap,
                provider
            );

            // Merge with existing graph
            const updatedGraph = existingGraph
                ? route.mergeGraphs(existingGraph, newEdgesGraph, mergedTokenBiMap.tokenBiMap)
                : newEdgesGraph;

            if (!checkIfGraphIsEmpty(updatedGraph)) {
                await cache.setDexTokenIndexBiMapCache(route.name, {
                    tokenBiMap: mergedTokenBiMap.tokenBiMap,
                    data: existingTokenBiMap
                        ? [...existingTokenBiMap.data, ...newPoolData.data] // Accumulate all pools
                        : newPoolData.data,
                    tokenPoolMap: newPoolData.tokenPoolMap
                });
                await cache.setDexGraphCache(route.name, updatedGraph);
                console.log(`✓ Added ${newPoolData.data.length} new pools to ${route.name}`);
            }
        } catch (error) {
            console.error(`Error adding new pools for ${route.name}:`, error);
        }
    }));

    // Update aggregated route if we have new pools
    if (hasNewPools) {
        try {
            const existingAllTokenBiMap = await cache.getDexTokenIndexBiMapCache(
                allRoute.name,
                allRoute.formatPool
            );
            const existingAllGraph = await cache.getDexGraphCache(allRoute.name);

            const allNewPoolData = await allRoute.getNewTokenBiMapIncremental<any>(provider);

            const mergedAllTokenBiMap = existingAllTokenBiMap
                ? allRoute.mergeTokenBiMaps(existingAllTokenBiMap, allNewPoolData)
                : allNewPoolData;

            const newAggregatedEdges = await allRoute.buildGraphFromPools(
                allNewPoolData.data,
                mergedAllTokenBiMap.tokenBiMap,
                provider
            );

            const updatedAllGraph = existingAllGraph
                ? allRoute.mergeGraphs(existingAllGraph, newAggregatedEdges, mergedAllTokenBiMap.tokenBiMap)
                : newAggregatedEdges;

            if (!checkIfGraphIsEmpty(updatedAllGraph)) {
                await cache.setDexTokenIndexBiMapCache(allRoute.name, {
                    tokenBiMap: mergedAllTokenBiMap.tokenBiMap,
                    data: Array.from(allNewPoolData.data.entries()) as any,
                    tokenPoolMap: allNewPoolData.tokenPoolMap
                });
                await cache.setDexGraphCache(allRoute.name, updatedAllGraph);
                console.log("✓ Updated aggregated route with new pools");
            }
        } catch (error) {
            console.error("Error updating aggregated route:", error);
        }
    }

    return hasNewPools;
};

/**
 * Refresh existing edges with current pool state
 */
const refreshExistingEdges = async (
    allRoute: AllRoute<any>,
    provider: JsonRpcProvider,
    cache: DexCache<any>
): Promise<void> => {
    console.log("\n--- Refreshing Edge Data ---");

    // Refresh individual routes
    await Promise.all(allRoute.routeProviders.map(async (RouteProviderClass) => {
        const route = new RouteProviderClass(provider, cache);

        try {
            const existingGraph = await cache.getDexGraphCache(route.name);
            const existingTokenBiMap = await cache.getDexTokenIndexBiMapCache(
                route.name,
                route.formatPool
            );

            if (!existingGraph || !existingTokenBiMap) {
                console.log(`No existing data to refresh for ${route.name}`);
                return;
            }

            // Get current state of all existing pools
            const existingPools = await route.getAllExistingPoolData(provider);

            if (existingPools.length === 0) {
                console.log(`No pools to refresh for ${route.name}`);
                return;
            }

            console.log(`Refreshing ${existingPools.length} pools for ${route.name}`);

            // Refresh edge data
            const refreshedGraph = await route.refreshGraphEdges(
                existingGraph,
                existingTokenBiMap.tokenBiMap,
                existingPools,
                provider
            );

            await cache.setDexGraphCache(route.name, refreshedGraph);
            console.log(`✓ Refreshed ${existingPools.length} pools for ${route.name}`);
        } catch (error) {
            console.error(`Error refreshing edges for ${route.name}:`, error);
        }
    }));

    // Refresh aggregated route
    try {
        const existingAllGraph = await cache.getDexGraphCache(allRoute.name);
        const existingAllTokenBiMap = await cache.getDexTokenIndexBiMapCache(
            allRoute.name,
            allRoute.formatPool
        );

        if (!existingAllGraph || !existingAllTokenBiMap) {
            console.log("No aggregated data to refresh");
            return;
        }

        console.log("Refreshing aggregated graph edges");

        const refreshedAllGraph = await allRoute.refreshGraphEdges(
            existingAllGraph,
            existingAllTokenBiMap.tokenBiMap,
            provider
        );

        await cache.setDexGraphCache(allRoute.name, refreshedAllGraph);
        console.log("✓ Refreshed aggregated graph");
    } catch (error) {
        console.error("Error refreshing aggregated edges:", error);
    }
};

/**
 * Full rebuild of the cache (safety fallback)
 */
const fullRebuildCache = async (
    allRoute: AllRoute<any>,
    provider: JsonRpcProvider,
    cache: DexCache<any>
): Promise<void> => {
    console.log("\n--- Full Cache Rebuild ---");

    try {
        // Clear existing caches
        for (const RouteProviderClass of allRoute.routeProviders) {
            const route = new RouteProviderClass(provider, cache);
            const config = route.getDexConfig()
            await cache.setLastBlockFetched(route.name, Number(config.fromBlock || 0)); // Reset block tracking
        }

        // Rebuild from scratch
        const allUpdatedTokenBiMap = await allRoute.getNewTokenBiMap<any>(provider);
        const allUpdatedGraph = await allRoute.getNewGraph(
            allUpdatedTokenBiMap,
            provider
        );

        if (!checkIfGraphIsEmpty(allUpdatedGraph)) {
            await cache.setDexTokenIndexBiMapCache(allRoute.name, allUpdatedTokenBiMap as any);
            await cache.setDexGraphCache(allRoute.name, allUpdatedGraph);
            console.log("✓ Full rebuild complete");
        }
    } catch (error) {
        console.error("Error in full rebuild:", error);
        throw error;
    }
};

// ========== Execution Setup ==========

const chain = {
    name: "BASE",
    rpc: process.env.BASE_RPC_URL || "https://mainnet.base.org"
};

let isUpdating = false;
let intervalId: NodeJS.Timeout | null = null;

const safeUpdateCacheData = async (rpc: string) => {
    if (isUpdating) {
        console.log("Update already in progress, skipping...");
        return;
    }

    isUpdating = true;
    try {
        await updateCacheDataSmart(rpc);
    } catch (error) {
        console.error("Error during cache update:", error);
    } finally {
        isUpdating = false;
    }
};

// Initial update
console.log("Running initial cache update...");
safeUpdateCacheData(chain.rpc).catch(console.error);

// Use the most frequent interval (checks will decide what to do)
const CHECK_INTERVAL = Math.min(
    UPDATE_CONFIG.NEW_POOLS_INTERVAL,
    UPDATE_CONFIG.EDGE_REFRESH_INTERVAL
);

intervalId = setInterval(async () => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Cache Update Check - ${new Date().toISOString()}`);
    console.log('='.repeat(60));
    await safeUpdateCacheData(chain.rpc);
}, CHECK_INTERVAL * 60 * 1000);

export const stopCacheUpdates = () => {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        console.log("Cache update interval stopped");
    }
};

process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    stopCacheUpdates();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\nShutting down gracefully...');
    stopCacheUpdates();
    process.exit(0);
});