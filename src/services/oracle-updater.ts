/**
 * Oracle Updater — submits price updates to AuxiteMetalOracleV2
 * Uses setAllPrices(gold, silver, platinum, palladium, eth) — single tx for all metals
 * Prices are in E6 format: $/oz * 1e6
 */

import { ethers } from 'ethers';
import { CONFIG } from '../config';
import { logger } from '../utils/logger';
import { withRetry } from '../utils/retry';
import type { MetalPrices, UpdateResult } from '../types';

// Convert price to E6 format (same as oracle daemon's toE6)
function toE6(price: number): bigint {
  return BigInt(Math.round(price * 1_000_000));
}

/**
 * Update all oracle prices in a single transaction
 * @param prices - Spot prices in $/oz
 * @param ethPrice - ETH price in USD
 */
export async function updateOracle(
  prices: MetalPrices,
  ethPrice: number,
): Promise<UpdateResult> {
  try {
    if (!CONFIG.privateKey) {
      throw new Error('PRIVATE_KEY not set');
    }

    const provider = new ethers.JsonRpcProvider(CONFIG.rpcUrl);
    const wallet = new ethers.Wallet(CONFIG.privateKey, provider);
    const oracle = new ethers.Contract(CONFIG.oracleAddress, CONFIG.oracleAbi, wallet);

    logger.info({
      gold: `$${prices.gold.toFixed(2)}`,
      silver: `$${prices.silver.toFixed(2)}`,
      platinum: `$${prices.platinum.toFixed(2)}`,
      palladium: `$${prices.palladium.toFixed(2)}`,
      eth: `$${ethPrice.toFixed(2)}`,
      from: wallet.address,
    }, 'Submitting setAllPrices tx');

    // Single transaction for all prices
    const tx = await withRetry(
      async () => oracle.setAllPrices(
        toE6(prices.gold),
        toE6(prices.silver),
        toE6(prices.platinum),
        toE6(prices.palladium),
        toE6(ethPrice),
      ),
      { maxRetries: 3, baseDelayMs: 2000, label: 'oracle-setAllPrices' },
    );

    logger.info({ txHash: tx.hash }, 'Oracle tx submitted, waiting for confirmation...');

    const receipt = await tx.wait();
    logger.info({
      txHash: tx.hash,
      block: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
    }, '✅ Oracle prices updated on-chain');

    return {
      success: true,
      txHash: tx.hash,
      prices,
      ethPrice,
    };
  } catch (error: any) {
    logger.error({ error: error.message }, '❌ Oracle update failed');
    return {
      success: false,
      txHash: '',
      prices,
      ethPrice,
      error: error.message,
    };
  }
}
