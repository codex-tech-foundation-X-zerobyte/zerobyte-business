# Code map (where things live)

Run `npm run format` before committing (Prettier: no semicolons, single quotes, 120 columns). `npm run format:check` only checks.

## Source folders (`src/`)
| Folder | What is in it |
|---|---|
| `features/<area>/` | One folder per product area: `dashboard`, `sales`, `inventory`, `customers`, `expenses`, `invoices`, `receipts`, `records`, `reports`, `people` (Workforce), `settings`, `billing`, `promoter`, `support`, `notifications`, `onboarding`, `guide`, `public` (landing, legal, support pages), `auth`, `workspace` (the app shell, navigation, branch context), `pwa` |
| `admin/` | The platform admin console: one `Admin<Page>.tsx` per section, `HeaderActions.tsx` (buttons in the page header), `AdminCommandPalette.tsx` (Ctrl/Cmd+K), shared charts in `AdminCharts.tsx` |
| `components/` | Shared pieces: `ui.tsx` (PageIntro, Metric, FitText, tables, forms), `charts.tsx`, `Hub.tsx`, `BrandMark.tsx` |
| `lib/` | No-screen code: Supabase client, identity, paging, offline queue, receipt PDF, monitoring, analytics, SEO page data |
| `AdminConsole.tsx`, `App.tsx`, `main.tsx` | The admin shell, the router and the entry point |

## CSS files (`src/*.css`, loaded in this order in `main.tsx`)
| File | Purpose |
|---|---|
| `styles.css` | The base: resets, forms, buttons, tables, the older shared rules |
| `design.css`, `theme.css`, `polish.css` | Colour and spacing tokens, the dark theme, finishing touches |
| `shell.css`, `layout.css` | The signed-in app frame: sidebar, top bar, bottom tab bar, phone sheet |
| `pages.css` | Page-level rules (Overview, Reports, Records, receipt preview, phone cards) |
| `charts.css`, `skeleton.css`, `scroll.css` | Charts, loading placeholders, scroll behaviour |
| `billing.css`, `promoter.css`, `auth.css` | Billing, promoter pages, sign-in |
| `public.css` | Landing page, footer, legal and support pages |
| `admin.css`, `admin-v2.css` | Admin console (`admin-v2.css` is the current look; `admin.css` keeps shared admin pieces) |

## Rules that keep it manageable
* New CSS goes in the file for that area, not at the end of `styles.css`.
* Before adding a class, search for it: a class that no `.tsx` file uses is dead CSS. The last clean-up removed 489 such rules.
* Docs: `CONTINUE.md` (what is done and next), `docs/CODEX-LINK.md` (monitor and support link setup), `docs/DEPLOYMENT.md` (hosting).
