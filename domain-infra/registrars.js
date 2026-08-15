// Ported from domains-emails-infra/scripts/utils/domain-registrars.cjs (2026-07-12) — was a
// working local-only script, never scheduled. ESM conversion, no logic changes.
function detectDns(nameservers = []) {
  const ns = nameservers.join(' ').toLowerCase();
  if (ns.includes('cloudflare.com')) return 'Cloudflare';
  if (ns.includes('porkbun.com')) return 'Porkbun';
  if (ns.includes('godaddy.com')) return 'GoDaddy';
  return nameservers[0] || null;
}

async function getCloudflare() {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/registrar/domains?per_page=100`,
    { headers: { 'X-Auth-Email': process.env.CF_EMAIL, 'X-Auth-Key': process.env.CF_GLOBAL_API_KEY } },
  );
  const data = await r.json();
  if (!data.success) throw new Error('CF registrar: ' + JSON.stringify(data.errors));

  return (data.result || []).map((d) => ({
    domain: d.name,
    registrar: 'Cloudflare',
    expires_at: d.expires_at ? d.expires_at.slice(0, 10) : null,
    auto_renew: d.auto_renew ?? null,
    status: d.last_known_status || 'active',
    dns_provider: detectDns(d.name_servers),
    nameservers: (d.name_servers || []).join(', '),
  }));
}

// Was calling this endpoint with ?per_page=100 — CF rejects that on /pages/projects (error
// 8000024 "Invalid list options provided"), so `data.success` was always false and this returned
// {} on every run, silently leaving cf_pages_project NULL for all 32 domains. Confirmed live
// 2026-08-15 via direct API call. Dropping per_page fixes the call; the project list response
// already embeds each project's attached custom domains, so the old per-project follow-up fetch
// (one extra request per project) is unnecessary too.
async function getCfPagesMap() {
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/pages/projects`,
    { headers: { 'X-Auth-Email': process.env.CF_EMAIL, 'X-Auth-Key': process.env.CF_GLOBAL_API_KEY } },
  );
  const data = await r.json();
  if (!data.success) return {};

  const map = {};
  for (const project of data.result || []) {
    for (const domain of project.domains || []) map[domain] = project.name;
  }
  return map;
}

async function getPorkbun() {
  const r = await fetch('https://api.porkbun.com/api/json/v3/domain/listAll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apikey: process.env.PORKBUN_API_KEY, secretapikey: process.env.PORKBUN_SECRET_KEY }),
  });
  const data = await r.json();
  if (data.status !== 'SUCCESS') throw new Error('Porkbun: ' + JSON.stringify(data));

  return (data.domains || []).map((d) => ({
    domain: d.domain,
    registrar: 'Porkbun',
    expires_at: d.expireDate ? d.expireDate.slice(0, 10) : null,
    auto_renew: d.autoRenew === '1',
    status: d.status ? d.status.toLowerCase() : 'active',
    dns_provider: null,
    nameservers: null,
  }));
}

async function getGodaddy() {
  if (!process.env.GODADDY_API_KEY) return [];
  const r = await fetch('https://api.godaddy.com/v1/domains?limit=100&status=ACTIVE', {
    headers: { Authorization: `sso-key ${process.env.GODADDY_API_KEY}:${process.env.GODADDY_API_SECRET}` },
  });
  const data = await r.json();
  if (data.code === 'ACCESS_DENIED' || !Array.isArray(data)) {
    console.warn('  GoDaddy API restricted — skipping');
    return [];
  }
  return data.map((d) => ({
    domain: d.domain,
    registrar: 'GoDaddy',
    expires_at: d.expires ? d.expires.slice(0, 10) : null,
    auto_renew: d.renewAuto ?? null,
    status: d.status ? d.status.toLowerCase() : 'active',
    dns_provider: detectDns(d.nameServers || []),
    nameservers: (d.nameServers || []).join(', '),
  }));
}

export async function getRegistrars() {
  const results = [];
  const errors = [];

  const [cfPages] = await Promise.allSettled([getCfPagesMap()]);
  const pagesMap = cfPages.status === 'fulfilled' ? cfPages.value : {};

  await Promise.allSettled([
    getCloudflare()
      .then((rows) => {
        console.log(`  Cloudflare: ${rows.length} domains`);
        results.push(...rows);
      })
      .catch((e) => errors.push('Cloudflare: ' + e.message)),
    getPorkbun()
      .then((rows) => {
        console.log(`  Porkbun: ${rows.length} domains`);
        results.push(...rows);
      })
      .catch((e) => errors.push('Porkbun: ' + e.message)),
    getGodaddy()
      .then((rows) => {
        if (rows.length) {
          console.log(`  GoDaddy: ${rows.length} domains`);
          results.push(...rows);
        }
      })
      .catch((e) => errors.push('GoDaddy: ' + e.message)),
  ]);

  for (const row of results) {
    row.cf_pages_project = pagesMap[row.domain] || null;
    if (!row.dns_provider) row.dns_provider = row.registrar;
  }

  if (errors.length) console.warn('  Registrar errors:', errors);
  return results;
}
