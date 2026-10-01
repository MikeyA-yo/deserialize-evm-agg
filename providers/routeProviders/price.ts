// Price Service with DeFiLlama + DexScreener (Free, No API Key Required) and optional Hermes fallback

const HERMES_URL = 'https://hermes.pyth.network';
const DEFILLAMA_URL = 'https://coins.llama.fi/prices/current';
const DEXSCREENER_URL = 'https://api.dexscreener.com/latest/dex';

export interface PriceData {
    symbol: string;
    price: number;
    conf: number;
    expo: number;
    publishTime: number;
    priceId: string;
}

export interface PriceResult {
    success: boolean;
    data?: PriceData;
    error?: string;
    timestamp: number;
}

export interface MultiplePriceResult {
    success: boolean;
    data?: Record<string, PriceData>;
    error?: string;
    timestamp: number;
}

// Stable Price Feed IDs (Pyth permanent feed IDs preserved for backward compatibility)
export const STABLE_PRICE_FEED_IDS: Record<string, string> = {
    'BTC': '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
    'ETH': '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
    'WETH': '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
    'SOL': '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
    'USDC': '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
    'USDT': '0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b',
    'BNB': '0x2f95862b045670cd22bee3114c39763a4a08beeb663b145d283c31d7d1101c4f',
    'ADA': '0x2a01deaec9e51a579277b34b122399984d0bbf57e2458a7e42fecd2829867a0d',
    'DOGE': '0xdcef50dd0a4cd2dcc17e45df1676dcb336a11a61c69df7a0299b0150c672d25c',
    'MATIC': '0x5de33a9112c2b700b8d30b8a3402c103578ccfa2765696471cc672bd5cf6ac52',
    'POL': '0x5de33a9112c2b700b8d30b8a3402c103578ccfa2765696471cc672bd5cf6ac52',
    'AVAX': '0x93da3352f9f1d105fdfe4971cfa80e9dd777bfc5d0f683ebb6e1294b92137bb7',
    'LINK': '0x8ac0c70fff57e9aefdf5edf44b51d62c2d433653cbb2cf5cc06bb115af04d221',
    'DOT': '0xca3eed9b267293f6595901c734c7525ce8ef49adafe8284606ceb307afa2ca5b',
    'UNI': '0x78d185a741d07edb3aeb9547aa6e684ec6a78531e2aa267e7a52f3c4a14d0b57',
    'LTC': '0x6e3f3fa8253588df9326580180233eb791e03b443a3ba7a1d892e73874e19a54',
    'BCH': '0x3dd2b63686a450ec7077a143b0cc7050e5b4e8ad0b34e7f5d5e1b97c7d4b8c5e',
    'XRP': '0xec5d399846a9209f3fe5881d70aae9268c94339ff9817e8d18ff19fa05eea1c8',
    'ATOM': '0xb00b60f88b03a6a625a8d1c048c3f66653edf217439983d037e7222c4e612819',
    'APT': '0x03ae4db29ed4ae33d323568895aa00337e658e348b37509f5372ae51f0af00d5',
    'NEAR': '0xc415de8d2eba7db216527dff4b60e8f3a5311c740dadb233e13e12547e226750',
    'FTT': '0x8a12be339b0cd1829b91adc01977caa5bf8ad40e5d94d27fed8c8d53c58c0c7',
    '0G': '0xfa9e8d4591613476ad0961732475dc08969d248faca270cc6c47efe009ea3070'
};

// Mapping from symbol to DeFiLlama coin identifier (100% free, no API key needed)
const SYMBOL_TO_DEFILLAMA: Record<string, string> = {
    'BTC': 'coingecko:bitcoin',
    'ETH': 'coingecko:ethereum',
    'WETH': 'coingecko:ethereum',
    'SOL': 'coingecko:solana',
    'USDC': 'coingecko:usd-coin',
    'USDT': 'coingecko:tether',
    'BNB': 'coingecko:binancecoin',
    'ADA': 'coingecko:cardano',
    'DOGE': 'coingecko:dogecoin',
    'MATIC': 'coingecko:matic-network',
    'POL': 'coingecko:matic-network',
    'AVAX': 'coingecko:avalanche-2',
    'LINK': 'coingecko:chainlink',
    'DOT': 'coingecko:polkadot',
    'UNI': 'coingecko:uniswap',
    'LTC': 'coingecko:litecoin',
    'BCH': 'coingecko:bitcoin-cash',
    'XRP': 'coingecko:ripple',
    'ATOM': 'coingecko:cosmos',
    'APT': 'coingecko:aptos',
    'NEAR': 'coingecko:near',
    'FTT': 'coingecko:ftx-token',
    '0G': 'coingecko:zero-gravity',
    'CLANKER': 'base:0x1bc0c42215582d5A085795f4baDbaC3ff36d1Bcb'
};

// In-memory cache for prices to avoid repeated network calls (30 second TTL)
interface CacheEntry {
    data: PriceData;
    timestamp: number;
}
const localPriceCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30 * 1000;

function getFromLocalCache(key: string): PriceData | null {
    const entry = localPriceCache.get(key.toUpperCase());
    if (entry && (Date.now() - entry.timestamp < CACHE_TTL_MS)) {
        return entry.data;
    }
    return null;
}

function setToLocalCache(key: string, data: PriceData): void {
    localPriceCache.set(key.toUpperCase(), { data, timestamp: Date.now() });
}

// Reverse mapping for looking up symbol by price ID
const PRICE_ID_TO_SYMBOL: Record<string, string> = {};
for (const [symbol, id] of Object.entries(STABLE_PRICE_FEED_IDS)) {
    PRICE_ID_TO_SYMBOL[id.toLowerCase()] = symbol;
}

/**
 * Fetch price from DeFiLlama (Free, public, no key)
 */
async function fetchPriceFromDeFiLlama(llamaId: string, symbol: string): Promise<PriceData | null> {
    try {
        const response = await fetch(`${DEFILLAMA_URL}/${llamaId}`);
        if (!response.ok) return null;

        const data = (await response.json()) as any;
        const coin = data?.coins?.[llamaId];
        if (!coin || typeof coin.price !== 'number') return null;

        return {
            symbol: symbol.toUpperCase(),
            price: coin.price,
            conf: coin.confidence ?? 0.99,
            expo: 0,
            publishTime: coin.timestamp ?? Math.floor(Date.now() / 1000),
            priceId: STABLE_PRICE_FEED_IDS[symbol.toUpperCase()] || llamaId
        };
    } catch {
        return null;
    }
}

/**
 * Fetch multiple prices from DeFiLlama in a single batch request
 */
async function fetchMultiplePricesFromDeFiLlama(
    llamaIdToSymbol: Record<string, string>
): Promise<Record<string, PriceData>> {
    try {
        const ids = Object.keys(llamaIdToSymbol);
        if (ids.length === 0) return {};

        const response = await fetch(`${DEFILLAMA_URL}/${ids.join(',')}`);
        if (!response.ok) return {};

        const data = (await response.json()) as any;
        const result: Record<string, PriceData> = {};

        for (const [id, symbol] of Object.entries(llamaIdToSymbol)) {
            const coin = data?.coins?.[id];
            if (coin && typeof coin.price === 'number') {
                const priceData: PriceData = {
                    symbol: symbol.toUpperCase(),
                    price: coin.price,
                    conf: coin.confidence ?? 0.99,
                    expo: 0,
                    publishTime: coin.timestamp ?? Math.floor(Date.now() / 1000),
                    priceId: STABLE_PRICE_FEED_IDS[symbol.toUpperCase()] || id
                };
                result[symbol.toUpperCase()] = priceData;
                setToLocalCache(symbol, priceData);
            }
        }

        return result;
    } catch {
        return {};
    }
}

/**
 * Fetch token price from DexScreener (Fallback, free, no key)
 */
async function fetchPriceFromDexScreener(query: string, symbol: string): Promise<PriceData | null> {
    try {
        const url = query.startsWith('0x')
            ? `${DEXSCREENER_URL}/tokens/${query}`
            : `${DEXSCREENER_URL}/search?q=${encodeURIComponent(query)}`;

        const response = await fetch(url);
        if (!response.ok) return null;

        const data = (await response.json()) as any;
        const pair = data?.pairs?.[0];
        if (!pair || !pair.priceUsd) return null;

        const price = parseFloat(pair.priceUsd);
        if (isNaN(price)) return null;

        return {
            symbol: symbol.toUpperCase(),
            price,
            conf: 0.95,
            expo: 0,
            publishTime: Math.floor(Date.now() / 1000),
            priceId: STABLE_PRICE_FEED_IDS[symbol.toUpperCase()] || query
        };
    } catch {
        return null;
    }
}

/**
 * Optional: Fetch from Hermes if user provided an API key
 */
async function fetchPriceFromHermes(priceId: string): Promise<PriceData | null> {
    const apiKey = process.env.HERMES_API_KEY;
    if (!apiKey) return null;

    try {
        const response = await fetch(
            `${HERMES_URL}/api/latest_price_feeds?ids[]=${priceId}&verbose=false&binary=false`,
            { headers: { Authorization: `Bearer ${apiKey}` } }
        );

        if (!response.ok) return null;

        const data = (await response.json()) as any;
        if (!data || !Array.isArray(data) || data.length === 0) return null;

        const priceData = data[0];
        const price = priceData.price;
        if (!price || !price.price) return null;

        const normalizedPrice = parseFloat(price.price) * Math.pow(10, price.expo);
        const normalizedConf = parseFloat(price.conf) * Math.pow(10, price.expo);

        return {
            symbol: priceData.id,
            price: normalizedPrice,
            conf: normalizedConf,
            expo: price.expo,
            publishTime: parseInt(price.publish_time),
            priceId: priceData.id
        };
    } catch {
        return null;
    }
}

/**
 * Get USD price for a token by symbol (DeFiLlama primary, DexScreener fallback)
 */
export async function getTokenPrice(symbol: string): Promise<PriceResult> {
    const upperSymbol = symbol.toUpperCase();
    const result: PriceResult = {
        success: false,
        timestamp: Date.now()
    };

    try {
        // 1. Check local cache
        const cached = getFromLocalCache(upperSymbol);
        if (cached) {
            return { success: true, data: cached, timestamp: Date.now() };
        }

        // Special handling for stablecoins
        if (upperSymbol === 'USDC' || upperSymbol === 'USDT' || upperSymbol === 'DAI') {
            const stableData: PriceData = {
                symbol: upperSymbol,
                price: 1.0,
                conf: 1.0,
                expo: 0,
                publishTime: Math.floor(Date.now() / 1000),
                priceId: STABLE_PRICE_FEED_IDS[upperSymbol] || upperSymbol
            };
            setToLocalCache(upperSymbol, stableData);
            return { success: true, data: stableData, timestamp: Date.now() };
        }

        // 2. Try Hermes if API key is explicitly configured
        const priceId = STABLE_PRICE_FEED_IDS[upperSymbol];
        if (priceId && process.env.HERMES_API_KEY) {
            const hermesData = await fetchPriceFromHermes(priceId);
            if (hermesData) {
                setToLocalCache(upperSymbol, hermesData);
                return { success: true, data: hermesData, timestamp: Date.now() };
            }
        }

        // 3. Try DeFiLlama (Free, fast, no key)
        const llamaId = SYMBOL_TO_DEFILLAMA[upperSymbol];
        if (llamaId) {
            const llamaData = await fetchPriceFromDeFiLlama(llamaId, upperSymbol);
            if (llamaData) {
                setToLocalCache(upperSymbol, llamaData);
                return { success: true, data: llamaData, timestamp: Date.now() };
            }
        }

        // 4. Try DexScreener (Fallback, free)
        const dexData = await fetchPriceFromDexScreener(upperSymbol, upperSymbol);
        if (dexData) {
            setToLocalCache(upperSymbol, dexData);
            return { success: true, data: dexData, timestamp: Date.now() };
        }

        // Special fallback for 0G (testnet/development)
        if (upperSymbol === '0G') {
            const ogData: PriceData = {
                symbol: '0G',
                price: 1.0,
                conf: 1.0,
                expo: 0,
                publishTime: Math.floor(Date.now() / 1000),
                priceId: STABLE_PRICE_FEED_IDS['0G']
            };
            return { success: true, data: ogData, timestamp: Date.now() };
        }

        result.error = `Unable to fetch price for symbol: ${upperSymbol}`;
        return result;
    } catch (error) {
        result.error = error instanceof Error ? error.message : 'Unknown error occurred';
        return result;
    }
}

/**
 * Get USD price for a token using Stable Price Feed ID directly
 */
export async function getTokenPriceById(priceId: string): Promise<PriceResult> {
    const result: PriceResult = {
        success: false,
        timestamp: Date.now()
    };

    try {
        if (!priceId || typeof priceId !== 'string') {
            result.error = 'Invalid price feed ID provided';
            return result;
        }

        // 1. Try Hermes if key is set
        if (process.env.HERMES_API_KEY) {
            const hermesData = await fetchPriceFromHermes(priceId);
            if (hermesData) {
                result.success = true;
                result.data = hermesData;
                return result;
            }
        }

        // 2. Reverse-map priceId to symbol and fetch via DeFiLlama
        const symbol = PRICE_ID_TO_SYMBOL[priceId.toLowerCase()];
        if (symbol) {
            return await getTokenPrice(symbol);
        }

        result.error = `Failed to fetch price data for price ID: ${priceId}`;
        return result;
    } catch (error) {
        result.error = error instanceof Error ? error.message : 'Unknown error occurred';
        return result;
    }
}

/**
 * Get USD prices for multiple tokens by symbols
 */
export async function getMultipleTokenPrices(symbols?: string[] | string): Promise<MultiplePriceResult> {
    const result: MultiplePriceResult = {
        success: false,
        timestamp: Date.now()
    };

    try {
        let requestedSymbols: string[] = [];
        if (typeof symbols === 'string') {
            requestedSymbols = symbols.split(',').map(s => s.trim().toUpperCase());
        } else if (Array.isArray(symbols)) {
            requestedSymbols = symbols.map(s => s.trim().toUpperCase());
        } else {
            requestedSymbols = Object.keys(STABLE_PRICE_FEED_IDS);
        }

        const llamaIdToSymbol: Record<string, string> = {};
        const finalResult: Record<string, PriceData> = {};

        for (const sym of requestedSymbols) {
            const cached = getFromLocalCache(sym);
            if (cached) {
                finalResult[sym] = cached;
            } else if (sym === 'USDC' || sym === 'USDT') {
                const stable: PriceData = {
                    symbol: sym,
                    price: 1.0,
                    conf: 1.0,
                    expo: 0,
                    publishTime: Math.floor(Date.now() / 1000),
                    priceId: STABLE_PRICE_FEED_IDS[sym] || sym
                };
                finalResult[sym] = stable;
            } else if (SYMBOL_TO_DEFILLAMA[sym]) {
                llamaIdToSymbol[SYMBOL_TO_DEFILLAMA[sym]] = sym;
            }
        }

        if (Object.keys(llamaIdToSymbol).length > 0) {
            const fetched = await fetchMultiplePricesFromDeFiLlama(llamaIdToSymbol);
            Object.assign(finalResult, fetched);
        }

        result.success = true;
        result.data = finalResult;
        return result;
    } catch (error) {
        result.error = error instanceof Error ? error.message : 'Unknown error occurred';
        return result;
    }
}

/**
 * Get USD prices for multiple tokens using Stable Price Feed IDs
 */
export async function getMultipleTokenPricesById(priceIds: string[]): Promise<MultiplePriceResult> {
    const result: MultiplePriceResult = {
        success: false,
        timestamp: Date.now()
    };

    try {
        if (!Array.isArray(priceIds) || priceIds.length === 0) {
            result.error = 'Invalid or empty price IDs array provided';
            return result;
        }

        const symbolsToFetch: string[] = [];
        const idToSymbol: Record<string, string> = {};

        for (const id of priceIds) {
            const sym = PRICE_ID_TO_SYMBOL[id.toLowerCase()];
            if (sym) {
                symbolsToFetch.push(sym);
                idToSymbol[id] = sym;
            }
        }

        const pricesResult = await getMultipleTokenPrices(symbolsToFetch);
        if (!pricesResult.success || !pricesResult.data) {
            result.error = pricesResult.error || 'Failed to fetch prices';
            return result;
        }

        const dataById: Record<string, PriceData> = {};
        for (const [id, sym] of Object.entries(idToSymbol)) {
            if (pricesResult.data[sym]) {
                dataById[id] = pricesResult.data[sym];
            }
        }

        result.success = true;
        result.data = dataById;
        return result;
    } catch (error) {
        result.error = error instanceof Error ? error.message : 'Unknown error occurred';
        return result;
    }
}

/**
 * Fetch price directly by chain and token address using DeFiLlama / DexScreener
 */
export async function getTokenPriceByAddress(chain: string, tokenAddress: string): Promise<PriceResult> {
    const result: PriceResult = {
        success: false,
        timestamp: Date.now()
    };

    const cleanAddress = tokenAddress.toLowerCase();
    const chainPrefix = chain.toLowerCase();

    // 1. Try DeFiLlama by chain:address
    try {
        const llamaKey = `${chainPrefix}:${cleanAddress}`;
        const response = await fetch(`${DEFILLAMA_URL}/${llamaKey}`);
        if (response.ok) {
            const data = (await response.json()) as any;
            const coin = data?.coins?.[llamaKey];
            if (coin && typeof coin.price === 'number') {
                const priceData: PriceData = {
                    symbol: coin.symbol || cleanAddress.slice(0, 6),
                    price: coin.price,
                    conf: coin.confidence ?? 0.99,
                    expo: 0,
                    publishTime: coin.timestamp ?? Math.floor(Date.now() / 1000),
                    priceId: cleanAddress
                };
                result.success = true;
                result.data = priceData;
                return result;
            }
        }
    } catch {}

    // 2. Try DexScreener by token address
    try {
        const dexRes = await fetch(`${DEXSCREENER_URL}/tokens/${cleanAddress}`);
        if (dexRes.ok) {
            const dexData = (await dexRes.json()) as any;
            const pair = dexData?.pairs?.[0];
            if (pair && pair.priceUsd) {
                const price = parseFloat(pair.priceUsd);
                if (!isNaN(price)) {
                    const priceData: PriceData = {
                        symbol: pair.baseToken?.symbol || cleanAddress.slice(0, 6),
                        price,
                        conf: 0.95,
                        expo: 0,
                        publishTime: Math.floor(Date.now() / 1000),
                        priceId: cleanAddress
                    };
                    result.success = true;
                    result.data = priceData;
                    return result;
                }
            }
        }
    } catch {}

    result.error = `Unable to fetch price for address: ${tokenAddress}`;
    return result;
}

export function getAvailableSymbols(): string[] {
    return Object.keys(STABLE_PRICE_FEED_IDS);
}

export function getPriceFeedId(symbol: string): string | null {
    return STABLE_PRICE_FEED_IDS[symbol.toUpperCase()] || null;
}

export function addPriceFeed(symbol: string, priceId: string): void {
    const upper = symbol.toUpperCase();
    STABLE_PRICE_FEED_IDS[upper] = priceId;
    PRICE_ID_TO_SYMBOL[priceId.toLowerCase()] = upper;
}

export async function getPrice(symbol: string): Promise<number> {
    const result = await getTokenPrice(symbol);
    if (!result.success || !result.data) {
        throw new Error(result.error || `Failed to get price for ${symbol}`);
    }
    return result.data.price;
}

export async function getPriceById(priceId: string): Promise<number> {
    const result = await getTokenPriceById(priceId);
    if (!result.success || !result.data) {
        throw new Error(result.error || `Failed to get price for ID ${priceId}`);
    }
    return result.data.price;
}

export async function getPrices(symbols?: string[] | string): Promise<Record<string, number>> {
    const result = await getMultipleTokenPrices(symbols);
    if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to get prices');
    }

    const prices: Record<string, number> = {};
    for (const [symbol, data] of Object.entries(result.data)) {
        prices[symbol] = data.price;
    }
    return prices;
}

export const get0gPrice = async (): Promise<PriceResult> => {
    return await getTokenPrice('0G');
};

export default {
    getTokenPrice,
    getTokenPriceById,
    getMultipleTokenPrices,
    getMultipleTokenPricesById,
    getTokenPriceByAddress,
    getAvailableSymbols,
    getPriceFeedId,
    addPriceFeed,
    getPrice,
    getPriceById,
    getPrices
};
