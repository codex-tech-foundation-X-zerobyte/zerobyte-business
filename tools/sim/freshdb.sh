#!/bin/bash
# usage: freshdb.sh <dbname> [testfile ...]   (applies stub + all migrations to a brand-new DB, then runs tests)
set -e
cd /home/claude/proj/zerobyte-business
DB=$1; shift
su postgres -c "dropdb --if-exists $DB; createdb $DB"
P="su postgres -c"
run() { su postgres -c "psql -q -d $DB -v ON_ERROR_STOP=1 $*" ; }
run "-f $PWD/supabase/tests/00_supabase_stub.sql" >/dev/null
for f in supabase/migrations/*.sql; do su postgres -c "psql -q -d $DB -v ON_ERROR_STOP=1 -1 -f $PWD/$f" >/dev/null 2>/tmp/mig_err.txt || { echo "MIGRATION FAILED: $f"; cat /tmp/mig_err.txt; exit 1; }; done
echo "migrations applied OK"
for t in "$@"; do echo "=== $t"; su postgres -c "psql -d $DB -f $PWD/$t" 2>&1 | tail -2000; done
