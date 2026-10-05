export const DESERIALIZE_FEE = 0

/**
 * DEXes excluded from routing, e.g. while their on-chain adapter cannot execute swaps.
 * Empty by default: since the Oct 5 2026 adapter migration every Base DEX executes (Uniswap V4
 * is additionally gated per pool by its adapter's registrations). Use the DISABLED_DEX_IDS env
 * var (comma-separated dexIds) to take a DEX out of routing without a code change.
 */
export const DISABLED_DEX_IDS: string[] = (process.env.DISABLED_DEX_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);