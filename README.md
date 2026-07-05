# sync-data

Крутится на VPS (`/opt/apps/projects/sync-data`), тянет данные из PlusVibe/Cal.com/Google Sheets
в Postgres схему `outreach` (та же БД, что использует `outreach-cockpit`). Каждый sync_type пишет
свой прогон в `outreach.sync_log` — там же смотреть последний запуск/ошибки (`node index.js health`).

## Cron (VPS crontab)

| Когда | Команда | Что делает |
|---|---|---|
| `*/30 * * * *` | `node index.js all` | campaigns → leads → email_accounts → tags → emails |
| `0 1 * * *` | `node index.js daily_stats` | вчерашние per-campaign метрики (инкрементально) |
| `0 */6 * * *` | `node index.js calcom` | все Cal.com брони (полный ре-пул) |
| `0 12 * * *` | `node index.js revenue` | Google Sheets CSV с оплатами |

## Синки

| sync_type | таблица | важность | механика | кто читает |
|---|---|---|---|---|
| `campaigns` | `outreach.campaigns` | core | полный пул (~70 кампаний, 1 запрос) | дашборд, pipeline |
| `leads` | `outreach.leads` | core | **полный** пагинированный пул всех лидов воркспейса (все статусы, все кампании — активные и завершённые), soft-delete тех, кого нет в ответе API. У PlusVibe нет `modified_since` фильтра, поэтому это неизбежно полный ре-пул каждый раз. `limit=1000` (макс по API) | дашборд, pipeline, reply-agent |
| `email_accounts` + `account_tags` | `outreach.email_accounts`, `outreach.account_tags` | core | полный пул (~200 аккаунтов), затем tag-ассайнменты | health-мониторинг доменов/аккаунтов |
| `tags` | `outreach.tags` | вспомогательный | полный пул списка тегов (дёшево, 1 запрос). Реанимирован 2026-07-05 — молча выпал из раннера с 2026-06-07 | имена тегов для `account_tags` |
| `emails_sync` | `outreach.emails` | core | rolling 48h safety-net (не полный пул) | reply-agent (`context.ts`) |
| `emails_backfill` | `outreach.emails` | ручной, не в cron | одноразовый полный бэкафилл через `/unibox/emails` | — (запускается вручную при необходимости) |
| `daily_stats` (`syncYesterdayDailyStats`) | `outreach.campaign_stats_daily` | core | **инкрементально** — только «вчера» на кампанию | дашборд (`server/index.ts`, 4 места) |
| `calcom_bookings` | `outreach.calcom_bookings` | core | **не инкрементально** — при каждом запуске тянет вообще все брони с Cal.com (~300 строк, старые никогда не меняются). Работает, но лишняя нагрузка — кандидат на date-filter | reply-agent, `DrillDownPanel.tsx` |
| `revenue` | `outreach.revenue_payments` | core | полный CSV из Google Sheets (маленький, не проблема) | `RevenueManager.tsx` |

## Fathom — НЕ здесь

Синк Fathom-записей (`calcom_bookings.fathom_url`, оба аккаунта main+alt) живёт **внутри
`outreach-cockpit/server/modules/fathom/sync.ts`** — крутится там же в Express-процессе (при
старте + `setInterval` каждые 6 часов + ручной триггер `POST /api/admin/sync-fathom`). В этом
репо когда-то был черновик-дубликат (`fathom/sync.js`, ветка от 2026-06-22) — он никогда не
коммитился/не деплоился и был удалён 2026-07-05, чтобы не путать.

Отдельно есть устаревшая таблица `outreach.fathom_calls` — синк для неё не найден нигде в текущем
коде, последний прогон 2026-04-19. Похоже на брошенный эксперимент из более старой версии проекта.

## Удалено 2026-07-05 (не читалось нигде + било API впустую)

- `campaign_stats` — каждые 30 мин тянул 6-месячный диапазон по каждой кампании ради одной строки
  за сегодня. `campaign_stats_daily`/`daily_stats` уже закрывает эту задачу правильно.
- `warmup_stats` — 7-дневное окно каждые 30 мин, нигде не используется.
- `lead_status_counts` — plain INSERT без дедупликации, бесконечно растущая таблица, нигде не
  используется.

## Известная механика 429 (PlusVibe rate limit)

Общий клиент `lib/plusvibe-api.js` теперь ретраит 429 (5 попыток, 2s→32s экспоненциально).
`leads` и `daily_stats` ловили постоянные 429 с 2026-07-01 — тогда бэкоффа вообще не было (первая
же ошибка валила весь прогон), плюс `leads` рос с ~14k до 36k+ и страницы были по 100 вместо
максимальных 1000. См. `CHANGELOG.md`.
