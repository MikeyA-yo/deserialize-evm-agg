# Deserialize EVM Aggregator — Project Documentation & Agent Guide

> **Target Audience:** AI Agents, Core Developers, and Integrators.  
> **Last Updated:** October 2026  
> **Active Branch:** `ayo-base-stability`  
> **Git Remotes:**
> - `fork`: `https://github.com/MikeyA-yo/deserialize-evm-agg.git` (Current development push target)
> - `origin`: `https://github.com/Bravark/deserialize-evm-agg.git` (Upstream main repo)

---

## 1. Executive Summary & Current Work State

### 1.1 Where We Are Right Now
We are completing the expansion of the **Base Mainnet (Chain ID: 8453)** swap aggregation engine from a concentrated-liquidity-only model (Uniswap V3, PancakeSwap V3, Aerodrome Slipstream V3) into a comprehensive multi-version aggregator supporting:
1. **Uniswap V2** (Standard AMM $x \cdot y = k$)
2. **PancakeSwap V2** (Uniswap V2 fork)
3. **Aerodrome Classic (V2)** (Solidly fork supporting both Volatile $x \cdot y = k$ and Stable $x^3y + y^3x = k$ curves)
4. **Uniswap V4** (Singleton `PoolManager` architecture with flash accounting)

### 1.2 Status of Both Repositories

| Component | Repository | Status | Next Milestone |
| :--- | :--- | :--- | :--- |
| **Routing & Quoting Engine** | `deserialize-evm-agg` (this repo) | **Quoting and execution live on all 7 DEXes**<br>Uniswap V3, PancakeSwap V3, Aerodrome V3, Uniswap V2, PancakeSwap V2, Aerodrome V2 and Uniswap V4 (2 registered WETH/USDC pools) execute on-chain through the Oct 5 2026 deployment, including ERC-20-input swaps (verified by `eth_call` dry runs, §12). There are no automated tests in the repo. | Add a quote-vs-market value guard (§12.5). Register more V4 pools as needed (§12.4). |
| **Execution Smart Contracts** | `deserialize-evm-swap-aggregator-contracts` | **Deployed & migrated Oct 5, 2026** (§4)<br>`MultiRouteSwapV2` proxy, `AdapterTracker` and 7 adapters, all registered and whitelisted; the PancakeSwap V3, Aerodrome V3 and Uniswap V4 adapters were replaced the same day (§12.3); V4 WETH/USDC fee 500 and 3000 pools registered (§12.4). | None blocking. |

---

## 2. Architecture & Execution Flow

The system operates across two decoupled layers: **Off-chain Routing** and **On-chain Settlement**.

```
[ User Request ]
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│               OFF-CHAIN ROUTING (This Repo)                 │
│                                                             │
│ 1. Token normalization (ETH <-> WETH)                       │
│ 2. Pool discovery across 7 DEX protocols                    │
│ 3. Multi-hop Graph construction & Dijkstra pathfinder       │
│ 4. AmountOut simulation per hop curve                       │
│ 5. Hop payload construction via Swap SDK                    │
└──────────────────────────────┬──────────────────────────────┘
                               │ Returns swap transaction payload
                               ▼
┌─────────────────────────────────────────────────────────────┐
│            ON-CHAIN SETTLEMENT (Base Mainnet)               │
│                                                             │
│ [User Wallet]                                               │
│       │                                                     │
│       │ 1. Approve (ERC-20 tokenIn)                         │
│       ▼                                                     │
│ [SwapProxy] ──────────(returnAdapter)────────► [AdapterTracker]
│   0x2B7b1...                                    0xbC9eB...  │
│       │                                             │       │
│       │ 2. swap(hops, minAmountOut, partnerFees)    │       │
│       ▼                                             ▼       │
│ [DEX Adapter (UniV3 / PanV3 / AeroV3 / V2 / AeroV2 / V4)]   │
│       │                                                     │
│       │ 3. Executes swap on underlying pool                 │
│       ▼                                                     │
│ [Target TokenOut] ────► Sent directly to [User Wallet]      │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Supported DEX Matrix (Base Mainnet)

| DEX Identifier | Protocol Architecture | Factory / Manager Address | On-Chain Adapter Address | Off-Chain Route Provider | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
Adapters below are the Oct 2026 deployment, as returned by `AdapterTracker.returnAdapter(factory)`.

| DEX Identifier | Protocol Architecture | Factory / Manager Address | On-Chain Adapter Address (type) | Off-Chain Route Provider | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `UNISWAP_V3_BASE` | Uniswap V3 (Concentrated Liquidity) | `0x33128a8fC17869897dcE68Ed026d694621f6FDfD` | `0x8968693f32064DaD06fc7D28945Bc0bed17cA084` (ZiaV3Adapter) | `UniswapV3BaseRoute` | **Live** (execution verified) |
| `PANCAKE_V3_BASE` | PancakeSwap V3 (Concentrated Liquidity) | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` | `0xA1744F79bd09B6fa3d830Af6219e28FE3E184435` (PancakeV3Adapter) | `PancakeV3Route` | **Live** (execution verified) |
| `AERODROME_V3_BASE` | Aerodrome Slipstream (CLAMM) | `0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A` | `0xd33E95a846070b352C4928C4B9167F9ba5F027ff` (ZiaV3Adapter) | `AerodromeV3Route` | **Live** (execution verified) |
| `UNISWAP_V2_BASE` | Uniswap V2 ($x \cdot y = k$) | `0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6` | `0xBB507A2fD265ADE1Cf56B0430DeEcF92694fFF81` (UniswapV2Adapter, fee 9970) | `UniswapV2BaseRoute` | **Live** (execution verified) |
| `PANCAKE_V2_BASE` | PancakeSwap V2 ($x \cdot y = k$) | `0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E` | `0x66f3A66F4019419691B15284AC501c3b73A829D9` (UniswapV2Adapter, fee 9975) | `PancakeV2BaseRoute` | **Live** (execution verified) |
| `AERODROME_V2_BASE`| Aerodrome Classic (Volatile + Stable) | `0x420DD381b31aEf6683db6B902084cB0FFECe40Da` | `0x967AB6b873862F1C8a3fb40490D2180D8993b137` (AerodromeV2Adapter) | `AerodromeV2BaseRoute` | **Live** (execution verified) |
| `UNISWAP_V4_BASE` | Uniswap V4 (Singleton `PoolManager`) | `0x498581fF718922c3f8e6A244956aF099B2652b2b` | `0xb5fD1C6122db94e52EBc697cca971C5759A54598` (UniswapV4Adapter, pool handles) | `UniswapV4BaseRoute` | **Live** for registered ERC-20 pools (WETH/USDC fee 500 and 3000, execution verified); other V4 pools are quote-gated out (§12.4) |

Decommissioned on Oct 5, 2026 (removed from the tracker and un-whitelisted): `0xe7F78cCf…70ae` and `0xc42b9C96…1b6E` (JaineV3Adapter, wrong swap callback for Base pools), and `0x80FD1e9F…7ba9` (first UniswapV4Adapter, which treated exact-input as exact-output).

---

## 4. Key On-Chain Protocol Addresses (Base Mainnet)

* **SwapProxy (Execution Router, `MultiRouteSwapV2` ERC-1967 proxy):** `0x2B7b17165aAe7Ce6cC390920282473720Db8b30b`
  * Implementation: `0xcB62D3532F37fE687f9545A87BFD3fe249694b47`
* **AdapterTracker (Factory -> Adapter Registry):** `0xbC9eB41b40be480541b54A4189bB82c4340378a7`
* **Admin:** `0x3a2e61653aF437F90fBB9Fde5B57ec080e88D19d`
* *Superseded (pre-Oct 2026):* SwapProxy `0xADb0018bCF10b7dD84B7C3e2D92889185DA41f45`, AdapterTracker `0xf0c3D4dE61d78742Eb51dffA29A109aCE473892F`.
* **Wrapped Ether (WETH):** `0x4200000000000000000000000000000000000006`
* **Native ETH Sentinel:** `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE`
* **Uniswap V4 StateView:** `0xa3c0c9b65bad0b08107aa264b0f3db444b867a71`
* **Uniswap V4 Quoter:** `0x0d5e0f971ed27fbff6c2837bf31316121532048d`

---

## 5. Adapter Deployment & Registration Guide

When deploying new adapters from `deserialize-evm-swap-aggregator-contracts`:

### 5.1 Environment Configuration (`.env.base`)
```env
# Core Protocol Addresses
SWAP_ROUTER_ADDRESS=0x2B7b17165aAe7Ce6cC390920282473720Db8b30b
WA0GI_ADDRESS=0x4200000000000000000000000000000000000006 # Canonical Base WETH
ADAPTER_TRACKER_ADDRESS=0xbC9eB41b40be480541b54A4189bB82c4340378a7

# Factory Addresses
AERODROME_FACTORY=0x420DD381b31aEf6683db6B902084cB0FFECe40Da
V4_POOL_MANAGER=0x498581fF718922c3f8e6A244956aF099B2652b2b
```

### 5.2 Post-Deployment On-Chain Handshake
Every newly deployed adapter needs:

1. **Authorize the router on the adapter** (adapters reject callers they haven't authorized):
   ```solidity
   adapter.authorize(SwapProxy); // SwapProxy = 0x2B7b17165aAe7Ce6cC390920282473720Db8b30b
   ```
   Adapters constructed with the proxy address already authorize it.
2. **Bind the factory and whitelist, in one call.** `trackAdapter` sets `factory → adapter` and calls `SwapProxy.registerAdapter(adapter)` itself:
   ```solidity
   AdapterTracker.trackAdapter(factory, adapterAddress, SwapProxy);
   // Uniswap V2:   factory 0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6 (adapter feeNumerator 9970)
   // PancakeSwap V2: factory 0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E (adapter feeNumerator 9975)
   // Aerodrome V2: factory 0x420DD381b31aEf6683db6B902084cB0FFECe40Da
   // Uniswap V4:   "factory" = PoolManager 0x498581fF718922c3f8e6A244956aF099B2652b2b
   ```
   Re-calling `trackAdapter` for a factory replaces its adapter.
3. **Verify before relying on it** (all three checks are read-only):
   * `AdapterTracker.returnAdapter(factory)` returns the new adapter.
   * `SwapProxy.whitelistedAdapters(adapter)` is `true`.
   * **V3-style adapters implement the callback the pools actually call**: Uniswap V3 and Aerodrome Slipstream pools call `uniswapV3SwapCallback`; PancakeSwap V3 pools call `pancakeV3SwapCallback`. An adapter with the wrong callback deploys and registers fine but reverts on every swap (§12.3). The quickest end-to-end check is an `eth_call` dry run of a `/swap` transaction with a state-override ETH balance (§12.2).

---

## 6. Monorepo Structure & Key Files

```
deserialize-evm-agg/
├── apps/
│   └── server/                     # Express REST API
│       ├── src/
│       │   ├── swap/               # /swap/quote and /swap endpoints
│       │   └── index.ts            # Server bootstrap & graph cache init
├── packages/
│   ├── cache/                      # Redis & memory pool/price caching
│   ├── graph/                      # Dijkstra pathfinding engine
│   └── swap-contract-sdk/          # On-chain transaction builder
│       └── src/
│           ├── helpers/contructHop.ts  # Resolves factory -> adapter via AdapterTracker
│           └── index.ts                # Builds approve + SwapProxy.swap txs
├── providers/
│   └── routeProviders/             # All DEX calculators & route logic
│       ├── base/
│       │   ├── all/index.ts        # Aggregator bundle (registers all 7 DEXes)
│       │   ├── uniswap/            # Uniswap V3 Base route
│       │   ├── pancake/            # PancakeSwap V3 Base route
│       │   ├── aerodrome/          # Aerodrome Slipstream V3 Base route
│       │   ├── uniswapV2/          # Uniswap V2 Base route
│       │   ├── pancakeV2/          # PancakeSwap V2 Base route
│       │   ├── aerodromeV2/        # Aerodrome Classic V2 Base route
│       │   └── uniswapV4/          # Uniswap V4 Base route
│       ├── BaseV2Calculator.ts     # Generic V2 quote calculator ($x * y = k)
│       ├── Aerodromev2Calculator.ts# Aerodrome Classic dual-curve calculator (Volatile + Stable)
│       ├── BaseV4Calculator.ts     # Uniswap V4 StateView/Quoter calculator
│       └── AllContructor.ts        # Unified multi-hop transaction constructor
```

---

## 7. Critical Rules for AI Agents Working on this Repo

1. **Git Remote Constraint**:
   * **Always push exclusively to `fork`**: `git push fork <branch>`.
   * **Do NOT push to `origin`** without explicit user permission.
2. **Build Before Committing**:
   * Always verify that `npm run build` exits with code 0 before finalizing changes.
3. **No Heavy RPC Log Scans**:
   * Never execute `provider.getLogs` or historic event queries inside hot quote loops; use view functions (`getPool`, `getReserves`, `getAmountOut`, `StateView`).
4. **V2 Adapter Reusability**:
   * Uniswap V2 and PancakeSwap V2 share the identical `IUniswapV2Pair` interface and require no custom swap callbacks. They share a single adapter contract.
5. **Aerodrome Classic Nuance**:
   * Aerodrome Classic pools have both volatile ($x \cdot y = k$, 30 bps) and stable ($x^3y + y^3x = k$, 5 bps) curves. Do not assume constant product math for stable pools.
6. **Uniswap V4 Nuance**:
   * V4 pools do not have individual pair contract addresses; state is hosted by the singleton `PoolManager`. In `IPath`, the `factory` field is mapped to the `PoolManager` address so `AdapterTracker` can resolve the V4 adapter.
7. **Amounts Are Always Raw Base Units (wei)**:
   * `amountIn` in `/quote`, every `getAmountOut` / `simulateTransaction`, and `amountOut` in responses are raw integer base units (e.g. `10000000000000000` = 0.01 WETH, `27000000` = 27 USDC). Spot `price` fields on edges are human units (tokenOut per 1 tokenIn). Never mix the two (see §8.1).
8. **Default Chain**:
   * Requests that name no chain (no `/:chain` URL segment and no `chain` body field) default to **`BASE`**. Pass `0G` explicitly for 0G.

---

## 8. Changelog: V2 / V4 Units & Logic Fixes (Oct 4, 2026)

### 8.1 Units mismatch (the main bug)
The V3 calculators, the Dijkstra edge cost and the swap SDK (`amountInRaw`) all work in **raw base units**. The V2 (`BaseV2Calculator`), Aerodrome V2 (`Aerodromev2Calculator`) and V4 (`BaseV4Calculator`) calculators treated the same input as **human units**. Measured on Base with 0.01 WETH → USDC passed as raw wei (correct answer ≈ 27 USDC):

| DEX | Before | After |
| :--- | :--- | :--- |
| Uniswap V2 | 669,583 (pool fully drained) | 26,951,025 (26.95 USDC) |
| Aerodrome V2 volatile | 4,407,139 | 26,967,663 (matches on-chain `getAmountOut` exactly) |
| Aerodrome V2 stable | 16,270 | 26,946,776 (matches on-chain exactly) |
| Uniswap V4 (fee 500) | 0 | 26,900,178 |

All `getAmountOut` and `simulateTransaction` methods in these three calculators now take raw input and return raw integer output (floored). The internal `getSureTokenPrice` helpers quote exactly one whole token (`10^decimals`) and convert the result back to human units.

### 8.2 Other V2 / V4 logic fixes

| # | Issue | Fix | Files |
| :--- | :--- | :--- | :--- |
| 1 | Edge cost divided a raw amountOut by a human spot price, so V2/V4 edges always scored ≈100% impact. | New shared `rawSwapImpactCost` in `utils.ts` compares amounts in human units. | `utils.ts`, `v2Route.ts`, `AerodromeV2Route.ts`, `v4Route.ts` |
| 2 | Cost was measured against the **pool's own** spot price, so a dead or mispriced pool scored ~0% and won the route. In testing, a stale Aerodrome V2 HIGHER pool returned 95 HIGHER where the market gives ~134k. | Edges store `token0PriceUsd` / `token1PriceUsd` on `edgeData.pool`. Cost is measured against the USD-derived market price (`usdReferencePrice`) and falls back to the spot price only when a USD price is unknown. That pool now scores 99.93. | same + calculator interfaces / `formatPool` |
| 3 | V4 `simulateTransaction` always quoted the **3000** fee tier, whatever pool the router picked. | `resolvePoolKey()` recovers the real PoolKey (fee, tickSpacing, WETH or native) by hashing candidate keys against the poolId. Pure computation, no RPC. | `BaseV4Calculator.ts` |
| 4 | V4 discovery ignored **native-ETH (`address(0)`) pools**, where most Base V4 ETH liquidity sits (all 4 fee tiers exist for ETH/USDC). | `findAllPools` also checks native variants for WETH pairs. In the graph they are exposed as **WETH** (the engine is WETH-denominated); `poolKey.currency0 = address(0)` is kept on the pool. | `BaseV4Calculator.ts` |
| 5 | V4 analytic fallback used `liquidity = 0`, so it always returned 0. | Fallback reads live `slot0` / `liquidity` for the resolved key. | `BaseV4Calculator.ts` |
| 6 | V4 StateView ABI declared `protocolFee` / `lpFee` as `uint8` (they are `uint24`). | ABI corrected. | `BaseV4Calculator.ts` |
| 7 | V4 and Aerodrome V2 `findUpdateTokenPairPools` built new edges with a **fresh** token map (indices 0, 1, …) and merged them into the cached graph, so edges pointed at the wrong tokens. | Merge the token map first, then build edges with the merged indices. Verified: 0 mis-indexed edges across all 7 DEX caches. | `v4Route.ts`, `AerodromeV2Route.ts` |
| 8 | V2/V4 never refreshed pool state. V2 rebuilt edges from reserves cached at discovery; V4 and Aerodrome V2 `refreshGraphEdges` returned the graph unchanged. | `getAllExistingPoolData` reads live reserves / slot0 (falling back to cache on error). `refreshGraphEdges` rebuilds edges and merges them into the existing graph. Added `refreshPoolData` helpers. | `v2Route.ts`, `AerodromeV2Route.ts`, `v4Route.ts`, calculators |
| 9 | V2 pools had `pairAddress` but no `poolAddress`, so the ALL-graph refresh (which matches on `poolAddress`) never updated V2 edges. | `PairData` carries a `poolAddress` alias. | `BaseV2Calculator.ts`, `v2Route.ts` |
| 10 | V4 and Aerodrome V2 priced unknown tokens at **$1** and wrote it to the **shared** Redis price cache, polluting V3 prices and the averaged `keyRate`. V2 cached `0` the same way. | Unknown tokens return `0`. Only prices `> 0` are cached. | `BaseV4Calculator.ts`, `Aerodromev2Calculator.ts`, `v2Route.ts`, `AerodromeV2Route.ts`, `v4Route.ts` |
| 11 | Aerodrome V2 analytic fallback swapped reserves for `token1 → token0` swaps and hardcoded 5/30 bps fees. | Uses the pool's real reserve order and the factory `getFee`. | `Aerodromev2Calculator.ts` |
| 12 | `mergeGraphs` (V2 / Aerodrome V2 / V4) could leave `undefined` rows when the token map grew. | Pads the merged graph to the token-map size. | `v2Route.ts`, `AerodromeV2Route.ts`, `v4Route.ts` |

### 8.3 Default chain
`chainFromRequest`, the `tokenPrice` / `tokenDetails` schemas and `tokenList` used to default to `0G`. They now default to `BASE` (`swap.controllers.ts`, `swap.schema.ts`, `swap.service.ts`).

### 8.4 Verification performed
* `npm run build` and `tsc --noEmit` on `providers/routeProviders` both exit 0.
* Live probes against Base mainnet RPC: raw vs human outputs (table in §8.1); V4 key resolution correct for all 6 WETH/USDC pools (2 WETH, 4 native); V4 Quoter vs analytic within ~0.1%.
* End-to-end `/quote` with no chain on a temporary second server instance: **WETH→USDC 0.01 → 27.047 USDC via Uniswap V4** (PancakeSwap V3 gave 27.05).

### 8.5 Operational notes after deploying
* **Restart the server.** It runs under ts-node with no watch, so it keeps the old code until restarted.
* **Stale cached edges.** V2/V4 edges cached before this change have no USD prices, so they fall back to spot-price cost until refreshed. The indexer's `EDGE_REFRESH_INTERVAL` is 2000 **minutes**, so run a refresh (or clear the `UNISWAP_V2_BASE`, `PANCAKE_V2_BASE`, `AERODROME_V2_BASE` and `UNISWAP_V4_BASE` caches) after deploying.

---

## 9. Known Issues (not changed in this pass)

### 9.1 ~~V3 edge cost is wrong for mixed-decimal pairs~~ (fixed Oct 5, 2026, see §11)
The V3 edge cost divided a raw `amountOut` by a human spot price, scoring ≈100 on 18→6-decimal hops and 0 on 6→18 hops. Combined with thin pools this produced quotes like 1 ETH → 8.30 DAI and 0.01 ETH → ~1.1k HIGHER (market ~135k).

### 9.2 V4 execution path (partly resolved Oct 5, 2026, see §12.4)
The hop format is resolved: the migrated `UniswapV4Adapter` takes a **pool handle** (the low 160 bits of the 32-byte poolId) in the hop's 20-byte pool field and resolves it to the registered PoolKey; V4 hops now send that handle. Still open: the adapter executes only admin-registered pools (one fee tier per pair), and it cannot settle native ETH, so native-ETH V4 pools, where most V4 ETH liquidity sits, are quote-only and never routed. Only hookless (`hooks = address(0)`) V4 pools are discovered.

### 9.3 Other routing issues observed
* ~~`AllRoute.getNewGraph` keeps only the **first** edge per token pair per DEX~~ (fixed Oct 5, 2026, §12.6).
* Dijkstra enqueues nodes by the single-edge cost instead of the accumulated path cost (`packages/graph/graph.ts`).
* New DEXes are only discovered for a pair when that pair is missing from the ALL graph. Pairs already indexed via V3 never get V2/V4 pools until the indexer or a discovery adds them.
* Discovery fans out to 5 candidate pairs × 7 DEXes. With the configured RPC this regularly hits request timeouts (a cold-pair quote took several minutes), and pools can be silently missed.

---

## 10. Quote Response: `route` Field (Oct 4, 2026)

Every `/quote` (and `/:chain/quote`) response now includes a `route` object for displaying the swap path, similar to KyberSwap's route view. It is purely additive: `routePlan` (which `/swap` consumes) is unchanged.

```json
"route": {
  "path": [ { "address": "0xEeee…EEeE", "symbol": "ETH", "decimals": 18 },
            { "address": "0x8335…2913", "symbol": "USDC", "decimals": 6 } ],
  "hops": [ {
    "hop": 1, "dexId": "UNISWAP_V4_BASE", "dexName": "Uniswap V4",
    "poolAddress": "0x96d4…8c0a", "fee": 500,
    "tokenIn":  { "address": "0xEeee…EEeE", "symbol": "ETH",  "decimals": 18 },
    "tokenOut": { "address": "0x8335…2913", "symbol": "USDC", "decimals": 6 },
    "amountIn": "10000000000000000", "amountOut": "27048610",
    "amountInFormatted": "0.01", "amountOutFormatted": "27.04861",
    "percent": 100
  } ],
  "summary": "ETH → USDC (Uniswap V4)"
}
```

* **Amounts**: `amountIn` / `amountOut` are raw base units. Each hop's `amountIn` is the previous hop's `amountOut`. The `*Formatted` fields are human units, or `null` if a token's decimals could not be read.
* **No extra simulation**: per-hop outputs come from the same simulation that produces the quote's `amountOut`. `AllRoute.getAmountOutFromPlan` now also returns `hopAmountsOut`, an optional field on the `IRoute` return type.
* **Native token**: when `isNativeIn` / `isNativeOut` is set, the first/last WETH leg is shown as the native token (ETH, `0xEeee…EEeE`), the token the user actually sends or receives.
* **Token metadata** comes from the Redis mint cache (`getTokenDetailsService`), falling back to an on-chain ERC-20 read. **DEX names** come from each route provider's `getDexConfig().name`.
* **`percent`**: the router currently finds single-path routes only, so it is always `100`. The field is there for split routing later.
* **`fee`**: passed through as stored by each DEX route, and the units differ per DEX (V3/V4 in hundredths of a bip, e.g. `500` = 0.05%; V2/Aerodrome V2 in bps, e.g. `30` = 0.3%). Do not render it as a percentage without per-DEX handling.
* **Failure is non-fatal**: if the route view cannot be built, `route` is omitted and the quote is still returned.
* Implemented in `buildQuoteRouteView` (`apps/server/src/swap/swap.service.ts`). Swagger schemas: `QuoteRoute`, `QuoteRouteHop`, `QuoteRouteToken`.

---

## 11. Changelog: V3 Edge Cost & On-Chain Route Checking (Oct 5, 2026)

### 11.1 Problem
The frontend showed **1 ETH → 8.30 DAI** (market ≈ 2,712). Every direct WETH/DAI pool on Base is thin; real DAI liquidity is in USDC/DAI. The router still preferred thin pools for two reasons:
1. **V3 edge cost units** (old §9.1): it divided a raw `amountOut` by a human price, so V3 edges scored ≈100 on 18→6-decimal hops and **0** on 6→18 hops, whatever the pool's depth.
2. **In-range math cannot see thin pools**: edge costs assume the pool's current liquidity covers the whole trade. A PancakeSwap V3 WETH/DAI pool scored **0.01** but its on-chain quoter returns **4.94 DAI** for 1 WETH. The V3 calculator's token0→token1 approximation could also overshoot past the price on large trades, making thin pools look better than market.

### 11.2 Fixes

| # | Change | Files |
| :--- | :--- | :--- |
| 1 | The V3 edge cost now uses `rawSwapImpactCost` (human units, compared against the USD-derived market price), the same as V2/V4. V3 edges store `token0PriceUsd` / `token1PriceUsd` on `edgeData.pool`, and `formatPool` keeps them. | `v3Route.ts`, `UniswapV3Calculator.ts` (`PoolData` type only) |
| 2 | The V3 edge cost uses a new exact in-range concentrated-liquidity formula, `concentratedLiquidityAmountOutRaw`, instead of the V3 calculator's approximation. The V3 calculator itself is unchanged; quotes still come from the on-chain quoters. | `utils.ts`, `v3Route.ts` |
| 3 | **On-chain route checking.** After Dijkstra, `selectRouteBySimulation` re-quotes candidate token paths with the real quoters: Dijkstra's path, the direct pair, and two-hop paths via WETH and via the stable token (USDC). For each path it picks, hop by hop, the pool with the highest simulated output (the 6 lowest-cost pools per hop). That is optimal for a fixed token path, since a hop's output only grows with its input. The path with the highest final output wins. Identical hop simulations are reused. If no candidate simulates successfully, it falls back to the Dijkstra route. | `apps/server/src/index.ts` |
| 4 | `getBestRoutes` returns the winning `simulated` result (amounts per hop), and the quote service uses it directly instead of simulating the route a second time. | `apps/server/src/index.ts`, `swap.service.ts` |
| 5 | V3 no longer caches a `0` price in the shared price cache (consistent with §8.2 #10). | `v3Route.ts` |

### 11.3 Verification (Base mainnet, temporary second server instance)

| Quote | Before | After |
| :--- | :--- | :--- |
| 1 ETH → DAI | 8.30 (frontend) / 2,336.41 | **2,718.47 DAI** via USDC (PancakeSwap V3 → Uniswap V3) |
| 2,700 DAI → ETH | n/a | 0.99256 ETH via USDC |
| 2,700 USDC → DAI | 2,336 (wrong pool) | **2,699.71 DAI** (Uniswap V3) |
| 0.01 ETH → HIGHER | ~1,099 HIGHER | **135,219 HIGHER** (Uniswap V3, direct) |
| 0.01 WETH → USDC | 27.05 | 27.18 USDC (Aerodrome V3) |
| 27 USDC → WETH | n/a | 0.009931 WETH (PancakeSwap V3) |

* `POST /base/swap` built from a simulated 1 ETH → DAI quote returns a valid single `SwapProxy.swap` transaction (`value` = 1 ETH, no approval needed for native input).
* Quote latency with route checking was 0–8 s on warm pairs with the configured RPC.
* `npm run build` and `tsc --noEmit` exit 0.

### 11.4 Notes
* **Cache refresh.** After deploying, run an edge refresh (the indexer's `refreshExistingEdges`, or the equivalent per-route `getAllExistingPoolData` → `refreshGraphEdges` → rebuild `ALL_BASE`) so cached edges carry USD prices; edges without them fall back to spot-price cost. This was done on the shared Redis on Oct 5 (194 edges across 7 DEXes, all priced). Scripts doing this outside the server must install the `BigInt.prototype.toJSON` shim used by the server and indexer, otherwise writing V3 pool data fails.
* **RPC load.** Each quote now runs a few extra quoter calls (≤ 6 pools per hop × up to 4 candidate paths, de-duplicated and run in parallel). If the RPC throttles, lower `MAX_POOLS_PER_HOP` in `apps/server/src/index.ts`.
* **Limits.** Besides Dijkstra's own path, the only candidates are the direct pair and two-hop paths via WETH or USDC. Split routing is not implemented, so `route.hops[].percent` stays 100.

---

## 12. Changelog: New Contract Deployment on Base (Oct 5, 2026)

The contracts were redeployed on Oct 5, 2026 (new `MultiRouteSwapV2` proxy, `AdapterTracker` and 7 adapters). The same day, the PancakeSwap V3, Aerodrome V3 and Uniswap V4 adapters were replaced after the checks below found problems (§12.3). Addresses: §3 and §4.

### 12.1 Backend changes
| # | Change | Files |
| :--- | :--- | :--- |
| 1 | SDK points at the new `SwapProxy` `0x2B7b…b30b` and `AdapterTracker` `0xbC9e…78a7`. Adapters are still resolved on-chain per factory (`returnAdapter`), so replacing an adapter needs no backend change. | `packages/swap-contract-sdk/src/interfaces/js/networkSetup.ts` |
| 2 | V4 hops send the pool's **handle** (`v4PoolHandleFromId`: the low 160 bits of the poolId) in the hop's 20-byte pool field. The UniswapV4Adapter resolves it to the registered PoolKey, so several fee tiers per pair can be routed. Previously the 32-byte poolId was sent and the SDK threw. | `AllContructor.ts`, `BaseV4Calculator.ts` |
| 3 | V4 quoting is gated to pools the adapter can execute: both currencies ERC-20 (the adapter cannot settle native ETH), and `getPoolKeyByHandle(handle)` must equal the pool's full PoolKey. Cached for 5 min. Non-executable pools simulate to 0, so the route checker (§11) picks another pool. Configured via `adapterAddress` in the V4 DEX config. | `BaseV4Calculator.ts`, `base/uniswapV4/index.ts` |
| 4 | `DISABLED_DEX_IDS` drops a DEX's edges before Dijkstra and the route checker. Empty by default; set the `DISABLED_DEX_IDS` env var (comma-separated dexIds) to take a DEX out of routing without a code change. | `apps/server/src/constants.ts`, `apps/server/src/index.ts` |

### 12.2 Verification (after the adapter migration)
* **On-chain registration (read-only):**
  * For all 7 factories, `returnAdapter(factory)` returns the active adapter, and `whitelistedAdapters(adapter)` is `true`. The 3 decommissioned adapters are `false`.
  * Every adapter has `allowedSwapAddresses(proxy) == true`.
  * The proxy's ERC-1967 slot points at the implementation, `tracker()` points at the new tracker, and the SDK's `swap(...)` selector `0x5a18dddd` exists in the implementation.
  * Swap callbacks in the bytecode: Uniswap V3 and Aerodrome V3 implement `uniswapV3SwapCallback`, PancakeSwap V3 implements `pancakeV3SwapCallback`, and V4 implements `unlockCallback`.
  * V2 adapter `feeNumerator`s: 9970 (Uniswap) and 9975 (PancakeSwap).
  * The backend's pool handle equals the adapter's `getPoolHandle` for the WETH/USDC tiers.
* **Single-hop dry runs:** `/swap` transactions for 0.001 ETH → USDC, each forced through one DEX, run with `eth_call` from a throwaway address given ETH via state override. All six non-V4 DEXes execute. V4 reverts with `V4Adapter: Pool not registered`, as expected while no pools are registered; this also confirms the handle reaches the adapter.
* **End to end** (quote → `/swap` → `eth_call`, all DEXes enabled):

  | Swap | Output | Route | Result |
  | :--- | :--- | :--- | :---: |
  | 0.1 ETH → USDC | 268.91 USDC | Uniswap V3 | executes |
  | 1 ETH → DAI | 2,688.79 DAI | PancakeSwap V3 → Uniswap V3 (via USDC) | executes |
  | 0.01 ETH → HIGHER | 135,219 HIGHER | Uniswap V3 | executes |
  | 0.01 ETH → DEGEN | 25,370 DEGEN (market ≈ 25,417) | Aerodrome V3 | executes |
  | 0.05 ETH → AERO | 157.13 AERO | Aerodrome V3 | executes |
  | 0.5 ETH → cbBTC | 0.01577849 cbBTC | PancakeSwap V3 → PancakeSwap V3 (via USDC) | executes |

* **Not covered:** ERC-20-input swaps. The dry run cannot set token balances and allowances without per-token storage overrides; the approve + swap flow is unchanged.

### 12.3 Adapter problems found and fixed during the rollout
* **PancakeSwap V3 / Aerodrome V3:** the first deployment used `JaineV3Adapter` (written for 0G), whose only callback is `jaineV3SwapCallback`. PancakeSwap V3 pools call `pancakeV3SwapCallback` and Aerodrome Slipstream pools call `uniswapV3SwapCallback`, so every swap reverted. They were replaced by `PancakeV3Adapter` (`0xA174…4435`) and a `ZiaV3Adapter` (`0xd33E…27ff`). While they were broken, both DEXes were excluded from routing via `DISABLED_DEX_IDS`.
* **Uniswap V4:** the first adapter passed `amountSpecified` positive, which V4 treats as exact *output*, and it addressed pools by hooks address with one fee tier per pair. It was replaced by `0xb5fD…4598`, which uses negative (exact-input) amounts and pool handles.
* **Lesson:** an adapter can deploy and register cleanly and still revert on every swap. Before enabling a DEX, run the §5.2 checks: callback selectors in the bytecode, plus an `eth_call` dry run.

### 12.4 Uniswap V4 pool registration
The UniswapV4Adapter only swaps pools registered with `registerPool(tokenA, tokenB, hooks, fee, tickSpacing)`, which returns the pool handle. Registered on Oct 5, 2026 (block 52215140), both hookless ERC-20 pools:

| Pair | Fee / tickSpacing | Pool handle (`hop.poolAddress`) | PoolId |
| :--- | :--- | :--- | :--- |
| WETH/USDC | 500 / 10 | `0xeF66F1A05165aA7dAC6815D24E807CC6EbD943A0` | `0x90333bb0…bd943a0` |
| WETH/USDC | 3000 / 60 | `0x5CDb93639E0c7102580A7d345E1144cD5A718f54` | `0x1d8c55f3…5a718f54` |

Verified on-chain: `getPoolKeyByHandle` returns the full PoolKey for each handle, the key hashes to the listed PoolId, and both pools have liquidity. Forced dry runs through each handle execute, both for native ETH input and WETH (ERC-20) input. The router uses a V4 pool only when it gives the best simulated output; in the Oct 5 tests PancakeSwap V3 paid slightly more for WETH/USDC.

To add more V4 pools, register them; the backend picks a registration up within 5 minutes. Native-ETH V4 pools, where most V4 ETH liquidity sits, stay unroutable until the adapter can settle native currency.

### 12.5 Open: no quote-vs-market value guard
While Aerodrome V3 was excluded, 0.01 ETH → DEGEN quoted **2,163.8 DEGEN** through a thin Uniswap V3 pool, about 91% below market (≈ 25,417). The route checker picks the best *available* executable route, but nothing flags a best route that is still far below market. Recommended: compute the quote's USD value in vs. out from the token prices already fetched, return it as a `priceImpact` / `valueLossPercent` field, and reject or flag quotes beyond a threshold (e.g. 5–10%) so the frontend can warn.

### 12.6 Fix: every pool of a DEX now reaches the routing graph
`AllRoute.getNewGraph` and `AllRoute.buildGraphFromPools` copy each DEX's edges into the combined `ALL_BASE` graph, but they matched edges by **token pair only**. For every pool a DEX had on a pair, they copied that DEX's *first* edge for the pair. So only one pool per DEX per pair was routable, and the copies showed up as duplicates (the ×4 V3 edges in §9.3). In particular, the registered V4 WETH/USDC pools never reached the router. Edges are now matched by token pair **and** pool address (`poolIdentifier` / `samePool` in `AllContructor.ts`).

Effect on the cached graph (WETH→USDC): before, 22 edges but only 7 distinct pools; after, 22 distinct pools (Uniswap V3 ×4, PancakeSwap V3 ×4, Aerodrome V3 ×4, Uniswap V4 ×6, Aerodrome V2 ×2, Uniswap V2, PancakeSwap V2). The `ALL_BASE` cache was rebuilt on Oct 5.

End to end after the fix (quote → `/swap` → `eth_call`), all executing:

| Swap | Output | Route | Quote time |
| :--- | :--- | :--- | :--- |
| 0.01 ETH → USDC | 26.93 USDC | PancakeSwap V3 | 2.7 s |
| 1 ETH → USDC | 2,693.38 USDC | PancakeSwap V3 | 0.9 s |
| 0.5 WETH → USDC (ERC-20 input, approve + swap) | 1,346.72 USDC | PancakeSwap V3 | 1.5 s |
| 1 ETH → DAI | 2,693.26 DAI | PancakeSwap V3 → Uniswap V3 | 1.9 s |
| 0.01 ETH → DEGEN | 25,441 DEGEN (market ≈ 25,417) | Aerodrome V3 | 1.8 s |
| 0.5 ETH → cbBTC | 0.01579944 cbBTC | PancakeSwap V3 | 2.0 s |
| 0.05 ETH → AERO | 158.04 AERO | PancakeSwap V3 | 2.2 s |

ERC-20-input dry runs give the test address a WETH balance and allowance by overriding WETH9 storage (`balanceOf` slot 3, `allowance` slot 4).
