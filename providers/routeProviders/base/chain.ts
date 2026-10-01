import path from "path";
import dotenv from "dotenv";
import { ChainConfig } from "../UniswapV3Calculator";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

export const chain: ChainConfig = {
    name: "Base",
    network: "BASE",
    get rpcUrl() {
        return process.env.BASE_RPC_URL || "https://mainnet.base.org";
    },
    wrappedNativeTokenAddress: "0x4200000000000000000000000000000000000006",
    wrappedTokenSymbol: "WETH",
    nativeTokenAddress: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
    nativeTokenSymbol: "ETH",
    stableTokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    chainId: 8453
}