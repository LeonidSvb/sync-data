import time
from datetime import date
from .auth import get_headers, BASE
from .db import get_conn
from curl_cffi import requests as cf


def fetch_campaigns(headers):
    all_campaigns = []
    page = 1
    while True:
        resp = cf.get(
            f"{BASE}/campaigns",
            params={"limit": 100, "page": page},
            headers=headers,
            impersonate="chrome124",
        )
        resp.raise_for_status()
        batch = resp.json().get("data", [])
        if not batch:
            break
        all_campaigns.extend(batch)
        if len(batch) < 100:
            break
        page += 1
        time.sleep(0.3)
    return all_campaigns


def sync():
    print("Syncing campaigns...")
    headers, _ = get_headers()
    campaigns = fetch_campaigns(headers)
    print(f"  Fetched {len(campaigns)} campaigns")

    conn = get_conn()
    cur = conn.cursor()
    today = date.today()
    api_ids = []
    upserted = 0

    cur.execute("SELECT COALESCE(MAX(id), 0) FROM outreach.campaign_stats")
    next_stat_id = cur.fetchone()[0] + 1

    for c in campaigns:
        cid = str(c.get("_id", ""))
        if not cid:
            continue
        api_ids.append(cid)

        cur.execute("""
            UPDATE outreach.campaigns SET
                name=%s, status=%s, lead_count=%s, sent_count=%s,
                unique_opened_count=%s, replied_count=%s, bounced_count=%s,
                positive_reply_count=%s, negative_reply_count=%s, neutral_reply_count=%s,
                lead_contacted_count=%s, completed_lead_count=%s,
                open_rate=%s, replied_rate=%s, modified_at=%s,
                synced_at=NOW(), deleted_from_source_at=NULL
            WHERE id=%s
        """, (
            c.get("camp_name", ""), c.get("status", ""),
            c.get("lead_count"), c.get("sent_count"), c.get("unique_opened_count"),
            c.get("replied_count"), c.get("bounced_count"),
            c.get("positive_reply_count"), c.get("negative_reply_count"), c.get("neutral_reply_count"),
            c.get("lead_contacted_count"), c.get("completed_lead_count"),
            c.get("open_rate"), c.get("replied_rate"), c.get("modified_at"),
            cid,
        ))
        if cur.rowcount == 0:
            cur.execute("""
                INSERT INTO outreach.campaigns (
                    id, name, status, campaign_type,
                    lead_count, sent_count, unique_opened_count, replied_count, bounced_count,
                    positive_reply_count, negative_reply_count, neutral_reply_count,
                    lead_contacted_count, completed_lead_count,
                    open_rate, replied_rate, created_at, modified_at, synced_at
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW())
            """, (
                cid, c.get("camp_name", ""), c.get("status", ""),
                "parent" if not c.get("parent_camp_id") else "subsequence",
                c.get("lead_count"), c.get("sent_count"), c.get("unique_opened_count"),
                c.get("replied_count"), c.get("bounced_count"),
                c.get("positive_reply_count"), c.get("negative_reply_count"), c.get("neutral_reply_count"),
                c.get("lead_contacted_count"), c.get("completed_lead_count"),
                c.get("open_rate"), c.get("replied_rate"),
                c.get("created_at"), c.get("modified_at"),
            ))

        cur.execute("""
            UPDATE outreach.campaign_stats SET
                lead_count=%s, sent_count=%s, unique_opened_count=%s,
                replied_count=%s, bounced_count=%s, positive_reply_count=%s,
                lead_contacted_count=%s, completed_lead_count=%s
            WHERE campaign_id=%s AND snapshot_date=%s
        """, (
            c.get("lead_count"), c.get("sent_count"), c.get("unique_opened_count"),
            c.get("replied_count"), c.get("bounced_count"), c.get("positive_reply_count"),
            c.get("lead_contacted_count"), c.get("completed_lead_count"),
            cid, today,
        ))
        if cur.rowcount == 0:
            cur.execute("""
                INSERT INTO outreach.campaign_stats (
                    id, campaign_id, campaign_name, snapshot_date,
                    lead_count, completed_lead_count, lead_contacted_count,
                    sent_count, unique_opened_count, replied_count, bounced_count,
                    positive_reply_count, created_at
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW())
            """, (
                next_stat_id, cid, c.get("camp_name", ""), today,
                c.get("lead_count"), c.get("completed_lead_count"), c.get("lead_contacted_count"),
                c.get("sent_count"), c.get("unique_opened_count"),
                c.get("replied_count"), c.get("bounced_count"),
                c.get("positive_reply_count"),
            ))
            next_stat_id += 1
        upserted += 1

    if api_ids:
        cur.execute("""
            UPDATE outreach.campaigns SET deleted_from_source_at = NOW()
            WHERE deleted_from_source_at IS NULL AND id != ALL(%s)
        """, (api_ids,))

    conn.commit()
    cur.close()
    conn.close()
    print(f"  campaigns: {upserted} upserted + stats snapshot for {today}")
    return upserted
