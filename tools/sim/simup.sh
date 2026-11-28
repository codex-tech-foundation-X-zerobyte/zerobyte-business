#!/bin/bash
# Real-database simulation: Postgres (all migrations) + PostgREST, UI driven by Playwright. Everything in ONE command.
# usage: simup.sh <python script>
set -e
cd /home/claude/proj/zerobyte-business
service postgresql start >/dev/null 2>&1 || true; sleep 3
DB=zb_sim
su postgres -c "dropdb --if-exists $DB; createdb $DB"
# stub with auth.uid() that understands PostgREST's request.jwt.claims too
sed "s#select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid#select coalesce(nullif(current_setting('request.jwt.claim.sub', true),''), nullif(nullif(current_setting('request.jwt.claims', true),'')::json->>'sub',''))::uuid#" supabase/tests/00_supabase_stub.sql > /tmp/stub_sim.sql
chmod a+r /tmp/stub_sim.sql
su postgres -c "psql -q -d $DB -v ON_ERROR_STOP=1 -f /tmp/stub_sim.sql" >/dev/null
for f in supabase/migrations/*.sql; do su postgres -c "psql -q -d $DB -v ON_ERROR_STOP=1 -1 -f $PWD/$f" >/dev/null 2>/tmp/mig_err.txt || { echo "MIGRATION FAILED $f"; cat /tmp/mig_err.txt; exit 1; }; done
cat > /tmp/pgrst.conf <<CONF
db-uri = "postgresql:///$DB?host=/var/run/postgresql&user=postgres"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "simulation-secret-simulation-secret-1234"
server-port = 3000
server-host = "127.0.0.1"
db-pool = 10
db-max-rows = 1000
CONF
chmod a+r /tmp/pgrst.conf /home/claude/pgrst/postgrest
su postgres -c "/home/claude/pgrst/postgrest /tmp/pgrst.conf" > /tmp/pgrst.log 2>&1 &
PG=$!
VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=dummy.anon.key npx vite --port 5199 --host 127.0.0.1 > /tmp/vite.log 2>&1 &
VP=$!
for i in $(seq 1 40); do curl -s -o /dev/null http://127.0.0.1:5199/ && curl -s -o /dev/null http://127.0.0.1:3000/ && break; sleep 0.5; done
if [ -n "$SEED" ]; then su postgres -c "psql -q -d $DB -f /home/claude/seed.sql" > /tmp/seed.log 2>&1; fi
cd /home/claude/shot && mkdir -p out && python3 "$@" || true
kill $VP $PG 2>/dev/null; pkill -f postgrest 2>/dev/null; wait 2>/dev/null
