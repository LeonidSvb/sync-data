// Full upsert + soft delete for campaigns from PlusVibe.
import { query, logSync } from '../../lib/db.js';
import { getCampaigns } from '../../lib/plusvibe-api.js';

export async function syncCampaigns() {
  const startedAt = new Date();
  console.log('  Syncing campaigns...');
  try {
    const campaigns = await getCampaigns();
    let upserted = 0;
    for (const c of campaigns) {
      await query(`
        INSERT INTO campaigns (
          id, name, status, campaign_type, parent_camp_id,
          lead_count, sent_count, unique_opened_count, replied_count, bounced_count,
          unsubscribed_count, positive_reply_count, negative_reply_count, neutral_reply_count,
          lead_contacted_count, completed_lead_count, open_rate, replied_rate, opportunity_val,
          daily_limit, schedule_timezone, schedule_from_time, schedule_to_time,
          stop_on_lead_replied, sequence_steps,
          created_at, modified_at, last_lead_sent, last_lead_replied, synced_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,NOW())
        ON CONFLICT (id) DO UPDATE SET
          name=EXCLUDED.name, status=EXCLUDED.status, lead_count=EXCLUDED.lead_count,
          sent_count=EXCLUDED.sent_count, unique_opened_count=EXCLUDED.unique_opened_count,
          replied_count=EXCLUDED.replied_count, bounced_count=EXCLUDED.bounced_count,
          positive_reply_count=EXCLUDED.positive_reply_count, lead_contacted_count=EXCLUDED.lead_contacted_count,
          completed_lead_count=EXCLUDED.completed_lead_count, open_rate=EXCLUDED.open_rate,
          replied_rate=EXCLUDED.replied_rate, opportunity_val=EXCLUDED.opportunity_val,
          last_lead_sent=EXCLUDED.last_lead_sent, last_lead_replied=EXCLUDED.last_lead_replied,
          modified_at=EXCLUDED.modified_at, synced_at=NOW(), deleted_from_source_at=NULL
      `, [
        c.id, c.camp_name, c.status, c.campaign_type || 'parent', c.parent_camp_id || null,
        c.lead_count, c.sent_count, c.unique_opened_count, c.replied_count, c.bounced_count,
        c.unsubscribed_count, c.positive_reply_count, c.negative_reply_count, c.neutral_reply_count,
        c.lead_contacted_count, c.completed_lead_count,
        c.open_rate || 0, c.replied_rate || 0, c.opportunity_val || 0,
        c.daily_limit, c.schedule?.tz, c.schedule?.from_time, c.schedule?.to_time,
        c.stop_on_lead_replied === 1, c.sequence_steps || 0,
        c.created_at, c.modified_at, c.last_lead_sent || null, c.last_lead_replied || null
      ]);
      upserted++;
    }
    // Soft delete campaigns not in API anymore
    const apiIds = campaigns.map(c => c.id);
    if (apiIds.length > 0) {
      await query(
        `UPDATE campaigns SET deleted_from_source_at = NOW() WHERE deleted_from_source_at IS NULL AND id != ALL($1::text[])`,
        [apiIds]
      );
    }
    await logSync('campaigns', startedAt, { processed: campaigns.length, upserted, status: 'success' });
    console.log(`  campaigns: ${upserted} upserted`);
  } catch (e) {
    await logSync('campaigns', startedAt, { status: 'error', error: e.message });
    console.error('  campaigns sync failed:', e.message);
  }
}
