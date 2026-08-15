// Domain infra sync — ported+extended from domains-emails-infra/scripts/utils/domain-infra-sync.cjs
// (2026-07-12). That script only ever upserted outreach.domain_infrastructure (domain TEXT PRIMARY
// KEY, one row per domain, overwritten every run) — real history never existed, was run once
// manually on 2026-06-13, and had never been scheduled since. This version keeps that same
// "latest snapshot" table for v_domain_monitor (unchanged consumer contract) but ALSO inserts into
// outreach.domain_infra_history (domain, snapshot_date) so past values survive the next sync run.
import { query, logSync } from '../lib/db.js';
import { getRegistrars } from './registrars.js';
import { getSpamhaus } from './spamhaus.js';

function merge(registrarRows, spamhausRows, siteRows) {
  const spamMap = Object.fromEntries(spamhausRows.map((r) => [r.domain, r]));
  const siteMap = Object.fromEntries(siteRows.map((r) => [r.domain, r]));
  return registrarRows.map((reg) => ({
    ...reg,
    spamhaus_score: spamMap[reg.domain]?.spamhaus_score ?? null,
    spamhaus_infra: spamMap[reg.domain]?.spamhaus_infra ?? null,
    spamhaus_smtp: spamMap[reg.domain]?.spamhaus_smtp ?? null,
    blacklisted: spamMap[reg.domain]?.blacklisted ?? null,
    abused: spamMap[reg.domain]?.abused ?? null,
    site_ok: siteMap[reg.domain]?.site_ok ?? null,
    site_http_status: siteMap[reg.domain]?.site_http_status ?? null,
    site_checked_at: siteMap[reg.domain]?.checked ? new Date() : null,
    site_error: siteMap[reg.domain]?.site_error ?? null,
  }))
}

// Only checks domains attached to a CF Pages project (cf_pages_project set) — the rest are
// SMTP-only sending domains that were never meant to serve a site, so "not applicable" (handled
// in v_domain_monitor) is the correct read for them, not a failed check. One request per domain,
// 8s timeout, small delay between requests since this runs in the same daily cron as the
// registrar/spamhaus checks — no shared rate limit with those APIs to respect here.
async function checkSites(registrarRows) {
  const results = []
  for (const r of registrarRows) {
    if (!r.cf_pages_project) continue
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    try {
      let res
      try {
        res = await fetch(`https://${r.domain}`, { method: 'HEAD', redirect: 'follow', signal: controller.signal })
      } catch {
        res = await fetch(`https://${r.domain}`, { method: 'GET', redirect: 'follow', signal: controller.signal })
      }
      results.push({ domain: r.domain, site_ok: res.ok, site_http_status: res.status, site_error: null, checked: true })
    } catch (e) {
      results.push({ domain: r.domain, site_ok: false, site_http_status: null, site_error: String(e.message || e).slice(0, 200), checked: true })
    } finally {
      clearTimeout(timer)
    }
    await new Promise((res) => setTimeout(res, 150))
  }
  return results
}

async function upsertLatest(rows) {
  for (const r of rows) {
    await query(
      `INSERT INTO domain_infrastructure
         (domain, registrar, expires_at, auto_renew, status, dns_provider, nameservers,
          cf_pages_project, spamhaus_score, spamhaus_infra, spamhaus_smtp, blacklisted, abused,
          site_ok, site_http_status, site_checked_at, site_error, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())
       ON CONFLICT (domain) DO UPDATE SET
         registrar        = EXCLUDED.registrar,
         expires_at       = EXCLUDED.expires_at,
         auto_renew       = EXCLUDED.auto_renew,
         status           = EXCLUDED.status,
         dns_provider     = EXCLUDED.dns_provider,
         nameservers      = EXCLUDED.nameservers,
         cf_pages_project = EXCLUDED.cf_pages_project,
         spamhaus_score   = COALESCE(EXCLUDED.spamhaus_score, domain_infrastructure.spamhaus_score),
         spamhaus_infra   = COALESCE(EXCLUDED.spamhaus_infra, domain_infrastructure.spamhaus_infra),
         spamhaus_smtp    = COALESCE(EXCLUDED.spamhaus_smtp, domain_infrastructure.spamhaus_smtp),
         blacklisted      = COALESCE(EXCLUDED.blacklisted, domain_infrastructure.blacklisted),
         abused           = COALESCE(EXCLUDED.abused, domain_infrastructure.abused),
         site_ok          = COALESCE(EXCLUDED.site_ok, domain_infrastructure.site_ok),
         site_http_status = COALESCE(EXCLUDED.site_http_status, domain_infrastructure.site_http_status),
         site_checked_at  = COALESCE(EXCLUDED.site_checked_at, domain_infrastructure.site_checked_at),
         site_error       = COALESCE(EXCLUDED.site_error, domain_infrastructure.site_error),
         updated_at       = NOW()`,
      [
        r.domain, r.registrar, r.expires_at, r.auto_renew, r.status,
        r.dns_provider, r.nameservers, r.cf_pages_project,
        r.spamhaus_score, r.spamhaus_infra, r.spamhaus_smtp,
        r.blacklisted, r.abused,
        r.site_ok, r.site_http_status, r.site_checked_at, r.site_error,
      ],
    );
  }
}

async function insertHistory(rows) {
  for (const r of rows) {
    await query(
      `INSERT INTO domain_infra_history
         (domain, snapshot_date, registrar, expires_at, auto_renew, status, dns_provider, nameservers,
          cf_pages_project, spamhaus_score, spamhaus_infra, spamhaus_smtp, blacklisted, abused,
          site_ok, site_http_status, site_checked_at, site_error)
       VALUES ($1, CURRENT_DATE, $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (domain, snapshot_date) DO UPDATE SET
         registrar        = EXCLUDED.registrar,
         expires_at       = EXCLUDED.expires_at,
         auto_renew       = EXCLUDED.auto_renew,
         status           = EXCLUDED.status,
         dns_provider     = EXCLUDED.dns_provider,
         nameservers      = EXCLUDED.nameservers,
         cf_pages_project = EXCLUDED.cf_pages_project,
         spamhaus_score   = COALESCE(EXCLUDED.spamhaus_score, domain_infra_history.spamhaus_score),
         spamhaus_infra   = COALESCE(EXCLUDED.spamhaus_infra, domain_infra_history.spamhaus_infra),
         spamhaus_smtp    = COALESCE(EXCLUDED.spamhaus_smtp, domain_infra_history.spamhaus_smtp),
         blacklisted      = COALESCE(EXCLUDED.blacklisted, domain_infra_history.blacklisted),
         abused           = COALESCE(EXCLUDED.abused, domain_infra_history.abused),
         site_ok          = COALESCE(EXCLUDED.site_ok, domain_infra_history.site_ok),
         site_http_status = COALESCE(EXCLUDED.site_http_status, domain_infra_history.site_http_status),
         site_checked_at  = COALESCE(EXCLUDED.site_checked_at, domain_infra_history.site_checked_at),
         site_error       = COALESCE(EXCLUDED.site_error, domain_infra_history.site_error)`,
      [
        r.domain, r.registrar, r.expires_at, r.auto_renew, r.status,
        r.dns_provider, r.nameservers, r.cf_pages_project,
        r.spamhaus_score, r.spamhaus_infra, r.spamhaus_smtp,
        r.blacklisted, r.abused,
        r.site_ok, r.site_http_status, r.site_checked_at, r.site_error,
      ],
    );
  }
}

export async function syncDomainInfra() {
  const startedAt = new Date();
  console.log('  Fetching registrar data...');
  try {
    const registrarRows = await getRegistrars();
    const domains = registrarRows.map((r) => r.domain);

    console.log(`  Checking Spamhaus for ${domains.length} domains...`);
    const spamhausRows = await getSpamhaus(domains);

    const pagesCount = registrarRows.filter((r) => r.cf_pages_project).length;
    console.log(`  Checking live site status for ${pagesCount} CF Pages-attached domains...`);
    const siteRows = await checkSites(registrarRows);

    const merged = merge(registrarRows, spamhausRows, siteRows);

    await upsertLatest(merged);
    await insertHistory(merged);

    console.log(`  Synced ${merged.length} domains (latest + history).`);
    await logSync('domain_infra', startedAt, { processed: merged.length, upserted: merged.length, status: 'success' });
    return merged;
  } catch (e) {
    await logSync('domain_infra', startedAt, { status: 'error', error: e.message });
    throw e;
  }
}
