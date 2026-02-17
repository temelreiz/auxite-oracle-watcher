/**
 * Oracle Watcher Configuration
 * All environment variables with sensible defaults
 *
 * IMPORTANT: AuxiteMetalOracleV2 uses $/oz * 1e6 format (E6 per troy ounce)
 * NOT per gram, NOT per kg. All prices flow as $/oz.
 */

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

  // ── Oracle Contract ABI (AuxiteMetalOracleV2) ──
  oracleAbi: [
    'function setAllPrices(uint256 _goldPrice, uint256 _silverPrice, uint256 _platinumPrice, uint256 _palladiumPrice, uint256 _ethPrice) external',
    'function getAllPrices() external view returns (uint256 goldPrice, uint256 silverPrice, uint256 platinumPrice, uint256 palladiumPrice, uint256 ethPrice, uint256 lastUpdated)',
  ],

  // ── Metal symbol mapping ──
  goldApiSymbols: {
    XAU: 'gold',
    XAG: 'silver',
    XPT: 'platinum',
    XPD: 'palladium',
  } as Record<string, string>,

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

  // ── Fallback prices ($/oz) ──
  fallbackPrices: {
    gold: 5050,
    silver: 89,
    platinum: 2280,
    palladium: 1820,
  },

  // ── ETH fallback ──
  ethFallbackPrice: 2500,
};
