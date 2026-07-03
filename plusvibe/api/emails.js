// Syncs email threads from PlusVibe Unibox to PostgreSQL.
// backfillEmails() — one-time full sync via /unibox/emails API.
// syncRecentEmails() — daily safety net, syncs last 48h.
import { query, logSync } from '../../lib/db.js';
const BASE = process.env.PLUSVIBE_BASE_URL;
const KEY = process.env.PLUSVIBE_API_KEY;
const WS = process.env.PLUSVIBE_WORKSPACE_ID;
const HEADERS = { 'x-api-key': KEY };

async function fetchEmailsPage(pageTrail = null, retries = 5) {
  const params = new URLSearchParams({ workspace_id: WS, email_type: 'all' });
  if (pageTrail) params.set('page_trail', pageTrail);
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`${BASE}/unibox/emails?${params}`, { headers: HEADERS });
    if (res.status === 429) {
      const wait = 2000 * Math.pow(2, attempt);
      console.log(`  429 rate limited, retry ${attempt + 1}/${retries} after ${wait}ms`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw new Error(`Unibox API returned ${res.status}`);
    return res.json();
  }
  throw new Error('Unibox API returned 429 after all retries');
}

async function upsertEmail(e, source = 'api_sync') {
  await query(`
    INSERT INTO emails (
      id, thread_id, campaign_id, lead_id, lead_email,
      from_email, sending_account, subject, body_text,
      direction, label, is_unread, event_type, sent_at, source
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    ON CONFLICT (id) DO UPDATE SET
      label = EXCLUDED.label,
      is_unread = EXCLUDED.is_unread,
      source = EXCLUDED.source
  `, [
    e.id,
    e.thread_id || null,
    e.campaign_id || null,
    e.lead_id || null,
    e.lead || null,
    e.from_address_email || null,
    e.eaccount || null,
    e.subject || null,
    e.body?.text || e.content_preview || null,
    ['IN', 'in', 'incoming'].includes(e.direction) ? 'IN' : 'OUT',
    e.label || null,
    e.is_unread || false,
    null,
    e.source_modified_at || e.timestamp_created || null,
    source,
  ]);
}

export async function backfillEmails() {
  const startedAt = new Date();
  console.log('[' + startedAt.toISOString() + '] Starting email backfill...');

  let pageTrail = null;
  let total = 0;
  let page = 0;

  while (true) {
    const data = await fetchEmailsPage(pageTrail);
    const emails = data.data || [];
    if (emails.length === 0) break;

    for (const e of emails) {
      await upsertEmail(e, 'api_sync');
      total++;
    }

    page++;
    console.log('  Page ' + page + ': ' + emails.length + ' emails (total: ' + total + ')');

    pageTrail = data.page_trail || null;
    if (!pageTrail) break;

    await new Promise(r => setTimeout(r, 600));
  }

  await logSync('emails_backfill', startedAt, { processed: total, upserted: total, deleted: 0, status: 'success' });
  console.log('[' + new Date().toISOString() + '] Backfill done: ' + total + ' emails');
}

export async function syncRecentEmails() {
  const startedAt = new Date();
  console.log('  Syncing recent emails (safety net)...');

  let pageTrail = null;
  let total = 0;

  while (true) {
    const data = await fetchEmailsPage(pageTrail);
    const emails = data.data || [];
    if (emails.length === 0) break;

    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const recent = emails.filter(e => {
      const d = new Date(e.source_modified_at || e.timestamp_created);
      return d >= cutoff;
    });

    for (const e of recent) {
      await upsertEmail(e, 'api_sync');
      total++;
    }

    pageTrail = data.page_trail || null;
    if (!pageTrail || recent.length < emails.length) break;

    await new Promise(r => setTimeout(r, 600));
  }

  await logSync('emails_sync', startedAt, { processed: total, upserted: total, deleted: 0, status: 'success' });
  console.log('  emails: ' + total + ' synced (last 48h)');
}
