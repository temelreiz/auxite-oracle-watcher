/**
 * Oracle Updater — submits price updates to blockchain
 * Ported from wallet app's oracle-updater.ts updateOraclePrices()
 * Key difference: accepts prices as argument, supports selective metal updates
 */

import { ethers } from 'ethers';
import { CONFIG } from '../config';
import { logger } from '../utils/logger';
import { getSpreadConfig } from './redis-state';
import { withRetry } from '../utils/retry';
import type { MetalPrices, UpdateResult } from '../types';

// ── Spread application (matches wallet spread-config.ts) ──
function applySpread(basePrice: number, spreadPercent: number): number {
  return basePrice * (1 + spreadPercent / 100);
}

// ── Convert $/gram to E6/kg (matches wallet oracle-updater.ts) ──
function gramToKgE6(pricePerGram: number): bigint {
  const pricePerKg = pricePerGram * 1000;
  return BigInt(Math.round(pricePerKg * 1_000_000));
}

// ── Metal key to CONFIG.metalIds mapping ──
const METAL_KEY_TO_ID: Record<string, string> = {
  gold: 'GOLD',
  silver: 'SILVER',
  platinum: 'PLATINUM',
  palladium: 'PALLADIUM',
};

/**
 * Update oracle prices on blockchain with spread
 * @param prices - Base prices in $/gram (no spread)
 * @param metalsToUpdate - Which metals to update (default: all)
 */
export async function updateOracle(
  prices: MetalPrices,
  metalsToUpdate?: string[],
): Promise<UpdateResult> {
  try {
    if (!CONFIG.privateKey) {
      throw new Error('PRIVATE_KEY not set');
    }

    // 1. Get admin spread config
    const spreadConfig = await getSpreadConfig();
    const metals = spreadConfig.metals;

    // 2. Apply buy spread
    const withSpread: MetalPrices = {
      gold: applySpread(prices.gold, metals.gold.buy),
      silver: applySpread(prices.silver, metals.silver.buy),
      platinum: applySpread(prices.platinum, metals.platinum.buy),
      palladium: applySpread(prices.palladium, metals.palladium.buy),
    };

    logger.info({
      base: { gold: prices.gold.toFixed(2), silver: prices.silver.toFixed(4) },
      withSpread: { gold: withSpread.gold.toFixed(2), silver: withSpread.silver.toFixed(4) },
    }, 'Applying spreads to oracle prices');

    // 3. Setup blockchain connection
    const provider = new ethers.JsonRpcProvider(CONFIG.rpcUrl);
    const wallet = new ethers.Wallet(CONFIG.privateKey, provider);
    const oracle = new ethers.Contract(CONFIG.oracleAddress, CONFIG.oracleAbi, wallet);

    // 4. Determine which metals to update
    const allMetals = ['gold', 'silver', 'platinum', 'palladium'];
    const toUpdate = metalsToUpdate || allMetals;

    const txHashes: string[] = [];
    const updatedMetals: string[] = [];

    // 5. Submit transactions
    for (const metal of toUpdate) {
      const metalId = METAL_KEY_TO_ID[metal];
      if (!metalId) continue;

      const priceWithSpread = withSpread[metal as keyof MetalPrices];
      const priceE6 = gramToKgE6(priceWithSpread);

      logger.info({
        metal,
        pricePerGram: priceWithSpread.toFixed(4),
        priceE6Kg: priceE6.toString(),
      }, `Updating ${metal} oracle price`);

      // Retry with exponential backoff
      const tx = await withRetry(
        async () => oracle.updatePrice(
          CONFIG.metalIds[metalId as keyof typeof CONFIG.metalIds],
          priceE6,
        ),
        { maxRetries: 3, baseDelayMs: 2000, label: `oracle-update-${metal}` },
      );

      txHashes.push(tx.hash);
      updatedMetals.push(metal);

      logger.info({ metal, txHash: tx.hash }, `${metal} oracle tx submitted`);

      // Wait between transactions
      if (metal !== toUpdate[toUpdate.length - 1]) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    logger.info({ txCount: txHashes.length, metals: updatedMetals },
      '✅ Oracle prices updated');

    return {
      success: true,
      txHashes,
      updatedMetals,
      prices: {
        base: prices,
        withSpread,
      },
    };
  } catch (error: any) {
    logger.error({ error: error.message }, '❌ Oracle update failed');
    return {
      success: false,
      txHashes: [],
      updatedMetals: [],
      prices: { base: prices, withSpread: prices },
      error: error.message,
    };
  }
}
