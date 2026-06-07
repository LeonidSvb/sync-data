// Proactive alerts: low account health, high bounce rate, sync errors, low utilization.
import { query } from '../lib/db.js';
import { sendTelegram } from './telegram.js';

export async function checkAndSendAlerts() {
  const alerts = [];

  // 1. Accounts with health < 95%
  const unhealthy = await query(`
    SELECT email, domain, health_7d, health_status
    FROM v_account_health
    WHERE health_status IN ('WARNING', 'CRITICAL')
    AND deleted_from_source_at IS NULL
    ORDER BY health_7d ASC
    LIMIT 10
  `);
  if (unhealthy.rows.length > 0) {
    alerts.push(`<b>Account Health Alert</b>`);
    for (const a of unhealthy.rows) {
      const icon = a.health_status === 'CRITICAL' ? '🔴' : '⚠️';
      alerts.push(`${icon} ${a.email}: ${a.health_7d}%`);
    }
    alerts.push('');
  }

  // 2. Low positive reply rate (active campaigns with > 50 contacted and 0 positive)
  const zeroPosive = await query(`
    SELECT campaign_name, contacted, total_replies, positive_replies, reply_rate_pct
    FROM v_campaign_performance
    WHERE status = 'ACTIVE'
    AND contacted > 100
    AND total_replies > 5
    AND positive_replies = 0
  `);
  if (zeroPosive.rows.length > 0) {
    alerts.push(`<b>Zero Positive Replies Alert</b>`);
    for (const c of zeroPosive.rows) {
      alerts.push(`⚠️ ${c.campaign_name}: ${c.total_replies} replies, 0 positive (${c.contacted} contacted)`);
    }
    alerts.push('');
  }

  // 4. Sync errors in last 6 hours
  const syncErrors = await query(`
    SELECT sync_type, error_message, started_at::time as time
    FROM sync_log
    WHERE status = 'error'
    AND started_at > NOW() - INTERVAL '6 hours'
    ORDER BY started_at DESC
  `);
  if (syncErrors.rows.length > 0) {
    alerts.push(`<b>Sync Error Alert</b>`);
    for (const e of syncErrors.rows) {
      alerts.push(`❌ ${e.sync_type} at ${e.time}: ${e.error_message}`);
    }
    alerts.push('');
  }

  // 5. Low capacity utilization warning (active accounts sending < 30% of limit)
  const lowUtil = await query(`
    SELECT domain, utilization_pct, sent_today, total_daily_limit
    FROM v_domain_capacity
    WHERE utilization_pct < 30
    AND total_daily_limit > 100
  `);
  if (lowUtil.rows.length > 0) {
    alerts.push(`<b>Low Utilization Alert</b>`);
    for (const d of lowUtil.rows) {
      alerts.push(`ℹ️ ${d.domain}: only ${d.utilization_pct}% used (${d.sent_today}/${d.total_daily_limit})`);
    }
    alerts.push('');
  }

  if (alerts.length === 0) {
    console.log('No alerts to send');
    return;
  }

  alerts.unshift(`<b>Outreach Alerts</b> — ${new Date().toISOString().slice(0,16).replace('T', ' ')}\n`);
  await sendTelegram(alerts.join('\n'));
  console.log(`Sent ${alerts.length} alert lines to Telegram`);
}
