// Ported from domains-emails-infra/scripts/utils/spamhaus-check.cjs (2026-07-12) — real
// Spamhaus Intel API (Developer License, 5000 req/month), not a guess at the methodology.
// ESM conversion, no logic changes.
const BASE = 'https://api.spamhaus.org';

async function login() {
  const r = await fetch(`${BASE}/api/v1/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: process.env.SPAMHAUS_USERNAME,
      password: process.env.SPAMHAUS_PASSWORD,
      realm: process.env.SPAMHAUS_REALM,
    }),
  });
  const data = await r.json();
  if (!data.token) throw new Error('Spamhaus login failed: ' + JSON.stringify(data));
  return data.token;
}

async function checkDomain(token, domain) {
  const H = { Authorization: `Bearer ${token}` };
  const base = `${BASE}/api/intel/v2/byobject/domain/${domain}`;

  const [info, dims, listing] = await Promise.all([
    fetch(base, { headers: H }).then((r) => (r.ok ? r.json() : null)),
    fetch(base + '/dimensions', { headers: H }).then((r) => (r.ok ? r.json() : null)),
    fetch(base + '/listing', { headers: H }).then((r) => (r.ok ? r.json() : null)),
  ]);

  return {
    domain,
    spamhaus_score: typeof info?.score === 'number' ? info.score : null,
    spamhaus_infra: typeof dims?.infra === 'number' ? dims.infra : null,
    spamhaus_smtp: typeof dims?.smtp === 'number' ? dims.smtp : null,
    blacklisted: listing?.['is-listed'] === true,
    abused: info?.abused === true,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Rate limit: 5000 req/month (developer license) — throttled to ~3 req/sec.
export async function getSpamhaus(domains) {
  if (!domains || !domains.length) throw new Error('Pass domains array to getSpamhaus()');

  console.log('  Spamhaus: logging in...');
  const token = await login();
  console.log(`  Spamhaus: checking ${domains.length} domains...`);

  const results = [];
  for (const domain of domains) {
    try {
      const row = await checkDomain(token, domain);
      results.push(row);
      console.log(`  ${domain.padEnd(28)} score=${String(row.spamhaus_score).padEnd(6)} infra=${String(row.spamhaus_infra).padEnd(6)} listed=${row.blacklisted}`);
    } catch (e) {
      console.warn(`  ${domain} ERROR: ${e.message}`);
      results.push({ domain, spamhaus_score: null, spamhaus_infra: null, spamhaus_smtp: null, blacklisted: null, abused: null });
    }
    await sleep(300);
  }

  return results;
}
