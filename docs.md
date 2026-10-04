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
| **Routing & Quoting Engine** | `deserialize-evm-agg` (this repo) | **Complete & Verified**<br>All 7 DEX calculators and route providers implemented, Dijkstra pathfinder enabled, unit tests passing. | Ready for end-to-end execution testing once adapters are deployed on Base. |
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
