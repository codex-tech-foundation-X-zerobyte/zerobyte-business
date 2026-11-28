# Connecting Zerøbyte to the Codex Workspace

Two connections from the Codex connection contract are built: **A. Super Monitor** and **B. Customer Service**. (C. Super Dashboard needs nothing: it appears once A and B work.)

## Setup guide, step by step (Windows PowerShell; written after the first real setup)
Two different Supabase projects are involved, so keep them apart:
* **The Codex Workspace project** (the owner's monitor, example ref `<workspace-ref>`): it receives your heartbeats, errors and tickets. Its address is what you put in `CODEX_FUNCTIONS_URL`.
* **This project** (Zerøbyte Business, example ref `<this-project-ref>`): it holds the three functions below and runs them.

1. **Get the values** from the Codex Main Admin (table above). Never paste a key into a chat, an email or a commit. If one was pasted anywhere by mistake, create a new key in the Main Admin, revoke the old one and use the new one below.
2. **Apply the migrations** to this project: `supabase db push`.
3. **Set the five secrets** on this project (one command each, so nothing is mixed up):
   ```powershell
   supabase secrets set CODEX_FUNCTIONS_URL=https://<workspace-ref>.supabase.co/functions/v1
   supabase secrets set MONITOR_KEY=<ctfm_ key>
   supabase secrets set SUPPORT_KEY=<ctfs_ key>
   supabase secrets set SUPPORT_CALLBACK_SECRET=<64 hex characters from the Support desk>
   supabase secrets set CODEX_HEARTBEAT_SECRET=<long random text>
   ```
   Make the random text with: `-join ((1..48) | % { '{0:x}' -f (Get-Random -Max 16) })`
4. **Deploy the three functions**: `npm run supabase:functions:deploy:codex`. (Do not type `supabase functions deploy a && supabase functions deploy b` in older PowerShell: it does not understand `&&`, and the CLI then treats the extra words as function names and prints errors. The npm script is safe.)
5. **Tell the Support desk where to call back**: `https://<this-project-ref>.supabase.co/functions/v1/codex-support-callback` (Support desk > Connected projects > Callbacks to the project).
6. **Schedule the heartbeat** every 5 minutes. In the Supabase Dashboard turn on the `pg_cron` and `pg_net` extensions (Database > Extensions), then run this once in the SQL editor of this project (do not save it in a migration, it contains the secret):
   ```sql
   select cron.schedule('codex-heartbeat', '*/5 * * * *', $$
     select net.http_post(
       url := 'https://<this-project-ref>.supabase.co/functions/v1/codex-heartbeat',
       headers := jsonb_build_object('x-heartbeat-secret', '<the same CODEX_HEARTBEAT_SECRET>', 'content-type', 'application/json'),
       body := '{}'::jsonb);
   $$);
   ```
7. **Browser errors**: in the hosting dashboard set `VITE_CODEX_FUNCTIONS_URL` and `VITE_MONITOR_KEY`, then redeploy. Errors are reported only from a production build. `VITE_ERROR_REPORT_ENDPOINT` is optional and separate (a second copy of errors to your own URL); leave it empty.
8. **Check it**: run the heartbeat by hand, it must answer with success and not 401:
   ```powershell
   Invoke-RestMethod -Method Post -Uri https://<this-project-ref>.supabase.co/functions/v1/codex-heartbeat -Headers @{'x-heartbeat-secret'='<secret>'}
   ```
   Then open Dashboard > Edge Functions > `codex-heartbeat` > Logs, and ask the owner to confirm the project shows in Super Monitor with a heartbeat from the last few minutes.

### The mistakes made on the first setup (check these first if nothing arrives)
| Symptom | Cause | Fix |
|---|---|---|
| Nothing reaches the Workspace, 404 in the logs | `CODEX_FUNCTIONS_URL` ended with `/monitor-ingest`. The code adds the function name itself, so the call went to `.../monitor-ingest/monitor-ingest`. | Use only `https://<workspace-ref>.supabase.co/functions/v1` |
| Replies from support never appear | `SUPPORT_CALLBACK_SECRET` was set to a web address | It is the 64-character hex secret from the Support desk |
| Project never shows as alive | The heartbeat was never scheduled (step 6) | Do step 6 |
| `WARN: failed to read file ... support-client/index.mjs` on deploy | The CLI reads a path mentioned in a comment of `_shared/support-client.mjs` | Harmless; the functions still deploy |
| `Entrypoint path does not exist ... functions/supabase/index.ts` | PowerShell did not accept `&&` (see step 4) | Use the npm script |

## What the owner gets from the Codex Main Admin (never paste these in a chat or commit them)
| Item | Made in the Workspace | Goes in |
|---|---|---|
| Functions address `https://<workspace-ref>.supabase.co/functions/v1` | the Workspace's Supabase address | Edge Function secret `CODEX_FUNCTIONS_URL` **and** build variable `VITE_CODEX_FUNCTIONS_URL` |
| Monitor key `ctfm_` + 48 characters | Super Monitor > Setup (register the project with Expected heartbeat **300**, then Create key) | Edge Function secret `MONITOR_KEY` **and** build variable `VITE_MONITOR_KEY` (a monitor key can only write telemetry and can be revoked, so the browser may hold it) |
| Support key `ctfs_` + 48 characters | Support desk > Connected projects (add the project, then Create key) | Edge Function secret `SUPPORT_KEY` only. **Never a `VITE_` variable** |
| Callback secret (64 hex) | Support desk > Connected projects > Callbacks to the project > Set up. Give them this address: `https://<this-project-ref>.supabase.co/functions/v1/codex-support-callback` | Edge Function secret `SUPPORT_CALLBACK_SECRET` |
| Heartbeat secret | You make it (any long random text) | Edge Function secret `CODEX_HEARTBEAT_SECRET` |

## Deploy
1. Apply the migration `20261031150000_codex_support_link.sql` (and the earlier ones).
2. `supabase secrets set CODEX_FUNCTIONS_URL=... MONITOR_KEY=... SUPPORT_KEY=... SUPPORT_CALLBACK_SECRET=... CODEX_HEARTBEAT_SECRET=...`
3. `npm run supabase:functions:deploy:codex` (deploys `codex-heartbeat`, `codex-support-ticket`, `codex-support-callback`, all with `--no-verify-jwt`; the key or signature is the authentication).
4. Schedule `codex-heartbeat` every 5 minutes (a POST with header `x-heartbeat-secret`). Without regular heartbeats the Workspace cannot tell the project is down.
5. Set `VITE_CODEX_FUNCTIONS_URL` and `VITE_MONITOR_KEY` in the hosting dashboard and redeploy (errors are reported only in a production build).

## What happens
* **Errors**: every error the app already catches (render errors, uncaught errors, failed promises) is also sent to the Super Monitor with the page path as the route (never the query string). Heartbeats are off in the browser on purpose.
* **Tickets**: the customer presses "Send this to technical support" in the chat. The chat becomes a ticket (`external_ref` = `ZB-<conversation id>`; pressing again never makes a second one). Follow-up messages are forwarded to the ticket.
* **Replies**: when Codex staff reply, Codex calls `codex-support-callback`; the signature is checked on the raw body, repeats and out-of-order status messages are ignored, and the reply appears in the customer's chat as "Technical support". A "resolved" status adds a note and the customer can rate the help (1 to 5 stars).
* Tickets are refused (422) if the text holds a card number, secret key or password.

## Smoke tests (run with the real values; remove the key values before sharing the output)
```bash
# A. heartbeat -> 202, then the same call again -> "duplicates":1
curl -sS -i -X POST "$CODEX_FUNCTIONS_URL/monitor-ingest" -H "x-monitor-key: $MONITOR_KEY" -H "content-type: application/json" -d '{"events":[{"event_id":"smoke-1","kind":"heartbeat"}]}'
# B. ticket -> 201, same call again -> 200 "duplicate":true; what the customer sees -> 200
curl -sS -i -X POST "$CODEX_FUNCTIONS_URL/support-intake" -H "x-support-key: $SUPPORT_KEY" -H "content-type: application/json" -d '{"external_ref":"smoke-001","subject":"Connection test","description":"Please ignore","category":"other","priority":"low"}'
curl -sS -i -X POST "$CODEX_FUNCTIONS_URL/support-ticket" -H "x-support-key: $SUPPORT_KEY" -H "content-type: application/json" -d '{"action":"status","external_ref":"smoke-001"}'
```
Then ask the owner to confirm the project shows in **Super Monitor** (heartbeat just now) and the test ticket is in the **Support desk** (they should close it).

## Definition of done (report to the owner)
- [ ] Pattern used: browser-only app for errors (heartbeats off) + server functions for heartbeat and tickets.
- [ ] Client files copied, nothing installed: `src/lib/superMonitor/` and `supabase/functions/_shared/support-client.mjs`.
- [ ] No `ctfs_` key or callback secret in the repository or the browser bundle; only `VITE_MONITOR_KEY` is in the bundle, on purpose.
- [ ] Smoke tests A and B pasted (keys removed) and the owner confirmed what they see in the Workspace.
- [ ] Callback route verifies the signature on the raw body, ignores repeats and stale `sequence`s and answers 2xx fast (covered by the e2e suite section 14).
- [ ] **Not verified here**: nothing was run against the real Workspace. The callback path, the signature check, and the SQL were tested locally with the Workspace's own client file and a locally signed request.
