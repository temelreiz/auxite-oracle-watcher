/**
 * Price Analyzer — anomaly detection + deviation calculation
 * All prices in $/oz
 */

import { CONFIG } from '../config';
import { logger } from '../utils/logger';
import { getLastFetch, getLastUpdate } from './redis-state';
import type { MetalPrices, AnalysisResult, Anomaly } from '../types';

const METAL_NAMES: Record<string, string> = {
  gold: 'Gold',
  silver: 'Silver',
  platinum: 'Platinum',
  palladium: 'Palladium',
};

/**
 * Analyze current prices vs on-chain + detect anomalies
 */
export async function analyzePrices(
  currentPrices: MetalPrices,
  onChainPrices: MetalPrices,
): Promise<AnalysisResult> {
  const anomalies: Anomaly[] = [];
  const deviations: Record<string, number> = {};
  let shouldUpdate = false;

  const metals = ['gold', 'silver', 'platinum', 'palladium'] as const;

  // ── 1. Deviation from on-chain ──
  for (const metal of metals) {
    const current = currentPrices[metal];
    const onChain = onChainPrices[metal];

    if (onChain <= 0) {
      deviations[metal] = 100;
      shouldUpdate = true;
      continue;
    }

    const deviation = Math.abs((current - onChain) / onChain) * 100;
    deviations[metal] = Math.round(deviation * 100) / 100;

    if (deviation > CONFIG.deviationThresholdPct) {
      shouldUpdate = true;
      logger.info({
        metal,
        current: `$${current.toFixed(2)}`,
        onChain: `$${onChain.toFixed(2)}`,
        deviation: `${deviation.toFixed(2)}%`,
      }, `${METAL_NAMES[metal]} exceeds deviation threshold`);
    }
  }

  // ── 2. Spike/crash detection ──
  const lastFetch = await getLastFetch();
  if (lastFetch?.prices) {
    for (const metal of metals) {
      const current = currentPrices[metal];
      const previous = lastFetch.prices[metal];
      if (previous <= 0) continue;

      const changePct = ((current - previous) / previous) * 100;
      const absChange = Math.abs(changePct);

      if (absChange > CONFIG.anomalyThresholdPct) {
        const isSpike = changePct > 0;
        anomalies.push({
          type: isSpike ? 'price_spike' : 'price_crash',
          metal,
          severity: 'critical',
          message: `${METAL_NAMES[metal]} ${isSpike ? 'spiked' : 'crashed'} ${absChange.toFixed(1)}% ($${previous.toFixed(2)} → $${current.toFixed(2)}/oz)`,
          value: Math.round(changePct * 100) / 100,
        });
      }
    }
  }

  // ── 3. Stale data detection ──
  const lastUpdate = await getLastUpdate();
  if (lastUpdate?.timestamp) {
    const timeSinceUpdate = Date.now() - new Date(lastUpdate.timestamp).getTime();
    if (timeSinceUpdate > CONFIG.staleThresholdMs) {
      const minutesSince = Math.round(timeSinceUpdate / 60000);
      anomalies.push({
        type: 'stale_data',
        severity: 'warning',
        message: `Oracle has not been updated for ${minutesSince} minutes`,
        value: minutesSince,
      });
    }
  }

  if (shouldUpdate) {
    logger.info({ deviations }, 'Oracle update needed');
  }

  return { anomalies, deviations, shouldUpdate };
}
