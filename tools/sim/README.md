# Simulation and audit tools (not part of the app)

These scripts let you test the real app against a real database, and take screenshots of every page. They were used to
check the V8 redesign. Nothing here is shipped to users.

## What it builds
Local Postgres 16 with every migration applied, PostgREST (the same layer Supabase uses, with `db-max-rows = 1000` like
Supabase), the Vite dev server, and Playwright (Chromium) driving the UI with a signed-in user. A minted JWT replaces
Supabase Auth; `/auth`, realtime, storage and edge functions are stubbed, so anything that needs an Edge Function
(workers, Paystack checkout) cannot be exercised here.

## Setup (one time, Ubuntu)
1. `apt-get install -y postgresql postgresql-contrib` and `service postgresql start`
2. PostgREST binary: https://github.com/PostgREST/postgrest/releases (v12.2.8, `linux-static-x86-64`), put it at
   `/home/claude/pgrst/postgrest` (or change the path in `simup.sh`).
3. Playwright for Python and a Chromium (`python3 -m playwright install chromium`); the scripts expect Chromium at
   `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (change it in `simlib.py`).
4. `npm ci` in the project root. The scripts assume the project is at `/home/claude/proj/zerobyte-business`; edit the
   paths at the top of `simup.sh`, `freshdb.sh` and `simlib.py` if yours differs.

## Use
- `freshdb.sh <db> [test.sql ...]`: build a fresh database from `supabase/tests/00_supabase_stub.sql` plus all
  migrations and run SQL tests (`SKIP=<part of a migration name>` leaves one migration out for before/after checks).
- `SEED=1 simup.sh <script.py> [args]`: start everything, seed a realistic business (`seed.sql`), run the script, stop.
  - `c1.py <tag>`: screenshot every page at desktop and phone size into `shot/out/`.
  - `mob.py <width> [light|dark]`: phone audit of every page with automatic checks (sideways scroll, off-screen
    elements, small tap targets). Run at 390 and 360.
  - `mob2.py`: opens a full-screen phone form, saves a customer, checks the form closes and the list updates.
  - `s5.py`: adds one item on each page twice and prints what happened (duplicates, limits, messages).
- `cssq.mjs '<regex>'` lists CSS rules matching a selector; `cssdrop.mjs '<regex>' [--dry] [--skip-vars]` removes
  selectors from the legacy stylesheets. Copy them into the project root to run (they import `postcss`).
