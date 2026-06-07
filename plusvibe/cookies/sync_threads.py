import time
from .auth import get_headers, BASE
from .db import get_conn
from curl_cffi import requests as cf


def fetch_all_threads(headers):
    all_threads = []
    page = 1
    while True:
        resp = cf.get(
            f"{BASE}/inbox",
            params={"page": page, "limit": 50},
            headers=headers,
            impersonate="chrome124",
        )
        resp.raise_for_status()
        batch = resp.json().get("data", [])
        if not batch:
            break
        all_threads.extend(batch)
        print(f"  page {page}: +{len(batch)} (total {len(all_threads)})")
        if len(batch) < 50:
            break
        page += 1
        time.sleep(0.3)
    return all_threads


def ensure_table(cur):
    cur.execute("""
        CREATE TABLE IF NOT EXISTS outreach.inbox_threads (
            id TEXT PRIMARY KEY,
            lead_email TEXT,
            lead_first_name TEXT,
            lead_last_name TEXT,
            lead_id TEXT,
            camp_id TEXT,
            camp_name TEXT,
            label TEXT,
            thread_status TEXT,
            snippet TEXT,
            subject TEXT,
            from_email TEXT,
            modified_at TIMESTAMPTZ,
            synced_at TIMESTAMPTZ DEFAULT NOW(),
            first_seen_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    cur.execute("""
        ALTER TABLE outreach.inbox_threads
        ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ DEFAULT NOW()
    """)


def sync():
    print("Syncing inbox threads...")
    headers, _ = get_headers()
    threads = fetch_all_threads(headers)
    print(f"  Total threads: {len(threads)}")

    conn = get_conn()
    cur = conn.cursor()
    ensure_table(cur)

    upserted = 0
    for t in threads:
        tid = t.get("_id", "")
        if not tid:
            continue

        cur.execute("""
            INSERT INTO outreach.inbox_threads (
                id, lead_email, lead_first_name, lead_last_name, lead_id,
                camp_id, camp_name, label, thread_status,
                snippet, subject, from_email, modified_at, synced_at, first_seen_at
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW(),NOW())
            ON CONFLICT (id) DO UPDATE SET
                label=EXCLUDED.label,
                thread_status=EXCLUDED.thread_status,
                snippet=EXCLUDED.snippet,
                modified_at=EXCLUDED.modified_at,
                synced_at=NOW()
        """, (
            tid,
            t.get("lead_email", ""),
            t.get("lead_first_name", ""),
            t.get("lead_last_name", ""),
            t.get("lead_id", ""),
            t.get("camp_id", ""),
            t.get("camp_name", ""),
            t.get("lead_label_txt", ""),
            t.get("thread_status", ""),
            (t.get("snippet") or "")[:500],
            t.get("subject", ""),
            t.get("from_email", ""),
            t.get("thread_modified_at"),
        ))
        upserted += 1

    conn.commit()
    cur.close()
    conn.close()

    label_counts = {}
    for t in threads:
        lbl = t.get("lead_label_txt") or "(no label)"
        label_counts[lbl] = label_counts.get(lbl, 0) + 1
    print(f"  threads: {upserted} upserted")
    for lbl, cnt in sorted(label_counts.items(), key=lambda x: -x[1]):
        print(f"    {lbl}: {cnt}")
    return upserted
