/**
 * @swagger
 * /quote:
 *   post:
 *     summary: Get a swap quote for token pair
 *     description: Returns the best swap route and expected output amount for a token swap on the default chain (0G)
 *     tags: [Swap]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SwapQuoteRequest'
 *     responses:
 *       200:
 *         description: Swap quote successfully generated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SwapQuoteResponse'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /{chain}/quote:
 *   post:
 *     summary: Get a swap quote for token pair on specific chain
 *     description: Returns the best swap route and expected output amount for a token swap on the specified chain
 *     tags: [Swap]
 *     parameters:
 *       - $ref: '#/components/parameters/ChainParam'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SwapQuoteRequest'
 *     responses:
 *       200:
 *         description: Swap quote successfully generated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SwapQuoteResponse'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /testnet/quote:
 *   post:
 *     summary: Get a swap quote on testnet
 *     description: Returns the best swap route and expected output amount for a token swap on the testnet
 *     tags: [Swap]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SwapQuoteRequest'
 *     responses:
 *       200:
 *         description: Swap quote successfully generated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SwapQuoteResponse'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /swap:
 *   post:
 *     summary: Create a swap transaction
 *     description: Generates transaction data for executing a swap based on a quote on the default chain (0G)
 *     tags: [Swap]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SwapTransactionRequest'
 *     responses:
 *       200:
 *         description: Swap transaction successfully generated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SwapTransactionResponse'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /{chain}/swap:
 *   post:
 *     summary: Create a swap transaction on specific chain
 *     description: Generates transaction data for executing a swap based on a quote on the specified chain
 *     tags: [Swap]
 *     parameters:
 *       - $ref: '#/components/parameters/ChainParam'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SwapTransactionRequest'
 *     responses:
 *       200:
 *         description: Swap transaction successfully generated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SwapTransactionResponse'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /testnet/swap:
 *   post:
 *     summary: Create a swap transaction on testnet
 *     description: Generates transaction data for executing a swap based on a quote on the testnet
 *     tags: [Swap]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SwapTransactionRequest'
 *     responses:
 *       200:
 *         description: Swap transaction successfully generated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SwapTransactionResponse'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /tokenDetails/{tokenAddress}:
 *   get:
 *     summary: Get token details
 *     description: Returns detailed information about a token on the default chain (0G)
 *     tags: [Token]
 *     parameters:
 *       - $ref: '#/components/parameters/TokenAddressParam'
 *     responses:
 *       200:
 *         description: Token details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TokenDetails'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /{chain}/tokenDetails/{tokenAddress}:
 *   get:
 *     summary: Get token details on specific chain
 *     description: Returns detailed information about a token on the specified chain
 *     tags: [Token]
 *     parameters:
 *       - $ref: '#/components/parameters/ChainParam'
 *       - $ref: '#/components/parameters/TokenAddressParam'
 *     responses:
 *       200:
 *         description: Token details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TokenDetails'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /tokenPrice/{tokenAddress}:
 *   get:
 *     summary: Get token price
 *     description: Returns the current price of a token on the default chain (0G)
 *     tags: [Token]
 *     parameters:
 *       - $ref: '#/components/parameters/TokenAddressParam'
 *     responses:
 *       200:
 *         description: Token price retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TokenPrice'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /{chain}/tokenPrice/{tokenAddress}:
 *   get:
 *     summary: Get token price on specific chain
 *     description: Returns the current price of a token on the specified chain
 *     tags: [Token]
 *     parameters:
 *       - $ref: '#/components/parameters/ChainParam'
 *       - $ref: '#/components/parameters/TokenAddressParam'
 *     responses:
 *       200:
 *         description: Token price retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TokenPrice'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /tokenList:
 *   get:
 *     summary: Get list of token addresses
 *     description: Returns an array of all available token addresses on the default chain (0G)
 *     tags: [Token]
 *     responses:
 *       200:
 *         description: Token list retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TokenList'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /{chain}/tokenList:
 *   get:
 *     summary: Get list of token addresses on specific chain
 *     description: Returns an array of all available token addresses on the specified chain
 *     tags: [Token]
 *     parameters:
 *       - $ref: '#/components/parameters/ChainParam'
 *     responses:
 *       200:
 *         description: Token list retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TokenList'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /tokenListWithDetails:
 *   get:
 *     summary: Get list of tokens with details
 *     description: Returns an array of all available tokens with their metadata on the default chain (0G)
 *     tags: [Token]
 *     responses:
 *       200:
 *         description: Token list with details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TokenListWithDetails'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /{chain}/tokenListWithDetails:
 *   get:
 *     summary: Get list of tokens with details on specific chain
 *     description: Returns an array of all available tokens with their metadata on the specified chain
 *     tags: [Token]
 *     parameters:
 *       - $ref: '#/components/parameters/ChainParam'
 *     responses:
 *       200:
 *         description: Token list with details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TokenListWithDetails'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /{chain}/tokens:
 *   get:
 *     summary: Get every known token on a chain
 *     description: |
 *       Full token list for token pickers. On Base it merges the CoinGecko Base token list
 *       (about 2,800 tokens, cached 6h), the curated default tokens, tokens already in the
 *       routing graph, and tokens found through search. `indexed` tokens quote instantly; others are
 *       discovered on their first quote (calling `/tokenDetails` for a token starts that early).
 *       `/tokens` without a chain defaults to Base.
 *     tags: [Token]
 *     parameters:
 *       - $ref: '#/components/parameters/ChainParam'
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: Filter by symbol, name or address prefix. Exact symbol matches rank first.
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1 }
 *         description: Page size. Omit to return every token.
 *       - in: query
 *         name: offset
 *         schema: { type: integer, minimum: 0, default: 0 }
 *     responses:
 *       200:
 *         description: Tokens ordered by relevance (with q), then curated, then routable, then symbol
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 result:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       address: { type: string, example: '0x940181a94A35A4569E4529A3CDfB74e38FD98631' }
 *                       symbol: { type: string, example: 'AERO' }
 *                       name: { type: string, example: 'Aerodrome' }
 *                       decimals: { type: integer, example: 18 }
 *                       logoURI: { type: string }
 *                       indexed: { type: boolean, description: 'Already in the routing graph' }
 *                       verified: { type: boolean, description: 'In the curated default list' }
 *                       network: { type: string, example: 'BASE' }
 *                 data: { type: array, description: 'Same as result' }
 *                 total: { type: integer, example: 2849 }
 *                 offset: { type: integer, example: 0 }
 *                 limit: { type: integer, nullable: true }
 *                 network: { type: string, example: 'BASE' }
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */

/**
 * @swagger
 * /{chain}/tokens/market:
 *   get:
 *     summary: Market data for a batch of tokens
 *     description: |
 *       Price, 24h change, 24h volume, market cap, FDV, liquidity and logo per token, from
 *       GeckoTerminal. Cached on the server for 5 minutes per token; only missing or expired
 *       tokens are fetched upstream (30 per call). Tokens GeckoTerminal does not know return null.
 *     tags: [Token]
 *     parameters:
 *       - $ref: '#/components/parameters/ChainParam'
 *       - in: query
 *         name: addresses
 *         required: true
 *         schema: { type: string }
 *         description: Comma-separated token addresses, at most 100. Use WETH for native ETH.
 *     responses:
 *       200:
 *         description: "`result` maps each lowercased address to its market data or null"
 *       400:
 *         description: No addresses, or more than 100
 */

/**
 * @swagger
 * /{chain}/tokens/trending:
 *   get:
 *     summary: Trending tokens
 *     description: Base tokens of GeckoTerminal's trending pools on the chain, with market data. Cached 5 minutes.
 *     tags: [Token]
 *     parameters:
 *       - $ref: '#/components/parameters/ChainParam'
 *     responses:
 *       200:
 *         description: "`result` is a list of tokens with market data, poolName and dex"
 */
