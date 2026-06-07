// Sync all Cal.com bookings into public.calcom_bookings
// Full upsert — safe to re-run any time.
// Links to outreach data via attendee_email → public.leads.email
import { query, logSync } from '../lib/db.js';

const CAL_BASE = 'https://api.cal.com/v2';
const API_KEY  = process.env.CAL_COM_API_KEY;
const CAL_HEADERS = {
  'Authorization': `Bearer ${API_KEY}`,
  'cal-api-version': '2024-08-13',
};

async function fetchAllBookings() {
  if (!API_KEY) throw new Error('CAL_COM_API_KEY not set');

  const bookings = [];
  let skip = 0;
  const take = 100;

  while (true) {
    const url = `${CAL_BASE}/bookings?take=${take}&skip=${skip}`;
    const res = await fetch(url, { headers: CAL_HEADERS });
    if (!res.ok) throw new Error(`Cal.com API error ${res.status}: ${await res.text()}`);
    const data = await res.json();

    const page = data.data || [];
    bookings.push(...page);

    if (page.length < take) break;
    skip += take;
  }

  return bookings;
}

// Cal.com sometimes returns "0" for missing dates — treat as null
function safeTs(v) {
  if (!v || v === '0' || v === 0) return null;
  return v;
}

export async function syncCalcom() {
  const startedAt = new Date();
  console.log('  Syncing Cal.com bookings...');

  try {
    const bookings = await fetchAllBookings();
    let upserted = 0;

    for (const b of bookings) {
      const attendee = b.attendees?.[0] || {};
      const r = b.bookingFieldsResponses || {};

      const qualification = Array.isArray(r.qualification)
        ? r.qualification[0] || null
        : (r.qualification || null);

      await query(`
        INSERT INTO outreach.calcom_bookings (
          id, uid, event_type_id, title, status,
          start_time, end_time,
          attendee_email, attendee_name, attendee_tz,
          company_name, website, revenue, qualification,
          video_call_url,
          from_reschedule, cancelled_by, rescheduled_by,
          cal_created_at, synced_at
        ) VALUES (
          $1,$2,$3,$4,$5,
          $6,$7,
          $8,$9,$10,
          $11,$12,$13,$14,
          $15,
          $16,$17,$18,
          $19, NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          status         = EXCLUDED.status,
          title          = EXCLUDED.title,
          start_time     = EXCLUDED.start_time,
          end_time       = EXCLUDED.end_time,
          attendee_email = EXCLUDED.attendee_email,
          attendee_name  = EXCLUDED.attendee_name,
          attendee_tz    = EXCLUDED.attendee_tz,
          company_name   = EXCLUDED.company_name,
          website        = EXCLUDED.website,
          revenue        = EXCLUDED.revenue,
          qualification  = EXCLUDED.qualification,
          video_call_url = EXCLUDED.video_call_url,
          from_reschedule= EXCLUDED.from_reschedule,
          cancelled_by   = EXCLUDED.cancelled_by,
          rescheduled_by = EXCLUDED.rescheduled_by,
          cal_created_at = EXCLUDED.cal_created_at,
          synced_at      = NOW()
      `, [
        b.id,
        b.uid,
        b.eventTypeId || null,
        b.title || null,
        b.status || null,
        safeTs(b.start),
        safeTs(b.end),
        attendee.email || null,
        attendee.name  || null,
        attendee.timeZone || null,
        r['Company-Name'] || r['company_name'] || null,
        r.website || null,
        r.revenue || null,
        qualification,
        b.meetingUrl || null,
        b.fromReschedule || null,
        b.cancelledByEmail || null,
        b.rescheduledByEmail || null,
        safeTs(b.createdAt),
      ]);
      upserted++;
    }

    await logSync('calcom_bookings', startedAt, { upserted, status: 'success' });
    console.log(`  Cal.com: ${upserted} bookings upserted`);
  } catch (e) {
    await logSync('calcom_bookings', startedAt, { status: 'error', error: e.message });
    throw e;
  }
}
