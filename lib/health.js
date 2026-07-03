import { query } from './db.js';

const EXPECTED_MINUTES = {
  campaigns: 30,
  leads: 30,
  email_accounts: 30,
  lead_status_counts: 30,
  campaign_stats: 30,
  warmup_stats: 30,
  emails_sync: 30,
  calcom_bookings: 360,
  daily_stats: 1440,
  revenue: 1440,
};

export async function showHealth() {
  const { rows } = await query(`
    SELECT DISTINCT ON (sync_type)
      sync_type, status, started_at, finished_at,
      EXTRACT(EPOCH FROM (finished_at - started_at))::int AS duration_sec,
      records_processed, records_upserted, error_message
    FROM sync_log
    ORDER BY sync_type, started_at DESC
  `);

  const now = Date.now();
  const table = rows.map(r => {
    const ageMin = Math.round((now - new Date(r.started_at).getTime()) / 60000);
    const expected = EXPECTED_MINUTES[r.sync_type];
    const stale = expected ? ageMin > expected * 2 : false;
    let flag = 'ok';
    if (r.status === 'error') flag = 'ERROR';
    else if (stale) flag = 'STALE';
    return {
      sync_type: r.sync_type,
      status: r.status,
      last_run: r.started_at.toISOString().replace('T', ' ').slice(0, 19),
      age_min: ageMin,
      duration_sec: r.duration_sec,
      processed: r.records_processed,
      flag,
    };
  });

  console.table(table);

  const problems = table.filter(t => t.flag !== 'ok');
  if (problems.length) {
    console.log(`\n${problems.length} sync(s) need attention:`);
    problems.forEach(p => console.log(`  - ${p.sync_type}: ${p.flag} (last run ${p.age_min} min ago, status=${p.status})`));
  } else {
    console.log('\nAll syncs healthy.');
  }
}
