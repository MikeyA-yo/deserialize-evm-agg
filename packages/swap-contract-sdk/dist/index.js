"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSwapTX = void 0;
const web3_1 = __importDefault(require("web3"));
const contructHop_1 = require("./helpers/contructHop");
const IMultiRouterSwapV1_json_1 = __importDefault(require("./interfaces/js/IMultiRouterSwapV1.json"));
const erc20_json_1 = __importDefault(require("./interfaces/js/erc20.json"));
const networkSetup_1 = require("./interfaces/js/networkSetup");
const createSwapTX = async ({ path, amountInRaw, minAmountOut }, walletAddress, provider, network, 
// isNativeIn: boolean,
partnerFees) => {
    if (!walletAddress)
        throw new Error("Wallet address must be passed");
    if (path.length < 1)
        throw new Error("Invalid path");
    const { rpc, addresses: { adapterTracker, nativeToken, swapProxy } } = (0, networkSetup_1.networkSetup)(network);
    if (!nativeToken || !swapProxy || !adapterTracker)
        throw new Error("Invalid network config");
    console.log(`        [SWAP_SDK:1/4] Network config for ${network.id}: swapProxy=${swapProxy}, adapterTracker=${adapterTracker}`);
    console.log(`        [SWAP_SDK:2/4] Resolving adapter hops...`);
    const hops = await (0, contructHop_1.constructHop)(path, adapterTracker, provider);
    console.log(`        [SWAP_SDK:2/4] Resolved ${hops.length} hop(s):`, hops);
    const web3 = new web3_1.default(provider._getConnection().url || rpc);
    const txs = [];
    if (path[0].tokenIn.toLowerCase() !== nativeToken.toLowerCase()) {
        const erc20 = new web3.eth.Contract(erc20_json_1.default, path[0].tokenIn);
        const allowance = await erc20.methods.allowance(walletAddress, swapProxy).call();
        console.log(`        [SWAP_SDK:3/4] ERC20 allowance check on ${path[0].tokenIn}: allowance=${allowance.toString()}, required=${amountInRaw}`);
        if (allowance < BigInt(amountInRaw)) {
            console.log(`        [SWAP_SDK:APPROVE] Insufficient allowance. Adding ERC20 approve transaction for spender ${swapProxy}...`);
            const approveABI = erc20.methods.approve(swapProxy, amountInRaw).encodeABI();
            txs.push({
                from: walletAddress,
                to: path[0].tokenIn,
                data: approveABI,
            });
        }
        else {
            console.log(`        [SWAP_SDK:APPROVE] Allowance is sufficient. Approval transaction not needed.`);
        }
    }
    else {
        console.log(`        [SWAP_SDK:3/4] Input token is native (${nativeToken}). Skipping ERC20 allowance check.`);
    }
    const proxyContract = new web3.eth.Contract(IMultiRouterSwapV1_json_1.default, swapProxy);
    const partnerFeeSettings = partnerFees ? {
        partnerFee: partnerFees.fee * 100,
        feeRecepient: partnerFees.recipient,
    } : {
        partnerFee: 0,
        feeRecepient: "0x0000000000000000000000000000000000000000",
    };
    console.log(`        [SWAP_SDK:4/4] Encoding swap call on swapProxy (${swapProxy}): amountIn=${amountInRaw}, minAmountOut=${minAmountOut}, partnerFee=${partnerFeeSettings.partnerFee}`);
    const proxyABI = proxyContract.methods
        .swap(hops, amountInRaw, minAmountOut, partnerFeeSettings)
        .encodeABI();
    txs.push({
        from: walletAddress,
        to: swapProxy,
        data: proxyABI,
        value: path[0].tokenIn.toLowerCase() === nativeToken.toLowerCase() ? amountInRaw : "0",
    });
    console.log(`        [SWAP_SDK:SUCCESS] Successfully assembled ${txs.length} transaction payload(s).`);
    return txs;
};
exports.createSwapTX = createSwapTX;
//# sourceMappingURL=index.js.map