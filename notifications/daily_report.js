// Daily Telegram report: yesterday stats, active campaigns, domains, warmup, lead pipeline.
import { query } from '../lib/db.js';
import { sendTelegram } from './telegram.js';

function pct(n, d) {
  if (!d || d === 0) return '—';
  return (n / d * 100).toFixed(1) + '%';
}

function num(n) {
  return n == null ? '—' : Number(n).toLocaleString('en');
}

export async function sendDailyReport() {
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const today = new Date().toISOString().split('T')[0];

  // 1. Yesterday stats
  const dayStats = await query(`
    SELECT
      SUM(sent_count) AS sent,
      SUM(replied_count) AS replied,
      SUM(positive_reply_count) AS positive,
      SUM(bounced_count) AS bounced,
      COUNT(DISTINCT campaign_id) AS campaigns
    FROM campaign_stats
    WHERE snapshot_date = $1
  `, [yesterday]);
  const d = dayStats.rows[0];

  // 2. Active campaigns performance
  const campaigns = await query(`
    SELECT campaign_name, contacted, emails_sent, total_replies, positive_replies,
           reply_rate_pct, bounce_rate_pct
    FROM v_campaign_performance
    WHERE status = 'ACTIVE'
    ORDER BY emails_sent DESC
    LIMIT 6
  `);

  // 3. Domain health
  const domains = await query(`
    SELECT domain, avg_health_7d, sent_today, total_daily_limit,
           capacity_used_pct, accounts_below_95
    FROM v_deliverability_by_domain
    ORDER BY domain
  `);

  // 4. Warmup stats latest
  const warmup = await query(`
    SELECT inbox_percent, spam_percent, google_percent, microsoft_percent, total_warmup_sent
    FROM warmup_stats
    ORDER BY snapshot_date DESC LIMIT 1
  `);
  const w = warmup.rows[0];

  // 5. Lead counts
  const leads = await query(`
    SELECT status, SUM(count) as count
    FROM lead_status_counts
    WHERE snapshot_at = (SELECT MAX(snapshot_at) FROM lead_status_counts)
    GROUP BY status ORDER BY count DESC
  `);

  // 6. Sync errors last 24h
  const errors = await query(`
    SELECT sync_type, error_message, started_at
    FROM sync_log
    WHERE status = 'error' AND started_at > NOW() - INTERVAL '24 hours'
    ORDER BY started_at DESC
  `);

  // 7. Tag performance
  const tags = await query(`
    SELECT tag_name, contacted_leads, replied_leads, reply_rate_pct,
           positive_of_replies_pct, auto_reply_rate_pct, bounce_rate_pct
    FROM v_performance_by_tag
    WHERE contacted_leads > 0
    ORDER BY reply_rate_pct DESC
  `);

  // Build message
  const lines = [];
  lines.push(`<b>Outreach Daily Report</b> — ${yesterday}`);
  lines.push('');

  // Yesterday totals
  lines.push('<b>Yesterday</b>');
  lines.push(`Sent: <b>${num(d.sent)}</b>  |  Campaigns: ${num(d.campaigns)}`);
  lines.push(`Replies: <b>${num(d.replied)}</b> (${pct(d.replied, d.sent)})  |  Positive: <b>${num(d.positive)}</b> (${pct(d.positive, d.replied)} of replies)`);
  lines.push(`Bounced: ${num(d.bounced)} (${pct(d.bounced, d.sent)})`);
  lines.push('');

  // Active campaigns
  if (campaigns.rows.length > 0) {
    lines.push('<b>Active Campaigns</b>');
    for (const c of campaigns.rows) {
      const flag = Number(c.bounce_rate_pct) > 5 ? ' !' : '';
      lines.push(`• ${c.campaign_name}${flag}`);
      lines.push(`  Contacted: ${num(c.contacted)} | Sent: ${num(c.emails_sent)} | Reply: ${c.reply_rate_pct ?? '—'}% | Bounce: ${c.bounce_rate_pct ?? '—'}%`);
    }
    lines.push('');
  }

  // Performance by tag
  if (tags.rows.length > 0) {
    lines.push('<b>By Tag</b>');
    for (const t of tags.rows) {
      lines.push(`• <b>${t.tag_name}</b> (${num(t.contacted_leads)} contacted)`);
      lines.push(`  Reply: ${t.reply_rate_pct}%  Positive/reply: ${t.positive_of_replies_pct ?? '—'}%  Auto: ${t.auto_reply_rate_pct ?? '—'}%  Bounce: ${t.bounce_rate_pct}%`);
    }
    lines.push('');
  }

  // Domain health
  lines.push('<b>Domain Health</b>');
  for (const dom of domains.rows) {
    const warn = Number(dom.avg_health_7d) < 97 ? ' ⚠' : '';
    lines.push(`• ${dom.domain}${warn}: health ${dom.avg_health_7d}% | sent today ${num(dom.sent_today)}/${num(dom.total_daily_limit)} (${dom.capacity_used_pct}%)`);
    if (Number(dom.accounts_below_95) > 0) {
      lines.push(`  ${dom.accounts_below_95} accounts below 95%`);
    }
  }
  lines.push('');

  // Warmup
  if (w) {
    lines.push('<b>Warmup</b>');
    lines.push(`Inbox: ${w.inbox_percent}%  Spam: ${w.spam_percent}%  |  Google: ${w.google_percent}%  MS: ${w.microsoft_percent}%`);
    lines.push(`Total warmup sent: ${num(w.total_warmup_sent)}`);
    lines.push('');
  }

  // Lead pipeline
  lines.push('<b>Lead Pipeline</b>');
  const leadMap = Object.fromEntries(leads.rows.map(r => [r.status, r.count]));
  lines.push(`Not contacted: ${num(leadMap.NOT_CONTACTED)}  |  Contacted: ${num(leadMap.CONTACTED)}`);
  lines.push(`Replied: ${num(leadMap.REPLIED)}  |  Bounced: ${num(leadMap.BOUNCED)}  |  Completed: ${num(leadMap.COMPLETED)}`);
  lines.push('');

  // Sync errors
  if (errors.rows.length > 0) {
    lines.push('<b>Sync Errors (24h)</b>');
    for (const e of errors.rows) {
      lines.push(`• ${e.sync_type}: ${e.error_message}`);
    }
    lines.push('');
  }

  lines.push(`<i>Synced from PlusVibe | outreach DB</i>`);

  const message = lines.join('\n');
  await sendTelegram(message);
  console.log('Daily report sent to Telegram');
  console.log('Preview:\n' + message);
}
