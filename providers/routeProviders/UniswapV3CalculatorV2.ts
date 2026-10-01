import { Contract, JsonRpcProvider } from "ethers";
import { ChainConfig, DexConfig, UniswapV3QuoteCalculator } from "./UniswapV3Calculator";
import Decimal from "decimal.js";
import { Address } from "viem";

export const UNISWAP_V3_QUOTER_V2_ABI = [
    {
        inputs: [
            {
                components: [
                    { internalType: "address", name: "tokenIn", type: "address" },
                    { internalType: "address", name: "tokenOut", type: "address" },
                    { internalType: "uint256", name: "amountIn", type: "uint256" },
                    { internalType: "uint24", name: "fee", type: "uint24" },
                    { internalType: "uint160", name: "sqrtPriceLimitX96", type: "uint160" },
                ],
                internalType: "struct IQuoterV2.QuoteExactInputSingleParams",
                name: "params",
                type: "tuple",
            },
        ],
        name: "quoteExactInputSingle",
        outputs: [
            { internalType: "uint256", name: "amountOut", type: "uint256" },
            { internalType: "uint160", name: "sqrtPriceX96After", type: "uint160" },
            { internalType: "uint32", name: "initializedTicksCrossed", type: "uint32" },
            { internalType: "uint256", name: "gasEstimate", type: "uint256" },
        ],
        stateMutability: "nonpayable",
        type: "function",
    },
] as const;

export class UniswapV3QuoteCalculatorV2 extends UniswapV3QuoteCalculator {
    constructor(config: DexConfig, chainConfig: ChainConfig, _provider?: JsonRpcProvider) {
        super(config, chainConfig, _provider);
    }

    /**
      * Simulate transaction using PancakeSwap V3's QuoterV2
      * Returns extended information including gas estimate and price impact
      */
    public async simulateTransaction(
        tokenIn: string,
        tokenOut: string,
        amountIn: string,
        pool: string,
        fee: number,
        sqrtPriceLimitX96: string = "0"
    ): Promise<{ amountOut: string, pool: string }> {
        console.log('fee: ', fee);
        const config = this.getConfig();
        if (!config.quoterAddress) {
            throw new Error("Quoter address not configured for PancakeSwap V3");
        }
        const client = this.client



        try {


            const amountInBN = BigInt(new Decimal(amountIn).toFixed(0));
            const sqrtPriceLimitBN = BigInt(new Decimal(sqrtPriceLimitX96 || "0").toFixed(0));

            const result = await this.retryWithBackoff(() => client.readContract({
                address: config.quoterAddress as Address,
                abi: UNISWAP_V3_QUOTER_V2_ABI,
                functionName: 'quoteExactInputSingle',
                args: [{
                    tokenIn: tokenIn as Address,
                    tokenOut: tokenOut as Address,
                    amountIn: amountInBN,
                    fee: fee,
                    sqrtPriceLimitX96: sqrtPriceLimitBN,
                }],
            }));

            console.log('result: ', result);
            const amountOut = (result as readonly [bigint])[0].toString();
            return { amountOut, pool };

        } catch (error) {
            console.error("UniswapV3 QuoterV2 simulation failed:", error);
            throw error;
        }
    }

}
