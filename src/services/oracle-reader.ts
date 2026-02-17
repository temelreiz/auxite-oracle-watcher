/**
 * Oracle Reader — reads current on-chain prices
 * Ported from wallet app's oracle-updater.ts getOraclePrices()
 */

import { ethers } from 'ethers';
import { CONFIG } from '../config';
import { logger } from '../utils/logger';
import type { MetalPrices } from '../types';

export async function readOraclePrices(): Promise<MetalPrices & { ethUsd: number }> {
  const provider = new ethers.JsonRpcProvider(CONFIG.rpcUrl);
  const oracle = new ethers.Contract(CONFIG.oracleAddress, CONFIG.oracleAbi, provider);

  const [goldE6, silverE6, platinumE6, palladiumE6, ethE6] = await Promise.all([
    oracle.getBasePerKgE6(CONFIG.metalIds.GOLD).catch(() => 0n),
    oracle.getBasePerKgE6(CONFIG.metalIds.SILVER).catch(() => 0n),
    oracle.getBasePerKgE6(CONFIG.metalIds.PLATINUM).catch(() => 0n),
    oracle.getBasePerKgE6(CONFIG.metalIds.PALLADIUM).catch(() => 0n),
    oracle.getETHPriceE6().catch(() => 0n),
  ]);

  // Convert E6/kg to $/gram
  const toGramPrice = (e6: bigint) => Number(e6) / 1_000_000 / 1000;

  const prices = {
    gold: toGramPrice(goldE6),
    silver: toGramPrice(silverE6),
    platinum: toGramPrice(platinumE6),
    palladium: toGramPrice(palladiumE6),
    ethUsd: Number(ethE6) / 1_000_000,
  };

  logger.debug({
    gold: prices.gold.toFixed(2),
    silver: prices.silver.toFixed(4),
    platinum: prices.platinum.toFixed(2),
    palladium: prices.palladium.toFixed(2),
  }, 'On-chain oracle prices read');

  return prices;
}
