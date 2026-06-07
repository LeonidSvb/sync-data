// Full paginated upsert + soft delete for leads (~14k). Preserves deleted leads.
import { query, logSync } from '../../lib/db.js';
import { getAllLeads } from '../../lib/plusvibe-api.js';

export async function syncLeads() {
  const startedAt = new Date();
  console.log('  Syncing leads (full paginated upsert)...');
  try {
    const leads = await getAllLeads();
    let upserted = 0;

    // Batch upserts of 50 at a time for speed
    const BATCH = 50;
    for (let i = 0; i < leads.length; i += BATCH) {
      const batch = leads.slice(i, i + BATCH);
      for (const l of batch) {
        await query(`
          INSERT INTO leads (
            id, campaign_id, campaign_name, email, first_name, last_name,
            job_title, company_name, company_website, phone_number, linkedin_person_url,
            city, country, status, label, email_acc_name,
            sent_step, total_steps, replied_count, opened_count, mx,
            notes, bounce_msg, last_sent_at, next_email_time,
            created_at, modified_at, synced_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,NOW())
          ON CONFLICT (id) DO UPDATE SET
            status=EXCLUDED.status, label=EXCLUDED.label,
            campaign_id=EXCLUDED.campaign_id, campaign_name=EXCLUDED.campaign_name,
            email_acc_name=EXCLUDED.email_acc_name, sent_step=EXCLUDED.sent_step,
            replied_count=EXCLUDED.replied_count, opened_count=EXCLUDED.opened_count,
            last_sent_at=EXCLUDED.last_sent_at, next_email_time=EXCLUDED.next_email_time,
            bounce_msg=EXCLUDED.bounce_msg, notes=EXCLUDED.notes,
            modified_at=EXCLUDED.modified_at, synced_at=NOW(), deleted_from_source_at=NULL
        `, [
          l._id, l.campaign_id, l.camp_name || null, l.email, l.first_name || null, l.last_name || null,
          l.job_title || null, l.company_name || null, l.company_website || null,
          l.phone_number || null, l.linkedin_person_url || null,
          l.city || null, l.country || null, l.status, l.label || null, l.email_acc_name || null,
          l.sent_step || 0, l.total_steps || 0, l.replied_count || 0, l.opened_count || 0, l.mx || null,
          l.notes || null, l.bounce_msg || null,
          l.last_sent_at || null, l.next_email_time || null,
          l.created_at, l.modified_at
        ]);
        upserted++;
      }
    }

    // Soft delete leads not in API
    const apiIds = leads.map(l => l._id);
    if (apiIds.length > 0) {
      const deleted = await query(
        `UPDATE leads SET deleted_from_source_at = NOW() WHERE deleted_from_source_at IS NULL AND id != ALL($1::text[])`,
        [apiIds]
      );
      if (deleted.rowCount > 0) console.log(`  leads: ${deleted.rowCount} soft-deleted from source`);
    }

    await logSync('leads', startedAt, { processed: leads.length, upserted, status: 'success' });
    console.log(`  leads: ${upserted} upserted from ${leads.length} fetched`);
  } catch (e) {
    await logSync('leads', startedAt, { status: 'error', error: e.message });
    console.error('  leads sync failed:', e.message);
  }
}
