/**
 * Redis State Management
 * All watcher state under oracle:watcher:* prefix
 * Also writes to shared metal:prices:* keys for wallet app
 */

import { Redis } from '@upstash/redis';
import { CONFIG } from '../config';
import { logger } from '../utils/logger';
import type {
  MetalPrices,
  WatcherStatus,
  LastUpdateRecord,
  LastFetchRecord,
  PriceSnapshot,
  SpreadConfig,
} from '../types';

// ── Redis Client ──
const redis = new Redis({
  url: CONFIG.redisUrl,
  token: CONFIG.redisToken,
});

// ── Key Constants ──
const KEYS = {
  killSwitch: 'oracle:watcher:kill_switch',
  overridePrices: 'oracle:watcher:override:prices',
  overrideExpires: 'oracle:watcher:override:expires',
  lastUpdate: 'oracle:watcher:last_update',
  lastFetch: 'oracle:watcher:last_fetch',
  status: 'oracle:watcher:status',
  errorCount: 'oracle:watcher:error_count',
  priceHistory: 'oracle:watcher:price_history',
  alertCooldown: (type: string) => `oracle:watcher:alert:cooldown:${type}`,

  // Shared with wallet app
  sharedPriceCache: 'metal:prices:cache',
  sharedPriceStale: 'metal:prices:stale',
  spreadConfig: 'admin:spread:config:v2',
} as const;

// ════════════════════════════════════════
// Kill Switch
// ════════════════════════════════════════

export async function getKillSwitch(): Promise<boolean> {
  try {
    const val = await redis.get(KEYS.killSwitch);
    return val === 'true' || val === true;
  } catch (error) {
    logger.error({ error }, 'Failed to get kill switch');
    return false;
  }
}

export async function setKillSwitch(active: boolean): Promise<void> {
  await redis.set(KEYS.killSwitch, active ? 'true' : 'false');
  logger.info({ active }, 'Kill switch updated');
}

// ════════════════════════════════════════
// Override Prices
// ════════════════════════════════════════

export async function getOverridePrices(): Promise<MetalPrices | null> {
  try {
    // Check if override exists and hasn't expired
    const expires = await redis.get(KEYS.overrideExpires);
    if (expires) {
      const expiresDate = new Date(expires as string);
      if (expiresDate < new Date()) {
        // Expired — clean up
        await clearOverridePrices();
        return null;
      }
    }

    const raw = await redis.get(KEYS.overridePrices);
    if (!raw) return null;

    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return parsed as MetalPrices;
  } catch (error) {
    logger.error({ error }, 'Failed to get override prices');
    return null;
  }
}

export async function setOverridePrices(prices: MetalPrices, expiresInMinutes: number): Promise<void> {
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);
  await redis.set(KEYS.overridePrices, JSON.stringify(prices));
  await redis.set(KEYS.overrideExpires, expiresAt.toISOString());
  logger.info({ prices, expiresAt: expiresAt.toISOString() }, 'Override prices set');
}

export async function clearOverridePrices(): Promise<void> {
  await redis.del(KEYS.overridePrices);
  await redis.del(KEYS.overrideExpires);
  logger.info('Override prices cleared');
}

// ════════════════════════════════════════
// Last Update / Last Fetch Records
// ════════════════════════════════════════

export async function getLastUpdate(): Promise<LastUpdateRecord | null> {
  try {
    const raw = await redis.get(KEYS.lastUpdate);
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw as LastUpdateRecord;
  } catch {
    return null;
  }
}

export async function setLastUpdate(record: LastUpdateRecord): Promise<void> {
  await redis.set(KEYS.lastUpdate, JSON.stringify(record));
}

export async function getLastFetch(): Promise<LastFetchRecord | null> {
  try {
    const raw = await redis.get(KEYS.lastFetch);
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw as LastFetchRecord;
  } catch {
    return null;
  }
}

export async function setLastFetch(record: LastFetchRecord): Promise<void> {
  await redis.set(KEYS.lastFetch, JSON.stringify(record));
}

// ════════════════════════════════════════
// Watcher Status
// ════════════════════════════════════════

export async function getStatus(): Promise<WatcherStatus> {
  try {
    const raw = await redis.get(KEYS.status);
    if (!raw) {
      return { state: 'stopped', uptimeStart: '', errorCount: 0, lastCycleMs: 0 };
    }
    return typeof raw === 'string' ? JSON.parse(raw) : raw as WatcherStatus;
  } catch {
    return { state: 'error', uptimeStart: '', errorCount: 0, lastCycleMs: 0 };
  }
}

export async function setStatus(status: WatcherStatus): Promise<void> {
  await redis.set(KEYS.status, JSON.stringify(status));
}

// ════════════════════════════════════════
// Error Tracking
// ════════════════════════════════════════

export async function incrementErrorCount(): Promise<number> {
  const count = await redis.incr(KEYS.errorCount);
  return count;
}

export async function resetErrorCount(): Promise<void> {
  await redis.set(KEYS.errorCount, 0);
}

export async function getErrorCount(): Promise<number> {
  const val = await redis.get(KEYS.errorCount);
  return Number(val) || 0;
}

// ════════════════════════════════════════
// Price History
// ════════════════════════════════════════

export async function pushPriceSnapshot(snapshot: PriceSnapshot): Promise<void> {
  try {
    await redis.lpush(KEYS.priceHistory, JSON.stringify(snapshot));
    // Keep max 1000 entries
    await redis.ltrim(KEYS.priceHistory, 0, 999);
  } catch (error) {
    logger.error({ error }, 'Failed to push price snapshot');
  }
}

export async function getPriceHistory(limit: number = 50): Promise<PriceSnapshot[]> {
  try {
    const raw = await redis.lrange(KEYS.priceHistory, 0, limit - 1);
    return raw.map((item: any) => {
      try {
        return typeof item === 'string' ? JSON.parse(item) : item;
      } catch {
        return item;
      }
    });
  } catch {
    return [];
  }
}

// ════════════════════════════════════════
// Alert Cooldown (5 min dedup)
// ════════════════════════════════════════

export async function isAlertOnCooldown(type: string): Promise<boolean> {
  const key = KEYS.alertCooldown(type);
  const val = await redis.get(key);
  return val !== null;
}

export async function setAlertCooldown(type: string, ttlSeconds?: number): Promise<void> {
  const key = KEYS.alertCooldown(type);
  await redis.setex(key, ttlSeconds || CONFIG.alertCooldownSeconds, 'true');
}

// ════════════════════════════════════════
// Shared Price Cache (wallet app reads these)
// ════════════════════════════════════════

export async function updateSharedPriceCache(prices: MetalPrices): Promise<void> {
  try {
    const data = { ...prices, timestamp: Date.now() };
    // 60s TTL cache (matches wallet price-cache.ts)
    await redis.setex(KEYS.sharedPriceCache, 60, JSON.stringify(data));
    // Stale backup (no TTL)
    await redis.set(KEYS.sharedPriceStale, JSON.stringify(data));
  } catch (error) {
    logger.error({ error }, 'Failed to update shared price cache');
  }
}

// ════════════════════════════════════════
// Read Spread Config (wallet admin sets this)
// ════════════════════════════════════════

const DEFAULT_SPREAD: SpreadConfig = {
  metals: {
    gold: { buy: 1.5, sell: 1.5 },
    silver: { buy: 2.0, sell: 2.0 },
    platinum: { buy: 2.0, sell: 2.0 },
    palladium: { buy: 2.5, sell: 2.5 },
  },
};

export async function getSpreadConfig(): Promise<SpreadConfig> {
  try {
    const raw = await redis.get(KEYS.spreadConfig);
    if (raw) {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (parsed.metals) return parsed as SpreadConfig;
    }
    return DEFAULT_SPREAD;
  } catch {
    return DEFAULT_SPREAD;
  }
}

// ════════════════════════════════════════
// Read Stale Prices from Shared Cache
// ════════════════════════════════════════

export async function getStalePrices(): Promise<MetalPrices | null> {
  try {
    const raw = await redis.get(KEYS.sharedPriceStale);
    if (!raw) return null;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return {
      gold: parsed.gold,
      silver: parsed.silver,
      platinum: parsed.platinum,
      palladium: parsed.palladium,
    };
  } catch {
    return null;
  }
}
