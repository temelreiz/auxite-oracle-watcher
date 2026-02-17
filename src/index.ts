/**
 * Oracle Watcher — Entry Point
 * Starts HTTP server + price monitoring scheduler
 */

import { CONFIG } from './config';
import { logger } from './utils/logger';
import { startServer } from './server';
import { startScheduler, stopScheduler } from './scheduler';
import { setStatus } from './services/redis-state';

async function main(): Promise<void> {
  logger.info('═══════════════════════════════════════');
  logger.info('  Auxite Oracle Watcher v1.0.0');
  logger.info('═══════════════════════════════════════');
  logger.info({
    pollInterval: `${CONFIG.pollIntervalMs}ms`,
    deviationThreshold: `${CONFIG.deviationThresholdPct}%`,
    anomalyThreshold: `${CONFIG.anomalyThresholdPct}%`,
    oracleAddress: CONFIG.oracleAddress,
    rpcUrl: CONFIG.rpcUrl,
    hasGoldApiKey: !!CONFIG.goldApiKey,
    hasPrivateKey: !!CONFIG.privateKey,
  }, 'Configuration loaded');

  // Set initial status
  await setStatus({
    state: 'running',
    uptimeStart: new Date().toISOString(),
    errorCount: 0,
    lastCycleMs: 0,
  });

  // Start HTTP server (Railway health check needs this)
  await startServer();

  // Start price monitoring scheduler
  startScheduler();

  logger.info('Oracle Watcher is running');

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down...');
    stopScheduler();
    await setStatus({
      state: 'stopped',
      uptimeStart: '',
      errorCount: 0,
      lastCycleMs: 0,
    });
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ error: err.message }, 'Fatal error — exiting');
  process.exit(1);
});
