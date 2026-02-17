/**
 * Multi-Source Price Fetcher
 * Fallback chain: GoldAPI → metals.live → Redis stale → Hardcoded
 *
 * All prices returned as $/oz (troy ounce) — matching oracle daemon format
 */

import { CONFIG } from '../config';
import { logger } from '../utils/logger';
import { getStalePrices, updateSharedPriceCache } from './redis-state';
import type { MetalPrices, FetchResult } from '../types';

// ════════════════════════════════════════
// Source 1: GoldAPI (primary) — returns $/oz
// ════════════════════════════════════════

async function fetchFromGoldApi(): Promise<{ prices: MetalPrices; ethPrice: number }> {
  if (!CONFIG.goldApiKey) {
    throw new Error('GOLDAPI_KEY not set');
  }

  const symbols = ['XAU', 'XAG', 'XPT', 'XPD'];
  const prices: Record<string, number> = {};

  for (const symbol of symbols) {
    if (symbol !== 'XAU') {
      await new Promise(r => setTimeout(r, CONFIG.goldApiRateDelayMs));
    }

    const res = await fetch(`${CONFIG.goldApiBaseUrl}/${symbol}/USD`, {
      headers: {
        'x-access-token': CONFIG.goldApiKey,
        'Content-Type': 'application/json',
      },
    });

    if (res.status === 429) throw new Error('GoldAPI rate limited');
    if (!res.ok) throw new Error(`GoldAPI ${symbol}: HTTP ${res.status}`);

    const data = await res.json() as { price?: number };
    if (!data.price || data.price <= 0) {
      throw new Error(`GoldAPI ${symbol}: invalid price ${data.price}`);
    }

    const metalKey = CONFIG.goldApiSymbols[symbol];
    prices[metalKey] = data.price;
  }

  // Fetch ETH price from CoinGecko
  let ethPrice = CONFIG.ethFallbackPrice;
  try {
    const ethRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
    if (ethRes.ok) {
      const ethData = await ethRes.json() as { ethereum?: { usd?: number } };
      ethPrice = ethData.ethereum?.usd || CONFIG.ethFallbackPrice;
    }
  } catch {
    logger.warn('CoinGecko ETH fetch failed, using fallback');
  }

  return {
    prices: prices as unknown as MetalPrices,
    ethPrice,
  };
}

// ════════════════════════════════════════
// Source 2: api.metals.live (free, no key)
// ════════════════════════════════════════

async function fetchFromMetalsLive(): Promise<{ prices: MetalPrices; ethPrice: number }> {
  const res = await fetch(CONFIG.metalsLiveUrl, {
    headers: { 'Accept': 'application/json' },
  });

  if (!res.ok) throw new Error(`metals.live: HTTP ${res.status}`);

  const data = await res.json() as any[];
  const prices: Record<string, number> = {};

  if (Array.isArray(data)) {
    for (const item of data) {
      if (item.gold) prices.gold = item.gold;
      else if (item.silver) prices.silver = item.silver;
      else if (item.platinum) prices.platinum = item.platinum;
      else if (item.palladium) prices.palladium = item.palladium;
      if (item.metal && item.price) {
        prices[item.metal.toLowerCase()] = item.price;
      }
    }
  }

  if (!prices.gold) throw new Error('metals.live: no gold price found');

  return {
    prices: {
      gold: prices.gold || CONFIG.fallbackPrices.gold,
      silver: prices.silver || CONFIG.fallbackPrices.silver,
      platinum: prices.platinum || CONFIG.fallbackPrices.platinum,
      palladium: prices.palladium || CONFIG.fallbackPrices.palladium,
    },
    ethPrice: CONFIG.ethFallbackPrice,
  };
}

// ════════════════════════════════════════
// Main Fetch Function (with fallback chain)
// ════════════════════════════════════════

export async function fetchPrices(): Promise<FetchResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  // Source 1: GoldAPI
  try {
    const result = await fetchFromGoldApi();
    const duration = Date.now() - startTime;
    logger.info({ source: 'goldapi', duration, gold: result.prices.gold.toFixed(2) },
      'Prices fetched from GoldAPI ($/oz)');
    await updateSharedPriceCache(result.prices);
    return { prices: result.prices, ethPrice: result.ethPrice, source: 'goldapi', fetchDurationMs: duration, errors };
  } catch (error: any) {
    errors.push(`GoldAPI: ${error.message}`);
    logger.warn({ error: error.message }, 'GoldAPI failed, trying metals.live');
  }

  // Source 2: metals.live
  try {
    const result = await fetchFromMetalsLive();
    const duration = Date.now() - startTime;
    logger.info({ source: 'metals-live', duration }, 'Prices fetched from metals.live ($/oz)');
    await updateSharedPriceCache(result.prices);
    return { prices: result.prices, ethPrice: result.ethPrice, source: 'metals-live', fetchDurationMs: duration, errors };
  } catch (error: any) {
    errors.push(`metals.live: ${error.message}`);
    logger.warn({ error: error.message }, 'metals.live failed, trying stale cache');
  }

  // Source 3: Redis stale cache
  try {
    const stale = await getStalePrices();
    if (stale && stale.gold > 0) {
      const duration = Date.now() - startTime;
      logger.warn({ source: 'redis-stale', duration }, 'Using stale Redis prices');
      return { prices: stale, ethPrice: CONFIG.ethFallbackPrice, source: 'redis-stale', fetchDurationMs: duration, errors };
    }
  } catch (error: any) {
    errors.push(`Redis stale: ${error.message}`);
  }

  // Source 4: Hardcoded fallback
  const duration = Date.now() - startTime;
  logger.error({ errors }, 'All sources failed, using hardcoded fallback');
  return {
    prices: { ...CONFIG.fallbackPrices },
    ethPrice: CONFIG.ethFallbackPrice,
    source: 'hardcoded',
    fetchDurationMs: duration,
    errors,
  };
}
