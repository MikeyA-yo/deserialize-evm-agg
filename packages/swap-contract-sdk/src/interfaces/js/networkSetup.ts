

export const networkSetup = (network: { id: string, rpc: string }) => {
    const config = { rpc: "", addresses: { adapterTracker: "", swapProxy: "", nativeToken: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" } }
    if (network.id == "0G") {
        config.rpc = network.rpc;
        config.addresses.adapterTracker = "0xc4b688854e870408E82519204918c8130Fbe4764";
        config.addresses.swapProxy = "0x228864aeAAE12Ee8000D9543d9cCfB538F46Da3b";
        return config
    }
    if (network.id == "BASE") {
        config.rpc = network.rpc;
        // Redeployed Oct 2026: MultiRouteSwapV2 (ERC1967 proxy) + AdapterTracker with V3, V2, Aerodrome V2 and V4 adapters
        config.addresses.adapterTracker = "0xbC9eB41b40be480541b54A4189bB82c4340378a7";
        config.addresses.swapProxy = "0x2B7b17165aAe7Ce6cC390920282473720Db8b30b";
        return config
    }
    return config
}