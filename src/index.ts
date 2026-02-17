/**
 * Oracle Watcher — Entry Point
 * Starts HTTP server + price monitoring scheduler
 */

import { CONFIG } from './config';
import { logger } from './utils/logger';
import { startServer } from './server';
import { startScheduler, stopScheduler } from './scheduler';

async function main(): Promise<void> {
  // Debug: log ALL env vars that start with UPSTASH, GOLD, PRIVATE (masked)
  logger.info({
    envKeys: Object.keys(process.env).filter(k =>
      k.includes('UPSTASH') || k.includes('GOLD') || k.includes('PRIVATE') || k.includes('REDIS')
    ),
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL ? `${process.env.UPSTASH_REDIS_REST_URL.substring(0, 20)}...` : 'MISSING',
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN ? `${process.env.UPSTASH_REDIS_REST_TOKEN.substring(0, 10)}...` : 'MISSING',
    GOLDAPI_KEY: process.env.GOLDAPI_KEY ? `${process.env.GOLDAPI_KEY.substring(0, 10)}...` : 'MISSING',
    PRIVATE_KEY: process.env.PRIVATE_KEY ? 'SET' : 'MISSING',
  }, 'ENV DEBUG');

  logger.info('═══════════════════════════════════════');
  logger.info('  Auxite Oracle Watcher v1.0.0');
  logger.info('═══════════════════════════════════════');
  // Derive wallet address for logging
  let walletAddress = 'N/A';
  if (CONFIG.privateKey) {
    try {
      const { ethers } = await import('ethers');
      walletAddress = new ethers.Wallet(CONFIG.privateKey).address;
    } catch { /* ignore */ }
  }

  logger.info({
    pollInterval: `${CONFIG.pollIntervalMs}ms`,
    deviationThreshold: `${CONFIG.deviationThresholdPct}%`,
    anomalyThreshold: `${CONFIG.anomalyThresholdPct}%`,
    oracleAddress: CONFIG.oracleAddress,
    rpcUrl: CONFIG.rpcUrl,
    walletAddress,
    hasGoldApiKey: !!CONFIG.goldApiKey,
    hasPrivateKey: !!CONFIG.privateKey,
    hasRedisUrl: !!CONFIG.redisUrl,
    hasRedisToken: !!CONFIG.redisToken,
  }, 'Configuration loaded');

  // Start HTTP server FIRST (Railway needs health check even if Redis is down)
  await startServer();
  logger.info('HTTP server started');

  // Only start scheduler if Redis is configured
  if (!CONFIG.redisUrl || !CONFIG.redisToken) {
    logger.error('Redis not configured — scheduler will not start. Waiting for env vars...');
    // Keep server running for health checks
    return;
  }

  // Try to set initial status (don't crash if Redis fails)
  try {
    const { setStatus } = await import('./services/redis-state');
    await setStatus({
      state: 'running',
      uptimeStart: new Date().toISOString(),
      errorCount: 0,
      lastCycleMs: 0,
    });
  } catch (err: any) {
    logger.error({ error: err.message }, 'Failed to set initial Redis status — continuing anyway');
  }

  // Start price monitoring scheduler
  startScheduler();
  logger.info('Oracle Watcher is running');

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down...');
    stopScheduler();
    try {
      const { setStatus } = await import('./services/redis-state');
      await setStatus({
        state: 'stopped',
        uptimeStart: '',
        errorCount: 0,
        lastCycleMs: 0,
      });
    } catch { /* ignore */ }
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('FATAL:', err);
  // Don't exit immediately — let Railway see the logs
  setTimeout(() => process.exit(1), 5000);
});
