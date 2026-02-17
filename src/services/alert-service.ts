/**
 * Alert Service — sends notifications via wallet app's push-send endpoint
 * Uses existing POST /api/admin/push-send (broadcast mode)
 */

import { CONFIG } from '../config';
import { logger } from '../utils/logger';
import { isAlertOnCooldown, setAlertCooldown } from './redis-state';
import type { AlertPayload } from '../types';

/**
 * Send alert through Auxite wallet push notification system
 * Respects cooldown to prevent spam
 */
export async function sendAlert(alert: AlertPayload): Promise<boolean> {
  // Check cooldown
  const onCooldown = await isAlertOnCooldown(alert.type);
  if (onCooldown) {
    logger.debug({ type: alert.type }, 'Alert on cooldown, skipping');
    return false;
  }

  try {
    const url = `${CONFIG.auxiteAppUrl}/api/admin/push-send`;

    const body = {
      broadcast: true,
      title: alert.title,
      body: alert.body,
      type: alert.severity === 'critical' ? 'security' : 'system',
      data: {
        ...alert.data,
        alertType: alert.type,
        severity: alert.severity,
        url: '/admin',
      },
    };

    logger.info({ type: alert.type, severity: alert.severity, title: alert.title },
      'Sending alert notification');

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.auxiteAdminToken}`,
      },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      // Set cooldown
      await setAlertCooldown(alert.type);
      logger.info({ type: alert.type }, 'Alert sent successfully');
      return true;
    } else {
      const errText = await res.text().catch(() => 'unknown');
      logger.error({ status: res.status, error: errText }, 'Alert send failed');
      return false;
    }
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to send alert (network error)');
    return false;
  }
}

/**
 * Send alerts for detected anomalies
 */
export async function sendAnomalyAlerts(
  anomalies: Array<{ type: string; severity: string; message: string; metal?: string; value?: number }>
): Promise<void> {
  for (const anomaly of anomalies) {
    let alertType: AlertPayload['type'];

    switch (anomaly.type) {
      case 'price_spike':
      case 'price_crash':
        alertType = 'price_anomaly';
        break;
      case 'source_failure':
        alertType = 'source_failure';
        break;
      case 'stale_data':
        alertType = 'oracle_stale';
        break;
      default:
        alertType = 'watcher_error';
    }

    await sendAlert({
      type: alertType,
      severity: anomaly.severity as 'warning' | 'critical',
      title: `Oracle Alert: ${anomaly.type.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}`,
      body: anomaly.message,
      data: {
        metal: anomaly.metal,
        value: anomaly.value,
      },
    });
  }
}
