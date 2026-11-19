# Deploying the website on Cloudflare (and what to do when it fails)

Cloudflare is free for commercial use on its static hosting, which is why it is the recommended host (see
`docs/LAUNCH-CHECKLIST.md` Phase 0). This guide is for the website only. Supabase and the Edge Functions are unchanged.

## What I verified before writing this
- A clean copy of the project (fresh `npm ci`, then `npm run build`, exactly what Cloudflare runs) **builds successfully**.
- The build output (`dist`) was served with Cloudflare's own local emulator in **both** setups below. In both, every page
  loads (`/`, `/privacy`, `/about`, `/guide`, `/promoters`, `/admin`), an unknown address shows your 404 page, `/admin/anything`
  goes to `/admin`, and the security headers (CSP, HSTS, X-Frame-Options) are applied.
  So when a Cloudflare deploy fails, the cause is the **project settings**, not the code.

## Why it keeps failing (the usual reasons)
0. **`Invalid _redirects configuration ... Infinite loop detected` (error 100324).** Cloudflare rejects a rule whose source ends in
   `/*` and whose destination is `/index.html` or `/index`, and one rejected rule fails the whole deploy (the build itself is fine
   and the log ends with "Failed: error occurred while running deploy command"). `public/_redirects` uses `/` instead. Do not
   change `/app/*  /  200` back to `/index.html`.
1. **The project was created as a Worker, not as Pages.** Cloudflare now shows Workers and Pages together. A Worker project runs
   `npx wrangler deploy` after the build, and a plain static site has no Worker config, so it stops with
   *"Missing entry-point to Worker script or to assets directory"*. Fix: use Path A below (a real Pages project).
2. **The wrong Node version.** Cloudflare may use an older Node than the project needs. Fix: add the variable `NODE_VERSION` = `22`.
3. **Missing website variables.** The build passes but the site cannot reach Supabase. Fix: add the `VITE_` variables, then redeploy.
4. **Cloudflare cannot read the repository** (private repo not shared with the Cloudflare GitHub app). Fix: GitHub -> Settings ->
   Applications -> Cloudflare -> give it access to the repository, then retry.

## Path A (recommended): a Cloudflare Pages project
1. Cloudflare dashboard -> **Workers & Pages** -> **Create**. Choose the **Pages** option and **Connect to Git**.
   (If the screen only offers a Worker flow, look near the bottom for a link such as "Looking to deploy Pages?".)
2. Pick your GitHub repository. Production branch: your main branch.
3. Build settings:

   | Setting | Value |
   |---|---|
   | Framework preset | None |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | Root directory | **empty if the Zerøbyte files are at the top of the repository; otherwise the folder they are in** (for example `zerobyte-business` when the repository holds several projects). Wrong here = "package.json not found" |

4. **Environment variables** (add them for Production, and Preview if you use it):

   | Name | Value |
   |---|---|
   | `NODE_VERSION` | `22` |
   | `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | your **anon** key (never `service_role`) |
   | `VITE_SITE_URL` | the public address, see step 6 |
   | `VITE_TURNSTILE_SITE_KEY` | your Turnstile **site** key |
   | `VITE_COMPANY_NAME`, `VITE_COMPANY_ADDRESS`, `VITE_SUPPORT_EMAIL` | your company details |

   The full list is in `docs/LAUNCH-CHECKLIST.md`, Appendix A.
5. **Save and Deploy.** The first build takes a few minutes. Open the build log if it fails (see the table below).
6. **Your address:** it is `https://<project-name>.pages.dev`. You only know it once the project has a name, so: deploy once, then set
   `VITE_SITE_URL` to that address and press **Retry deployment**. (If you attach your own domain under the project's **Custom
   domains**, use that instead.)
7. After the first good deploy, update the places that must match the address:
   - Supabase -> Authentication -> URL Configuration: Site URL and Redirect URL (`https://<address>/auth`)
   - `supabase secrets set SITE_URL="https://<address>"`, then `npm run supabase:functions:deploy`
   - Cloudflare Turnstile: add the hostname to the widget
   - Google Search Console and Bing: add the site
8. Every change to a `VITE_` variable needs **Retry deployment** (they are baked in at build time).

## Path B (only if you must use a Worker project): Worker with static assets
Use this only if the dashboard will not let you create a Pages project. Add a file named `wrangler.jsonc` in the **root of the repository**
and commit it:
```json
{
  "name": "zerobyte-business",
  "compatibility_date": "2026-01-01",
  "assets": { "directory": "./dist", "html_handling": "auto-trailing-slash", "not_found_handling": "404-page" }
}
```
Then in the project's build settings: Build command `npm run build`, Deploy command `npx wrangler deploy`, and add `NODE_VERSION` = `22`
and the `VITE_` variables as **build** variables (the section for variables used while building, not the runtime ones). The `name` must
match the project name. Do **not** add this file if you use Path A: it can confuse a Pages project.

## Getting a clean address (not mixed with another project's name)
The address is built from names that Cloudflare takes from your setup, so a messy address means a messy name was picked up:
- **Pages project:** the address is `<project-name>.pages.dev`. The project name **defaults to the GitHub repository name**, so a repository
  called something like `codex-tech-workspace` gives that address. At creation, change the **Project name** field to `zerobyte-business`
  (or `zerobyte`; names are shared by everyone on Cloudflare, so if it is taken pick another). Already created? Project -> **Settings ->
  General -> Project name -> Change**. The address changes immediately and the old one stops working, so afterwards redo the "update the
  places that must match the address" list (step 7 of Path A).
- **Worker project:** the address is `<worker name>.<your account's workers.dev subdomain>.workers.dev`. The worker name comes from `name`
  in `wrangler.jsonc` (set it to `zerobyte-business`). The second part is the account-wide subdomain shared by all your Workers (Workers & Pages overview ->
  the Subdomain setting). If it carries another project's name, that is where it comes from.
- **One repository, several projects:** each Cloudflare project needs its own **Root directory** (its own folder) and its own name.
- Preview builds get addresses like `<hash>.<project>.pages.dev` and `<branch>.<project>.pages.dev`. Those are previews. Share the production address only.
- **The real fix is your own domain.** Under the Pages project -> **Custom domains**, add `app.yourdomain.com` (or the bare domain). The address then never depends on
  project names, you can rename or move projects freely, and search rankings stay put. A bare domain must be a zone on the same Cloudflare account;
  a subdomain can point at the project with a CNAME. After adding it, set `VITE_SITE_URL` and `SITE_URL` to the domain and redo step 7.

## When it fails: read the error, find it here

| What the log says | What to do |
|---|---|
| `Missing entry-point to Worker script or to assets directory` | It is a Worker project with no config. Create a Pages project (Path A), or add `wrangler.jsonc` (Path B) |
| `Vite requires Node.js version ...`, `EBADENGINE`, or strange syntax errors | Add `NODE_VERSION` = `22`, then retry |
| `Output directory "dist" not found` | The build failed earlier (read the lines above the message), or the output directory was typed differently |
| `package.json and package-lock.json are not in sync` | On your computer run `npm install`, commit the updated `package-lock.json`, push |
| `package.json` not found, or `ENOENT ... package.json` | The Root directory is wrong. If the repository holds several projects, set it to the Zerøbyte folder |
| Build passes but the site is blank or says it cannot connect | The `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` variables are missing. Add them, then Retry deployment |
| Stuck at "Cloning repository" or "repository not found" | Give the Cloudflare GitHub app access to the repo (GitHub -> Settings -> Applications) |
| Pages work but sign-in shows a CAPTCHA error | Add the hostname to the Turnstile widget and check `VITE_TURNSTILE_SITE_KEY` |
| Browser shows CORS errors calling functions | `SITE_URL` (Supabase secret) does not match the address in the browser bar |

## Still failing? Send me
1. The **last 30 lines of the build log** (from the first red line down), and
2. a screenshot of the project's **Settings -> Build** page, with any secret values hidden.
