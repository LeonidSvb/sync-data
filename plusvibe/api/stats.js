// Daily snapshots: campaign_stats (cumulative), warmup_stats, lead_status_counts.
import { query, logSync } from '../../lib/db.js';
import { getCampaigns, getCampaignStats, getWarmupStats, getLeadStatusCounts } from '../../lib/plusvibe-api.js';

export async function syncCampaignStats() {
  const startedAt = new Date();
  console.log('  Syncing campaign stats...');
  try {
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const yearStart = today.slice(0, 4) + '-01-01';

    const campaigns = await getCampaigns();
    let upserted = 0;

    for (const c of campaigns) {
      await new Promise(r => setTimeout(r, 210)); // rate limit 5 req/sec
      const stats = await getCampaignStats(c.id, yearStart, today);
      const s = Array.isArray(stats) ? stats[0] : stats;
      if (!s || s.message) continue;

      await query(`
        INSERT INTO campaign_stats (
          campaign_id, campaign_name, snapshot_date,
          lead_count, completed_lead_count, lead_contacted_count,
          sent_count, unique_opened_count, replied_count,
          bounced_count, unsubscribed_count, positive_reply_count, opportunity_val
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (campaign_id, snapshot_date) DO UPDATE SET
          lead_count=EXCLUDED.lead_count, sent_count=EXCLUDED.sent_count,
          unique_opened_count=EXCLUDED.unique_opened_count, replied_count=EXCLUDED.replied_count,
          bounced_count=EXCLUDED.bounced_count, positive_reply_count=EXCLUDED.positive_reply_count,
          opportunity_val=EXCLUDED.opportunity_val
      `, [
        c.id, c.camp_name, today,
        s.lead_count || 0, s.completed_lead_count || 0, s.lead_contacted_count || 0,
        s.sent_count || 0, s.unique_opened_count || 0, s.replied_count || 0,
        s.bounced_count || 0, s.unsubscribed_count || 0, s.positive_reply_count || 0,
        s.opportunity_val || 0
      ]);
      upserted++;
    }

    await logSync('campaign_stats', startedAt, { processed: campaigns.length, upserted, status: 'success' });
    console.log(`  campaign_stats: ${upserted} upserted`);
  } catch (e) {
    await logSync('campaign_stats', startedAt, { status: 'error', error: e.message });
    console.error('  campaign_stats sync failed:', e.message);
  }
}

export async function syncWarmupStats() {
  const startedAt = new Date();
  console.log('  Syncing warmup stats...');
  try {
    const today = new Date().toISOString().split('T')[0];
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const stats = await getWarmupStats(weekAgo, today);
    const e = stats.emailAcc;
    if (!e) { console.log('  warmup_stats: no data'); return; }

    await query(`
      INSERT INTO warmup_stats (
        snapshot_date, google_percent, microsoft_percent, other_percent,
        inbox_percent, spam_percent, promotion_percent,
        total_warmup_sent, total_inbox_sent, total_spam_sent
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (snapshot_date) DO UPDATE SET
        google_percent=EXCLUDED.google_percent, microsoft_percent=EXCLUDED.microsoft_percent,
        inbox_percent=EXCLUDED.inbox_percent, spam_percent=EXCLUDED.spam_percent,
        total_warmup_sent=EXCLUDED.total_warmup_sent, total_inbox_sent=EXCLUDED.total_inbox_sent
    `, [
      today,
      parseFloat(e.google_percent), parseFloat(e.microsoft_percent), parseFloat(e.other_percent),
      parseFloat(e.inbox_percent), parseFloat(e.spam_percent), parseFloat(e.promotion_percent),
      e.total_warmup_sent, e.total_inbox_sent, e.total_spam_sent
    ]);

    await logSync('warmup_stats', startedAt, { processed: 1, upserted: 1, status: 'success' });
    console.log(`  warmup_stats: inbox ${e.inbox_percent}% spam ${e.spam_percent}%`);
  } catch (e) {
    await logSync('warmup_stats', startedAt, { status: 'error', error: e.message });
    console.error('  warmup_stats sync failed:', e.message);
  }
}

export async function syncLeadStatusCounts() {
  const startedAt = new Date();
  console.log('  Syncing lead status counts...');
  try {
    const counts = await getLeadStatusCounts();
    if (!Array.isArray(counts)) { console.log('  lead_status_counts: no data'); return; }

    const now = new Date().toISOString();
    for (const row of counts) {
      await query(
        `INSERT INTO lead_status_counts (snapshot_at, status, count) VALUES ($1, $2, $3)`,
        [now, row.status, row.count]
      );
    }

    await logSync('lead_status_counts', startedAt, { processed: counts.length, upserted: counts.length, status: 'success' });
    console.log(`  lead_status_counts: ${counts.length} rows`);
  } catch (e) {
    await logSync('lead_status_counts', startedAt, { status: 'error', error: e.message });
    console.error('  lead_status_counts sync failed:', e.message);
  }
}
