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
// Fallback when GeckoTerminal is unavailable (it can block cloud/datacenter IPs via Cloudflare)
const DEXSCREENER = "https://api.dexscreener.com";
const DEXSCREENER_CHAIN: Partial<Record<NetworkType, string>> = { BASE: "base" };
const DEXSCREENER_BATCH_SIZE = 30;
const REQUEST_HEADERS = {
    accept: "application/json",
    "user-agent": "Mozilla/5.0 (compatible; DeserializeAggregator/1.0; +https://deserialize.xyz)",
};

/** Last outcome per upstream source, returned with responses for diagnostics */
const upstreamStatus: Record<string, string> = { geckoterminal: "not called yet", dexscreener: "not called yet" };
export const getUpstreamStatus = () => ({ ...upstreamStatus });

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
                headers: REQUEST_HEADERS,
                signal: controller.signal,
            });
            if (!res.ok) throw new Error(`GeckoTerminal HTTP ${res.status}`);
            const body = await res.json();
            upstreamStatus.geckoterminal = "ok";
            return body;
        } catch (error: any) {
            upstreamStatus.geckoterminal = error?.message ?? "failed";
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    });
    requestQueue = run.catch(() => undefined);
    return run;
};

/**
 * DexScreener batch lookup (up to 30 tokens). For each token, price comes from its most liquid
 * pair; volume and liquidity are summed over the pairs where it is the base token.
 */
const fetchDexScreenerMarkets = async (network: NetworkType, addresses: string[]): Promise<Map<string, TokenMarket>> => {
    const chain = DEXSCREENER_CHAIN[network];
    const out = new Map<string, TokenMarket>();
    if (!chain || addresses.length === 0) return out;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(`${DEXSCREENER}/tokens/v1/${chain}/${addresses.join(",")}`, {
            headers: REQUEST_HEADERS,
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`DexScreener HTTP ${res.status}`);
        const body: any = await res.json();
        const pairs: any[] = Array.isArray(body) ? body : Array.isArray(body?.pairs) ? body.pairs : [];
        upstreamStatus.dexscreener = "ok";
        const now = Date.now();
        for (const address of addresses) {
            const asBase = pairs.filter((p) => String(p?.baseToken?.address ?? "").toLowerCase() === address);
            const asQuote = pairs.filter((p) => String(p?.quoteToken?.address ?? "").toLowerCase() === address);
            const byLiquidity = (a: any, b: any) => (num(b?.liquidity?.usd) ?? 0) - (num(a?.liquidity?.usd) ?? 0);
            const best = [...asBase].sort(byLiquidity)[0];
            let priceUsd: number | null = null;
            let token: any = best?.baseToken;
            if (best) {
                priceUsd = num(best.priceUsd);
            } else {
                // Only seen as the quote token: quote price = base price in USD / base price in quote units
                const q = [...asQuote].sort(byLiquidity)[0];
                const baseUsd = num(q?.priceUsd);
                const baseInQuote = num(q?.priceNative);
                if (baseUsd !== null && baseInQuote) priceUsd = baseUsd / baseInQuote;
                token = q?.quoteToken;
            }
            if (!token || priceUsd === null) continue;
            const sum = (list: any[], pick: (p: any) => unknown) => {
                const values = list.map((p) => num(pick(p))).filter((v): v is number => v !== null);
                return values.length ? values.reduce((a, b) => a + b, 0) : null;
            };
            out.set(address, {
                address: checksum(address),
                symbol: typeof token.symbol === "string" ? token.symbol : null,
                name: typeof token.name === "string" ? token.name : null,
                decimals: null,
                logoURI: imageOrNull(best?.info?.imageUrl),
                priceUsd,
                priceChange24h: best ? num(best.priceChange?.h24) : null,
                volume24hUsd: sum(asBase.length ? asBase : asQuote, (p) => p?.volume?.h24),
                marketCapUsd: best ? num(best.marketCap) : null,
                fdvUsd: best ? num(best.fdv) : null,
                liquidityUsd: sum(asBase.length ? asBase : asQuote, (p) => p?.liquidity?.usd),
                updatedAt: now,
            });
        }
    } catch (error: any) {
        upstreamStatus.dexscreener = error?.message ?? "failed";
        console.warn(`  [MARKET:WARN] DexScreener batch of ${addresses.length} failed:`, error?.message);
    } finally {
        clearTimeout(timeout);
    }
    return out;
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
    const results = new Map<string, TokenMarket>();

    // 1. GeckoTerminal (richest data, but may refuse cloud IPs)
    let geckoFailed = false;
    try {
        const body = await geckoTerminal(`/networks/${slug}/tokens/multi/${addresses.join(",")}?include=top_pools`);
        const pools = new Map<string, any>(
            (Array.isArray(body?.included) ? body.included : []).filter((i: any) => i?.type === "pool").map((p: any) => [p.id, p])
        );
        for (const token of Array.isArray(body?.data) ? body.data : []) {
            const a = token?.attributes ?? {};
            const address = String(a.address ?? "").toLowerCase();
            if (!address) continue;
            const poolIds = (token.relationships?.top_pools?.data ?? []).map((p: any) => p.id);
            results.set(address, {
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
            });
        }
    } catch (error: any) {
        geckoFailed = true;
        console.warn(`  [MARKET:WARN] GeckoTerminal batch of ${addresses.length} failed:`, error?.message);
    }

    // 2. DexScreener for anything GeckoTerminal could not price (or everything, if it failed)
    const missing = addresses.filter((a) => results.get(a)?.priceUsd == null);
    let dexFailed = false;
    for (let i = 0; i < missing.length; i += DEXSCREENER_BATCH_SIZE) {
        const dex = await fetchDexScreenerMarkets(network, missing.slice(i, i + DEXSCREENER_BATCH_SIZE));
        if (upstreamStatus.dexscreener !== "ok") dexFailed = true;
        for (const [address, market] of dex) {
            const gecko = results.get(address);
            // Keep GeckoTerminal's metadata (decimals, logo) when it had the token but no price
            results.set(address, gecko ? { ...market, decimals: gecko.decimals, logoURI: gecko.logoURI ?? market.logoURI } : market);
        }
    }

    for (const address of addresses) {
        const key = `${network}:${address}`;
        const data = results.get(address);
        if (data) {
            marketCache.set(key, { data, at: now, ttl: MARKET_TTL_MS });
        } else if (dexFailed) {
            // The fallback failed too: keep serving stale data if we have it, and retry in a minute
            const stale = marketCache.get(key);
            marketCache.set(key, stale ? { ...stale, at: now, ttl: FAILURE_RETRY_MS } : { data: null, at: now, ttl: FAILURE_RETRY_MS });
        } else {
            // A source answered and nobody knows the token (or it has no price): remember that for the full TTL
            marketCache.set(key, { data: null, at: now, ttl: geckoFailed ? FAILURE_RETRY_MS : MARKET_TTL_MS });
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

/**
 * Trending tokens on the network (base tokens of GeckoTerminal's trending pools), cached 5 minutes.
 * If GeckoTerminal is unavailable, falls back to `fallbackAddresses` (e.g. curated + routable
 * tokens) ranked by 24h volume, using the market data path (which itself falls back to DexScreener).
 */
export const getTrendingTokens = async (
    network: NetworkType,
    fallbackAddresses?: () => Promise<string[]>
): Promise<TrendingToken[]> => {
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
            if (tokens.length === 0) throw new Error("GeckoTerminal returned no trending pools");
            trendingCache.set(network, { data: tokens, at: now, ttl: MARKET_TTL_MS });
            return tokens;
        } catch (error: any) {
            console.warn(`  [MARKET:WARN] GeckoTerminal trending failed:`, error?.message);
            const stale = trendingCache.get(network);
            if (stale && stale.data.length > 0) {
                trendingCache.set(network, { ...stale, at: now, ttl: FAILURE_RETRY_MS });
                return stale.data;
            }
            // Fallback: top tokens by 24h volume among the given candidates
            let tokens: TrendingToken[] = [];
            if (fallbackAddresses) {
                try {
                    const markets = await getTokenMarkets(network, await fallbackAddresses());
                    tokens = Object.values(markets)
                        .filter((m): m is TokenMarket => !!m && m.priceUsd !== null)
                        .sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0))
                        .slice(0, 20)
                        .map((m) => ({ ...m, poolName: "", dex: null }));
                } catch (fallbackError: any) {
                    console.warn(`  [MARKET:WARN] Trending fallback failed:`, fallbackError?.message);
                }
            }
            trendingCache.set(network, { data: tokens, at: now, ttl: FAILURE_RETRY_MS });
            return tokens;
        }
    })();
    trendingInFlight.set(network, run);
    try {
        return await run;
    } finally {
        trendingInFlight.delete(network);
    }
};
