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

Allows frontend token pickers/search bars to search tokens by their ticker (e.g. `ETH`, `AERO`, `BRETT`, `DEGEN`, `USDC`, `CLANKER`), token name, or contract address (CA).

- **Method:** `GET`
- **Paths Supported:**
  - `/:chain/tokens/search?q=:query` (e.g. `GET /base/tokens/search?q=aero`)
  - `/:chain/tokens/search/:query` (e.g. `GET /base/tokens/search/aero`)
  - `/:chain/tokenSearch?query=:query`
  - `/tokens/search?q=:query` (defaults to Base chain)
- **Supported Query Params:** `q`, `query`, `tick`, `symbol`
- **Behavior:**
  - Matches ticker symbols (exact matches ranked first, then prefix matches, then substring matches).
  - Matches token names and contract address prefixes.
  - Automatically fetches on-chain details if a valid 42-character contract address (`0x...`) is entered.
  - Returns default top tokens if query is empty.

#### Example Request:
```http
GET http://localhost:3735/base/tokens/search?q=aero
```

#### Response (`200 OK`):
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
  ],
  "data": [
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
  "dexId": "ALL_BASE",
  "dexFactory": "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865",
  "isNativeIn": true,
  "isNativeOut": false
}
```

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
| `quote` | `object` | Yes | The entire quote object returned from `POST /quote`. |
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
const quote = await quoteRes.json();
```

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
- **Cause:** Calling the bare root path `/swap` without specifying `/base/swap`.
- **Resolution:** Always use `POST /base/swap` (or include `"chain": "BASE"` in the body).

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

