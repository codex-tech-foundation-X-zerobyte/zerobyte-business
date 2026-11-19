#!/bin/bash
# usage: run.sh "100:35" "250:35" ...   (users:seconds)
cd "$(dirname "$0")"
service postgresql start >/dev/null 2>&1; sleep 4
cat > /tmp/pgrst-load.conf <<CONF
db-uri = "postgres://authenticator:pw@127.0.0.1:5432/${LOAD_DB:-zbl}"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "local-test-secret-local-test-secret-1234"
server-port = 3000
db-pool = 15
db-pool-acquisition-timeout = 10
db-max-rows = 1000
CONF
postgrest /tmp/pgrst-load.conf > /tmp/pgrst-load.log 2>&1 &
for i in $(seq 1 20); do curl -s -m 1 -o /dev/null http://127.0.0.1:3000/ && break; sleep 1; done
node load.cjs 20 6 warmup 2 > /dev/null 2>&1
for spec in "$@"; do node load.cjs ${spec%%:*} ${spec##*:} "" ${RAMP:-8}; done
pkill -f "postgrest /tmp/pgrst-load.conf"
