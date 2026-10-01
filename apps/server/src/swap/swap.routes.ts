// swap.routes.ts
import { Router } from "express";
import {
    // allUserPointsController,
    // getGaslessTransactionController,
    // getTokenAtaTransactionController,
    // getTokenBalanceController,
    // pingController,
    // questController,
    // setBoostController,
    // submitGaslessTransactionRequestController,
    // swapController,
    // swapQuoteAllBetterController,
    // swapQuoteAllController,
    swapQuoteController,
    swapTransactionController,
    tokenDetailsController,
    tokenListController,
    tokenListWithDetailsController,
    tokenPriceController,
    tokenSearchController,
    // tokenListController,
    // tokenPriceController,
    // unWrapEthTxController,
} from "./swap.controllers";
import { swapQuoteService } from "./swap.service";

const swapRouter: Router = Router();

// swapRouter.get("/ping", pingController);

// swapRouter.get("/quest/*", questController);

// swapRouter.get("/tokenPrice/:tokenAddress", tokenPriceController);

// swapRouter.post("/getMintBalances", getTokenBalanceController);

// swapRouter.get("/tokenList", tokenListController);

swapRouter.post("/quote", swapQuoteController);
swapRouter.post("/swap", swapTransactionController);
swapRouter.get("/tokenList", tokenListController);
swapRouter.get("/tokenListWithDetails", tokenListWithDetailsController);
swapRouter.get("/tokenPrice/:tokenAddress", tokenPriceController);
swapRouter.get("/tokenDetails/:tokenAddress", tokenDetailsController);
swapRouter.get("/tokens/search", tokenSearchController);
swapRouter.get("/tokens/search/:query", tokenSearchController);
swapRouter.get("/tokenSearch", tokenSearchController);
swapRouter.get("/tokenSearch/:query", tokenSearchController);


swapRouter.post("/:chain/quote", swapQuoteController);
swapRouter.post("/:chain/swap", swapTransactionController);
swapRouter.get("/:chain/tokenList", tokenListController);
swapRouter.get("/:chain/tokenListWithDetails", tokenListWithDetailsController);
swapRouter.get("/:chain/tokenPrice/:tokenAddress", tokenPriceController);
swapRouter.get("/:chain/tokenDetails/:tokenAddress", tokenDetailsController);
swapRouter.get("/:chain/tokens/search", tokenSearchController);
swapRouter.get("/:chain/tokens/search/:query", tokenSearchController);
swapRouter.get("/:chain/tokenSearch", tokenSearchController);
swapRouter.get("/:chain/tokenSearch/:query", tokenSearchController);



swapRouter.post("/testnet/quote", swapQuoteController);
swapRouter.post("/testnet/swap", swapTransactionController);


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
export default swapRouter;
