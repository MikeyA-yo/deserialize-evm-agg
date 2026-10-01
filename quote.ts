//here i want to get the route plan from an swap request

import { getBestRoutes } from "./apps/server/src"
import { JsonRpcProvider } from "ethers"
import { NetworkType } from "./providers/routeProviders/constants"
import { getChainFromName } from "./providers/routeProviders"
import Decimal from "decimal.js"
const input = {

}
const testQuote = async () => {
    const network: NetworkType = "BASE"
    const fromTokenString = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
    const toTokenString = "0x1bc0c42215582d5A085795f4baDbaC3ff36d1Bcb"
    const amount = 1 * (10 ** 18)
    const provider = new JsonRpcProvider(getChainFromName(network).rpcUrl)
    const route = await getBestRoutes(network, fromTokenString, toTokenString, amount, provider)
    console.log('route: ', route.routes);
    const { amountOut, pools } = await route.RouteJsonRpcProvider.getAmountOutFromPlan(new Decimal(amount), route.routes, 0, provider)
    const finalRoutes = route.routes.map((r, i) => {
        return {
            ...r,
            poolAddress: pools[i]
        }
    })
    console.log('finalRoutes: ', finalRoutes);
    console.log('amountOut: ', amountOut.toFixed(0));
}

testQuote()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

