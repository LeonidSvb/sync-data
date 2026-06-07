// Upserts tags list and account→tag assignments from PlusVibe.
import { query, logSync } from '../../lib/db.js';
const BASE = process.env.PLUSVIBE_BASE_URL;
const KEY = process.env.PLUSVIBE_API_KEY;
const WS = process.env.PLUSVIBE_WORKSPACE_ID;
const H = { 'x-api-key': KEY };

async function get(path, params = {}) {
  const qs = new URLSearchParams({ workspace_id: WS, ...params }).toString();
  const res = await fetch(`${BASE}${path}?${qs}`, { headers: H });
  return res.json();
}

export async function syncTags() {
  const startedAt = new Date();
  console.log('  Syncing tags...');
  try {
    const tags = await get('/tags/list', { limit: 100 });
    if (!Array.isArray(tags)) { console.log('  tags: no data'); return; }

    for (const t of tags) {
      await query(`
        INSERT INTO tags (id, name, color, description, synced_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, color=EXCLUDED.color, description=EXCLUDED.description, synced_at=NOW()
      `, [t._id, t.name, t.color, t.description || null]);
    }
    await logSync('tags', startedAt, { processed: tags.length, upserted: tags.length, status: 'success' });
    console.log(`  tags: ${tags.length} upserted`);
  } catch (e) {
    await logSync('tags', startedAt, { status: 'error', error: e.message });
    console.error('  tags sync failed:', e.message);
  }
}

export async function syncAccountTags(accounts) {
  // accounts = already fetched from /account/list
  console.log('  Syncing account_tags...');
  let total = 0;
  for (const a of accounts) {
    const tagIds = a.payload?.tags || [];
    // Delete old tags for this account
    await query('DELETE FROM account_tags WHERE account_id = $1', [a.id]);
    // Insert current tags
    for (const tagId of tagIds) {
      await query(
        'INSERT INTO account_tags (account_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [a.id, tagId]
      );
      total++;
    }
  }
  console.log(`  account_tags: ${total} tag assignments`);
}
