// PlusVibe API client. Rate limit: 5 req/sec — always use 210ms delay in loops.
const BASE = process.env.PLUSVIBE_BASE_URL;
const KEY = process.env.PLUSVIBE_API_KEY;
const WS = process.env.PLUSVIBE_WORKSPACE_ID;
const HEADERS = { 'x-api-key': KEY, 'Content-Type': 'application/json' };

async function get(path, params = {}, retries = 3) {
  const qs = new URLSearchParams({ workspace_id: WS, ...params }).toString();
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}?${qs}`, { headers: HEADERS });
    if (res.ok) return res.json();
    if (res.status === 429 && attempt < retries) {
      const delay = 1000 * 2 ** attempt; // 1s, 2s, 4s
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    throw new Error(`API ${path} returned ${res.status}`);
  }
}

export async function getCampaigns() {
  return get('/campaign/list-all', { limit: 100 });
}

export async function getEmailAccounts() {
  const res = await get('/account/list', { limit: 200 });
  return res.accounts || [];
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
    await new Promise(r => setTimeout(r, 220));
  }
  return leads;
}

export async function getCampaignStats(campaignId, startDate, endDate) {
  return get('/analytics/campaign/stats', { campaign_id: campaignId, start_date: startDate, end_date: endDate });
}
