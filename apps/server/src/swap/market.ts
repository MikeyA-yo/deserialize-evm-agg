import { getAddress } from "ethers";
import { NetworkType } from "@deserialize-evm-agg/routes-providers";

/**
 * Token market data (price, 24h change, volume, market cap, liquidity) from GeckoTerminal,
 * CoinGecko's free on-chain API. Everything is cached in memory for MARKET_TTL_MS so the
 * explore page and every visitor share a small number of upstream calls (the free tier allows
 * about 30 requests a minute).
 */

const GECKOTERMINAL = "https://api.geckoterminal.com/api/v2";
const NETWORK_SLUG: Partial<Record<NetworkType, string>> = { BASE: "base" };

export const MARKET_TTL_MS = 5 * 60 * 1000; // refresh cached market data after 5 minutes
const FAILURE_RETRY_MS = 60 * 1000; // a failed fetch is retried after 1 minute, not 5
const MULTI_BATCH_SIZE = 30; // GeckoTerminal tokens/multi limit
const MIN_REQUEST_GAP_MS = 2_100; // keeps us under ~30 requests/minute
const REQUEST_TIMEOUT_MS = 10_000;
export const MAX_ADDRESSES_PER_REQUEST = 100;

export interface TokenMarket {
    address: string;
    symbol: string | null;
    name: string | null;
    decimals: number | null;
    logoURI: string | null;
    priceUsd: number | null;
    /** 24h price change in percent, from the token's top pool (null when unavailable) */
    priceChange24h: number | null;
    volume24hUsd: number | null;
    marketCapUsd: number | null;
    fdvUsd: number | null;
    liquidityUsd: number | null;
    /** When this data was fetched from GeckoTerminal (ms epoch) */
    updatedAt: number;
}

export interface TrendingToken extends TokenMarket {
    poolName: string;
    dex: string | null;
}

type CacheEntry<T> = { data: T; at: number; ttl: number };

const marketCache = new Map<string, CacheEntry<TokenMarket | null>>(); // `${network}:${address}`
const marketInFlight = new Map<string, Promise<void>>();
const trendingCache = new Map<string, CacheEntry<TrendingToken[]>>();
const trendingInFlight = new Map<string, Promise<TrendingToken[]>>();

const isFresh = (entry: CacheEntry<unknown> | undefined) => !!entry && Date.now() - entry.at < entry.ttl;

const num = (value: unknown): number | null => {
    if (value === null || value === undefined || value === "") return null;
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : null;
};

const checksum = (address: string): string => {
    try {
        return getAddress(address);
    } catch {
        return address;
    }
};

const imageOrNull = (url: unknown): string | null =>
    typeof url === "string" && url.startsWith("http") && !url.includes("missing") ? url : null;

// One GeckoTerminal request at a time, spaced out, shared by every caller in this process
let requestQueue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

const geckoTerminal = (path: string): Promise<any> => {
    const run = requestQueue.then(async () => {
        const wait = lastRequestAt + MIN_REQUEST_GAP_MS - Date.now();
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        lastRequestAt = Date.now();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const res = await fetch(`${GECKOTERMINAL}${path}`, {
                headers: { accept: "application/json" },
                signal: controller.signal,
            });
            if (!res.ok) throw new Error(`GeckoTerminal HTTP ${res.status}`);
            return await res.json();
        } finally {
            clearTimeout(timeout);
        }
    });
    requestQueue = run.catch(() => undefined);
    return run;
};

/** 24h change of the token's first top pool in which it is the base token */
const priceChangeFromPools = (tokenId: string, poolIds: string[], pools: Map<string, any>): number | null => {
    for (const id of poolIds) {
        const pool = pools.get(id);
        if (pool?.relationships?.base_token?.data?.id === tokenId) {
            return num(pool.attributes?.price_change_percentage?.h24);
        }
    }
    return null;
};

const fetchMarketBatch = async (network: NetworkType, slug: string, addresses: string[]) => {
    const now = Date.now();
    try {
        const body = await geckoTerminal(`/networks/${slug}/tokens/multi/${addresses.join(",")}?include=top_pools`);
        const pools = new Map<string, any>(
            (Array.isArray(body?.included) ? body.included : []).filter((i: any) => i?.type === "pool").map((p: any) => [p.id, p])
        );
        const found = new Set<string>();
        for (const token of Array.isArray(body?.data) ? body.data : []) {
            const a = token?.attributes ?? {};
            const address = String(a.address ?? "").toLowerCase();
            if (!address) continue;
            found.add(address);
            const poolIds = (token.relationships?.top_pools?.data ?? []).map((p: any) => p.id);
            marketCache.set(`${network}:${address}`, {
                ttl: MARKET_TTL_MS,
                at: now,
                data: {
                    address: checksum(address),
                    symbol: typeof a.symbol === "string" ? a.symbol : null,
                    name: typeof a.name === "string" ? a.name : null,
                    decimals: num(a.decimals),
                    logoURI: imageOrNull(a.image_url),
                    priceUsd: num(a.price_usd),
                    priceChange24h: priceChangeFromPools(token.id, poolIds, pools),
                    volume24hUsd: num(a.volume_usd?.h24),
                    marketCapUsd: num(a.market_cap_usd),
                    fdvUsd: num(a.fdv_usd),
                    liquidityUsd: num(a.total_reserve_in_usd),
                    updatedAt: now,
                },
            });
        }
        // Tokens GeckoTerminal does not know: cache "no data" too, so they are not refetched every call
        for (const address of addresses) {
            if (!found.has(address)) marketCache.set(`${network}:${address}`, { data: null, at: now, ttl: MARKET_TTL_MS });
        }
    } catch (error: any) {
        console.warn(`  [MARKET:WARN] GeckoTerminal batch of ${addresses.length} failed:`, error?.message);
        // Keep serving stale data if we have it; otherwise remember the failure briefly
        for (const address of addresses) {
            const key = `${network}:${address}`;
            const stale = marketCache.get(key);
            marketCache.set(key, stale
                ? { ...stale, at: now, ttl: FAILURE_RETRY_MS }
                : { data: null, at: now, ttl: FAILURE_RETRY_MS });
        }
    }
};

/**
 * Market data for up to MAX_ADDRESSES_PER_REQUEST addresses. Cached entries younger than
 * 5 minutes are returned as-is; only missing or expired ones are fetched (30 per upstream call).
 * Concurrent requests for the same address share one upstream fetch.
 */
export const getTokenMarkets = async (
    network: NetworkType,
    addresses: string[]
): Promise<Record<string, TokenMarket | null>> => {
    const slug = NETWORK_SLUG[network];
    const wanted = [...new Set(addresses.map((a) => a.trim().toLowerCase()).filter((a) => /^0x[0-9a-f]{40}$/.test(a)))]
        .slice(0, MAX_ADDRESSES_PER_REQUEST);
    const result: Record<string, TokenMarket | null> = {};
    if (!slug || wanted.length === 0) {
        wanted.forEach((a) => (result[a] = null));
        return result;
    }

    const toFetch = wanted.filter((a) => !isFresh(marketCache.get(`${network}:${a}`)) && !marketInFlight.has(`${network}:${a}`));
    for (let i = 0; i < toFetch.length; i += MULTI_BATCH_SIZE) {
        const batch = toFetch.slice(i, i + MULTI_BATCH_SIZE);
        const run = fetchMarketBatch(network, slug, batch);
        for (const a of batch) marketInFlight.set(`${network}:${a}`, run);
        void run.finally(() => batch.forEach((a) => {
            if (marketInFlight.get(`${network}:${a}`) === run) marketInFlight.delete(`${network}:${a}`);
        }));
    }

    await Promise.all(wanted.map((a) => marketInFlight.get(`${network}:${a}`)).filter(Boolean));
    for (const a of wanted) result[a] = marketCache.get(`${network}:${a}`)?.data ?? null;
    return result;
};

/** Trending tokens on the network (base tokens of GeckoTerminal's trending pools), cached 5 minutes */
export const getTrendingTokens = async (network: NetworkType): Promise<TrendingToken[]> => {
    const slug = NETWORK_SLUG[network];
    if (!slug) return [];
    const cached = trendingCache.get(network);
    if (cached && isFresh(cached)) return cached.data;
    const pending = trendingInFlight.get(network);
    if (pending) return pending;

    const run = (async () => {
        const now = Date.now();
        try {
            const body = await geckoTerminal(`/networks/${slug}/trending_pools?include=base_token,dex`);
            const included = new Map<string, any>((Array.isArray(body?.included) ? body.included : []).map((i: any) => [i.id, i]));
            const seen = new Set<string>();
            const tokens: TrendingToken[] = [];
            for (const pool of Array.isArray(body?.data) ? body.data : []) {
                const tokenId = pool?.relationships?.base_token?.data?.id;
                const token = included.get(tokenId);
                const t = token?.attributes ?? {};
                const address = String(t.address ?? "").toLowerCase();
                if (!address || seen.has(address)) continue;
                seen.add(address);
                const p = pool.attributes ?? {};
                const dexId = pool?.relationships?.dex?.data?.id;
                tokens.push({
                    address: checksum(address),
                    symbol: typeof t.symbol === "string" ? t.symbol : null,
                    name: typeof t.name === "string" ? t.name : null,
                    decimals: num(t.decimals),
                    logoURI: imageOrNull(t.image_url),
                    priceUsd: num(p.base_token_price_usd),
                    priceChange24h: num(p.price_change_percentage?.h24),
                    volume24hUsd: num(p.volume_usd?.h24),
                    marketCapUsd: num(p.market_cap_usd),
                    fdvUsd: num(p.fdv_usd),
                    liquidityUsd: num(p.reserve_in_usd),
                    updatedAt: now,
                    poolName: typeof p.name === "string" ? p.name : "",
                    dex: included.get(dexId)?.attributes?.name ?? null,
                });
            }
            trendingCache.set(network, { data: tokens, at: now, ttl: MARKET_TTL_MS });
            return tokens;
        } catch (error: any) {
            console.warn(`  [MARKET:WARN] GeckoTerminal trending failed:`, error?.message);
            const stale = trendingCache.get(network);
            trendingCache.set(network, { data: stale?.data ?? [], at: now, ttl: FAILURE_RETRY_MS });
            return stale?.data ?? [];
        }
    })();
    trendingInFlight.set(network, run);
    try {
        return await run;
    } finally {
        trendingInFlight.delete(network);
    }
};
