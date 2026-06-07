// PostgreSQL connection pool, query helper, and sync logger.
import pg from 'pg';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env if available (local dev / VPS). On Railway, env vars are injected directly.
const envCandidates = [
  resolve(__dirname, '../.env'),
  resolve('/root/outreach-sync/.env'),
];
const envPath = envCandidates.find(p => existsSync(p));
if (envPath) {
  const parsed = Object.fromEntries(
    readFileSync(envPath, 'utf8').split('\n')
      .filter(l => l && !l.startsWith('#') && l.includes('='))
      .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
  );
  Object.assign(process.env, parsed);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function query(sql, params) {
  return pool.query(sql, params);
}

export async function logSync(type, startedAt, result) {
  await pool.query(
    `INSERT INTO sync_log (sync_type, started_at, finished_at, records_processed, records_upserted, records_deleted, status, error_message)
     VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7)`,
    [type, startedAt, result.processed || 0, result.upserted || 0, result.deleted || 0, result.status || 'success', result.error || null]
  );
}

export default pool;
