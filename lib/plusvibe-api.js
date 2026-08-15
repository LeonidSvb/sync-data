// PlusVibe API client. Rate limit: 5 req/sec — always use 210ms delay in loops.
const BASE = process.env.PLUSVIBE_BASE_URL;
const KEY = process.env.PLUSVIBE_API_KEY;
const WS = process.env.PLUSVIBE_WORKSPACE_ID;
const HEADERS = { 'x-api-key': KEY, 'Content-Type': 'application/json' };

async function get(path, params = {}, retries = 5) {
  const qs = new URLSearchParams({ workspace_id: WS, ...params }).toString();
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}?${qs}`, { headers: HEADERS });
    if (res.ok) return res.json();
    if (res.status === 429 && attempt < retries) {
      const delay = 2000 * 2 ** attempt; // 2s, 4s, 8s, 16s, 32s
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    throw new Error(`API ${path} returned ${res.status}`);
  }
}

export async function getCampaigns() {
  return get('/campaign/list-all', { limit: 100 });
}

// Was capped at a single unpaginated page (limit:200, no skip) — with 500+ real accounts in the
// workspace, every account past #200 got silently marked deleted_from_source_at by the sync's
// own "not in apiIds -> soft delete" cleanup step on every run, even though still active in
// PlusVibe. Confirmed live 2026-08-15 via MCP: skip=300 still returns real active accounts (e.g.
// axystrust.com) with real tags. Paginates with `skip` (the API's actual offset param, confirmed
// via the same MCP call) like getAllLeads() already does with `page`.
export async function getEmailAccounts() {
  const accounts = [];
  let skip = 0;
  const limit = 200;
  while (true) {
    const res = await get('/account/list', { limit, skip });
    const batch = res.accounts || [];
    accounts.push(...batch);
    if (batch.length < limit) break;
    skip += limit;
    await new Promise(r => setTimeout(r, 210));
  }
  return accounts;
}

export async function getLeads(page = 1, limit = 1000) {
  return get('/lead/workspace-leads', { page, limit });
}

export async function getAllLeads() {
  const leads = [];
  let page = 1;
  while (true) {
    const batch = await getLeads(page, 1000);
    if (!batch || batch.length === 0) break;
    leads.push(...batch);
    if (batch.length < 1000) break;
    page++;
    await new Promise(r => setTimeout(r, 300));
  }
  return leads;
}

export async function getCampaignStats(campaignId, startDate, endDate) {
  return get('/analytics/campaign/stats', { campaign_id: campaignId, start_date: startDate, end_date: endDate });
}
