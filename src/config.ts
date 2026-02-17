/**
 * Oracle Watcher Configuration
 * All environment variables with sensible defaults
 */

import { ethers } from 'ethers';

export const CONFIG = {
  // ── Polling ──
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS) || 90_000,

  // ── Thresholds ──
  deviationThresholdPct: Number(process.env.DEVIATION_THRESHOLD_PCT) || 0.5,
  anomalyThresholdPct: Number(process.env.ANOMALY_THRESHOLD_PCT) || 5.0,
  staleThresholdMs: Number(process.env.STALE_THRESHOLD_MS) || 600_000, // 10 min
  maxConsecutiveErrors: 10,
  alertAfterErrors: 3,

  // ── GoldAPI ──
  goldApiKey: process.env.GOLDAPI_KEY || '',
  goldApiBaseUrl: 'https://www.goldapi.io/api',
  goldApiRateDelayMs: 1500,

  // ── Metals.live (free, no key) ──
  metalsLiveUrl: 'https://api.metals.live/v1/spot',

  // ── Blockchain ──
  rpcUrl: process.env.BASE_RPC_URL || process.env.NEXT_PUBLIC_BASE_RPC_URL || 'https://mainnet.base.org',
  privateKey: process.env.PRIVATE_KEY || '',
  oracleAddress: process.env.ORACLE_ADDRESS || '0xbB109166062D718756D0389F4bA2aB02A36F296c',

  // ── Oracle Contract ABI (matches wallet app) ──
  oracleAbi: [
    'function updatePrice(bytes32 metalId, uint256 priceE6) external',
    'function getBasePerKgE6(bytes32 metalId) external view returns (uint256)',
    'function getETHPriceE6() view returns (uint256)',
  ],

  // ── Metal IDs (ethers.id hashes, matching wallet oracle-updater.ts) ──
  metalIds: {
    GOLD: ethers.id('GOLD'),
    SILVER: ethers.id('SILVER'),
    PLATINUM: ethers.id('PLATINUM'),
    PALLADIUM: ethers.id('PALLADIUM'),
  },

  // ── Metal symbol mapping ──
  goldApiSymbols: {
    XAU: 'gold',
    XAG: 'silver',
    XPT: 'platinum',
    XPD: 'palladium',
  } as Record<string, string>,

  troyOunceToGrams: 31.1035,

  // ── Redis ──
  redisUrl: process.env.UPSTASH_REDIS_REST_URL || '',
  redisToken: process.env.UPSTASH_REDIS_REST_TOKEN || '',

  // ── Notification (wallet app push-send) ──
  auxiteAppUrl: process.env.AUXITE_APP_URL || 'https://vault.auxite.io',
  auxiteAdminToken: process.env.AUXITE_ADMIN_TOKEN || 'auxite-admin-2024',

  // ── HTTP Server ──
  port: Number(process.env.PORT) || 3001,
  watcherApiKey: process.env.WATCHER_API_KEY || '',

  // ── Alert cooldown ──
  alertCooldownSeconds: 300, // 5 minutes

  // ── Fallback prices ($/gram, Feb 2026) ──
  fallbackPrices: {
    gold: 162.4,
    silver: 2.86,
    platinum: 73.3,
    palladium: 58.5,
  },

  // ── Fallback prices ($/oz) ──
  fallbackPricesOz: {
    gold: 5050,
    silver: 89,
    platinum: 2280,
    palladium: 1820,
  },
} as const;
