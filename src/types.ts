/**
 * Shared TypeScript interfaces for Oracle Watcher
 *
 * IMPORTANT: All MetalPrices are in $/oz (troy ounce), matching
 * AuxiteMetalOracleV2's E6 format: price * 1e6
 */

export interface MetalPrices {
  gold: number;      // $/oz
  silver: number;    // $/oz
  platinum: number;  // $/oz
  palladium: number; // $/oz
}

export interface FetchResult {
  prices: MetalPrices;       // $/oz
  ethPrice: number;          // $/ETH
  source: PriceSource;
  fetchDurationMs: number;
  errors: string[];
}

export type PriceSource = 'goldapi' | 'metals-live' | 'redis-stale' | 'hardcoded' | 'override';

export interface AnalysisResult {
  anomalies: Anomaly[];
  deviations: Record<string, number>;  // per-metal deviation %
  shouldUpdate: boolean;
}

export interface Anomaly {
  type: 'price_spike' | 'price_crash' | 'source_failure' | 'stale_data';
  metal?: string;
  severity: 'warning' | 'critical';
  message: string;
  value?: number;
}

export interface UpdateResult {
  success: boolean;
  txHash: string;
  prices: MetalPrices;
  ethPrice: number;
  error?: string;
}

export interface SpreadConfig {
  metals: {
    gold: { buy: number; sell: number };
    silver: { buy: number; sell: number };
    platinum: { buy: number; sell: number };
    palladium: { buy: number; sell: number };
  };
  crypto?: Record<string, { buy: number; sell: number }>;
}

export interface WatcherStatus {
  state: 'running' | 'paused' | 'error' | 'stopped';
  uptimeStart: string;
  errorCount: number;
  lastCycleMs: number;
}

export interface LastUpdateRecord {
  timestamp: string;
  txHash: string;
  source: PriceSource;
  prices: MetalPrices;
  ethPrice: number;
}

export interface LastFetchRecord {
  timestamp: string;
  prices: MetalPrices;
  ethPrice: number;
  source: PriceSource;
  errors: string[];
}

export interface PriceSnapshot {
  timestamp: string;
  fetched: MetalPrices;
  onChain: MetalPrices;
  deviations: Record<string, number>;
  source: PriceSource;
}

export interface AlertPayload {
  type: 'oracle_stale' | 'price_anomaly' | 'source_failure' | 'update_failure' | 'kill_switch' | 'watcher_error';
  severity: 'warning' | 'critical';
  title: string;
  body: string;
  data?: Record<string, unknown>;
}
