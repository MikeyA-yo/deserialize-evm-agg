# Base EVM Aggregator Specifications & Frontend Integration Guide

This document specifies the API endpoints, on-chain contracts, routing infrastructure, and integration flow for building frontend swap interfaces on **Base** using `deserialize-evm-agg`.

---

## 1. Executive Summary & Infrastructure Status

| Component | Status | Details |
| :--- | :--- | :--- |
| **Aggregator Smart Contracts** | **Deployed & Active** | Already deployed on Base Mainnet. No custom contracts need to be written or deployed. |
| **DEX Adapters** | **Active & Configured** | Adapters registered for Uniswap V3, PancakeSwap V3, and Aerodrome SlipStream. |
| **Pricing Engine** | **Operational** | Dynamic price queries across Base tokens (`GET /base/tokenPrice/:tokenAddress`). |
| **Quote Engine** | **Operational** | Finds optimal routes across Base DEX pools (`POST /base/quote`). |
| **Route Visualization** | **Available** | Every quote includes a `route` object (token path, DEX per hop, per-hop amounts) for rendering the swap route (§3.4.1). |
| **Swap TX Generator** | **Operational** | Returns ready-to-sign EVM transaction payloads (`POST /base/swap`). |
| **Auto-Discovery** | **Active** | Unknown tokens are dynamically resolved and cached into the Redis graph upon query. |

---

## 2. On-Chain Contracts (Base Mainnet)

The aggregator routes swaps through an on-chain proxy pattern that interacts with DEX adapters:

```
[User Wallet] 
     │
     │ 1. Approve (if ERC-20)
     ▼
[SwapProxy]  ───(returnAdapter)───► [AdapterTracker]
     │                                    │
     │ 2. swap(hops, minOut, fees)        │ (Resolves Factory -> Adapter)
     ▼                                    ▼
[DEX Adapter (Uniswap/Pancake/Aerodrome)]
     │
     │ 3. Execute swap on Pool
     ▼
[Target Token] ──► Transferred directly to [User Wallet]
```

### Deployed Addresses on Base:

- **SwapProxy:** `0xADb0018bCF10b7dD84B7C3e2D92889185DA41f45`
- **AdapterTracker:** `0xf0c3D4dE61d78742Eb51dffA29A109aCE473892F`
- **Native ETH Placeholder:** `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE`
- **Wrapped Ether (WETH):** `0x4200000000000000000000000000000000000006`

### Registered DEX Adapters on Base:
- **Uniswap V3 Factory** (`0x33128a8fC17869897dcE68Ed026d694621f6FDfD`) $\rightarrow$ Adapter: `0x4001564cf4e1DBBaA20e7E24be51abaf2eaA4d3B`
- **PancakeSwap V3 Factory** (`0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865`) $\rightarrow$ Adapter: `0x27DfBFcE2a4AAa2a08DDcD71Ad298AcFD81AE4Dc`
- **Aerodrome SlipStream Factory** (`0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A`) $\rightarrow$ Adapter: `0xEA81B9CcFBF6053B33429f103D11dc7a060f7869`

---

## 3. API Reference

Base Server URL: `http://localhost:3735` (Development) / `https://evm-api.deserialize.xyz` (Production)

---

### 3.1 Get Token Price

Returns the token's current USD price.

- **Method:** `GET`
- **Path:** `/:chain/tokenPrice/:tokenAddress`
- **Example:** `GET http://localhost:3735/base/tokenPrice/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`

#### Response (`200 OK`):
```json
{
  "result": 1.0002573221978994
}
```

---

### 3.2 Get Token Details

Fetches ERC-20 metadata (decimals, symbol, name) and liquidity status.

- **Method:** `GET`
- **Path:** `/:chain/tokenDetails/:tokenAddress`
- **Example:** `GET http://localhost:3735/base/tokenDetails/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`

#### Response (`200 OK`):
```json
{
  "address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "symbol": "USDC",
  "name": "USD Coin",
  "decimals": 6
}
```

---

### 3.3 Search Tokens (by Ticker, Symbol, Name, or Address)

Allows frontend token pickers/search bars to search tokens by their ticker (both default and non-default tokens on Base), token name, or contract address (CA).

- **Method:** `GET`
- **Paths Supported:**
  - `/:chain/tokens/search?q=:query` (e.g. `GET /base/tokens/search?q=ski`)
  - `/:chain/tokens/search/:query` (e.g. `GET /base/tokens/search/ski`)
  - `/:chain/tokenSearch?query=:query`
  - `/tokens/search?q=:query` (defaults to Base chain)
- **Supported Query Params:** `q`, `query`, `tick`, `symbol`
- **Search Capabilities & Ticker Coverage:**
  1. **Default Verified Tokens:** High-liquidity tokens (`ETH`, `WETH`, `USDC`, `USDbC`, `DAI`, `cbBTC`, `cbETH`, `AERO`, `BRETT`, `DEGEN`, `CLANKER`, `TOSHI`, `VIRTUAL`, `HIGHER`) resolve instantly in **2–5ms**.
  2. **Non-Default / Arbitrary Tickers:** Any non-default token on Base (e.g. `SKI`, `MIGGLES`, `KEYCAT`, `WELL`, `SEAM`, `BENJI`, meme coins, new tokens) is dynamically discovered via live Base DEX search, verified against on-chain metadata for accurate token decimals (`decimals`), and cached for subsequent instantaneous lookups.
  3. **Direct Contract Address (CA):** Entering a 42-character address (`0x...`) queries the ERC-20 contract directly on-chain via RPC.
  4. **Relevance Scoring:** Exact symbol matches rank first (`+100`), followed by exact CA match (`+95`), symbol prefix (`+80`), symbol substring (`+60`), and name match (`+40`).
  5. **Empty Query:** Returns the top verified default tokens list.

#### Example 1: Searching a Default Ticker (`aero`)
```http
GET http://localhost:3735/base/tokens/search?q=aero
```
```json
{
  "result": [
    {
      "address": "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
      "symbol": "AERO",
      "name": "Aerodrome",
      "decimals": 18,
      "network": "BASE"
    }
  ]
}
```

#### Example 2: Searching a Non-Default Ticker (`ski`)
```http
GET http://localhost:3735/base/tokens/search?q=ski
```
```json
{
  "result": [
    {
      "address": "0x768BE13e1680b5ebE0024C42c896E3dB59ec0149",
      "symbol": "SKI",
      "name": "SKI MASK DOG",
      "decimals": 9,
      "network": "BASE"
    }
  ]
}
```

#### Example 3: Searching a Non-Default Ticker (`miggles`)
```http
GET http://localhost:3735/base/tokens/search?q=miggles
```
```json
{
  "result": [
    {
      "address": "0xB1a03EdA10342529bBF8EB700a06C60441fEf25d",
      "symbol": "MIGGLES",
      "name": "Mr. Miggles",
      "decimals": 18,
      "network": "BASE"
    }
  ]
}
```

*Note: The response returns both `result` and `data` keys to ensure 100% compatibility with any frontend client.*

---

### 3.4 Get Swap Quote

Calculates best execution route and expected output amount across all registered Base DEXes.

- **Method:** `POST`
- **Path:** `/:chain/quote` (or `/quote`)
- **Headers:** `Content-Type: application/json`

#### Request Body:
```json
{
  "tokenA": "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  "tokenB": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "amountIn": "1000000000000000000",
  "dexId": "ALL_BASE"
}
```

| Field | Type | Description |
| :--- | :--- | :--- |
| `tokenA` | `string` | Input token address (use `0xEeeee...` for Native ETH). |
| `tokenB` | `string` | Output token address. |
| `amountIn` | `string \| number` | Amount in atomic units (wei / token decimals). |
| `dexId` | `string` | `"ALL_BASE"` to route across all Base DEXes. |
| `options` | `object` *(optional)* | `{ "targetRouteNumber": 5 }` |

#### Response (`200 OK`):
```json
{
  "tokenA": "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  "tokenB": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "amountIn": "1000000000000000000",
  "amountOut": "2698061156",
  "tokenPrice": "1.0002",
  "routePlan": [
    {
      "tokenA": "0x4200000000000000000000000000000000000006",
      "tokenB": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "dexId": "PANCAKE_V3_BASE",
      "poolAddress": "0x72AB388E2E2F6FaceF59E3C3FA2C4E29011c2D38",
      "aToB": false,
      "fee": 100
    }
  ],
  "route": {
    "path": [
      { "address": "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", "symbol": "ETH", "decimals": 18 },
      { "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "symbol": "USDC", "decimals": 6 }
    ],
    "hops": [
      {
        "hop": 1,
        "dexId": "PANCAKE_V3_BASE",
        "dexName": "PancakeSwap V3",
        "poolAddress": "0x72AB388E2E2F6FaceF59E3C3FA2C4E29011c2D38",
        "fee": 100,
        "tokenIn": { "address": "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", "symbol": "ETH", "decimals": 18 },
        "tokenOut": { "address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "symbol": "USDC", "decimals": 6 },
        "amountIn": "1000000000000000000",
        "amountOut": "2698061156",
        "amountInFormatted": "1",
        "amountOutFormatted": "2698.061156",
        "percent": 100
      }
    ],
    "summary": "ETH → USDC (PancakeSwap V3)"
  },
  "dexId": "ALL_BASE",
  "dexFactory": "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865",
  "isNativeIn": true,
  "isNativeOut": false
}
```

| Field | Type | Description |
| :--- | :--- | :--- |
| `amountOut` | `string` | Expected output in atomic units of `tokenB`. Large values may come back in exponent form (e.g. `"1.099e+21"`). Parse with a decimal library (e.g. `decimal.js`, `bignumber.js`), not `BigInt`. |
| `routePlan` | `array` | Machine route consumed by `POST /swap`. Do not modify it. |
| `route` | `object` *(optional)* | Human-readable route for display (§3.4.1). It is omitted if the server could not build it; the quote is still valid. |

#### 3.4.1 `route`: Route Visualization Data

`route` describes the path the quote takes, for a KyberSwap-style "Route" panel (`ETH → USDC → HIGHER`, with the DEX used on each hop). Its amounts come from the same simulation as `amountOut`, so the last hop's `amountOut` equals the quote's `amountOut`.

**TypeScript types:**
```typescript
interface QuoteRouteToken {
  address: string;          // may be lowercase; compare case-insensitively
  symbol: string | null;    // null if metadata could not be read
  decimals: number | null;  // null if metadata could not be read
}

interface QuoteRouteHop {
  hop: number;                       // 1-based, in swap order
  dexId: string;                     // e.g. "UNISWAP_V4_BASE"
  dexName: string;                   // display name, e.g. "Uniswap V4"
  poolAddress: string;               // 20-byte address, or a 32-byte poolId for Uniswap V4
  fee: number;                       // raw DEX fee value; units differ per DEX (see fee table)
  tokenIn: QuoteRouteToken;
  tokenOut: QuoteRouteToken;
  amountIn: string;                  // atomic units (integer string)
  amountOut: string;                 // atomic units (integer string)
  amountInFormatted: string | null;  // human units, e.g. "0.01"; null if decimals unknown
  amountOutFormatted: string | null; // human units, e.g. "27.04861"
  percent: number;                   // share of the trade through this hop; always 100 today
}

interface QuoteRoute {
  path: QuoteRouteToken[];  // tokens in order: path[0] = input, path[path.length - 1] = output
  hops: QuoteRouteHop[];    // hops.length === path.length - 1
  summary: string;          // ready-made text, e.g. "ETH → USDC (Uniswap V4) → HIGHER (Uniswap V3)"
}

interface QuoteResponse {
  tokenA: string;
  tokenB: string;
  amountIn: string;
  amountOut: string;
  tokenPrice: string;
  routePlan: unknown[];
  route?: QuoteRoute;
  dexId: string;
  dexFactory: string;
  isNativeIn: boolean;
  isNativeOut: boolean;
}
```

**Field rules:**
- **Native ETH**: when the user sells or buys native ETH, the first or last token is shown as `ETH` (`0xEeee…EEeE`) even though the pool trades WETH. Display it as is.
- **Chained amounts**: each hop's `amountIn` equals the previous hop's `amountOut`.
- **Formatted amounts** are full-precision decimal strings. Round them for display (e.g. 6 significant digits). If one is `null`, show the raw amount or hide it.
- **`percent`**: the router only returns single-path routes today, so it is always `100`. Still render from `percent` rather than hardcoding, so split routes (e.g. 60% / 40%) work later without frontend changes.
- **`poolAddress`** for Uniswap V4 is a 32-byte pool id, not a contract address. Link V4 pools to the Uniswap app or explorer by pool id, or don't link them.
- **Unknown symbol** (`symbol === null`): fall back to a shortened address (`0x0578…0ffe`).

**Converting `fee` to a percentage** (units differ per DEX):

| `dexId` | `fee` unit | Example | Display |
| :--- | :--- | :--- | :--- |
| `UNISWAP_V3_BASE`, `PANCAKE_V3_BASE`, `UNISWAP_V4_BASE` | hundredths of a bip (1e-6) | `500` | `0.05%` (`fee / 10_000`) |
| `UNISWAP_V2_BASE`, `PANCAKE_V2_BASE`, `AERODROME_V2_BASE` | basis points (1e-4) | `30` | `0.3%` (`fee / 100`) |
| `AERODROME_V3_BASE` | not a reliable fee (may be the pool's tick spacing) | `100` | don't show a percentage |

```typescript
const FEE_PIPS = ["UNISWAP_V3_BASE", "PANCAKE_V3_BASE", "UNISWAP_V4_BASE"];
const FEE_BPS = ["UNISWAP_V2_BASE", "PANCAKE_V2_BASE", "AERODROME_V2_BASE"];

function feePercent(hop: QuoteRouteHop): string | null {
  if (FEE_PIPS.includes(hop.dexId)) return `${hop.fee / 10_000}%`;
  if (FEE_BPS.includes(hop.dexId)) return `${hop.fee / 100}%`;
  return null; // AERODROME_V3_BASE or unknown DEX: hide the fee
}
```

**`dexName` values on Base:** `Uniswap V3`, `PancakeSwap V3`, `Aerodrome V3`, `Uniswap V2`, `PancakeSwap V2`, `Aerodrome V2`, `Uniswap V4`. Map `dexId` to a logo on the frontend; the API returns no logo URLs.

---

### 3.5 Build Swap Transaction

Constructs the raw EVM transaction array (`transactions`) for the user's wallet to execute.

- **Method:** `POST`
- **Path:** `/:chain/swap` (or `/swap`)
- **Headers:** `Content-Type: application/json`

#### Request Body:
```json
{
  "publicKey": "0xYourUserWalletAddress",
  "quote": {
    "tokenA": "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
    "tokenB": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "amountIn": "1000000000000000000",
    "amountOut": "2698061156",
    "tokenPrice": "1.0002",
    "routePlan": [
      {
        "tokenA": "0x4200000000000000000000000000000000000006",
        "tokenB": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "dexId": "PANCAKE_V3_BASE",
        "poolAddress": "0x72AB388E2E2F6FaceF59E3C3FA2C4E29011c2D38",
        "aToB": false,
        "fee": 100
      }
    ],
    "dexId": "ALL_BASE",
    "isNativeIn": true,
    "isNativeOut": false
  },
  "slippage": 0.5,
  "partnerFees": {
    "recipient": "0xPartnerFeeCollectorAddress",
    "fee": 0.5
  }
}
```

| Field | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `publicKey` | `string` | Yes | User's wallet address. |
| `quote` | `object` | Yes | The entire quote object returned from `POST /quote`. Sending it unchanged, including `route`, is fine: the server ignores `route` and builds the transaction from `routePlan`. |
| `slippage` | `number` | Yes | Slippage tolerance percentage (0.1 to 10.0). |
| `partnerFees` | `object` | No | Optional integrator fee (`fee` percentage, `recipient` address). |

#### Response (`200 OK`):
```json
{
  "transactions": [
    {
      "from": "0xYourUserWalletAddress",
      "to": "0xADb0018bCF10b7dD84B7C3e2D92889185DA41f45",
      "data": "0x...",
      "value": "1000000000000000000"
    }
  ]
}
```

> **Note on Approvals:** If `tokenA` is an ERC-20 token and the user's current allowance for `SwapProxy` is insufficient, the API automatically prepends an ERC-20 `approve(0xADb0018bCF10b7dD84B7C3e2D92889185DA41f45, amountIn)` transaction to `transactions[0]`.

---

## 4. Frontend Integration Workflow

When developing the frontend swap widget or channel, follow this sequence:

### Step 0: Search & Select Tokens (by ticker or CA)
```typescript
// Users can type "aero", "eth", "degen", or paste a contract address:
const searchRes = await fetch(`http://localhost:3735/base/tokens/search?q=${encodeURIComponent(query)}`);
const { result: tokens } = await searchRes.json();
// tokens = [{ address: "0x940181...", symbol: "AERO", name: "Aerodrome", decimals: 18, network: "BASE" }]
```

### Step 1: Request Quote
```typescript
const quoteRes = await fetch("http://localhost:3735/base/quote", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    tokenA: tokenInAddress,
    tokenB: tokenOutAddress,
    amountIn: amountInWei.toString(),
    dexId: "ALL_BASE"
  })
});
const quote: QuoteResponse = await quoteRes.json();
```

### Step 1b: Show the Route (optional)
Render `quote.route` beside the quote, the way KyberSwap shows its "Route" panel. Types and field rules are in §3.4.1.

```tsx
function RouteView({ route }: { route?: QuoteRoute }) {
  if (!route || route.hops.length === 0) return null; // route is optional
  const label = (t: QuoteRouteToken) => t.symbol ?? `${t.address.slice(0, 6)}…${t.address.slice(-4)}`;

  return (
    <div className="route">
      <div className="route-path">{route.path.map(label).join(" → ")}</div>
      {route.hops.map((hop) => (
        <div key={hop.hop} className="route-hop">
          <span>{hop.percent}%</span>
          <span>{label(hop.tokenIn)} → {label(hop.tokenOut)}</span>
          <span>{hop.dexName}{feePercent(hop) ? ` · ${feePercent(hop)}` : ""}</span>
          <span>
            {hop.amountInFormatted ?? hop.amountIn} → {hop.amountOutFormatted ?? hop.amountOut}
          </span>
        </div>
      ))}
    </div>
  );
}
```

If you only need one line of text, use `route.summary` (e.g. `"ETH → USDC (Uniswap V4) → HIGHER (Uniswap V3)"`). Re-render the panel on every new quote: the route can change between quotes for the same pair.

### Step 2: Request Transaction Payloads
```typescript
const swapRes = await fetch("http://localhost:3735/base/swap", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    publicKey: userWalletAddress,
    quote: quote,
    slippage: 0.5 // 0.5%
  })
});
const { transactions } = await swapRes.json();
```

### Step 3: Execute in User's Wallet (e.g., Wagmi / Ethers / Viem)
```typescript
for (const tx of transactions) {
  // If ERC-20, tx[0] may be an approve transaction, tx[1] will be the swap
  const txHash = await walletClient.sendTransaction({
    to: tx.to,
    data: tx.data,
    value: BigInt(tx.value || "0")
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });
}
```

---

## 5. Verified Base Tokens & Test Results

The following pairs were verified live against Base Mainnet RPC and pools:

| Swap Pair | Direction | Quoted DEX | Route Status |
| :--- | :--- | :--- | :---: |
| **ETH $\rightarrow$ USDC** | Native $\rightarrow$ ERC-20 | PancakeSwap V3 | ✅ Verified |
| **WETH $\rightarrow$ USDC** | ERC-20 $\rightarrow$ ERC-20 | PancakeSwap V3 | ✅ Verified |
| **USDC $\rightarrow$ WETH** | ERC-20 $\rightarrow$ ERC-20 | PancakeSwap V3 | ✅ Verified |
| **ETH $\rightarrow$ CLANKER** | Native $\rightarrow$ ERC-20 | Aerodrome V3 | ✅ Verified |
| **ETH $\rightarrow$ AERO** | Native $\rightarrow$ ERC-20 | PancakeSwap V3 | ✅ Verified |
| **AERO $\rightarrow$ ETH** | ERC-20 $\rightarrow$ Native | Aerodrome V3 | ✅ Verified |
| **ETH $\rightarrow$ DEGEN** | Native $\rightarrow$ ERC-20 | Uniswap V3 | ✅ Verified |
| **DEGEN $\rightarrow$ ETH** | ERC-20 $\rightarrow$ Native | Aerodrome V3 | ✅ Verified |
| **ETH $\rightarrow$ BRETT** | Native $\rightarrow$ ERC-20 | PancakeSwap V3 | ✅ Verified |

---

## 6. What's Next & Recommendations

1. **Smart Contracts:**
   - **No deployment needed.** All swap proxy contracts and adapters are in place on Base Mainnet.
2. **Aggregator Channel Usage:**
   - Use the `/base/quote` and `/base/swap` channels directly from your frontend web app.
3. **Multi-Hop Traversal (Edge Case):**
   - Direct pairs to/from ETH or WETH resolve across all three DEXes.
   - For multi-hop routing between two non-ETH tokens (e.g., `USDC -> WETH -> CLANKER`), the graph currently rejects the 2nd hop due to the edge cost calculation across differing decimals (6 to 18).
   - If two arbitrary altcoins need to be swapped directly without routing through ETH first on the UI, updating the edge cost weight in `v3Route.ts` will resolve multi-hop pathing.

---

## 7. Backend Step-by-Step Logging Reference

The backend includes structured logs across every layer of the swap lifecycle to diagnose frontend integration issues instantly:

### Log Hierarchy & Prefixes

| Layer | Prefix | What it indicates |
| :--- | :--- | :--- |
| **HTTP Ingress** | `📥 [HTTP IN #id]` | Logs method, full path, origin, query, and request body. |
| **HTTP Egress** | `📤 [HTTP OUT #id]` | Logs response HTTP status code and latency in milliseconds. |
| **Quote Controller** | `[QUOTE:STEP 1..4]` | Payload validation, network resolution, service dispatch, and summary. |
| **Quote Service** | `[QUOTE_SVC:1..5]` | Route search initiation, hops found, on-chain pool simulation, route price. |
| **Graph Router** | `[ROUTER:...]` | BiMap lookups, pool auto-discovery, edge checks, and Dijkstra search. |
| **Swap Controller** | `[SWAP_TX:STEP 1..4]` | Swap payload validation, wallet detection, and transaction dispatch. |
| **Swap Service** | `[SWAP_SVC:1..4]` | Route provider initialization and route plan execution. |
| **Transaction Builder**| `[TX_BUILD:1..4]` | Minimum amount out calculation (with slippage) and path structure. |
| **Contract SDK** | `[SWAP_SDK:1..4]` | Adapter resolution, ERC-20 allowance check, and `SwapProxy.swap` calldata encoding. |
| **Validation Error** | `⚠️ [VALIDATION_ERROR]` | Exact list of missing or mismatched request fields. |

---

## 8. Frontend Troubleshooting Checklist & Common Gotchas

When the frontend reports that "something isn't working", check the backend terminal for the log output matching these common causes:

### 1. `Field "body.tokenB": Required` or `Field "body.dexId": Required`
- **Cause:** Using `fromToken`/`toToken` or `tokenIn`/`tokenOut` instead of `tokenA` and `tokenB`.
- **Fix:** In `POST /base/quote`, ensure the payload uses:
  ```json
  {
    "tokenA": "0x...",
    "tokenB": "0x...",
    "amountIn": "1000000000000000000",
    "dexId": "ALL_BASE"
  }
  ```

### 2. Calling `/swap` instead of `/base/swap`
- **Behavior:** Bare paths (`/quote`, `/swap`, `/tokenPrice/...`, `/tokenDetails/...`, `/tokenList`) now default to **Base** when no chain is given. Earlier builds defaulted to 0G.
- **Recommendation:** Still use the explicit `/base/...` paths (or `"chain": "BASE"` in the body), so requests don't depend on the server default.

### 3. Missing `quote` Object in `POST /base/swap`
- **Cause:** Sending only tokens or amounts instead of the full `quote` object.
- **Fix:** Send the exact quote object received from `POST /base/quote`:
  ```json
  {
    "publicKey": "0xYourWalletAddress",
    "quote": quoteObjectFromQuoteEndpoint,
    "slippage": 0.5
  }
  ```

### 4. Reading Transactions Array from `/swap` Response
- **Response Format:** The response contains `{ "transactions": [ ... ] }`.
- **Frontend Execution:** Iterate through `data.transactions` (NOT `data.transaction.transactions`):
  ```typescript
  const { transactions } = await swapRes.json();
  for (const tx of transactions) {
    await walletClient.sendTransaction({
      to: tx.to,
      data: tx.data,
      value: BigInt(tx.value || "0")
    });
  }
  ```

### 5. `BigInt` throws on `quote.amountOut`
- **Cause:** Very large outputs (≥ 1e21 atomic units, common for 18-decimal meme tokens) are serialized in exponent form, e.g. `"1.099e+21"`, which `BigInt()` rejects.
- **Fix:** Parse `amountOut` with a decimal library, or use `route.hops[route.hops.length - 1].amountOut` / `amountOutFormatted`, which are always plain decimal strings.

### 6. Route panel is empty
- **Cause:** `route` is optional. It is omitted if the server could not build it (e.g. token metadata lookup failed), while the quote itself is still valid.
- **Fix:** Guard with `if (quote.route)` and hide the panel. Never block the swap on `route`; `POST /swap` only needs `routePlan`.

