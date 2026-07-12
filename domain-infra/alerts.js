// Compares each domain's two most recent domain_infra_history snapshots and alerts via Telegram
// on real, actionable changes — not on every run. Meant to run right after syncDomainInfra()
// (same cron invocation), so it's always comparing "today vs whatever the last successful run was".
import { query } from '../lib/db.js';
import { sendTelegram } from '../notifications/telegram.js';

const SCORE_DROP_THRESHOLD = 2; // spamhaus_score dropping by more than this in one snapshot
const EXPIRY_WARNING_DAYS = 30;

export async function checkDomainInfraAlerts() {
  const { rows } = await query(`
    WITH ranked AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY domain ORDER BY snapshot_date DESC) AS rn
      FROM domain_infra_history
    )
    SELECT
      curr.domain,
      curr.snapshot_date  AS curr_date,  curr.spamhaus_score AS curr_score,
      curr.blacklisted    AS curr_blacklisted, curr.expires_at AS curr_expires_at,
      prev.snapshot_date  AS prev_date,  prev.spamhaus_score AS prev_score,
      prev.blacklisted    AS prev_blacklisted
    FROM ranked curr
    LEFT JOIN ranked prev ON prev.domain = curr.domain AND prev.rn = curr.rn + 1
    WHERE curr.rn = 1
  `);

  const lines = [];

  for (const r of rows) {
    if (r.curr_blacklisted === true && r.prev_blacklisted !== true) {
      lines.push(`🔴 <b>${r.domain}</b> just got BLACKLISTED (was clean on ${r.prev_date ?? 'n/a'})`);
    }
    if (r.prev_score != null && r.curr_score != null) {
      const drop = Number(r.prev_score) - Number(r.curr_score);
      if (drop >= SCORE_DROP_THRESHOLD) {
        lines.push(`⚠️ <b>${r.domain}</b> Spamhaus score dropped ${r.prev_score} → ${r.curr_score} (Δ${drop.toFixed(1)})`);
      }
    }
    if (r.curr_expires_at) {
      const daysLeft = Math.floor((new Date(r.curr_expires_at) - new Date()) / 86400000);
      if (daysLeft >= 0 && daysLeft <= EXPIRY_WARNING_DAYS) {
        lines.push(`⏳ <b>${r.domain}</b> expires in ${daysLeft} day(s) (${r.curr_expires_at})`);
      }
    }
  }

  if (lines.length === 0) {
    console.log('  Domain infra: no alerts.');
    return;
  }

  lines.unshift(`<b>Domain Infra Alert</b> — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}\n`);
  await sendTelegram(lines.join('\n'));
  console.log(`  Domain infra: sent ${lines.length - 1} alert line(s) to Telegram.`);
}
