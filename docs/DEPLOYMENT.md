# Deploying Zerøbyte Business (free tier) and running without an email provider

## 1. Supabase (once)

1. **Run the migrations** (`npm run supabase:push`) on a staging project first, then production. Run the SQL tests in
   `supabase/tests/` against staging (see its README).
2. **Deploy the edge functions:** `npm run supabase:functions:deploy`.
   Undeploy the old `create-sale` function in the dashboard if it exists (it was removed from the code).
3. **Set function secrets** (these must match the address people actually visit):
   ```bash
   supabase secrets set SITE_URL="https://your-app.vercel.app"        # or https://your-app.pages.dev
   supabase secrets set ALLOWED_ORIGINS="https://other-address.example"   # optional extras, comma separated
   ```
   `SITE_URL` is where password-setup links point and is automatically an allowed origin.
   When you buy a domain: change `SITE_URL`, put the old address in `ALLOWED_ORIGINS` while you switch, redeploy.
4. **Authentication → URL Configuration:** set *Site URL* to the same address and add `https://your-app.vercel.app/auth`
   to *Redirect URLs*. (Without this, setup and reset links are refused.)
5. **Authentication → Emails → OTP expiry:** raise it to `86400` (24 hours). Setup links sent over WhatsApp are
   usually opened hours later, not minutes.
6. **Authentication → Providers → Email:** minimum password length 8 or more. If you have **no email provider**,
   turn **Confirm email OFF** until you have one, otherwise new owners wait for a confirmation email that never comes.

## 2. Vercel

Import the repository. Framework: *Vite*. Build command `npm run build`, output `dist`. Add environment variables
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (and optionally `VITE_SUPPORT_WHATSAPP`, `VITE_ERROR_REPORT_ENDPOINT`).
Headers and routing come from `vercel.json`.

## 3. Cloudflare Pages

Connect the repository. Build command `npm run build`, output directory `dist`, same environment variables
(Node version comes from `.nvmrc`). Headers and routing come from `public/_headers` and `public/_redirects`.

## 4. No email provider: what works and what to do

Supabase's built-in email sender is only meant for trying things out: it allows very few messages per hour and,
on new projects, only delivers to your own team's addresses (check Supabase's current limits). Don't rely on it.

| Situation | How it works now (no email needed) |
|---|---|
| **New promoter** | Applies with their **WhatsApp number** → an admin approves → admin presses **Send access on WhatsApp** in *Admin → Promoters* → WhatsApp opens with the promoter ID and a one-time password-setup link → promoter chooses their **own** password. No password is ever created, shown or sent. |
| **Owner forgot password** | Owner messages support (button on the Forgot-password screen if `VITE_SUPPORT_WHATSAPP` is set) → admin presses **Reset link** next to the user in *Admin → Users* → sends it on WhatsApp. |
| **Worker forgot password** | Business owner presses **Reset password** in *User Accounts* → a new temporary password is shown once (and can be sent on WhatsApp); the worker must choose their own at next sign-in. |

Only SUPER_ADMIN and SUPPORT_ADMIN can generate recovery links, only a SUPER_ADMIN can do it for another admin, and
every link issued is written to the audit log.

**When you want automatic emails** (confirmations, "Forgot password" mail) you only need an SMTP sender, no domain
required to start: *Supabase → Authentication → Emails → SMTP Settings*.
- **Gmail** (free, about 500/day): host `smtp.gmail.com`, port `465`, user = your Gmail, password = a Google
  *App password* (needs 2-step verification on). Fine for a small launch.
- **Brevo** (free, about 300/day): verify one sender address; no domain needed to begin.
- **Resend** (free tier): only sends to other people once you have verified a domain, so it fits after you buy one.

## 5. Optional settings

| Variable | Where | Purpose |
|---|---|---|
| `VITE_SUPPORT_WHATSAPP` | host env | Support number (international digits, e.g. `2348031234567`). Adds chat buttons on Forgot-password and the promoter dashboard. |
| `VITE_ERROR_REPORT_ENDPOINT` | host env | HTTPS endpoint that receives client error reports. |
| `SITE_URL`, `ALLOWED_ORIGINS` | Supabase secrets | See step 3. |
