import { Options } from 'swagger-jsdoc';

export const swaggerOptions: Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'EVM Aggregator API',
      version: '1.0.0',
      description: 'API for aggregating swap routes across multiple DEXes on EVM chains',
      contact: {
        name: 'Deserialize Team',
      },
    },
    servers: [
      {
        url: 'http://localhost:{port}',
        description: 'Local development server',
        variables: {
          port: {
            default: '3000',
            description: 'Server port',
          },
        },
      },
    ],
    tags: [
      {
        name: 'Swap',
        description: 'Swap quote and transaction endpoints',
      },
      {
        name: 'Token',
        description: 'Token information endpoints',
      },
    ],
    components: {
      schemas: {
        Chain: {
          type: 'string',
          enum: ['0G', 'BASE', 'TESTNET'],
          description: 'Supported blockchain networks',
          default: '0G',
        },
        DexId: {
          type: 'string',
          description: 'DEX identifier',
          example: 'ZERO_G',
        },
        Address: {
          type: 'string',
          pattern: '^0x[a-fA-F0-9]{40}$',
          description: 'Ethereum address',
          example: '0x1234567890123456789012345678901234567890',
        },
        RouteStep: {
          type: 'object',
          properties: {
            tokenA: {
              type: 'string',
              description: 'Address of token A in this step',
              example: '0x1234567890123456789012345678901234567890',
            },
            tokenB: {
              type: 'string',
              description: 'Address of token B in this step',
              example: '0x0987654321098765432109876543210987654321',
            },
            poolAddress: {
              type: 'string',
              description: 'Liquidity pool address',
              example: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
            },
            fee: {
              type: 'number',
              description: 'Pool fee tier',
              example: 3000,
            },
            aToB: {
              type: 'boolean',
              description: 'Direction of swap (true if A to B)',
              example: true,
            },
            dexId: {
              type: 'string',
              description: 'DEX identifier for this step',
              example: 'ZERO_G',
            },
          },
          required: ['tokenA', 'tokenB', 'poolAddress', 'fee', 'aToB', 'dexId'],
        },
        SwapQuoteRequest: {
          type: 'object',
          required: ['tokenA', 'tokenB', 'amountIn', 'dexId'],
          properties: {
            tokenA: {
              type: 'string',
              description: 'Token address to swap from',
              example: '0x1234567890123456789012345678901234567890',
            },
            tokenB: {
              type: 'string',
              description: 'Token address to swap to',
              example: '0x0987654321098765432109876543210987654321',
            },
            amountIn: {
              type: 'string',
              description: 'Amount to swap (will be converted to float)',
              example: '1000',
            },
            dexId: {
              type: 'string',
              description: 'DEX identifier',
              example: 'ZERO_G',
            },
            options: {
              type: 'object',
              properties: {
                targetRouteNumber: {
                  type: 'number',
                  description: 'Number of routes to target',
                  default: 5,
                  example: 5,
                },
              },
            },
          },
        },
        SwapQuoteResponse: {
          type: 'object',
          properties: {
            tokenA: {
              type: 'string',
              description: 'Token address swapping from',
              example: '0x1234567890123456789012345678901234567890',
            },
            tokenB: {
              type: 'string',
              description: 'Token address swapping to',
              example: '0x0987654321098765432109876543210987654321',
            },
            amountIn: {
              type: 'string',
              description: 'Input amount',
              example: '1000',
            },
            amountOut: {
              type: 'string',
              description: 'Expected output amount from the route',
              example: '999.5',
            },
            tokenPrice: {
              type: 'string',
              description: 'Price of the token',
              example: '0.9995',
            },
            routePlan: {
              type: 'array',
              items: {
                $ref: '#/components/schemas/RouteStep',
              },
              description: 'Ordered list of swap steps to execute',
            },
            route: {
              $ref: '#/components/schemas/QuoteRoute',
            },
            dexId: {
              type: 'string',
              description: 'DEX identifier',
              example: 'ZERO_G',
            },
            dexFactory: {
              type: 'string',
              description: 'DEX factory address',
              example: '0xfactoryfactoryfactoryfactoryfactoryfactory1',
            },
            isNativeIn: {
              type: 'boolean',
              description: 'Whether input token is native currency',
              example: false,
            },
            isNativeOut: {
              type: 'boolean',
              description: 'Whether output token is native currency',
              example: false,
            },
          },
        },
        QuoteRouteToken: {
          type: 'object',
          properties: {
            address: { type: 'string', example: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' },
            symbol: { type: 'string', nullable: true, example: 'ETH' },
            decimals: { type: 'integer', nullable: true, example: 18 },
          },
        },
        QuoteRouteHop: {
          type: 'object',
          properties: {
            hop: { type: 'integer', description: '1-based hop index', example: 1 },
            dexId: { type: 'string', example: 'UNISWAP_V4_BASE' },
            dexName: { type: 'string', example: 'Uniswap V4' },
            poolAddress: { type: 'string', description: 'Pool address (bytes32 poolId for Uniswap V4)' },
            fee: { type: 'number', description: 'Pool fee as stored by the DEX route (units differ per DEX)', example: 500 },
            tokenIn: { $ref: '#/components/schemas/QuoteRouteToken' },
            tokenOut: { $ref: '#/components/schemas/QuoteRouteToken' },
            amountIn: { type: 'string', description: 'Raw base units', example: '10000000000000000' },
            amountOut: { type: 'string', description: 'Raw base units', example: '27047401' },
            amountInFormatted: { type: 'string', nullable: true, description: 'Human units (null if decimals unknown)', example: '0.01' },
            amountOutFormatted: { type: 'string', nullable: true, example: '27.047401' },
            percent: { type: 'number', description: 'Share of the input routed through this hop (single-path routing, always 100)', example: 100 },
          },
        },
        QuoteRoute: {
          type: 'object',
          description: 'Human-readable route for display. Omitted if it could not be built; routePlan is unaffected.',
          properties: {
            path: { type: 'array', items: { $ref: '#/components/schemas/QuoteRouteToken' }, description: 'Tokens in swap order' },
            hops: { type: 'array', items: { $ref: '#/components/schemas/QuoteRouteHop' } },
            summary: { type: 'string', example: 'ETH → USDC (Uniswap V4)' },
          },
        },
        PartnerFees: {
          type: 'object',
          required: ['recipient', 'fee'],
          properties: {
            recipient: {
              type: 'string',
              description: 'Partner fee recipient address',
              example: '0x1234567890123456789012345678901234567890',
            },
            fee: {
              type: 'number',
              description: 'Partner fee amount',
              example: 0,
            },
          },
        },
        SwapTransactionRequest: {
          type: 'object',
          required: ['publicKey', 'quote', 'slippage'],
          properties: {
            publicKey: {
              type: 'string',
              description: "User's wallet address",
              example: '0x1234567890123456789012345678901234567890',
            },
            quote: {
              $ref: '#/components/schemas/SwapQuoteResponse',
              description: 'Quote object from the /quote endpoint',
            },
            slippage: {
              type: 'number',
              minimum: 0,
              maximum: 10,
              description: 'Slippage tolerance percentage (0-10%)',
              example: 0.5,
            },
            partnerFees: {
              $ref: '#/components/schemas/PartnerFees',
              description: 'Optional partner fee configuration',
            },
          },
        },
        SwapTransactionResponse: {
          type: 'object',
          properties: {
            transaction: {
              type: 'object',
              properties: {
                transactions: {
                  type: 'array',
                  items: {
                    type: 'object',
                  },
                  description: 'Array of transaction objects to execute',
                },
              },
            },
          },
        },
        TokenDetails: {
          type: 'object',
          properties: {
            result: {
              type: 'object',
              properties: {
                contractAddress: {
                  type: 'string',
                  description: 'Token contract address',
                  example: '0x1234567890123456789012345678901234567890',
                },
                decimals: {
                  type: 'number',
                  description: 'Token decimals',
                  example: 18,
                },
                name: {
                  type: 'string',
                  description: 'Token name',
                  example: 'Example Token',
                },
                symbol: {
                  type: 'string',
                  description: 'Token symbol',
                  example: 'EXT',
                },
              },
            },
          },
        },
        TokenPrice: {
          type: 'object',
          properties: {
            result: {
              type: 'string',
              description: 'Token price',
              example: '1.234',
            },
          },
        },
        TokenList: {
          type: 'object',
          properties: {
            result: {
              type: 'array',
              items: {
                type: 'string',
                description: 'Token address',
                example: '0x1234567890123456789012345678901234567890',
              },
              description: 'Array of token addresses',
            },
          },
        },
        TokenListWithDetails: {
          type: 'object',
          properties: {
            result: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  contractAddress: {
                    type: 'string',
                    example: '0x1234567890123456789012345678901234567890',
                  },
                  decimals: {
                    type: 'number',
                    example: 18,
                  },
                  name: {
                    type: 'string',
                    example: 'Example Token',
                  },
                  symbol: {
                    type: 'string',
                    example: 'EXT',
                  },
                },
              },
            },
          },
        },
        Error: {
          type: 'object',
          properties: {
            code: {
              type: 'number',
              description: 'HTTP status code',
              example: 400,
            },
            message: {
              type: 'string',
              description: 'Error message',
              example: 'Invalid request parameters',
            },
            stack: {
              type: 'string',
              description: 'Stack trace (development only)',
            },
            cause: {
              type: 'string',
              description: 'Error cause (development only)',
            },
            errors: {
              type: 'array',
              items: {
                type: 'string',
              },
              description: 'Array of validation errors (development only)',
            },
          },
        },
      },
      parameters: {
        ChainParam: {
          in: 'path',
          name: 'chain',
          schema: {
            $ref: '#/components/schemas/Chain',
          },
          required: true,
          description: 'Blockchain network',
        },
        TokenAddressParam: {
          in: 'path',
          name: 'tokenAddress',
          schema: {
            type: 'string',
            pattern: '^0x[a-fA-F0-9]{40}$',
          },
          required: true,
          description: 'Token contract address',
        },
      },
      responses: {
        BadRequest: {
          description: 'Bad request - Invalid parameters',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error',
              },
            },
          },
        },
        InternalServerError: {
          description: 'Internal server error',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error',
              },
            },
          },
        },
      },
    },
  },
  apis: [
    './src/swagger/routes.docs.ts',
    './apps/server/src/swagger/routes.docs.ts',
  ],
};
