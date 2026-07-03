import { syncCampaigns } from './plusvibe/api/campaigns.js';
import { syncLeads } from './plusvibe/api/leads.js';
import { syncEmailAccounts } from './plusvibe/api/email_accounts.js';
import { syncCampaignStats, syncWarmupStats, syncLeadStatusCounts } from './plusvibe/api/stats.js';
import { syncYesterdayDailyStats } from './plusvibe/api/daily_stats.js';
import { syncRecentEmails } from './plusvibe/api/emails.js';
import { syncCalcom } from './calcom/sync.js';
import { syncRevenue } from './revenue/sync.js';
import { sendDailyReport } from './notifications/daily_report.js';
import { checkAndSendAlerts } from './notifications/alerts.js';
import { showHealth } from './lib/health.js';

const cmd = process.argv[2] || 'all';

const runners = {
  campaigns:   () => syncCampaigns(),
  leads:       () => syncLeads(),
  accounts:    () => syncEmailAccounts(),
  stats:       () => Promise.all([syncCampaignStats(), syncWarmupStats(), syncLeadStatusCounts()]),
  daily_stats: () => syncYesterdayDailyStats(),
  emails:      () => syncRecentEmails(),
  calcom:      () => syncCalcom(),
  revenue:     () => syncRevenue(),
  report:      () => sendDailyReport(),
  alerts:      () => checkAndSendAlerts(),
  health:      () => showHealth(),
  all: async () => {
    await syncCampaigns();
    await syncLeads();
    await syncEmailAccounts();
    await syncRecentEmails();
    await Promise.all([syncCampaignStats(), syncWarmupStats(), syncLeadStatusCounts()]);
  },
};

if (!runners[cmd]) {
  console.error(`Unknown command: ${cmd}`);
  console.error(`Available: ${Object.keys(runners).join(', ')}`);
  process.exit(1);
}

console.log(`[${new Date().toISOString()}] Running: ${cmd}`);
runners[cmd]()
  .then(() => { console.log(`[${new Date().toISOString()}] Done: ${cmd}`); process.exit(0); })
  .catch(e => { console.error(`[${new Date().toISOString()}] Error:`, e.message); process.exit(1); });
