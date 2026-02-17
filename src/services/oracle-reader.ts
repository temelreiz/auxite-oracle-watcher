/**
 * Oracle Reader — reads current on-chain prices from AuxiteMetalOracleV2
 * Uses getAllPrices() which returns E6 format ($/oz * 1e6)
 */

import { ethers } from 'ethers';
import { CONFIG } from '../config';
import { logger } from '../utils/logger';
import type { MetalPrices } from '../types';

export async function readOraclePrices(): Promise<MetalPrices & { ethUsd: number; lastUpdated: number }> {
  const provider = new ethers.JsonRpcProvider(CONFIG.rpcUrl);
  const oracle = new ethers.Contract(CONFIG.oracleAddress, CONFIG.oracleAbi, provider);

  const [goldE6, silverE6, platinumE6, palladiumE6, ethE6, lastUpdated] = await oracle.getAllPrices();

  // E6 format: price_in_usd * 1e6, so divide by 1e6 to get $/oz
  const fromE6 = (val: bigint) => Number(val) / 1_000_000;

  const prices = {
    gold: fromE6(goldE6),
    silver: fromE6(silverE6),
    platinum: fromE6(platinumE6),
    palladium: fromE6(palladiumE6),
    ethUsd: fromE6(ethE6),
    lastUpdated: Number(lastUpdated),
  };

  logger.debug({
    gold: `$${prices.gold.toFixed(2)}`,
    silver: `$${prices.silver.toFixed(2)}`,
    platinum: `$${prices.platinum.toFixed(2)}`,
    palladium: `$${prices.palladium.toFixed(2)}`,
    eth: `$${prices.ethUsd.toFixed(2)}`,
  }, 'On-chain oracle prices read ($/oz)');

  return prices;
}
