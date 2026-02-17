/**
 * HTTP Server — Health checks + Admin API
 * Railway needs an HTTP port for health checks
 */

import express from 'express';
import { CONFIG } from './config';
import { logger } from './utils/logger';
import { forceTick } from './scheduler';
import {
  getStatus,
  getLastUpdate,
  getLastFetch,
  getKillSwitch,
  setKillSwitch,
  getOverridePrices,
  setOverridePrices,
  clearOverridePrices,
  getErrorCount,
  getPriceHistory,
} from './services/redis-state';
import { readOraclePrices } from './services/oracle-reader';

const app = express();
app.use(express.json());

const startTime = Date.now();

// ════════════════════════════════════════
// Auth Middleware (admin endpoints)
// ════════════════════════════════════════

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!CONFIG.watcherApiKey) {
    // No API key configured — allow all (development)
    next();
    return;
  }

  const auth = req.headers.authorization;
  if (auth !== `Bearer ${CONFIG.watcherApiKey}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

// ════════════════════════════════════════
// CORS (allow admin panel to call)
// ════════════════════════════════════════

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

// ════════════════════════════════════════
// Public Endpoints
// ════════════════════════════════════════

/**
 * GET /health — Simple health check for Railway
 */
app.get('/health', (req, res) => {
  const uptimeSeconds = Math.round((Date.now() - startTime) / 1000);
  res.json({
    status: 'ok',
    version: '1.0.0',
    uptime: uptimeSeconds,
  });
});

/**
 * GET /status — Detailed watcher status
 */
app.get('/status', async (req, res) => {
  try {
    const [status, lastUpdate, lastFetch, killSwitch, override, errorCount] = await Promise.all([
      getStatus(),
      getLastUpdate(),
      getLastFetch(),
      getKillSwitch(),
      getOverridePrices(),
      getErrorCount(),
    ]);

    // Try to read on-chain prices (optional, don't fail if RPC is down)
    let onChainPrices = null;
    let deviations: Record<string, number> = {};
    try {
      const oraclePrices = await readOraclePrices();
      onChainPrices = {
        gold: oraclePrices.gold,
        silver: oraclePrices.silver,
        platinum: oraclePrices.platinum,
        palladium: oraclePrices.palladium,
      };

      // Calculate deviations if we have both
      if (lastFetch?.prices && onChainPrices) {
        for (const metal of ['gold', 'silver', 'platinum', 'palladium'] as const) {
          const fetched = lastFetch.prices[metal];
          const onChain = onChainPrices[metal];
          if (onChain > 0) {
            deviations[metal] = Math.round(Math.abs((fetched - onChain) / onChain) * 10000) / 100;
          }
        }
      }
    } catch {
      // RPC down, no on-chain prices available
    }

    res.json({
      status: 'ok',
      version: '1.0.0',
      uptime: Math.round((Date.now() - startTime) / 1000),
      state: status.state,
      killSwitch,
      overrideActive: override !== null,
      overridePrices: override,
      consecutiveErrors: errorCount,
      lastCycleMs: status.lastCycleMs,
      lastUpdate: lastUpdate ? {
        timestamp: lastUpdate.timestamp,
        metals: lastUpdate.metals,
        source: lastUpdate.source,
        txHashes: lastUpdate.txHashes,
      } : null,
      lastFetch: lastFetch ? {
        timestamp: lastFetch.timestamp,
        source: lastFetch.source,
        errors: lastFetch.errors,
      } : null,
      prices: {
        current: lastFetch?.prices || null,
        onChain: onChainPrices,
        deviations,
      },
      config: {
        pollIntervalMs: CONFIG.pollIntervalMs,
        deviationThresholdPct: CONFIG.deviationThresholdPct,
        anomalyThresholdPct: CONFIG.anomalyThresholdPct,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /prices — Current fetched and on-chain prices
 */
app.get('/prices', async (req, res) => {
  try {
    const [lastFetch, oraclePrices] = await Promise.all([
      getLastFetch(),
      readOraclePrices().catch(() => null),
    ]);

    res.json({
      fetched: lastFetch?.prices || null,
      fetchedAt: lastFetch?.timestamp || null,
      source: lastFetch?.source || null,
      onChain: oraclePrices ? {
        gold: oraclePrices.gold,
        silver: oraclePrices.silver,
        platinum: oraclePrices.platinum,
        palladium: oraclePrices.palladium,
        ethUsd: oraclePrices.ethUsd,
      } : null,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /history — Price snapshot history
 */
app.get('/history', async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 50;
    const history = await getPriceHistory(Math.min(limit, 200));
    res.json({ count: history.length, history });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ════════════════════════════════════════
// Admin Endpoints (require auth)
// ════════════════════════════════════════

/**
 * POST /admin/kill-switch — Toggle kill switch
 */
app.post('/admin/kill-switch', requireAuth, async (req, res) => {
  try {
    const { active } = req.body;
    if (typeof active !== 'boolean') {
      res.status(400).json({ error: 'active (boolean) required' });
      return;
    }

    await setKillSwitch(active);
    logger.info({ active }, 'Kill switch toggled via admin API');

    res.json({ success: true, killSwitch: active });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /admin/override — Set manual price override
 */
app.post('/admin/override', requireAuth, async (req, res) => {
  try {
    const { prices, expiresInMinutes } = req.body;

    if (!prices || !prices.gold || !prices.silver || !prices.platinum || !prices.palladium) {
      res.status(400).json({ error: 'prices { gold, silver, platinum, palladium } required ($/gram)' });
      return;
    }

    const duration = Number(expiresInMinutes) || 60;
    await setOverridePrices(prices, duration);

    logger.info({ prices, duration }, 'Manual override set via admin API');

    res.json({
      success: true,
      override: prices,
      expiresAt: new Date(Date.now() + duration * 60 * 1000).toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /admin/override — Clear manual override
 */
app.delete('/admin/override', requireAuth, async (req, res) => {
  try {
    await clearOverridePrices();
    res.json({ success: true, message: 'Override cleared' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /admin/force-update — Trigger immediate oracle update
 */
app.post('/admin/force-update', requireAuth, async (req, res) => {
  try {
    logger.info('Force update triggered via admin API');
    // Run in background, return immediately
    forceTick().catch(err => logger.error({ error: err.message }, 'Force tick error'));
    res.json({ success: true, message: 'Force update triggered' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ════════════════════════════════════════
// Start Server
// ════════════════════════════════════════

export async function startServer(): Promise<void> {
  return new Promise((resolve) => {
    app.listen(CONFIG.port, () => {
      logger.info({ port: CONFIG.port }, `HTTP server listening on port ${CONFIG.port}`);
      resolve();
    });
  });
}

export { app };
