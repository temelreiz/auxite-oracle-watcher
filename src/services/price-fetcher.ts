/**
 * Multi-Source Price Fetcher
 * Fallback chain: GoldAPI → metals.live → Redis stale → Hardcoded
 */

import { CONFIG } from '../config';
import { logger } from '../utils/logger';
import { getStalePrices, updateSharedPriceCache } from './redis-state';
import type { MetalPrices, FetchResult, PriceSource } from '../types';

const TROY_OZ = CONFIG.troyOunceToGrams;

// ════════════════════════════════════════
// Source 1: GoldAPI (primary)
// ════════════════════════════════════════

async function fetchFromGoldApi(): Promise<{ prices: MetalPrices; pricesOz: MetalPrices }> {
  if (!CONFIG.goldApiKey) {
    throw new Error('GOLDAPI_KEY not set');
  }

  const symbols = ['XAU', 'XAG', 'XPT', 'XPD'];
  const pricesOz: Record<string, number> = {};

  for (const symbol of symbols) {
    // Rate limit between requests
    if (symbol !== 'XAU') {
      await new Promise(r => setTimeout(r, CONFIG.goldApiRateDelayMs));
    }

    const res = await fetch(`${CONFIG.goldApiBaseUrl}/${symbol}/USD`, {
      headers: {
        'x-access-token': CONFIG.goldApiKey,
        'Content-Type': 'application/json',
      },
    });

    if (res.status === 429) {
      throw new Error('GoldAPI rate limited');
    }

    if (!res.ok) {
      throw new Error(`GoldAPI ${symbol}: HTTP ${res.status}`);
    }

    const data = await res.json();
    if (!data.price || data.price <= 0) {
      throw new Error(`GoldAPI ${symbol}: invalid price ${data.price}`);
    }

    const metalKey = CONFIG.goldApiSymbols[symbol];
    pricesOz[metalKey] = data.price;
  }

  return {
    pricesOz: pricesOz as unknown as MetalPrices,
    prices: {
      gold: pricesOz.gold / TROY_OZ,
      silver: pricesOz.silver / TROY_OZ,
      platinum: pricesOz.platinum / TROY_OZ,
      palladium: pricesOz.palladium / TROY_OZ,
    },
  };
}

// ════════════════════════════════════════
// Source 2: api.metals.live (free, no key)
// ════════════════════════════════════════

async function fetchFromMetalsLive(): Promise<{ prices: MetalPrices; pricesOz: MetalPrices }> {
  const res = await fetch(CONFIG.metalsLiveUrl, {
    headers: { 'Accept': 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`metals.live: HTTP ${res.status}`);
  }

  const data = await res.json();

  // metals.live returns: [{ gold: 5050 }, { silver: 89 }, ...]
  // or: [{ metal: "gold", price: 5050 }, ...]
  const pricesOz: Record<string, number> = {};

  if (Array.isArray(data)) {
    for (const item of data) {
      if (item.gold) pricesOz.gold = item.gold;
      else if (item.silver) pricesOz.silver = item.silver;
      else if (item.platinum) pricesOz.platinum = item.platinum;
      else if (item.palladium) pricesOz.palladium = item.palladium;
      // Alternative format
      if (item.metal && item.price) {
        pricesOz[item.metal.toLowerCase()] = item.price;
      }
    }
  }

  if (!pricesOz.gold) {
    throw new Error('metals.live: no gold price found');
  }

  return {
    pricesOz: pricesOz as unknown as MetalPrices,
    prices: {
      gold: (pricesOz.gold || CONFIG.fallbackPricesOz.gold) / TROY_OZ,
      silver: (pricesOz.silver || CONFIG.fallbackPricesOz.silver) / TROY_OZ,
      platinum: (pricesOz.platinum || CONFIG.fallbackPricesOz.platinum) / TROY_OZ,
      palladium: (pricesOz.palladium || CONFIG.fallbackPricesOz.palladium) / TROY_OZ,
    },
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
    logger.debug('Trying GoldAPI...');
    const result = await fetchFromGoldApi();
    const duration = Date.now() - startTime;

    logger.info({ source: 'goldapi', duration, gold: result.prices.gold.toFixed(2) },
      'Prices fetched from GoldAPI');

    // Write to shared cache
    await updateSharedPriceCache(result.prices);

    return {
      prices: result.prices,
      pricesOz: result.pricesOz,
      source: 'goldapi',
      fetchDurationMs: duration,
      errors,
    };
  } catch (error: any) {
    errors.push(`GoldAPI: ${error.message}`);
    logger.warn({ error: error.message }, 'GoldAPI failed, trying metals.live');
  }

  // Source 2: metals.live
  try {
    logger.debug('Trying metals.live...');
    const result = await fetchFromMetalsLive();
    const duration = Date.now() - startTime;

    logger.info({ source: 'metals-live', duration, gold: result.prices.gold.toFixed(2) },
      'Prices fetched from metals.live');

    await updateSharedPriceCache(result.prices);

    return {
      prices: result.prices,
      pricesOz: result.pricesOz,
      source: 'metals-live',
      fetchDurationMs: duration,
      errors,
    };
  } catch (error: any) {
    errors.push(`metals.live: ${error.message}`);
    logger.warn({ error: error.message }, 'metals.live failed, trying stale cache');
  }

  // Source 3: Redis stale cache
  try {
    const stale = await getStalePrices();
    if (stale && stale.gold > 0) {
      const duration = Date.now() - startTime;

      logger.warn({ source: 'redis-stale', duration },
        'Using stale Redis prices');

      return {
        prices: stale,
        pricesOz: {
          gold: stale.gold * TROY_OZ,
          silver: stale.silver * TROY_OZ,
          platinum: stale.platinum * TROY_OZ,
          palladium: stale.palladium * TROY_OZ,
        },
        source: 'redis-stale',
        fetchDurationMs: duration,
        errors,
      };
    }
  } catch (error: any) {
    errors.push(`Redis stale: ${error.message}`);
  }

  // Source 4: Hardcoded fallback
  const duration = Date.now() - startTime;
  logger.error({ errors }, 'All sources failed, using hardcoded fallback');

  return {
    prices: { ...CONFIG.fallbackPrices },
    pricesOz: { ...CONFIG.fallbackPricesOz },
    source: 'hardcoded',
    fetchDurationMs: duration,
    errors,
  };
}
