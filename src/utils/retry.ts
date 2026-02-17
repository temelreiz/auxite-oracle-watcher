/**
 * Retry utility with exponential backoff
 */

import { logger } from './logger';

interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  label?: string;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 2000, maxDelayMs = 15000, label = 'operation' } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      if (attempt === maxRetries) break;

      const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
      logger.warn({ attempt: attempt + 1, maxRetries, delay, label, error: error.message },
        `${label} failed, retrying in ${delay}ms`);

      await new Promise(r => setTimeout(r, delay));
    }
  }

  throw lastError;
}
