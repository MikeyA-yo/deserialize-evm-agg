"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// swap.routes.ts
const express_1 = require("express");
const swap_controllers_1 = require("./swap.controllers");
const swapRouter = (0, express_1.Router)();
// swapRouter.get("/ping", pingController);
// swapRouter.get("/quest/*", questController);
// swapRouter.get("/tokenPrice/:tokenAddress", tokenPriceController);
// swapRouter.post("/getMintBalances", getTokenBalanceController);
// swapRouter.get("/tokenList", tokenListController);
swapRouter.post("/quote", swap_controllers_1.swapQuoteController);
swapRouter.post("/swap", swap_controllers_1.swapTransactionController);
swapRouter.get("/tokenList", swap_controllers_1.tokenListController);
swapRouter.get("/tokenListWithDetails", swap_controllers_1.tokenListWithDetailsController);
swapRouter.get("/tokens", swap_controllers_1.allTokensController);
swapRouter.get("/tokens/market", swap_controllers_1.tokenMarketController);
swapRouter.get("/tokens/trending", swap_controllers_1.trendingTokensController);
swapRouter.get("/tokenPrice/:tokenAddress", swap_controllers_1.tokenPriceController);
swapRouter.get("/tokenDetails/:tokenAddress", swap_controllers_1.tokenDetailsController);
swapRouter.get("/tokens/search", swap_controllers_1.tokenSearchController);
swapRouter.get("/tokens/search/:query", swap_controllers_1.tokenSearchController);
swapRouter.get("/tokenSearch", swap_controllers_1.tokenSearchController);
swapRouter.get("/tokenSearch/:query", swap_controllers_1.tokenSearchController);
swapRouter.post("/:chain/quote", swap_controllers_1.swapQuoteController);
swapRouter.post("/:chain/swap", swap_controllers_1.swapTransactionController);
swapRouter.get("/:chain/tokenList", swap_controllers_1.tokenListController);
swapRouter.get("/:chain/tokenListWithDetails", swap_controllers_1.tokenListWithDetailsController);
swapRouter.get("/:chain/tokens", swap_controllers_1.allTokensController);
swapRouter.get("/:chain/tokens/market", swap_controllers_1.tokenMarketController);
swapRouter.get("/:chain/tokens/trending", swap_controllers_1.trendingTokensController);
swapRouter.get("/:chain/tokenPrice/:tokenAddress", swap_controllers_1.tokenPriceController);
swapRouter.get("/:chain/tokenDetails/:tokenAddress", swap_controllers_1.tokenDetailsController);
swapRouter.get("/:chain/tokens/search", swap_controllers_1.tokenSearchController);
swapRouter.get("/:chain/tokens/search/:query", swap_controllers_1.tokenSearchController);
swapRouter.get("/:chain/tokenSearch", swap_controllers_1.tokenSearchController);
swapRouter.get("/:chain/tokenSearch/:query", swap_controllers_1.tokenSearchController);
swapRouter.post("/testnet/quote", swap_controllers_1.swapQuoteController);
swapRouter.post("/testnet/swap", swap_controllers_1.swapTransactionController);
// swapRouter.post("/quoteAll", swapQuoteAllController);
// swapRouter.post("/quoteAllBetter", swapQuoteAllBetterController);
// swapRouter.post("/setQuest", setBoostController);
// swapRouter.get("/allPoints", allUserPointsController);
// swapRouter.get("/unWrapEth/:tokenAddress", unWrapEthTxController);
// swapRouter.post("/getGaslessTransaction", getGaslessTransactionController);
// swapRouter.post(
//     "/submitGaslessTransaction",
//     submitGaslessTransactionRequestController
// );
// swapRouter.post("/createAta", getTokenAtaTransactionController)
exports.default = swapRouter;
