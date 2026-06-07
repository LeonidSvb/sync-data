// Full upsert + soft delete for email accounts (196 accounts) + tag assignments.
import { query, logSync } from '../../lib/db.js';
import { getEmailAccounts } from '../../lib/plusvibe-api.js';
import { syncAccountTags } from './tags.js';

export async function syncEmailAccounts() {
  const startedAt = new Date();
  console.log('  Syncing email accounts...');
  try {
    const accounts = await getEmailAccounts();
    let upserted = 0;
    for (const a of accounts) {
      const h = a.payload?.analytics?.health_scores || {};
      const d = a.payload?.analytics?.daily_counters || {};
      const domain = a.email.split('@')[1] || null;
      await query(`
        INSERT INTO email_accounts (
          id, email, domain, provider, status, warmup_status,
          daily_limit, sending_gap_min, warmup_limit,
          health_7d, bounce_rate_3d, email_sent_today, warmup_sent_today,
          warmup_enabled_at, created_at, modified_at, synced_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())
        ON CONFLICT (id) DO UPDATE SET
          status=EXCLUDED.status, warmup_status=EXCLUDED.warmup_status,
          daily_limit=EXCLUDED.daily_limit, health_7d=EXCLUDED.health_7d,
          bounce_rate_3d=EXCLUDED.bounce_rate_3d, email_sent_today=EXCLUDED.email_sent_today,
          warmup_sent_today=EXCLUDED.warmup_sent_today, modified_at=EXCLUDED.modified_at,
          synced_at=NOW(), deleted_from_source_at=NULL
      `, [
        a.id, a.email, domain, a.provider, a.status, a.warmup_status,
        a.payload?.daily_limit, a.payload?.sending_gap, a.payload?.warmup?.limit,
        h['7d_overall_warmup_health'] ?? null,
        h['3d_bounce_rate'] === -1 ? null : h['3d_bounce_rate'],
        d.email_sent_today ?? 0, d.warmup_email_sent_today ?? 0,
        a.warmup_enb_dt || null, a.timestamp_created, a.timestamp_updated
      ]);
      upserted++;
    }
    const apiIds = accounts.map(a => a.id);
    if (apiIds.length > 0) {
      await query(
        `UPDATE email_accounts SET deleted_from_source_at = NOW() WHERE deleted_from_source_at IS NULL AND id != ALL($1::text[])`,
        [apiIds]
      );
    }
    // Sync tag assignments
    await syncAccountTags(accounts);

    await logSync('email_accounts', startedAt, { processed: accounts.length, upserted, status: 'success' });
    console.log(`  email_accounts: ${upserted} upserted`);
  } catch (e) {
    await logSync('email_accounts', startedAt, { status: 'error', error: e.message });
    console.error('  email_accounts sync failed:', e.message);
  }
}
