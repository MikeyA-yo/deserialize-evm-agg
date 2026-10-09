# Base EVM Aggregator Specifications & Frontend Integration Guide

This document specifies the API endpoints, on-chain contracts, routing infrastructure, and integration flow for building frontend swap interfaces on **Base** using `deserialize-evm-agg`.

---

## 1. Executive Summary & Infrastructure Status

| Component | Status | Details |
| :--- | :--- | :--- |
| **Aggregator Smart Contracts** | **Deployed & Active** | Already deployed on Base Mainnet. No custom contracts need to be written or deployed. |
| **DEX Adapters** | **Redeployed Oct 5, 2026** | Swaps execute on Uniswap V3, PancakeSwap V3, Aerodrome V3, Uniswap V2, PancakeSwap V2 and Aerodrome V2 (verified on-chain). Uniswap V4 routes through the pools registered on its adapter (WETH/USDC fee 500 and 3000). Quotes only use routes that can execute, so no frontend change is needed. |
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

- **SwapProxy:** `0x2B7b17165aAe7Ce6cC390920282473720Db8b30b` (new Oct 2026; replaces `0xADb0018b…1f45`)
- **AdapterTracker:** `0xbC9eB41b40be480541b54A4189bB82c4340378a7` (new Oct 2026; replaces `0xf0c3D4dE…892F`)
- **Native ETH Placeholder:** `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE`
- **Wrapped Ether (WETH):** `0x4200000000000000000000000000000000000006`

### Registered DEX Adapters on Base:
| DEX | Factory | Adapter | Executable |
| :--- | :--- | :--- | :---: |
| Uniswap V3 | `0x33128a8fC17869897dcE68Ed026d694621f6FDfD` | `0x8968693f32064DaD06fc7D28945Bc0bed17cA084` | ✅ |
| PancakeSwap V3 | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` | `0xA1744F79bd09B6fa3d830Af6219e28FE3E184435` | ✅ |
| Aerodrome Slipstream (V3) | `0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A` | `0xd33E95a846070b352C4928C4B9167F9ba5F027ff` | ✅ |
| Uniswap V2 | `0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6` | `0xBB507A2fD265ADE1Cf56B0430DeEcF92694fFF81` | ✅ |
| PancakeSwap V2 | `0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E` | `0x66f3A66F4019419691B15284AC501c3b73A829D9` | ✅ |
| Aerodrome V2 | `0x420DD381b31aEf6683db6B902084cB0FFECe40Da` | `0x967AB6b873862F1C8a3fb40490D2180D8993b137` | ✅ |
| Uniswap V4 | PoolManager `0x498581fF718922c3f8e6A244956aF099B2652b2b` | `0xb5fD1C6122db94e52EBc697cca971C5759A54598` | ✅ registered pools: WETH/USDC fee 500 and 3000 |

The frontend never needs adapter addresses. The backend resolves them; they are listed here for reference.

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

### 3.3.1 Get All Tokens

Returns every known token on the chain, for token pickers and token pages. On Base it merges:
- the **CoinGecko Base token list** (about 2,800 tokens, with logos; cached 6 h on the server)
- the curated default tokens
- tokens already in the routing graph
- tokens found earlier through search

- **Method:** `GET`
- **Paths:** `/:chain/tokens` (e.g. `GET /base/tokens`), or `/tokens` (defaults to Base)
- **Query params (all optional):**

| Param | Description |
| :--- | :--- |
| `q` (or `query`) | Filter by symbol, name, or address prefix. Exact symbol matches rank first, then symbol prefix, then substring, then name. |
| `limit` | Page size. Omit to get every token (~2,850 entries, about 0.5 s once cached; the first call after a server start takes ~3–4 s). |
| `offset` | Page start, default `0`. |

#### Response (`200 OK`):
```json
{
  "result": [
    {
      "address": "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
      "symbol": "AERO",
      "name": "Aerodrome",
      "decimals": 18,
      "logoURI": "https://assets.coingecko.com/coins/images/…",
      "indexed": true,
      "verified": true,
      "network": "BASE"
    }
  ],
  "data": [ /* same as result */ ],
  "total": 2849,
  "offset": 0,
  "limit": null,
  "network": "BASE"
}
```

| Field | Meaning |
| :--- | :--- |
| `indexed` | The token is already in the routing graph, so quotes return in ~1–3 s. For other tokens the **first** quote discovers pools on-chain, which takes ~20 s or more (§3.4.2). |
| `verified` | In the curated default list. Treat everything else like an imported token: show a "check the contract address" warning, as the import flow already does. |
| `logoURI` | Optional. Missing for tokens that are only in the routing graph or found via search. |

Order: relevance to `q` (when given), then `verified`, then `indexed`, then symbol A–Z. `address` is checksummed. `total` is the count after filtering by `q`, before pagination. The merged list is cached on the server for 5 minutes, and the CoinGecko list underneath it for 6 hours.

### 3.3.2 Token Market Data & Trending (Explore page)

Market data comes from **GeckoTerminal** (CoinGecko's on-chain API) and is **cached on the aggregator for 5 minutes** per token. Every visitor shares those upstream calls, so call these freely; refetching sooner than 5 minutes returns the same data.

**`GET /:chain/tokens/market?addresses=0xabc,0xdef,…`** (max **100** addresses; use WETH's address for native ETH)
```json
{
  "result": {
    "0x940181a94a35a4569e4529a3cdfb74e38fd98631": {
      "address": "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
      "symbol": "AERO", "name": "Aerodrome Finance", "decimals": 18,
      "logoURI": "https://assets.coingecko.com/…",
      "priceUsd": 0.7968, "priceChange24h": -3.18,
      "volume24hUsd": 23516650, "marketCapUsd": 796253553, "fdvUsd": 1203000000, "liquidityUsd": 41200000,
      "updatedAt": 1791580000000
    },
    "0x0000000000000000000000000000000000000001": null
  },
  "cacheSeconds": 300
}
```
- Keys are **lowercased** addresses. `null` means GeckoTerminal has no data for that token. Any numeric field can be `null`.
- `priceChange24h` is a percent (`-3.18` = −3.18%), taken from the token's most liquid pool.
- If GeckoTerminal is down or blocks the server, **DexScreener** is used as a fallback; if both fail, the last cached values are served.
- Responses include `sources: { "geckoterminal": "ok" | "<error>", "dexscreener": "ok" | "<error>" }`. If prices show as blank, check it first.

**`GET /:chain/tokens/trending`**: tokens from Base's trending pools (about 18–20), same fields plus `poolName` and `dex`, cached 5 minutes.

**Explore page pattern (implemented in `deserialise-frontend`):** load `GET /base/tokens` once, filter it client-side, render 50 rows at a time, and request `/tokens/market` once per 50 visible rows (React Query `staleTime: 5 min`). A "Trending" tab reads `/tokens/trending`.

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

#### 3.4.2 First quote for a new token (pasted address or non-indexed token)

The routing graph only holds tokens whose pools have been discovered. For any other token (`indexed: false` in §3.3.1, or a pasted contract address), the first quote discovers its pools on-chain across all 7 DEXes. That takes **~20 s or more** (two new tokens take longer than one). Later quotes for that token take ~1–3 s.

- **Start discovery early.** `GET /:chain/tokenDetails/:address` starts discovery for a non-indexed token in the background, and a quote arriving meanwhile waits for it instead of starting over. The import flow already calls it when the user pastes an address, so in practice the pools are often ready by the time the user enters an amount.
- **Timeout:** allow **at least 60 s** for `POST /quote` (the frontend now uses 60 s). A 20 s timeout is the root cause of "manually entered token pairs don't work": the request was abandoned while the backend was still discovering pools.
- **Loading state:** while a quote for a non-indexed token is pending, show something like "Finding liquidity for a new token… this can take up to a minute the first time".
- **No liquidity:** if neither token has a pool on any supported Base DEX (directly or via WETH/USDC), the quote returns **HTTP 400** with `message: "No liquidity found for <tokenA> / <tokenB> on any supported BASE DEX (directly or via WETH/USDC)"`. Previously this was a 500. Show it as "No route for this pair".

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
      "to": "0x2B7b17165aAe7Ce6cC390920282473720Db8b30b",
      "data": "0x...",
      "value": "1000000000000000000"
    }
  ]
}
```

> **Note on Approvals:** If `tokenA` is an ERC-20 token and the user's current allowance for `SwapProxy` is insufficient, the API automatically prepends an ERC-20 `approve(0x2B7b17165aAe7Ce6cC390920282473720Db8b30b, amountIn)` transaction to `transactions[0]`.

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

To show a full token list instead (with logos and `indexed` / `verified` flags), load `GET /base/tokens` once and filter it on the client, or pass `?q=` (§3.3.1):
```typescript
const { result: allTokens, total } = await (await fetch("http://localhost:3735/base/tokens")).json();
```
When the user pastes an address that isn't in the list, call `GET /base/tokenDetails/:address` straight away. It returns the metadata and starts pool discovery, so the first quote is faster (§3.4.2).

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

Verified on Oct 5, 2026 against the new contracts: quote → `POST /base/swap` → on-chain `eth_call` dry run of the returned transaction.

| Swap | Quoted output | Route | Execution |
| :--- | :--- | :--- | :---: |
| **0.1 ETH → USDC** | 268.91 USDC | Uniswap V3 | ✅ executes |
| **1 ETH → DAI** | 2,688.79 DAI | PancakeSwap V3 → Uniswap V3 (via USDC) | ✅ executes |
| **0.01 ETH → HIGHER** | 135,219 HIGHER | Uniswap V3 | ✅ executes |
| **0.01 ETH → DEGEN** | 25,370 DEGEN | Aerodrome V3 | ✅ executes |
| **0.05 ETH → AERO** | 157.13 AERO | Aerodrome V3 | ✅ executes |
| **0.5 ETH → cbBTC** | 0.01577849 cbBTC | PancakeSwap V3 → PancakeSwap V3 (via USDC) | ✅ executes |

Single-hop ETH → USDC transactions forced through each of Uniswap V3, PancakeSwap V3, Aerodrome V3, Uniswap V2, PancakeSwap V2 and Aerodrome V2 also execute, as do Uniswap V4 swaps through both registered WETH/USDC pools. ERC-20-input swaps (approve + swap, e.g. 0.5 WETH → 1,346.72 USDC) were dry-run too and execute.

> **No value guard yet.** The API returns the best *executable* route, but it does not yet flag a quote that is far below market price (e.g. when only thin pools exist for a token). Until it does, consider showing a warning when the quote's USD value out is much lower than the USD value in (using `GET /base/tokenPrice/:token` for both tokens).

---

## 6. What's Next & Recommendations

1. **Smart Contracts:**
   - **No deployment needed.** All swap proxy contracts and adapters are in place on Base Mainnet.
2. **Aggregator Channel Usage:**
   - Use the `/base/quote` and `/base/swap` channels directly from your frontend web app.
3. **Multi-Hop Routing:**
   - Multi-hop routes across tokens with different decimals (e.g. `ETH -> USDC -> DAI`, 18 → 6 → 18) resolve correctly as of Oct 5, 2026. Before the edge-cost fix, the router could pick thin pools (e.g. 1 ETH → 8.30 DAI); the same quote now returns ≈ 2,718 DAI via USDC.
   - Every quote is checked against the on-chain quoters across several candidate paths (direct, via WETH, via USDC), and the best real output is returned. `amountOut` and `route` reflect the chosen path.
   - The frontend needs no changes. Quote latency may rise slightly (typically 0–8 s on cached pairs).

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

### 7. Approvals after the Oct 2026 contract redeployment
- **What changed:** the spender is now the new SwapProxy `0x2B7b17165aAe7Ce6cC390920282473720Db8b30b`. Allowances users gave the old proxy (`0xADb0018b…1f45`) do not carry over.
- **What happens:** nothing breaks. `POST /base/swap` checks the allowance against the new proxy and prepends an `approve` transaction when needed, so users with old approvals see one extra approve on their next ERC-20 swap.
- **Frontend action:** if the frontend hardcodes the proxy address anywhere (allowance checks, approval UI, "revoke" links, explorer links), update it to `0x2B7b17165aAe7Ce6cC390920282473720Db8b30b`. Otherwise just send the transactions `/swap` returns, in order.
