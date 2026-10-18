# Paystack payments

How it works (the browser is never trusted with money):

1. Owner clicks **Pay with Paystack** on a plan. The browser sends only `organizationId`, `planId`, `interval`.
2. `paystack-initialize` checks the caller owns that business, reads the price from `plan_price_versions`,
   stores it against a server-made reference in `payments`, and returns a Paystack checkout address.
3. Paystack takes the payment. Two things then confirm it, both server-side:
   - `paystack-webhook` (Paystack calls it; signature `x-paystack-signature` is checked with HMAC-SHA512), and
   - `paystack-verify` (the browser asks after returning; it only passes the reference).
4. Both call Paystack's verify API and then `settle_paystack_payment()`, which checks amount + currency against
   what the server stored and activates the plan exactly once. A mismatch activates nothing.

## One-time setup

```bash
# 1. Database
supabase db push            # applies 20261013090000_paystack_payments.sql and 20261013091000_admin_traffic_snapshot.sql

# 2. Secrets (never put the secret key in a VITE_* variable or a file in this repo)
supabase secrets set PAYSTACK_SECRET_KEY="sk_test_..."
supabase secrets set SITE_URL="https://zerobyte-business.vercel.app"

# 3. Deploy the three functions
npm run supabase:functions:deploy:paystack
```

4. In the Paystack dashboard (Settings > API Keys & Webhooks) set the **Webhook URL** to
   `https://<project-ref>.supabase.co/functions/v1/paystack-webhook`.
5. For local testing against the live project, allow your dev origin:
   `supabase secrets set ALLOWED_ORIGINS="https://zerobyte-business.vercel.app,http://localhost:5173"`

The public key (`pk_...`) is not needed: this flow redirects to Paystack's hosted checkout.
Going live later = swap `PAYSTACK_SECRET_KEY` for the `sk_live_...` key; no code changes.
