#!/bin/bash
cd "$(dirname "$0")"
REPO="${REPO:-$(cd ../../.. && pwd)}"
service postgresql start >/dev/null 2>&1; sleep 3
su postgres -c "psql -d ${E2E_DB:-zbe} -q -v ON_ERROR_STOP=0 -f $REPO/supabase/migrations/20261014100000_payment_diagnostics.sql" >/dev/null 2>&1
su postgres -c "psql -d ${E2E_DB:-zbe} -q -v ON_ERROR_STOP=0 -f $REPO/supabase/migrations/20261016090000_paystack_fee_bearer.sql" >/dev/null 2>&1
su postgres -c "psql -d ${E2E_DB:-zbe} -q -c 'delete from payment_events; delete from payments; delete from subscription_events where actor_id is not null'" >/dev/null 2>&1
postgrest pgrst.conf > pgrst.log 2>&1 &
node servers.cjs > servers.log 2>&1 &
ANON=$(node mkjwt.cjs anon); SVC=$(node mkjwt.cjs service_role)
for spec in "paystack-initialize:8801" "paystack-verify:8802" "paystack-webhook:8803"; do n=${spec%%:*}; port=${spec##*:}
  SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=$ANON SUPABASE_SERVICE_ROLE_KEY=$SVC PAYSTACK_SECRET_KEY=sk_test_local_fake_key PAYSTACK_API_URL=http://127.0.0.1:54400 SITE_URL=https://zerobyte-business.vercel.app PORT=$port deno run --allow-net --allow-env --import-map=import_map.json $REPO/supabase/functions/$n/index.ts > deno-$n.log 2>&1 &
done
for i in $(seq 1 40); do ok=1; for p in 3000 8801 8802 8803 54400; do curl -s -m 1 -o /dev/null http://127.0.0.1:$p/ || ok=0; done; [ $ok = 1 ] && break; sleep 1; done
node e2e.cjs 2>&1 | grep -v "^$"
code=$?
pkill -f postgrest; pkill -f "node servers.cjs"; pkill -f "deno run"
