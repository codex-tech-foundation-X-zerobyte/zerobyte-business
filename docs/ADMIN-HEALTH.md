# Admin Health center

One admin page (**Governance → Health center**) for payments, subscriptions, functions, capacity, security, data checks,
customer health, app errors and promoter checks, plus threshold alerts pushed to Telegram or a webhook.

## Turn it on (once)

1. **Apply the database update:** `supabase/migrations/20261124090000_admin_health_center.sql`. It adds the page, the checks,
   the browser error log and the alert bookkeeping. It changes nothing that exists, except adding "Health center" to the
   SUPER, PLATFORM and FINANCE admin roles. Payment and subscription panels are shown to finance-capable admins only.
2. **Deploy the alert sender:** `supabase functions deploy platform-alerts --no-verify-jwt` (it protects itself with a secret).
3. **Set its secrets:**
   - `ALERT_CRON_SECRET`: any long random string (required).
   - Telegram: `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` (create a bot with @BotFather, send it a message, read the chat id).
   - and/or `ALERT_WEBHOOK_URL`: Slack, Discord, Make or Zapier (Make or Zapier can forward to WhatsApp or email).
   - Optional: `ALERT_BRAND` (default "Zerøbyte").
4. **Schedule it every 15 minutes** (SQL editor; needs the `pg_cron` and `pg_net` extensions):

```sql
select cron.schedule('platform-alerts', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://YOUR-PROJECT.supabase.co/functions/v1/platform-alerts',
    headers := jsonb_build_object('x-cron-secret', 'THE-SAME-SECRET', 'Content-Type', 'application/json'),
    body := '{}'::jsonb);
$$);
```

An alert is pushed once when it appears, again every 6 hours while unresolved, and a "back to normal" note when it clears.

## Telegram commands (read-only)

Besides pushing alerts, the bot answers commands from your chat. Nothing it does can change data: it only reports.

| Command | Shows |
|---|---|
| `/health` | overall status, active alerts, paid today, database use |
| `/alerts` | active alerts only |
| `/ping` | database and sign-in response times |
| `/users` | accounts, businesses, sales today, top businesses today |
| `/payments` | paid, failed, stuck, needs review, paid-but-plan-not-active |
| `/trials` | trials ending in 48 hours, conversion |
| `/errors` | app errors and failing functions |
| `/capacity` | database size, connections, storage |
| `/security` | rate-limit hits, admins without 2-step |
| `/customers` | quiet, never started, support waiting |
| `/business mama` | one business: plan, trial, products, sales, last sale |
| `/refresh` | run a fresh scan now (not more than once per 20 seconds) |
| `/help` | the list |

### Turn the commands on (once)

1. Apply the update `20261126090000_telegram_bot_reports.sql` (`npm run supabase:push`).
2. Create a webhook secret (letters and numbers only) and store it:
   ```powershell
   $bytes = New-Object byte[] 32
   [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
   $webhookSecret = -join ($bytes | ForEach-Object { $_.ToString('x2') })
   supabase secrets set TELEGRAM_WEBHOOK_SECRET=$webhookSecret
   ```
3. Deploy the function (Telegram cannot send a login token, so it has its own secret instead):
   ```powershell
   supabase functions deploy telegram-bot --no-verify-jwt
   ```
4. Tell Telegram where to send messages (keep the secret in the same window; replace the two placeholders):
   ```powershell
   $token = "YOUR_BOT_TOKEN"
   Invoke-RestMethod "https://api.telegram.org/bot$token/setWebhook" -Method Post -ContentType 'application/json' -Body (@{
     url = "https://YOUR-PROJECT-REF.supabase.co/functions/v1/telegram-bot"
     secret_token = $webhookSecret
     allowed_updates = @("message")
   } | ConvertTo-Json)
   ```
5. Add the command menu that appears when you type `/`:
   ```powershell
   Invoke-RestMethod "https://api.telegram.org/bot$token/setMyCommands" -Method Post -ContentType 'application/json' -Body (@{
     commands = @(
       @{ command = "health";    description = "Status and anything needing attention" },
       @{ command = "alerts";    description = "Active alerts only" },
       @{ command = "ping";      description = "Is everything responding?" },
       @{ command = "users";     description = "Accounts, businesses, sales today" },
       @{ command = "payments";  description = "Payments in the last 24 hours" },
       @{ command = "trials";    description = "Trials ending in 48 hours" },
       @{ command = "errors";    description = "App errors and failing functions" },
       @{ command = "capacity";  description = "Database size and connections" },
       @{ command = "security";  description = "Sign-in pressure and admin safety" },
       @{ command = "customers"; description = "Quiet and never-started businesses" },
       @{ command = "business";  description = "Look up a business: /business mama" },
       @{ command = "refresh";   description = "Run a fresh health scan" },
       @{ command = "help";      description = "Show the list" }
     )
   } | ConvertTo-Json -Depth 4)
   ```
6. Message your bot `/ping`. You should get a reply within a second or two.

### How it is protected

- Telegram must send the webhook secret; anything else gets a 401.
- Only the chat ids in `TELEGRAM_CHAT_ID` get an answer (one id, or several separated by commas). Everyone else is ignored with no reply, so strangers cannot even tell the bot is live.
- If you add the bot to a group, everyone in that group can run the commands, so keep it in a private chat.
- Commands are read-only and technical errors are never shown in chat.
- To switch the commands off: `Invoke-RestMethod "https://api.telegram.org/bot$token/deleteWebhook"`. Alerts keep working.

## How often it hits the database

The scan is saved in `platform_health_snapshot` and reused for 5 minutes by every admin and by the alert sender. Refresh asks
for a new scan (at most one per 20 seconds). To keep it warm so nobody ever waits, schedule (needs `pg_cron`):

```sql
select cron.schedule('health-snapshot', '*/5 * * * *', $$select public.platform_health_snapshot_get(interval '0 seconds', true)$$);
```

## What each panel watches

| Panel | Watches | Alerts when |
|---|---|---|
| Payments | paid, failed, stuck pending, needs review, paid-but-plan-not-active, confirmation errors | any needs-review, any activation gap, 3+ confirmation errors, 3+ stuck |
| Subscriptions | trials ending in 48 h, past due, expired, cancelled, trial-to-paid, churn | any past-due |
| Functions | requests, errors, average and slowest-5% time per function (24 h) | 20%+ errors on 10+ requests |
| Capacity | database size vs plan limit, connections, file storage, time since last activity | 70% (warning), 85% (critical), 80% connections, 120 h idle (free plans pause after about 7 days) |
| Security | rate-limit hits, admins without 2-step sign-in, sensitive admin actions, bulk deletions | any admin without 2-step, 200+ throttled attempts, 15+ deletions by one business |
| Data checks | sale total vs items, stock vs movements, sales without items, offline sync failures | any sale total mismatch |
| Customers | quiet 7/14/30+ days, never added a product, no sale yet, support waiting | (shown only) |
| App errors | browser and phone errors, affected people, most common, by app version | 50+ in 24 h and at least double the day before |
| Promoters | self-referrals, referral spikes, payouts waiting, payout above total earned | any self-referral or payout above earned |

Change limits in `platform_health_alerts()` (alerts) and `platform_health_signals()` (the plan limit, `db_limit_bytes`, is
500 MB for the free plan; raise it when you upgrade).

Not readable from inside the database, so check in the hosting dashboard: bandwidth use and the last backup. The free plan
has no point-in-time recovery.

Notes: negative stock cannot occur (the database rejects it), so that check stays at zero. "Stock differs from movements"
can list older products that were created before movements were recorded; it is a prompt to look, not an alarm.

## What the browser shows (and does not)

Production builds are set up so a visitor opening the browser console sees nothing from the app:

- No `console.*` output at all in production (stripped at build time, including from libraries). Errors go to the Health
  center instead (`src/lib/errorReporting.ts`), with emails, ids, links and long numbers removed first.
- Uncaught errors are not echoed by the browser (`preventDefault` after reporting).
- Every request passes through `src/lib/safeErrors.ts`: error text that mentions tables, constraints, SQL or the name of
  the data service is replaced with a plain sentence, and `details` / `hint` are dropped. The error `code` is kept so the
  app still behaves correctly. Messages written for people pass through unchanged.
- The saved sign-in uses the neutral name `zerobyte-auth` (an existing sign-in is moved over automatically), requests carry
  `X-Client-Info: zerobyte-web`, and the library chunk is named `vendor-core`.
- Visitor-facing wording no longer names the data service, migrations or SQL.

What cannot be hidden by the app: the address of the data service (it appears in the network tab, the content-security
header and the saved bundle), Chromium's own "Failed to load resource" line for a failed request, and strings inside the
data library's code. To hide the address too, put the service behind your own domain (the provider's custom-domain option,
or a first-party proxy; check that live updates still work through a proxy before relying on it).

## Checking the database code without a server

`tools/pglite-check/` runs every migration and the Health center checks in an in-memory Postgres:

```
cd tools/pglite-check && npm install && node health-center.mjs
```
