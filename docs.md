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
| **Routing & Quoting Engine** | `deserialize-evm-agg` (this repo) | **Quoting works on all 7 DEXes, with known routing issues**<br>All 7 DEX calculators and route providers are implemented. The V2/V4 units and logic fixes from Oct 4 2026 were verified against live Base pools (see §8). There are no automated tests in the repo. V3 edge-cost bug still open (see §9). | Fix the V3 edge cost (§9.1). The V4 execution path needs SDK and adapter work (§9.2). |
| **Execution Smart Contracts** | `deserialize-evm-swap-aggregator-contracts` | **Contracts Written**<br>`UniswapV2Adapter.sol`, `AerodromeV2Adapter.sol`, `UniswapV4Adapter.sol` prepared. `.env.base` configured. | Run deployment scripts on Base Mainnet, whitelist adapters on `SwapProxy`, and map factories in `AdapterTracker`. |

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
│   0xADb00...                                    0xf0c3D...  │
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
| `UNISWAP_V3_BASE` | Uniswap V3 (Concentrated Liquidity) | `0x33128a8fC17869897dcE68Ed026d694621f6FDfD` | `0x4001564cf4e1DBBaA20e7E24be51abaf2eaA4d3B` | `UniswapV3BaseRoute` | **Active & Live** |
| `PANCAKE_V3_BASE` | PancakeSwap V3 (Concentrated Liquidity) | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` | `0x27DfBFcE2a4AAa2a08DDcD71Ad298AcFD81AE4Dc` | `PancakeV3Route` | **Active & Live** |
| `AERODROME_V3_BASE` | Aerodrome Slipstream (CLAMM) | `0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A` | `0xEA81B9CcFBF6053B33429f103D11dc7a060f7869` | `AerodromeV3Route` | **Active & Live** |
| `UNISWAP_V2_BASE` | Uniswap V2 ($x \cdot y = k$) | `0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6` | *Awaiting deployment* | `UniswapV2BaseRoute` | **Ready for deployment** |
| `PANCAKE_V2_BASE` | PancakeSwap V2 ($x \cdot y = k$) | `0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E` | *Shares Uni V2 Adapter* | `PancakeV2BaseRoute` | **Ready for deployment** |
| `AERODROME_V2_BASE`| Aerodrome Classic (Volatile + Stable) | `0x420DD381b31aEf6683db6B902084cB0FFECe40Da` | *Awaiting deployment* | `AerodromeV2BaseRoute` | **Ready for deployment** |
| `UNISWAP_V4_BASE` | Uniswap V4 (Singleton `PoolManager`) | `0x498581fF718922c3f8e6A244956aF099B2652b2b` | *Awaiting deployment* | `UniswapV4BaseRoute` | **Ready for deployment** |

---

## 4. Key On-Chain Protocol Addresses (Base Mainnet)

* **SwapProxy (Execution Router):** `0xADb0018bCF10b7dD84B7C3e2D92889185DA41f45`
* **AdapterTracker (Factory -> Adapter Registry):** `0xf0c3D4dE61d78742Eb51dffA29A109aCE473892F`
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
SWAP_ROUTER_ADDRESS=0xADb0018bCF10b7dD84B7C3e2D92889185DA41f45
WA0GI_ADDRESS=0x4200000000000000000000000000000000000006 # Canonical Base WETH
ADAPTER_TRACKER_ADDRESS=0xf0c3D4dE61d78742Eb51dffA29A109aCE473892F

# Factory Addresses
AERODROME_FACTORY=0x420DD381b31aEf6683db6B902084cB0FFECe40Da
V4_POOL_MANAGER=0x498581fF718922c3f8e6A244956aF099B2652b2b
```

### 5.2 Post-Deployment On-Chain Handshake
Every newly deployed adapter **must** be registered via two on-chain calls:

1. **Whitelist on `SwapProxy`**:
   ```solidity
   SwapProxy.registerAdapter(adapterAddress);
   ```
2. **Bind Factory on `AdapterTracker`**:
   ```solidity
   // For Uniswap V2 & PancakeSwap V2 (single shared adapter):
   AdapterTracker.trackAdapter(0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6, v2AdapterAddress);
   AdapterTracker.trackAdapter(0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E, v2AdapterAddress);

   // For Aerodrome Classic (V2):
   AdapterTracker.trackAdapter(0x420DD381b31aEf6683db6B902084cB0FFECe40Da, aeroV2AdapterAddress);

   // For Uniswap V4:
   AdapterTracker.trackAdapter(0x498581fF718922c3f8e6A244956aF099B2652b2b, v4AdapterAddress);
   ```

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

### 9.1 V3 edge cost is wrong for mixed-decimal pairs (high priority)
`BaseV3Route.getFunctionToMutateEdgeCost` (`v3Route.ts`) divides a **raw** `amountOut` by a **human** spot price and compares it with a raw `amountIn`. For 18→6-decimal hops (e.g. WETH→USDC) every V3 edge scores ≈**100**. For 6→18-decimal hops (e.g. USDC→HIGHER) it scores **0** regardless of liquidity. Before §8, V2/V4 edges also scored ≈100, which hid this. Now that they score correctly, the router can be steered into thin V3 pools. Observed: WETH→HIGHER became WETH →(V4) USDC →(thin Uniswap V3 pool) HIGHER for ~1.1k HIGHER, while the direct V3 pool gives ~134k. Quoted amounts are still accurate (every hop is simulated); only route **selection** suffers. Fix: compute V3 impact in human units, ideally against the USD reference price as in `rawSwapImpactCost`.

### 9.2 V4 execution path
`constructHop` in `swap-contract-sdk` calls `ethers.getAddress(poolAddress)`, which throws on a bytes32 V4 poolId. The hop tuple `[tokenIn, tokenOut, adapter, pool, "0"]` also has no room for the PoolKey (`fee`, `tickSpacing`, `hooks`, native vs WETH currency). The SDK and `UniswapV4Adapter` need a hop format that carries the PoolKey. The adapter must also wrap/unwrap when the PoolKey uses native ETH but the route token is WETH (§8.2 #4). Only hookless (`hooks = address(0)`) V4 pools are discovered.

### 9.3 Other routing issues observed
* `AllRoute.getNewGraph` keeps only the **first** edge per token pair per DEX, so other pools of the same DEX on that pair (e.g. a second Aerodrome V2 pool) never reach the ALL graph. V3 edges also appear duplicated (×4) in `ALL_BASE`.
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
