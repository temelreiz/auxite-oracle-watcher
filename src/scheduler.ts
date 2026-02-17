/**
 * Oracle Watcher Scheduler
 * Main monitoring loop — runs every POLL_INTERVAL_MS (default 90s)
 * Uses setAllPrices() for single-tx oracle updates
 */

import { CONFIG } from './config';
import { logger } from './utils/logger';

import { fetchPrices } from './services/price-fetcher';
import { readOraclePrices } from './services/oracle-reader';
import { updateOracle } from './services/oracle-updater';
import { analyzePrices } from './services/price-analyzer';
import { sendAlert, sendAnomalyAlerts } from './services/alert-service';
import {
  getKillSwitch,
  setKillSwitch,
  getOverridePrices,
  setLastFetch,
  setLastUpdate,
  setStatus,
  getStatus,
  pushPriceSnapshot,
  incrementErrorCount,
  resetErrorCount,
  getErrorCount,
} from './services/redis-state';
import type { MetalPrices } from './types';

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

/**
 * Single tick of the watcher cycle
 */
async function tick(): Promise<void> {
  if (isRunning) {
    logger.warn('Previous tick still running, skipping');
    return;
  }

  isRunning = true;
  const cycleStart = Date.now();

  try {
    // ── 1. Check kill switch ──
    const killSwitchActive = await getKillSwitch();

    // ── 2. Check for override prices ──
    const overridePrices = await getOverridePrices();

    // ── 3. Fetch prices ($/oz) ──
    let fetchedPrices: MetalPrices;
    let ethPrice: number;
    let priceSource: string;

    if (overridePrices) {
      fetchedPrices = overridePrices;
      ethPrice = CONFIG.ethFallbackPrice;
      priceSource = 'override';
      logger.info({ prices: overridePrices }, 'Using override prices');
    } else {
      const fetchResult = await fetchPrices();
      fetchedPrices = fetchResult.prices;
      ethPrice = fetchResult.ethPrice;
      priceSource = fetchResult.source;

      await setLastFetch({
        timestamp: new Date().toISOString(),
        prices: fetchedPrices,
        ethPrice,
        source: fetchResult.source,
        errors: fetchResult.errors,
      });

      if (fetchResult.source === 'hardcoded' && fetchResult.errors.length > 0) {
        await sendAlert({
          type: 'source_failure',
          severity: 'warning',
          title: 'Oracle: All Price Sources Failed',
          body: `GoldAPI and metals.live both failed. Using hardcoded fallback. Errors: ${fetchResult.errors.join('; ')}`,
          data: { errors: fetchResult.errors },
        });
      }
    }

    // ── 4. Read on-chain prices ──
    let onChainPrices: MetalPrices;
    try {
      const oracleResult = await readOraclePrices();
      onChainPrices = {
        gold: oracleResult.gold,
        silver: oracleResult.silver,
        platinum: oracleResult.platinum,
        palladium: oracleResult.palladium,
      };
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to read on-chain prices');
      onChainPrices = { gold: 0, silver: 0, platinum: 0, palladium: 0 };
    }

    // ── 5. Analyze prices ──
    const analysis = await analyzePrices(fetchedPrices, onChainPrices);

    // ── 6. Send anomaly alerts ──
    if (analysis.anomalies.length > 0) {
      await sendAnomalyAlerts(analysis.anomalies);
    }

    // ── 7. Update oracle if needed (single tx with setAllPrices) ──
    if (analysis.shouldUpdate && !killSwitchActive) {
      logger.info({ deviations: analysis.deviations }, 'Updating oracle prices...');

      const updateResult = await updateOracle(fetchedPrices, ethPrice);

      if (updateResult.success) {
        await setLastUpdate({
          timestamp: new Date().toISOString(),
          txHash: updateResult.txHash,
          source: priceSource as any,
          prices: updateResult.prices,
          ethPrice: updateResult.ethPrice,
        });
        await resetErrorCount();
      } else {
        const errorCount = await incrementErrorCount();

        if (errorCount >= CONFIG.alertAfterErrors) {
          await sendAlert({
            type: 'update_failure',
            severity: 'critical',
            title: 'Oracle: Update Failed',
            body: `Oracle update failed ${errorCount} consecutive times. Error: ${updateResult.error}`,
            data: { errorCount, error: updateResult.error },
          });
        }

        if (errorCount >= CONFIG.maxConsecutiveErrors) {
          await setKillSwitch(true);
          await sendAlert({
            type: 'watcher_error',
            severity: 'critical',
            title: 'Oracle Watcher Auto-Paused',
            body: `Auto-paused after ${errorCount} consecutive failures.`,
            data: { errorCount },
          });
        }
      }
    } else if (killSwitchActive && analysis.shouldUpdate) {
      logger.info('Kill switch active — skipping oracle update');
    }

    // ── 8. Update status ──
    const cycleDuration = Date.now() - cycleStart;
    const status = await getStatus();
    await setStatus({
      state: killSwitchActive ? 'paused' : 'running',
      uptimeStart: status.uptimeStart || new Date().toISOString(),
      errorCount: await getErrorCount(),
      lastCycleMs: cycleDuration,
    });

    // ── 9. Push price snapshot ──
    await pushPriceSnapshot({
      timestamp: new Date().toISOString(),
      fetched: fetchedPrices,
      onChain: onChainPrices,
      deviations: analysis.deviations,
      source: priceSource as any,
    });

    logger.info({
      cycleDuration,
      source: priceSource,
      shouldUpdate: analysis.shouldUpdate,
      killSwitch: killSwitchActive,
      anomalies: analysis.anomalies.length,
    }, `Tick complete (${cycleDuration}ms)`);

  } catch (error: any) {
    const errorCount = await incrementErrorCount();
    logger.error({ error: error.message, errorCount }, 'Tick failed');

    const cycleDuration = Date.now() - cycleStart;
    const status = await getStatus();
    await setStatus({
      state: 'error',
      uptimeStart: status.uptimeStart || new Date().toISOString(),
      errorCount,
      lastCycleMs: cycleDuration,
    });
  } finally {
    isRunning = false;
  }
}

export function startScheduler(): void {
  logger.info({ intervalMs: CONFIG.pollIntervalMs }, 'Starting scheduler');
  tick();
  intervalHandle = setInterval(tick, CONFIG.pollIntervalMs);
}

export function stopScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    logger.info('Scheduler stopped');
  }
}

export async function forceTick(): Promise<void> {
  logger.info('Force tick triggered by admin');
  await tick();
}
