import { query, logSync } from '../lib/db.js'

const SHEET_ID = '1Usn8eNQODuRtLl2bwg8Ix1MnXMwYkzu1ojxE9TOQVmU'
const CSV_URL  = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`

const MONTHS = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 }

function parseDate(str) {
  if (!str) return null
  const parts = str.trim().split(/\s+/)
  if (parts.length < 2) return null
  const day   = parseInt(parts[0])
  const month = MONTHS[parts[1].slice(0, 3)]
  if (!day || !month) return null
  const now  = new Date()
  let year   = now.getFullYear()
  const candidate = new Date(year, month - 1, day)
  if (candidate > new Date(now.getTime() + 60 * 86400000)) year--
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function parseAmount(str) {
  if (!str) return null
  const n = parseFloat(str.replace(/[^0-9.]/g, ''))
  return isNaN(n) ? null : n
}

function parseCsv(text) {
  const lines = text.trim().split('\n').filter(Boolean)
  if (lines.length < 2) return []
  const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase())
  return lines.slice(1).map(line => {
    const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''))
    return Object.fromEntries(header.map((h, i) => [h, cols[i] ?? '']))
  })
}

export async function syncRevenue() {
  const startedAt = new Date()
  console.log('  Syncing Google Sheets revenue...')

  const res = await fetch(CSV_URL, { redirect: 'follow' })
  if (!res.ok) throw new Error(`Google Sheets fetch failed: ${res.status} — make sure the sheet is set to "Anyone with the link can view"`)
  const csv = await res.text()

  const rows = parseCsv(csv)
  let upserted = 0

  for (const row of rows) {
    const clientName  = row['client name'] || row['client'] || row['name'] || ''
    const paymentDate = parseDate(row['payment date'] || row['date'] || '')
    const amount      = parseAmount(row['amount'] || '')

    if (!clientName || !paymentDate || amount === null) {
      console.log('  Skipping row (missing fields):', row)
      continue
    }

    await query(
      `INSERT INTO outreach.revenue_payments (client_name, payment_date, amount, synced_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (client_name, payment_date, amount) DO UPDATE SET synced_at = NOW()`,
      [clientName, paymentDate, amount],
    )
    upserted++
  }

  console.log(`  Revenue: ${upserted} rows upserted`)
  await logSync('revenue', startedAt, { processed: rows.length, upserted })
}
