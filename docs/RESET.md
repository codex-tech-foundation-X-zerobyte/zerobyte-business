# Reset the database: erase all users and data, keep the super admin

**This permanently erases every business, customer, sale, payment record, promoter and user account in the Supabase
project you run it on. It cannot be undone. Follow the steps in order, and do not skip the backup.**

## What happens

| Kept | Erased |
|---|---|
| The ONE super admin you name: their login, profile, admin role and authenticator app | Every other account: owners, workers, promoters and every other admin (including any second super admin) |
| Plans, plan limits and price history | All businesses and everything inside them: products, customers, sales, expenses, invoices, receipts, reports, branches, team |
| Admin security settings (including the two-factor switch) | Subscriptions, payments, discounts, trial history, promoter applications, commissions and payouts |
| Blocked email domains, promoter terms, release notes and roadmap | Support chats, feedback, notifications, audit logs and visitor analytics |
| Everything outside the database: Edge Function secrets, Turnstile and Auth settings, Paystack settings, Vercel settings, the 5-minute report timer | Business logos (files), erased by step 4 |

If the super admin also owns a business you want to keep, stop and ask first: this reset erases every business.

The reset is **all-or-nothing**: it runs as one transaction and checks its own result. If anything is wrong it cancels
and changes nothing. It also refuses to run unless you type a confirmation phrase.

## Step 0: make sure you are in the right project
Open the Supabase dashboard and check the **project name** (top left). Its web address, `https://<ref>.supabase.co`, must match
the `VITE_SUPABASE_URL` of the site you intend to reset. Wrong project means the wrong data is erased.

## Step 1: take a backup and keep it safe
Free Supabase projects have no automatic backups, so make your own. In the VS Code terminal (the project must be linked, as
for `npm run supabase:push`). The files hold personal data: save them **outside** the project folder so they can never be
committed, for example one level up:

```
npx supabase db dump --linked --data-only -f ../zerobyte-backup-public.sql
npx supabase db dump --linked --data-only -s auth -f ../zerobyte-backup-auth.sql
```
If the CLI refuses the second command, the first one (your business data) is the important one. Check the files are not empty.

## Step 2: preview (changes nothing)
1. Supabase dashboard -> **SQL Editor** -> new query -> paste all of `supabase/reset/1_preview.sql`.
2. Change the one email near the top to your super admin's email.
3. Run it. Read the result:
   - line **1** must show your super admin's email and "super admin, 1 authenticator(s) kept". If it says NOT FOUND, the email is wrong
     or that account is not an active super admin. Do not continue.
   - line **2** is how many accounts will be erased.
   - lines **3** list every table: `KEEP`, `KEEP ONLY THE SUPER ADMIN'S ROW`, or `ERASE`, with the number of rows.
     If a table you created by hand in the dashboard appears under `ERASE` and you want to keep it, tell me before going on.
   - line **4** is how many files will be erased in step 4.

## Step 3: erase
1. New query -> paste all of `supabase/reset/2_wipe.sql`.
2. Edit the two values near the top: `keep_email` (your super admin's email) and `confirm`, which must be exactly
   `ERASE ALL DATA` (capitals).
3. Run the whole script once. Success shows a result row **RESET COMPLETE** with `accounts_remaining` = 1.
   Any error message means it cancelled and **nothing was changed**:
   - `NOT CONFIRMED`: the phrase was not typed exactly.
   - `KEEP ACCOUNT NOT FOUND`: the email is not an active super admin.
   - `CHECK FAILED ...`: it erased, found something unexpected and undid everything. Send me the message.
4. Run `1_preview.sql` again: every `ERASE` table should now show 0 and only your super admin remains.

## Step 4: erase the files (business logos)
SQL is not allowed to delete files, so use the script. You need the project web address and the **service_role** key
(Dashboard -> Project Settings -> API). That key is a master password: type it only here, never save it in a file, never
paste it into a chat or commit it. Set the values for this one command, preview first:

PowerShell:
```
$env:SUPABASE_URL="https://<ref>.supabase.co"; $env:SUPABASE_SERVICE_ROLE_KEY="<paste key>"; npm run reset:storage
```
bash / macOS / Linux:
```
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<paste key> npm run reset:storage
```
It prints the project name and how many files it found, and deletes nothing. If the project is right, run it again with
`-- --yes` added at the end (`npm run reset:storage -- --yes`). Close the terminal afterwards so the key is gone.

## Step 5: check it worked
- Sign in to the admin console with the super admin account (it will ask for the authenticator code if two-factor is on).
- Create a test business from a normal sign-up and confirm it gets a free trial.
- Anyone who had the app open before the reset (testers, your own phone): sign out and clear the site's data, because their
  device can still hold old drafts and offline sales that no longer exist.

## Good to know
- Erased accounts stay signed in on their devices for up to an hour (their tokens expire on their own), but they can see nothing.
- Pending Paystack notifications for erased test payments are harmless: the system ignores references it does not know.
- Running the reset again later is safe and does the same thing.
- New tables added in future releases are erased by default unless they are added to the "keep" list at the top of both scripts.
- How it was tested: `bash supabase/reset/test_reset.sh` (needs a local Postgres with the schema) builds a copy with demo data and traps,
  and proves the refusals, the all-or-nothing rollback, that the super admin and shared settings survive, and that sign-up,
  trials and reports work afterwards. `npm run test:reset` tests the file-erasing script.
