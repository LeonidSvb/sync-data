import { query, logSync } from '../../lib/db.js';
import { getCampaigns, getCampaignStats } from '../../lib/plusvibe-api.js';

function getDatesInRange(startDate, endDate) {
  const dates = [];
  const current = new Date(startDate);
  const end = new Date(endDate);
  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

async function upsertDailyStat(campaignId, campaignName, date, s) {
  await query(`
    INSERT INTO campaign_stats_daily (
      campaign_id, campaign_name, stat_date,
      sent_count, new_lead_contacted_count, replied_count,
      bounced_count, positive_reply_count, unique_opened_count, opportunity_val
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT (campaign_id, stat_date) DO UPDATE SET
      sent_count = EXCLUDED.sent_count,
      new_lead_contacted_count = EXCLUDED.new_lead_contacted_count,
      replied_count = EXCLUDED.replied_count,
      bounced_count = EXCLUDED.bounced_count,
      positive_reply_count = EXCLUDED.positive_reply_count,
      unique_opened_count = EXCLUDED.unique_opened_count,
      opportunity_val = EXCLUDED.opportunity_val
  `, [
    campaignId, campaignName, date,
    s.sent_count || 0, s.new_lead_contacted_count || 0, s.replied_count || 0,
    s.bounced_count || 0, s.positive_reply_count || 0, s.unique_opened_count || 0,
    s.opportunity_val || 0
  ]);
}

export async function backfillDailyStats(fromDate = '2026-01-01') {
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  console.log(`Backfilling daily stats from ${fromDate} to ${yesterday}...`);

  const campaigns = await getCampaigns();
  const dates = getDatesInRange(fromDate, yesterday);

  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const campaign of campaigns) {
    const campStart = campaign.created_at ? campaign.created_at.split('T')[0] : fromDate;
    const relevantDates = dates.filter(d => d >= campStart);
    console.log(`  ${campaign.camp_name}: ${relevantDates.length} days to check`);

    for (const date of relevantDates) {
      try {
        await new Promise(r => setTimeout(r, 210)); // rate limit 5 req/sec
        const raw = await getCampaignStats(campaign.id, date, date);
        const s = Array.isArray(raw) ? raw[0] : raw;
        if (!s || s.message || s.error || s.code === 0) { skipped++; continue; }
        if (!s.sent_count && !s.replied_count && !s.bounced_count) { skipped++; continue; }

        await upsertDailyStat(campaign.id, campaign.camp_name, date, s);
        inserted++;
      } catch (e) {
        errors++;
        console.error(`    Error ${campaign.camp_name} ${date}: ${e.message}`);
      }
    }
  }

  console.log(`Done: ${inserted} inserted, ${skipped} skipped (no activity), ${errors} errors`);
  return { inserted, skipped, errors };
}

// Intraday top-up — runs every 30 min (see crontab), only for campaigns that could plausibly have
// moved TODAY, so it stays cheap (a handful of API calls, not all ~77 campaigns every 30 min).
// syncYesterdayDailyStats() still runs once nightly across every campaign and remains the
// authoritative full pass for a finished day — this function only exists to close the up-to-24h
// gap between a real send and it showing up in the dashboard (Leo caught this live, 2026-08-18).
//
// Edge case Leo asked about directly: a campaign that goes ACTIVE -> COMPLETED/PAUSED in the
// 30-min gap between two runs. Filtering to status==='ACTIVE' alone would drop it right when it
// still has today's partial-day numbers to report. Fixed by also including any campaign whose
// modified_at is today — PlusVibe flips modified_at on every status change, so a campaign that
// just completed still qualifies for one more pass before it ages out. Worst case beyond that
// (missed by both this AND still not "yesterday" yet) self-heals the next night regardless, since
// syncYesterdayDailyStats() re-syncs everyone once the day is over.
export async function syncTodayActiveDailyStats() {
  const startedAt = new Date();
  const today = new Date().toISOString().split('T')[0];
  console.log(`  Syncing intraday stats for ${today}...`);

  try {
    const campaigns = await getCampaigns();
    const relevant = campaigns.filter(c =>
      c.status === 'ACTIVE' || (c.modified_at && c.modified_at.slice(0, 10) === today)
    );

    let upserted = 0;
    for (const campaign of relevant) {
      await new Promise(r => setTimeout(r, 210)); // rate limit 5 req/sec
      const raw = await getCampaignStats(campaign.id, today, today);
      const s = Array.isArray(raw) ? raw[0] : raw;
      if (!s || s.message || s.error || s.code === 0) continue;
      if (!s.sent_count && !s.replied_count && !s.bounced_count) continue;

      await upsertDailyStat(campaign.id, campaign.camp_name, today, s);
      upserted++;
    }

    await logSync('daily_stats_intraday', startedAt, { processed: relevant.length, upserted, status: 'success' });
    console.log(`  daily_stats_intraday: ${upserted}/${relevant.length} campaigns updated for ${today}`);
  } catch (e) {
    await logSync('daily_stats_intraday', startedAt, { status: 'error', error: e.message });
    console.error('  daily_stats_intraday sync failed:', e.message);
  }
}

export async function syncYesterdayDailyStats() {
  const startedAt = new Date();
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  console.log(`  Syncing daily stats for ${yesterday}...`);

  try {
    const campaigns = await getCampaigns();
    let upserted = 0;

    for (const campaign of campaigns) {
      await new Promise(r => setTimeout(r, 210)); // rate limit 5 req/sec
      const raw = await getCampaignStats(campaign.id, yesterday, yesterday);
      const s = Array.isArray(raw) ? raw[0] : raw;
      if (!s || s.message || s.error || s.code === 0) continue;
      if (!s.sent_count && !s.replied_count && !s.bounced_count) continue;

      await upsertDailyStat(campaign.id, campaign.camp_name, yesterday, s);
      upserted++;
    }

    await logSync('daily_stats', startedAt, { processed: campaigns.length, upserted, status: 'success' });
    console.log(`  daily_stats: ${upserted} campaigns updated for ${yesterday}`);
  } catch (e) {
    await logSync('daily_stats', startedAt, { status: 'error', error: e.message });
    console.error('  daily_stats sync failed:', e.message);
  }
}
