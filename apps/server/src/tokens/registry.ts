/**
 * On-chain token registry for Base.
 *
 * Tokens are discovered from the pools of the DEXes we route through, not from third-party token
 * lists: a token is listed when it has a pool against a hub token (WETH or USDC) holding at least
 * MIN_LIQUIDITY_USD. Name, symbol, decimals and total supply are read from the token contract.
 *
 * Discovery
 *  - V2-style factories (Uniswap V2, PancakeSwap V2, Aerodrome V2, Aerodrome Slipstream) expose
 *    allPairs(i)/allPools(i), so they are enumerated by index with Multicall3 batches over the main
 *    RPC (eth_call only; Alchemy's free tier allows that).
 *  - Uniswap V3 and PancakeSwap V3 factories keep no list, so their PoolCreated logs are scanned,
 *    filtered to hub pairs. Alchemy's free tier caps eth_getLogs at 10 blocks, so log scanning uses
 *    LOGS_RPC_URL (default https://base.drpc.org, 10k-block windows).
 *  - Uniswap V4 is skipped: its adapter only executes admin-registered pools.
 *
 * Everything is stored in Redis with per-source checkpoints, so the backfill (long: Uniswap V2 has
 * ~3M pairs) resumes after restarts, and later cycles (every 5 minutes) only process new pools.
 * Pools below the threshold are re-checked for 24h, because liquidity is often added after the
 * pool is created.
 */

import { Contract, FetchRequest, Interface, JsonRpcProvider, ethers } from "ethers";
import { createClient, RedisClientType } from "redis";
import { config } from "../config";

// ---------------------------------------------------------------- configuration

const NETWORK = "BASE";
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
export const WETH = "0x4200000000000000000000000000000000000006";
export const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const HUBS: Record<string, { decimals: number }> = { [WETH]: { decimals: 18 }, [USDC]: { decimals: 6 } };
const UNISWAP_V3_FACTORY = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD";

const MIN_LIQUIDITY_USD = Number(process.env.TOKEN_INDEX_MIN_LIQUIDITY_USD ?? 1000);
/** Hub side of a pool must hold at least half the minimum (pool value ≈ 2 × hub side) */
const MIN_HUB_SIDE_USD = MIN_LIQUIDITY_USD / 2;
const MULTICALL_CHUNK = 1000; // sub-calls per eth_call (~2s on Alchemy)
const ENUM_BATCH = 1000; // pools per enumeration step
const ENUM_CONCURRENCY = 4; // enumeration steps in flight at once
/** Pools created this close to the chain head are re-checked for 24h if below the threshold */
const PENDING_WINDOW_POOLS = 5_000; // enumerable factories: last N pools
const PENDING_WINDOW_BLOCKS = 43_200; // log sources: ~24h of Base blocks
const PENDING_WINDOW_POSITIONS = 20_000; // position managers: last N position ids
/** V3 discovery via PoolCreated logs needs an RPC with wide getLogs ranges (paid tier); default is position managers */
const V3_VIA_LOGS = process.env.TOKEN_INDEX_V3_LOGS === "on";
const LOGS_RPC_URL = process.env.LOGS_RPC_URL || "https://base.drpc.org";
const LOGS_MAX_RANGE = Number(process.env.LOGS_MAX_RANGE ?? 9_999);
const CYCLE_MS = 5 * 60 * 1000;
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_POOLS_PER_TOKEN = 5;
const LOCK_TTL_S = 15 * 60;
const RPC_TIMEOUT_MS = 30_000;
/** Comma-separated dexIds to skip, e.g. TOKEN_INDEX_SKIP=UNISWAP_V2_BASE */
const SKIP = new Set((process.env.TOKEN_INDEX_SKIP ?? "").split(",").map((s) => s.trim()).filter(Boolean));

type PoolKind = "v2" | "aeroVolatile" | "aeroStable" | "cl";

interface EnumSource { dexId: string; factory: string; lengthFn: string; itemFn: string; kind: "v2" | "aero" | "cl" }
interface LogSource { dexId: string; factory: string; startBlock: number }
interface NpmSource { dexId: string; npm: string; factory: string }

const ENUM_SOURCES: EnumSource[] = [
    { dexId: "PANCAKE_V2_BASE", factory: "0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E", lengthFn: "allPairsLength", itemFn: "allPairs", kind: "v2" },
    { dexId: "AERODROME_V2_BASE", factory: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da", lengthFn: "allPoolsLength", itemFn: "allPools", kind: "aero" },
    { dexId: "AERODROME_V3_BASE", factory: "0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A", lengthFn: "allPoolsLength", itemFn: "allPools", kind: "cl" },
    // Largest last: ~3M pairs, so the smaller DEXes are indexed first
    { dexId: "UNISWAP_V2_BASE", factory: "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6", lengthFn: "allPairsLength", itemFn: "allPairs", kind: "v2" },
];

const NPM_SOURCES: NpmSource[] = [
    { dexId: "UNISWAP_V3_BASE", npm: "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1", factory: UNISWAP_V3_FACTORY },
    { dexId: "PANCAKE_V3_BASE", npm: "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364", factory: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865" },
];

// Only used with TOKEN_INDEX_V3_LOGS=on
const LOG_SOURCES: LogSource[] = [
    { dexId: "UNISWAP_V3_BASE", factory: UNISWAP_V3_FACTORY, startBlock: 1_371_680 },
    { dexId: "PANCAKE_V3_BASE", factory: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865", startBlock: 2_912_007 },
];

// ---------------------------------------------------------------- types

export interface RegistryPool {
    pool: string;
    dexId: string;
    kind: PoolKind;
    hub: string;
    /** USD value of the hub side when last checked */
    hubSideUsd: number;
}

export interface RegistryToken {
    address: string; // lowercase
    symbol: string;
    name: string;
    decimals: number;
    totalSupply: string; // raw units
    pools: RegistryPool[]; // up to MAX_POOLS_PER_TOKEN, deepest first
    liquidityUsd: number; // ≈ 2 × sum of hub sides, at index time
    firstSeen: number;
    updatedAt: number;
}

interface PendingPool { pool: string; dexId: string; kind: PoolKind; token: string; hub: string; seenAt: number }

// ---------------------------------------------------------------- ABIs

const multicallIface = new Interface([
    "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)",
]);
const factoryIface = new Interface([
    "function allPairsLength() view returns (uint256)",
    "function allPairs(uint256) view returns (address)",
    "function allPoolsLength() view returns (uint256)",
    "function allPools(uint256) view returns (address)",
    "function getPool(address,address,uint24) view returns (address)",
]);
const poolIface = new Interface([
    "function token0() view returns (address)",
    "function token1() view returns (address)",
    "function stable() view returns (bool)",
    "function getAmountOut(uint256 amountIn, address tokenIn) view returns (uint256)",
]);
const npmIface = new Interface([
    "function totalSupply() view returns (uint256)",
    "function tokenByIndex(uint256) view returns (uint256)",
    "function positions(uint256) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
]);
const SLOT0_SELECTOR = "0x3850c7bd"; // slot0(): first returned word is sqrtPriceX96 on every V3/CL variant
const erc20Iface = new Interface([
    "function balanceOf(address) view returns (uint256)",
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
    "function totalSupply() view returns (uint256)",
]);
const bytes32Iface = new Interface(["function name() view returns (bytes32)", "function symbol() view returns (bytes32)"]);
const POOL_CREATED_V3 = ethers.id("PoolCreated(address,address,uint24,int24,address)");

// ---------------------------------------------------------------- helpers

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * ethers' default request timeout is 5 minutes. A 1,000-call multicall normally takes ~2s, so a hung
 * request is abandoned (and retried) after RPC_TIMEOUT_MS instead of stalling a whole batch.
 * (Setting provider._getConnection().timeout has no effect: it returns a copy.)
 */
export function providerWithTimeout(url: string): JsonRpcProvider {
    const request = new FetchRequest(url);
    request.timeout = RPC_TIMEOUT_MS;
    return new JsonRpcProvider(request, 8453, { staticNetwork: true, batchMaxCount: 1 });
}
const lower = (a: string) => a.toLowerCase();
const isHub = (a: string) => lower(a) in HUBS;

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 5): Promise<T> {
    let delay = 1_000;
    for (let i = 1; ; i += 1) {
        try {
            return await fn();
        } catch (error: any) {
            if (i >= attempts) throw error;
            console.warn(`  [TOKEN_INDEX] ${label} failed (attempt ${i}/${attempts}): ${String(error?.shortMessage || error?.message).slice(0, 120)}`);
            await sleep(delay);
            delay = Math.min(delay * 2, 30_000);
        }
    }
}

type Call = { target: string; data: string };

/** Batched eth_calls through Multicall3. Failed sub-calls return null. */
async function multicall(provider: JsonRpcProvider, calls: Call[]): Promise<(string | null)[]> {
    const out: (string | null)[] = [];
    for (let i = 0; i < calls.length; i += MULTICALL_CHUNK) {
        const chunk = calls.slice(i, i + MULTICALL_CHUNK);
        const data = multicallIface.encodeFunctionData("aggregate3", [chunk.map((c) => ({ target: c.target, allowFailure: true, callData: c.data }))]);
        const raw = await withRetry("multicall", () => provider.call({ to: MULTICALL3, data }));
        const [results] = multicallIface.decodeFunctionResult("aggregate3", raw);
        for (const r of results) out.push(r.success && r.returnData !== "0x" ? r.returnData : null);
    }
    return out;
}

const decode = <T>(iface: Interface, fn: string, data: string | null): T | null => {
    if (!data) return null;
    try {
        return iface.decodeFunctionResult(fn, data)[0] as T;
    } catch {
        return null;
    }
};

const decodeText = (fn: "name" | "symbol", data: string | null): string | null => {
    const s = decode<string>(erc20Iface, fn, data);
    if (typeof s === "string") return s.replace(/\0/g, "").trim();
    const b = decode<string>(bytes32Iface, fn, data); // old tokens return bytes32
    if (typeof b === "string") {
        try {
            return ethers.decodeBytes32String(b).trim();
        } catch {
            return null;
        }
    }
    return null;
};

const toUnits = (raw: bigint | null, decimals: number): number =>
    raw === null ? 0 : Number(ethers.formatUnits(raw, decimals));

// ---------------------------------------------------------------- redis storage

const KEY = {
    tokens: `tokenreg:${NETWORK}:tokens`,
    pending: `tokenreg:${NETWORK}:pending`,
    cursor: (dexId: string) => `tokenreg:${NETWORK}:cursor:${dexId}`,
    lock: `tokenreg:${NETWORK}:lock`,
    status: `tokenreg:${NETWORK}:status`,
};

let redis: RedisClientType | null = null;
async function getRedis(): Promise<RedisClientType> {
    if (redis) return redis;
    const client = createClient({ url: config.REDIS_URL }) as RedisClientType;
    client.on("error", (e) => console.warn("  [TOKEN_INDEX] redis error:", e?.message));
    await client.connect();
    redis = client;
    return client;
}

let registryMemo: { tokens: RegistryToken[]; at: number } | null = null;
const REGISTRY_MEMO_MS = 5 * 60 * 1000;

/** All registry tokens (memoized for 5 minutes) */
export async function getRegistryTokens(): Promise<RegistryToken[]> {
    if (registryMemo && Date.now() - registryMemo.at < REGISTRY_MEMO_MS) return registryMemo.tokens;
    const client = await getRedis();
    const all = await client.hGetAll(KEY.tokens);
    const tokens: RegistryToken[] = [];
    for (const value of Object.values(all)) {
        try {
            tokens.push(JSON.parse(value));
        } catch {
            // skip corrupt entry
        }
    }
    registryMemo = { tokens, at: Date.now() };
    return tokens;
}

export async function getRegistryToken(address: string): Promise<RegistryToken | null> {
    const client = await getRedis();
    const value = await client.hGet(KEY.tokens, lower(address));
    return value ? (JSON.parse(value) as RegistryToken) : null;
}

export async function getRegistryStatus(): Promise<Record<string, string>> {
    const client = await getRedis();
    return client.hGetAll(KEY.status);
}

// ---------------------------------------------------------------- hub prices

/** USD price of each hub token: USDC = 1, WETH from the Uniswap V3 WETH/USDC 0.05% pool */
export async function getHubPricesUsd(provider: JsonRpcProvider): Promise<Record<string, number>> {
    const factory = new Contract(UNISWAP_V3_FACTORY, factoryIface, provider);
    const pool: string = await withRetry("getPool WETH/USDC", () => factory.getPool(WETH, USDC, 500));
    const raw = await withRetry("slot0 WETH/USDC", () => provider.call({ to: pool, data: SLOT0_SELECTOR }));
    const sqrtPriceX96 = BigInt("0x" + raw.slice(2, 66));
    // token0 = WETH (0x42… < 0x83…), price = token1/token0 in raw units → USDC per WETH
    const ratio = Number(sqrtPriceX96) / 2 ** 96;
    const wethUsd = ratio * ratio * 10 ** (18 - 6);
    if (!Number.isFinite(wethUsd) || wethUsd <= 0) throw new Error("Invalid WETH price");
    return { [WETH]: wethUsd, [USDC]: 1 };
}

// ---------------------------------------------------------------- pool evaluation

interface Candidate { pool: string; dexId: string; kind: PoolKind; token0: string; token1: string }

/**
 * Checks each candidate's hub-side balance. Qualifying pools are added to the registry (both
 * sides, when both tokens are hubs); the rest go to the pending set for re-checking.
 */
async function evaluateCandidates(
    provider: JsonRpcProvider,
    client: RedisClientType,
    candidates: Candidate[],
    hubUsd: Record<string, number>,
    seenAt = Date.now(),
    /** Track below-threshold pools for re-checking. Off for historical backfill (dead pools). */
    trackPending = true
): Promise<{ qualified: number; pending: number }> {
    if (candidates.length === 0) return { qualified: 0, pending: 0 };
    // One balance check per (pool, hub side)
    const checks: { c: Candidate; hub: string; token: string }[] = [];
    for (const c of candidates) {
        if (isHub(c.token0)) checks.push({ c, hub: lower(c.token0), token: lower(c.token1) });
        if (isHub(c.token1)) checks.push({ c, hub: lower(c.token1), token: lower(c.token0) });
    }
    const balances = await multicall(provider, checks.map((k) => ({ target: k.hub, data: erc20Iface.encodeFunctionData("balanceOf", [k.c.pool]) })));

    const byToken = new Map<string, RegistryPool[]>();
    const pending: PendingPool[] = [];
    checks.forEach((k, i) => {
        const raw = decode<bigint>(erc20Iface, "balanceOf", balances[i]);
        const hubSideUsd = toUnits(raw, HUBS[k.hub].decimals) * (hubUsd[k.hub] ?? 0);
        if (hubSideUsd >= MIN_HUB_SIDE_USD) {
            const list = byToken.get(k.token) ?? [];
            list.push({ pool: lower(k.c.pool), dexId: k.c.dexId, kind: k.c.kind, hub: k.hub, hubSideUsd });
            byToken.set(k.token, list);
        } else if (trackPending) {
            pending.push({ pool: lower(k.c.pool), dexId: k.c.dexId, kind: k.c.kind, token: k.token, hub: k.hub, seenAt });
        }
    });

    if (pending.length > 0) {
        await client.hSet(KEY.pending, Object.fromEntries(pending.map((p) => [`${p.pool}:${p.token}`, JSON.stringify(p)])));
    }
    if (byToken.size > 0) await upsertTokens(provider, client, byToken);
    return { qualified: byToken.size, pending: pending.length };
}

/** Adds pools to tokens (reading metadata for tokens not yet in the registry) */
async function upsertTokens(provider: JsonRpcProvider, client: RedisClientType, poolsByToken: Map<string, RegistryPool[]>) {
    const addresses = [...poolsByToken.keys()];
    const existingRaw = await client.hmGet(KEY.tokens, addresses);
    const existing = new Map<string, RegistryToken>();
    existingRaw.forEach((v, i) => {
        if (v) existing.set(addresses[i], JSON.parse(v));
    });

    const fresh = addresses.filter((a) => !existing.has(a));
    const meta = new Map<string, { name: string; symbol: string; decimals: number; totalSupply: string }>();
    if (fresh.length > 0) {
        const calls: Call[] = [];
        for (const a of fresh) {
            calls.push({ target: a, data: erc20Iface.encodeFunctionData("name") });
            calls.push({ target: a, data: erc20Iface.encodeFunctionData("symbol") });
            calls.push({ target: a, data: erc20Iface.encodeFunctionData("decimals") });
            calls.push({ target: a, data: erc20Iface.encodeFunctionData("totalSupply") });
        }
        const results = await multicall(provider, calls);
        fresh.forEach((a, i) => {
            const symbol = decodeText("symbol", results[i * 4 + 1]);
            const decimals = decode<bigint>(erc20Iface, "decimals", results[i * 4 + 2]);
            if (!symbol || decimals === null || Number(decimals) > 36) return; // not a usable ERC-20
            const totalSupply = decode<bigint>(erc20Iface, "totalSupply", results[i * 4 + 3]);
            meta.set(a, {
                name: decodeText("name", results[i * 4]) || symbol,
                symbol: symbol.slice(0, 32),
                decimals: Number(decimals),
                totalSupply: (totalSupply ?? 0n).toString(),
            });
        });
    }

    const now = Date.now();
    const writes: Record<string, string> = {};
    for (const [address, newPools] of poolsByToken) {
        const base = existing.get(address);
        const m = meta.get(address);
        if (!base && !m) continue;
        const pools = new Map<string, RegistryPool>();
        for (const p of [...(base?.pools ?? []), ...newPools]) pools.set(p.pool, p);
        const top = [...pools.values()].sort((a, b) => b.hubSideUsd - a.hubSideUsd).slice(0, MAX_POOLS_PER_TOKEN);
        const token: RegistryToken = {
            address,
            symbol: base?.symbol ?? m!.symbol,
            name: base?.name ?? m!.name,
            decimals: base?.decimals ?? m!.decimals,
            totalSupply: base?.totalSupply ?? m!.totalSupply,
            pools: top,
            liquidityUsd: 2 * top.reduce((sum, p) => sum + p.hubSideUsd, 0),
            firstSeen: base?.firstSeen ?? now,
            updatedAt: now,
        };
        writes[address] = JSON.stringify(token);
    }
    if (Object.keys(writes).length > 0) {
        await client.hSet(KEY.tokens, writes);
        registryMemo = null;
    }
}

// ---------------------------------------------------------------- discovery: enumerable factories

async function indexEnumSource(provider: JsonRpcProvider, client: RedisClientType, source: EnumSource, hubUsd: Record<string, number>) {
    const factory = { target: source.factory };
    const [lenRaw] = await multicall(provider, [{ ...factory, data: factoryIface.encodeFunctionData(source.lengthFn) }]);
    const length = Number(decode<bigint>(factoryIface, source.lengthFn, lenRaw) ?? 0n);
    let cursor = Number((await client.get(KEY.cursor(source.dexId))) ?? 0);
    if (cursor >= length) return;
    console.log(`  [TOKEN_INDEX] ${source.dexId}: pools ${cursor.toLocaleString()} → ${length.toLocaleString()}`);

    /** Enumerates pools [start, end) and evaluates the hub-paired ones */
    const processRange = async (start: number, end: number): Promise<number> => {
        const indexes = Array.from({ length: end - start }, (_, i) => start + i);
        const poolResults = await multicall(provider, indexes.map((i) => ({ ...factory, data: factoryIface.encodeFunctionData(source.itemFn, [i]) })));
        const pools = poolResults.map((r) => decode<string>(factoryIface, source.itemFn, r)).filter((p): p is string => !!p);

        const tokenCalls: Call[] = [];
        for (const p of pools) {
            tokenCalls.push({ target: p, data: poolIface.encodeFunctionData("token0") });
            tokenCalls.push({ target: p, data: poolIface.encodeFunctionData("token1") });
            if (source.kind === "aero") tokenCalls.push({ target: p, data: poolIface.encodeFunctionData("stable") });
        }
        const per = source.kind === "aero" ? 3 : 2;
        const tokenResults = await multicall(provider, tokenCalls);
        const candidates: Candidate[] = [];
        pools.forEach((pool, i) => {
            const token0 = decode<string>(poolIface, "token0", tokenResults[i * per]);
            const token1 = decode<string>(poolIface, "token1", tokenResults[i * per + 1]);
            if (!token0 || !token1 || !(isHub(token0) || isHub(token1))) return;
            let kind: PoolKind = source.kind === "cl" ? "cl" : "v2";
            if (source.kind === "aero") kind = decode<boolean>(poolIface, "stable", tokenResults[i * per + 2]) ? "aeroStable" : "aeroVolatile";
            candidates.push({ pool, dexId: source.dexId, kind, token0, token1 });
        });
        // Only recently created pools are worth re-checking later; old empty ones are dead
        const recent = end > length - PENDING_WINDOW_POOLS;
        return (await evaluateCandidates(provider, client, candidates, hubUsd, Date.now(), recent)).qualified;
    };

    let qualifiedTotal = 0;
    let groups = 0;
    while (cursor < length) {
        // ENUM_CONCURRENCY consecutive ranges in parallel; the cursor only advances once all are done
        const ranges: [number, number][] = [];
        for (let start = cursor; ranges.length < ENUM_CONCURRENCY && start < length; start += ENUM_BATCH) {
            ranges.push([start, Math.min(start + ENUM_BATCH, length)]);
        }
        const counts = await Promise.all(ranges.map(([start, end]) => processRange(start, end)));
        qualifiedTotal += counts.reduce((a, b) => a + b, 0);
        cursor = ranges[ranges.length - 1][1];
        await client.set(KEY.cursor(source.dexId), String(cursor));
        await client.expire(KEY.lock, LOCK_TTL_S);
        groups += 1;
        if (groups % 10 === 0 || cursor === length) {
            console.log(`  [TOKEN_INDEX] ${source.dexId}: ${cursor.toLocaleString()}/${length.toLocaleString()} pools scanned, +${qualifiedTotal} token listings`);
            await client.hSet(KEY.status, source.dexId, `${cursor}/${length} pools scanned`);
        }
    }
}

// ---------------------------------------------------------------- discovery: V3 PoolCreated logs

async function getLogsWithSplit(logs: JsonRpcProvider, filter: { address: string; topics: (string | string[] | null)[] }, from: number, to: number): Promise<ethers.Log[]> {
    try {
        return await withRetry(`getLogs ${from}-${to}`, () => logs.getLogs({ ...filter, fromBlock: from, toBlock: to }), 4);
    } catch (error) {
        if (to - from < 100) throw error;
        const mid = Math.floor((from + to) / 2);
        return [...(await getLogsWithSplit(logs, filter, from, mid)), ...(await getLogsWithSplit(logs, filter, mid + 1, to))];
    }
}

async function indexLogSource(provider: JsonRpcProvider, logs: JsonRpcProvider, client: RedisClientType, source: LogSource, hubUsd: Record<string, number>) {
    const latest = await withRetry("blockNumber", () => logs.getBlockNumber());
    let from = Number((await client.get(KEY.cursor(source.dexId))) ?? source.startBlock);
    if (from > latest) return;
    console.log(`  [TOKEN_INDEX] ${source.dexId}: blocks ${from.toLocaleString()} → ${latest.toLocaleString()} (PoolCreated logs, ${LOGS_MAX_RANGE.toLocaleString()}-block windows)`);
    const hubTopics = Object.keys(HUBS).map((h) => ethers.zeroPadValue(h, 32));

    let qualifiedTotal = 0;
    let steps = 0;
    while (from <= latest) {
        const to = Math.min(from + LOGS_MAX_RANGE - 1, latest);
        const [asToken0, asToken1] = await Promise.all([
            getLogsWithSplit(logs, { address: source.factory, topics: [POOL_CREATED_V3, hubTopics, null] }, from, to),
            getLogsWithSplit(logs, { address: source.factory, topics: [POOL_CREATED_V3, null, hubTopics] }, from, to),
        ]);
        const seen = new Set<string>();
        const candidates: Candidate[] = [];
        for (const log of [...asToken0, ...asToken1]) {
            const pool = ethers.getAddress("0x" + log.data.slice(2 + 64 + 24, 2 + 128)); // data: (int24 tickSpacing, address pool)
            if (seen.has(pool)) continue;
            seen.add(pool);
            candidates.push({ pool, dexId: source.dexId, kind: "cl", token0: "0x" + log.topics[1].slice(26), token1: "0x" + log.topics[2].slice(26) });
        }
        const { qualified } = await evaluateCandidates(provider, client, candidates, hubUsd, Date.now(), to >= latest - PENDING_WINDOW_BLOCKS);
        qualifiedTotal += qualified;
        from = to + 1;
        await client.set(KEY.cursor(source.dexId), String(from));
        await client.expire(KEY.lock, LOCK_TTL_S);
        steps += 1;
        if (steps % 50 === 0 || from > latest) {
            console.log(`  [TOKEN_INDEX] ${source.dexId}: up to block ${to.toLocaleString()}, +${qualifiedTotal} token listings`);
            await client.hSet(KEY.status, source.dexId, `scanned to block ${to}`);
        }
    }
}

// ---------------------------------------------------------------- discovery: V3 position managers

/**
 * Uniswap/PancakeSwap V3 factories keep no pool list, and free RPCs can't serve their full log
 * history (Alchemy free: 10-block getLogs; dRPC free: ~100). Their NonfungiblePositionManagers,
 * however, are enumerable: positions(tokenId) returns token0, token1 and fee, so walking the
 * position ids finds every pool that has had liquidity. Pools are deduplicated in a Redis set and
 * each is evaluated once. Burned positions revert and are skipped.
 */
async function indexNpmSource(provider: JsonRpcProvider, client: RedisClientType, source: NpmSource, hubUsd: Record<string, number>) {
    const npm = { target: source.npm };
    const [supplyRaw] = await multicall(provider, [{ ...npm, data: npmIface.encodeFunctionData("totalSupply") }]);
    const supply = decode<bigint>(npmIface, "totalSupply", supplyRaw) ?? 0n;
    if (supply === 0n) return;
    const [lastRaw] = await multicall(provider, [{ ...npm, data: npmIface.encodeFunctionData("tokenByIndex", [supply - 1n]) }]);
    const length = Number(decode<bigint>(npmIface, "tokenByIndex", lastRaw) ?? 0n) + 1; // highest live id + 1
    const cursorKey = KEY.cursor(`${source.dexId}:npm`);
    const seenKey = `tokenreg:${NETWORK}:seenpools:${source.dexId}`;
    let cursor = Number((await client.get(cursorKey)) ?? 1);
    if (cursor >= length) return;
    console.log(`  [TOKEN_INDEX] ${source.dexId}: positions ${cursor.toLocaleString()} → ${length.toLocaleString()} (position manager)`);

    const processRange = async (start: number, end: number): Promise<number> => {
        const ids = Array.from({ length: end - start }, (_, i) => start + i);
        const results = await multicall(provider, ids.map((id) => ({ ...npm, data: npmIface.encodeFunctionData("positions", [id]) })));
        // Unique hub-paired (token0, token1, fee) combinations in this range
        const keys = new Map<string, { token0: string; token1: string; fee: bigint }>();
        for (const raw of results) {
            if (!raw) continue; // burned position
            try {
                const p = npmIface.decodeFunctionResult("positions", raw);
                const token0 = lower(p.token0), token1 = lower(p.token1);
                if (!(isHub(token0) || isHub(token1))) continue;
                keys.set(`${token0}:${token1}:${p.fee}`, { token0, token1, fee: p.fee });
            } catch {
                // undecodable: skip
            }
        }
        if (keys.size === 0) return 0;
        // Skip pools already evaluated
        const list = [...keys.keys()];
        // A hash (HMGET/HSET) rather than a set: SMISMEMBER needs Redis 6.2+
        const seen = await client.hmGet(seenKey, list);
        const fresh = list.filter((_, i) => !seen[i]);
        if (fresh.length === 0) return 0;
        await client.hSet(seenKey, Object.fromEntries(fresh.map((k) => [k, "1"])));
        const pools = await multicall(provider, fresh.map((k) => {
            const { token0, token1, fee } = keys.get(k)!;
            return { target: source.factory, data: factoryIface.encodeFunctionData("getPool", [token0, token1, fee]) };
        }));
        const candidates: Candidate[] = [];
        fresh.forEach((k, i) => {
            const pool = decode<string>(factoryIface, "getPool", pools[i]);
            if (!pool || pool === ethers.ZeroAddress) return;
            const { token0, token1 } = keys.get(k)!;
            candidates.push({ pool, dexId: source.dexId, kind: "cl", token0, token1 });
        });
        const recent = end > length - PENDING_WINDOW_POSITIONS;
        return (await evaluateCandidates(provider, client, candidates, hubUsd, Date.now(), recent)).qualified;
    };

    let qualifiedTotal = 0;
    let groups = 0;
    while (cursor < length) {
        const ranges: [number, number][] = [];
        for (let start = cursor; ranges.length < ENUM_CONCURRENCY && start < length; start += ENUM_BATCH) {
            ranges.push([start, Math.min(start + ENUM_BATCH, length)]);
        }
        const counts = await Promise.all(ranges.map(([start, end]) => processRange(start, end)));
        qualifiedTotal += counts.reduce((a, b) => a + b, 0);
        cursor = ranges[ranges.length - 1][1];
        await client.set(cursorKey, String(cursor));
        await client.expire(KEY.lock, LOCK_TTL_S);
        groups += 1;
        if (groups % 10 === 0 || cursor === length) {
            console.log(`  [TOKEN_INDEX] ${source.dexId}: ${cursor.toLocaleString()}/${length.toLocaleString()} positions scanned, +${qualifiedTotal} token listings`);
            await client.hSet(KEY.status, source.dexId, `${cursor}/${length} positions scanned`);
        }
    }
}

// ---------------------------------------------------------------- pending re-check

async function recheckPending(provider: JsonRpcProvider, client: RedisClientType, hubUsd: Record<string, number>) {
    const all = await client.hGetAll(KEY.pending);
    const now = Date.now();
    const expired: string[] = [];
    const candidates = new Map<string, { candidate: Candidate; seenAt: number; field: string }>();
    for (const [field, value] of Object.entries(all)) {
        let p: PendingPool;
        try {
            p = JSON.parse(value);
        } catch {
            expired.push(field);
            continue;
        }
        if (now - p.seenAt > PENDING_TTL_MS) {
            expired.push(field);
            continue;
        }
        const [token0, token1] = p.hub < p.token ? [p.hub, p.token] : [p.token, p.hub];
        candidates.set(field, { candidate: { pool: p.pool, dexId: p.dexId, kind: p.kind, token0, token1 }, seenAt: p.seenAt, field });
    }
    if (expired.length > 0) await client.hDel(KEY.pending, expired);
    if (candidates.size === 0) return;
    // Remove, then re-evaluate: still-low pools are written back with their original seenAt
    await client.hDel(KEY.pending, [...candidates.keys()]);
    const groups = new Map<number, Candidate[]>();
    for (const { candidate, seenAt } of candidates.values()) {
        const list = groups.get(seenAt) ?? [];
        list.push(candidate);
        groups.set(seenAt, list);
    }
    let promoted = 0;
    for (const [seenAt, list] of groups) promoted += (await evaluateCandidates(provider, client, list, hubUsd, seenAt)).qualified;
    if (promoted > 0) console.log(`  [TOKEN_INDEX] pending re-check: ${promoted} token(s) now above the liquidity threshold`);
}

// ---------------------------------------------------------------- indexer loop

let running = false;

async function runCycle(provider: JsonRpcProvider, logs: JsonRpcProvider) {
    if (running) return;
    running = true;
    const client = await getRedis();
    const owner = `${process.pid}:${Date.now()}`;
    try {
        const acquired = await client.set(KEY.lock, owner, { NX: true, EX: LOCK_TTL_S });
        if (!acquired) return; // another process is indexing
        const hubUsd = await getHubPricesUsd(provider);
        // Enumeration (main RPC) and log scanning (logs RPC) run side by side, so V3 coverage does
        // not wait for the multi-hour Uniswap V2 backfill
        await Promise.all([
            (async () => {
                for (const source of ENUM_SOURCES) {
                    if (SKIP.has(source.dexId)) continue;
                    try {
                        await indexEnumSource(provider, client, source, hubUsd);
                    } catch (error: any) {
                        console.warn(`  [TOKEN_INDEX] ${source.dexId} stopped (resumes next cycle):`, error?.message);
                    }
                }
            })(),
            (async () => {
                if (!V3_VIA_LOGS) {
                    for (const source of NPM_SOURCES) {
                        if (SKIP.has(source.dexId)) continue;
                        try {
                            await indexNpmSource(provider, client, source, hubUsd);
                        } catch (error: any) {
                            console.warn(`  [TOKEN_INDEX] ${source.dexId} stopped (resumes next cycle):`, error?.message);
                        }
                    }
                    return;
                }
                for (const source of LOG_SOURCES) {
                    if (SKIP.has(source.dexId)) continue;
                    try {
                        await indexLogSource(provider, logs, client, source, hubUsd);
                    } catch (error: any) {
                        console.warn(`  [TOKEN_INDEX] ${source.dexId} stopped (resumes next cycle):`, error?.message);
                    }
                }
            })(),
        ]);
        await recheckPending(provider, client, hubUsd);
        await client.hSet(KEY.status, "lastCycle", new Date().toISOString());
    } catch (error: any) {
        console.warn("  [TOKEN_INDEX] cycle failed:", error?.message);
    } finally {
        if ((await client.get(KEY.lock).catch(() => null)) === owner) await client.del(KEY.lock).catch(() => undefined);
        running = false;
    }
}

/**
 * Starts the background token indexer: one cycle now, then every 5 minutes. Disabled with
 * TOKEN_INDEXER=off. Safe to call in several processes (a Redis lock lets one index at a time).
 */
export function startTokenIndexer(rpcUrl: string) {
    if (process.env.TOKEN_INDEXER === "off") {
        console.log("  [TOKEN_INDEX] disabled (TOKEN_INDEXER=off)");
        return;
    }
    const provider = providerWithTimeout(rpcUrl);
    const logs = providerWithTimeout(LOGS_RPC_URL);
    console.log(`  [TOKEN_INDEX] starting (min liquidity $${MIN_LIQUIDITY_USD}, V3 pools via ${V3_VIA_LOGS ? `PoolCreated logs on ${LOGS_RPC_URL}` : "position managers"})`);
    const tick = () => void runCycle(provider, logs).catch((e) => console.warn("  [TOKEN_INDEX] error:", e?.message));
    setTimeout(tick, 10_000);
    setInterval(tick, CYCLE_MS);
}

// ---------------------------------------------------------------- on-chain market data

export interface OnchainMarket {
    priceUsd: number | null;
    marketCapUsd: number | null;
    liquidityUsd: number | null;
}

/**
 * Live price, market cap and liquidity for registry tokens, computed from their pools: price from
 * the deepest hub pool (V2/volatile: reserve ratio; Aerodrome stable: getAmountOut; V3/CL: slot0),
 * liquidity ≈ 2 × hub side summed over the token's pools, market cap = total supply × price.
 */
export async function computeOnchainMarkets(provider: JsonRpcProvider, tokens: RegistryToken[]): Promise<Map<string, OnchainMarket>> {
    const out = new Map<string, OnchainMarket>();
    if (tokens.length === 0) return out;
    const hubUsd = await getHubPricesUsd(provider);

    const calls: Call[] = [];
    const plan: { token: RegistryToken; priceIdx: number[]; hubIdx: number[] }[] = [];
    for (const token of tokens) {
        const best = token.pools[0];
        const priceIdx: number[] = [];
        const hubIdx: number[] = [];
        if (best) {
            if (best.kind === "cl") {
                priceIdx.push(calls.push({ target: best.pool, data: SLOT0_SELECTOR }) - 1);
            } else if (best.kind === "aeroStable") {
                priceIdx.push(calls.push({ target: best.pool, data: poolIface.encodeFunctionData("getAmountOut", [10n ** BigInt(token.decimals), token.address]) }) - 1);
            } else {
                priceIdx.push(calls.push({ target: token.address, data: erc20Iface.encodeFunctionData("balanceOf", [best.pool]) }) - 1);
                priceIdx.push(calls.push({ target: best.hub, data: erc20Iface.encodeFunctionData("balanceOf", [best.pool]) }) - 1);
            }
        }
        for (const p of token.pools) hubIdx.push(calls.push({ target: p.hub, data: erc20Iface.encodeFunctionData("balanceOf", [p.pool]) }) - 1);
        plan.push({ token, priceIdx, hubIdx });
    }
    const results = await multicall(provider, calls);

    for (const { token, priceIdx, hubIdx } of plan) {
        const best = token.pools[0];
        let priceUsd: number | null = null;
        if (best) {
            const hubDecimals = HUBS[best.hub].decimals;
            const hubPrice = hubUsd[best.hub] ?? 0;
            if (best.kind === "cl") {
                const raw = results[priceIdx[0]];
                if (raw && raw.length >= 66) {
                    const ratio = Number(BigInt("0x" + raw.slice(2, 66))) / 2 ** 96;
                    const p = ratio * ratio; // token1 per token0, raw units
                    const tokenIs0 = token.address < best.hub;
                    const hubPerToken = tokenIs0 ? p * 10 ** (token.decimals - hubDecimals) : (p > 0 ? (1 / p) * 10 ** (token.decimals - hubDecimals) : 0);
                    priceUsd = hubPerToken * hubPrice;
                }
            } else if (best.kind === "aeroStable") {
                const out = decode<bigint>(poolIface, "getAmountOut", results[priceIdx[0]]);
                priceUsd = toUnits(out, hubDecimals) * hubPrice;
            } else {
                const tokenBal = toUnits(decode<bigint>(erc20Iface, "balanceOf", results[priceIdx[0]]), token.decimals);
                const hubBal = toUnits(decode<bigint>(erc20Iface, "balanceOf", results[priceIdx[1]]), hubDecimals);
                priceUsd = tokenBal > 0 ? (hubBal / tokenBal) * hubPrice : null;
            }
            if (priceUsd !== null && (!Number.isFinite(priceUsd) || priceUsd <= 0)) priceUsd = null;
        }
        let liquidityUsd = 0;
        token.pools.forEach((p, i) => {
            const bal = toUnits(decode<bigint>(erc20Iface, "balanceOf", results[hubIdx[i]]), HUBS[p.hub].decimals);
            liquidityUsd += 2 * bal * (hubUsd[p.hub] ?? 0);
        });
        const supply = Number(ethers.formatUnits(BigInt(token.totalSupply || "0"), token.decimals));
        out.set(token.address, {
            priceUsd,
            marketCapUsd: priceUsd !== null && supply > 0 ? supply * priceUsd : null,
            liquidityUsd: token.pools.length > 0 ? liquidityUsd : null,
        });
    }
    return out;
}
