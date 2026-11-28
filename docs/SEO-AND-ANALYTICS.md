# Search Console and Google Analytics: setup and what was checked

## 1. Set these in the hosting dashboard (Vercel or Cloudflare), then redeploy
| Variable | Value |
|---|---|
| `VITE_SITE_URL` | Your public address, for example `https://app.yourdomain.com` (https, no slash at the end). **Required**: it creates `sitemap.xml`, the canonical links and the link-preview image. |
| `VITE_GOOGLE_SITE_VERIFICATION` | Filled in at step 2 below. |
| `VITE_GA_MEASUREMENT_ID` | Filled in at step 3 below (looks like `G-ABC123XYZ9`). |
| `VITE_COMPANY_NAME`, `VITE_COMPANY_ADDRESS`, `VITE_SUPPORT_EMAIL` | Shown on the Terms and Privacy pages. The build warns if they are missing. |

Variables starting with `VITE_` are read **while building**, so changing one needs a new deployment.

## 2. Google Search Console (search.google.com/search-console)
1. **Add property** > **URL prefix** > type your exact address (`https://app.yourdomain.com`).
2. Choose the **HTML tag** method. Google shows `<meta name="google-site-verification" content="XXXX">`. Copy only the XXXX part into `VITE_GOOGLE_SITE_VERIFICATION`, redeploy, go back and press **Verify**. (The tag is added to every public page automatically.)
3. **Sitemaps** > type `sitemap.xml` > **Submit**. It lists the 7 public pages: home, promoters, guide, support, privacy, terms, cookies.
4. **URL inspection**: paste `/`, `/guide` and `/promoters` one at a time and press **Request indexing**.
5. What you should see (all normal): `/auth`, `/promoter-setup` and `/promoter-dashboard` are "Excluded by noindex tag" (on purpose, they are private screens). Unknown addresses are "Not found (404)". The admin console is never listed.
6. Come back after 3 to 7 days: **Pages** should show 7 indexed pages. **Core Web Vitals** needs about 28 days of real visits before it shows data.

## 3. Google Analytics 4 (analytics.google.com)
1. **Admin** > **Create** > **Property** > then **Data streams** > **Web** > enter your address. Copy the **Measurement ID** (`G-...`) into `VITE_GA_MEASUREMENT_ID` and redeploy.
2. Visitors see a cookie choice. **Analytics only starts after they press Accept** (this is deliberate and follows your Cookie Policy), so your numbers will be lower than real visits. Rejecting stops it and clears the Google cookies.
3. Events the app sends (nothing personal in any of them): `page_view` (address without the query string), `sign_up`, `generate_lead` (promoter application sent), `begin_checkout`, `purchase` (plan activated). In **Admin > Data display > Events**, switch **Mark as key event** on for `sign_up`, `generate_lead` and `purchase`.
4. Test: open your site, press Accept, then look at **Reports > Realtime** (or **Admin > DebugView**) for yourself.
5. Link the two: **Admin > Product links > Search Console links** so search queries appear beside your visits.

## 4. What was checked and fixed
* **Guide and Promoters pages pointed to the home page as their "original" (canonical) and shared its title.** Google could have dropped them. Every public page now has its own title, description, canonical address and link preview, from one shared list (`src/lib/seoPages.json`).
* **One real HTML file per public page** (`guide.html`, `promoters.html`...). Search engines, WhatsApp and social previews that do not run JavaScript now see the right page, with a heading, a short text and links. Before, all of them saw only the home page.
* **Private screens are `noindex`** (sign-in, promoter set-up, promoter dashboard, and the signed-in workspace at `/`). The old `robots.txt` blocked them instead, which stops Google reading the noindex and causes "indexed though blocked" warnings.
* **Unknown addresses now return a real 404 page.** Before, every address answered "200 OK" with the app (Search Console calls that a "soft 404"). Both `vercel.json` (clean URLs) and `public/_redirects` were updated. Old `/privacy.html` style addresses still redirect.
* **Sitemap** no longer lists a made-up "last modified" date, and structured data is valid JSON-LD (Organization, WebSite, SoftwareApplication on the home page, breadcrumbs on the others).
* **Analytics privacy:** the page-view event used to send the full address, including query strings (the promoter set-up link holds a secret token). It now sends the page only, and never reports the promoter set-up or dashboard. A visitor who accepts cookies halfway through a page is now counted for that page.
* **Speed:** the signed-in app (about 720 KB of code) was downloaded by every visitor of the landing page. It now loads only after sign-in: the first download dropped to about 117 KB.
* **Accessibility:** white text on the bright mint buttons (contrast 1.4, minimum 4.5) is now dark; the small brand label on light pages is darker.
* Automated checks: every public page has exactly one `h1`, no image without `alt`, no empty links or unnamed buttons, no sideways scrolling on a phone, no broken internal links. Lighthouse (SEO) scored **100** on the home, guide, support, privacy and promoters pages.

## 5. Not verified here
* Nothing was tested on your real domain, so Search Console acceptance, indexing speed and Core Web Vitals field data are unknown until after launch.
* Lighthouse speed numbers came from a throttled simulated phone and a test server without compression or caching; Vercel and Cloudflare add both, so real numbers should be better.
* Pages that need sign-in (the workspace) are not meant to be indexed, so they were not audited for SEO.
