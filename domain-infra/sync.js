// Domain infra sync — ported+extended from domains-emails-infra/scripts/utils/domain-infra-sync.cjs
// (2026-07-12). That script only ever upserted outreach.domain_infrastructure (domain TEXT PRIMARY
// KEY, one row per domain, overwritten every run) — real history never existed, was run once
// manually on 2026-06-13, and had never been scheduled since. This version keeps that same
// "latest snapshot" table for v_domain_monitor (unchanged consumer contract) but ALSO inserts into
// outreach.domain_infra_history (domain, snapshot_date) so past values survive the next sync run.
import { query, logSync } from '../lib/db.js';
import { getRegistrars } from './registrars.js';
import { getSpamhaus } from './spamhaus.js';

function merge(registrarRows, spamhausRows) {
  const spamMap = Object.fromEntries(spamhausRows.map((r) => [r.domain, r]));
  return registrarRows.map((reg) => ({
    ...reg,
    spamhaus_score: spamMap[reg.domain]?.spamhaus_score ?? null,
    spamhaus_infra: spamMap[reg.domain]?.spamhaus_infra ?? null,
    spamhaus_smtp: spamMap[reg.domain]?.spamhaus_smtp ?? null,
    blacklisted: spamMap[reg.domain]?.blacklisted ?? null,
    abused: spamMap[reg.domain]?.abused ?? null,
  }));
}

async function upsertLatest(rows) {
  for (const r of rows) {
    await query(
      `INSERT INTO domain_infrastructure
         (domain, registrar, expires_at, auto_renew, status, dns_provider, nameservers,
          cf_pages_project, spamhaus_score, spamhaus_infra, spamhaus_smtp, blacklisted, abused, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
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
         updated_at       = NOW()`,
      [
        r.domain, r.registrar, r.expires_at, r.auto_renew, r.status,
        r.dns_provider, r.nameservers, r.cf_pages_project,
        r.spamhaus_score, r.spamhaus_infra, r.spamhaus_smtp,
        r.blacklisted, r.abused,
      ],
    );
  }
}

async function insertHistory(rows) {
  for (const r of rows) {
    await query(
      `INSERT INTO domain_infra_history
         (domain, snapshot_date, registrar, expires_at, auto_renew, status, dns_provider, nameservers,
          cf_pages_project, spamhaus_score, spamhaus_infra, spamhaus_smtp, blacklisted, abused)
       VALUES ($1, CURRENT_DATE, $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
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
         abused           = COALESCE(EXCLUDED.abused, domain_infra_history.abused)`,
      [
        r.domain, r.registrar, r.expires_at, r.auto_renew, r.status,
        r.dns_provider, r.nameservers, r.cf_pages_project,
        r.spamhaus_score, r.spamhaus_infra, r.spamhaus_smtp,
        r.blacklisted, r.abused,
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

    const merged = merge(registrarRows, spamhausRows);

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
