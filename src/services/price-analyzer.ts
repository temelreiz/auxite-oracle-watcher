/**
 * Price Analyzer — anomaly detection + deviation calculation
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
  const metalsToUpdate: string[] = [];

  const metals = ['gold', 'silver', 'platinum', 'palladium'] as const;

  // ── 1. Deviation from on-chain ──
  for (const metal of metals) {
    const current = currentPrices[metal];
    const onChain = onChainPrices[metal];

    if (onChain <= 0) {
      // On-chain price not set yet — always update
      deviations[metal] = 100;
      metalsToUpdate.push(metal);
      continue;
    }

    const deviation = Math.abs((current - onChain) / onChain) * 100;
    deviations[metal] = Math.round(deviation * 100) / 100; // 2 decimal places

    if (deviation > CONFIG.deviationThresholdPct) {
      metalsToUpdate.push(metal);
      logger.info({
        metal,
        current: current.toFixed(4),
        onChain: onChain.toFixed(4),
        deviation: deviation.toFixed(2),
      }, `${METAL_NAMES[metal]} exceeds deviation threshold`);
    }
  }

  // ── 2. Spike/crash detection (compare to previous fetch) ──
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
          message: `${METAL_NAMES[metal]} ${isSpike ? 'spiked' : 'crashed'} ${absChange.toFixed(1)}% in one cycle ($${previous.toFixed(2)} → $${current.toFixed(2)}/g)`,
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

  const shouldUpdate = metalsToUpdate.length > 0;

  if (shouldUpdate) {
    logger.info({
      metalsToUpdate,
      deviations,
    }, `${metalsToUpdate.length} metal(s) need oracle update`);
  }

  return {
    anomalies,
    deviations,
    shouldUpdate,
    metalsToUpdate,
  };
}
