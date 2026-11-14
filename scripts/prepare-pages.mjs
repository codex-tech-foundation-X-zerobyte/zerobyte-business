// Runs after `vite build`. Produces what search engines, link previews and static hosts need, using the real site address
// (VITE_SITE_URL) and the page wording in src/lib/seoPages.json (the same file the app reads at run time):
//   - one ready-made HTML file per public page (dist/guide.html ...) with its own title, description, canonical address,
//     link-preview tags, structured data and readable text, so Google, WhatsApp and social previews that do not run
//     JavaScript still see the right page;
//   - "noindex" copies for the sign-in and promoter screens;
//   - dist/robots.txt, dist/sitemap.xml, the Google Search Console and Bing Webmaster verification tags;
//   - dist/404.html, a real "page not found" page (hosts answer unknown addresses with it and a 404 status).
import { readFile, writeFile } from 'node:fs/promises'

const seo = JSON.parse(await readFile(new URL('../src/lib/seoPages.json', import.meta.url), 'utf8'))
const siteUrl = (process.env.VITE_SITE_URL ?? '').trim().replace(/\/+$/, '')
const verification = (process.env.VITE_GOOGLE_SITE_VERIFICATION ?? '').trim()
const bingVerification = (process.env.VITE_BING_SITE_VERIFICATION ?? '').trim()
const brand = 'Zerøbyte Business'
// Who builds the product: one file (src/lib/brand.json) shared with the app, so the name is identical everywhere.
const brandData = JSON.parse(await readFile(new URL('../src/lib/brand.json', import.meta.url), 'utf8'))
const builderName = brandData.builder.name
const formerName = brandData.builder.formerName
const builtBy = `${brand} is built by ${builderName}, formerly known as ${formerName}.`
const httpsUrl = (value) => (/^https:\/\/[^\s"<>]+$/.test((value ?? '').trim()) ? value.trim() : '')
// Optional: the builder's own website and public profiles (LinkedIn, X, Facebook, ...). They tell search engines and AI tools
// that these accounts and this site are the same organisation.
const builderUrl = httpsUrl(process.env.VITE_BUILDER_URL)
const sameAs = (process.env.VITE_BUILDER_SAME_AS ?? '').split(',').map(httpsUrl).filter(Boolean).slice(0, 12)
const legalCompany = (process.env.VITE_COMPANY_NAME ?? '').trim()
const publicPaths = Object.keys(seo.indexable)
const privatePages = {
  '/auth': 'Sign in',
  '/promoter-setup': 'Promoter set-up',
  '/promoter-dashboard': 'Promoter dashboard',
}

if (!/^https:\/\/[^\s/]+$/.test(siteUrl))
  console.warn(
    '\n[prepare-pages] VITE_SITE_URL is not set to an https address (for example https://app.yourdomain.com). robots.txt will not list a sitemap, no sitemap.xml is written and pages have no canonical address. Set it in your hosting environment variables before launch.\n',
  )

const escapeHtml = (value) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ---- robots.txt and sitemap.xml
// Private screens are kept out of Google with a noindex tag (Google has to be allowed to read the page to see it), so
// they are not listed here. The admin console is not linked from anywhere public and is noindex as well.
await writeFile(
  'dist/robots.txt',
  ['User-agent: *', 'Allow: /', 'Disallow: /admin', ...(siteUrl ? ['', `Sitemap: ${siteUrl}/sitemap.xml`] : []), ''].join('\n'),
)
if (siteUrl) {
  // Google ignores changefreq and priority, and a lastmod that is always "today" is ignored too, so only the address is listed.
  const urls = publicPaths.map((path) => `  <url><loc>${siteUrl}${path === '/' ? '/' : path}</loc></url>`).join('\n')
  await writeFile(
    'dist/sitemap.xml',
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
  )
}

// ---- llms.txt: a plain-language summary for AI assistants and AI search (an emerging convention; harmless if unused)
if (siteUrl) {
  const pages = publicPaths
    .map((path) => `- [${seo.indexable[path].h1}](${siteUrl}${path === '/' ? '/' : path}): ${seo.indexable[path].description}`)
    .join('\n')
  await writeFile(
    'dist/llms.txt',
    `# ${brand}\n\n> ${brand} is business software for recording sales, stock, customers, expenses, receipts and invoices in naira, with daily and weekly reports. ${builtBy}\n\n## Who builds it\n\n${builderName} (formerly ${formerName})${builderUrl ? ` - ${builderUrl}` : ''}\n\n## Pages\n\n${pages}\n`,
  )
}

// ---- the shared head, then one file per page
const base = await readFile('dist/index.html', 'utf8')
const shared = [`<meta name="author" content="${escapeHtml(builderName)}" />`]
if (/^[A-Za-z0-9_-]{20,100}$/.test(verification))
  shared.push(`<meta name="google-site-verification" content="${verification}" />`)
// Bing Webmaster Tools proves ownership with this tag (name msvalidate.01). Only a plain code is accepted, so a typo or a pasted
// full tag can never break the page.
if (/^[A-Za-z0-9]{16,64}$/.test(bingVerification))
  shared.push(`<meta name="msvalidate.01" content="${bingVerification}" />`)
if (siteUrl) {
  shared.push(
    `<meta property="og:image" content="${siteUrl}/og-image.png" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${brand}: sales, stock and customers in one place" />`,
    `<meta name="twitter:image" content="${siteUrl}/og-image.png" />`,
  )
}

function jsonLd(path) {
  if (!siteUrl) return ''
  const graph = [
    {
      '@type': 'Organization',
      '@id': `${siteUrl}/#org`,
      name: builderName,
      alternateName: [formerName],
      description: builtBy,
      url: builderUrl || siteUrl,
      logo: `${siteUrl}/icon-512.png`,
      brand: { '@type': 'Brand', name: brand },
      ...(sameAs.length ? { sameAs } : {}),
      ...(legalCompany && !legalCompany.includes(builderName) ? { legalName: legalCompany } : {}),
    },
    { '@type': 'WebSite', '@id': `${siteUrl}/#site`, name: brand, url: siteUrl, publisher: { '@id': `${siteUrl}/#org` }, inLanguage: 'en-NG' },
  ]
  if (path === '/')
    graph.push({
      '@type': 'SoftwareApplication',
      name: brand,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      description: seo.indexable['/'].description,
      url: siteUrl,
      author: { '@id': `${siteUrl}/#org` },
      publisher: { '@id': `${siteUrl}/#org` },
      creator: { '@id': `${siteUrl}/#org` },
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'NGN', description: '7-day free trial' },
    })
  else
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${siteUrl}/` },
        { '@type': 'ListItem', position: 2, name: seo.indexable[path].h1, item: `${siteUrl}${path}` },
      ],
    })
  if (path === '/about')
    graph.push({
      '@type': 'AboutPage',
      '@id': `${siteUrl}/about#page`,
      url: `${siteUrl}/about`,
      name: seo.indexable['/about'].h1,
      description: seo.indexable['/about'].description,
      about: { '@id': `${siteUrl}/#org` },
      isPartOf: { '@id': `${siteUrl}/#site` },
    })
  return `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c')}</script>`
}

const links = publicPaths
  .filter((path) => path !== '/')
  .map((path) => `<a href="${path}">${escapeHtml(seo.indexable[path].h1)}</a>`)
  .join(' · ')

/** Readable text inside #root. React replaces it as soon as the app starts. */
const staticBody = (heading, intro) =>
  `<main style="max-width:720px;margin:0 auto;padding:56px 20px;font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.6;color:#1b1f1d"><p style="margin:0 0 8px;font-weight:700">${brand}</p><h1 style="margin:0 0 12px;font-size:32px;line-height:1.2">${escapeHtml(heading)}</h1><p style="margin:0 0 20px;font-size:17px">${escapeHtml(intro)}</p><p style="margin:0 0 20px;font-size:14px;color:#55655c">${escapeHtml(builtBy)}</p><p style="margin:0"><a href="/auth">Sign in</a> · ${links}</p></main>`

function buildPage({ path, title, description, heading, intro, noindex }) {
  let html = base
  const url = `${siteUrl}${path === '/' ? '/' : path}`
  const set = (pattern, replacement) => {
    if (!pattern.test(html)) throw new Error(`[prepare-pages] index.html is missing ${pattern} (needed for ${path})`)
    html = html.replace(pattern, () => replacement)
  }
  set(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)}</title>`)
  set(/<meta name="description"[^>]*>/, `<meta name="description" content="${escapeHtml(description)}" />`)
  set(/<meta name="robots"[^>]*>/, `<meta name="robots" content="${noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large'}" />`)
  set(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${escapeHtml(title)}" />`)
  set(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${escapeHtml(description)}" />`)
  const extra = [
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
    ...shared,
  ]
  if (siteUrl && !noindex) extra.push(`<link rel="canonical" href="${url}" />`, `<meta property="og:url" content="${url}" />`)
  if (!noindex) extra.push(jsonLd(path))
  html = html.replace('</head>', () => `    ${extra.filter(Boolean).join('\n    ')}\n  </head>`)
  set(/<div id="root"><\/div>/, `<div id="root">${staticBody(heading, intro)}</div>`)
  return html
}

// Home replaces dist/index.html; every other page becomes dist/<name>.html (hosts serve it at /<name>).
for (const path of publicPaths) {
  const page = seo.indexable[path]
  const html = buildPage({ path, title: page.title, description: page.description, heading: page.h1, intro: page.intro, noindex: false })
  await writeFile(path === '/' ? 'dist/index.html' : `dist${path}.html`, html)
}
for (const [path, label] of Object.entries(privatePages)) {
  const html = buildPage({ path, title: `${label} | ${brand}`, description: `Sign in and account access for ${brand}.`, heading: label, intro: `${brand} sign-in and account screens.`, noindex: true })
  await writeFile(`dist${path}.html`, html)
}

// ---- a real "page not found" page: no app, no JavaScript, never indexed
await writeFile(
  'dist/404.html',
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Page not found | ${brand}</title>
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  </head>
  <body style="margin:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1b1f1d;background:#f5f6f5">
    <main style="max-width:520px;margin:0 auto;padding:96px 20px;text-align:center;line-height:1.6">
      <p style="margin:0 0 8px"><img src="/logo-mark.png" alt="" width="60" height="41" /></p>
      <p style="margin:0 0 8px;font-weight:700">${brand}</p>
      <h1 style="margin:0 0 12px;font-size:32px">This page does not exist.</h1>
      <p style="margin:0 0 24px">The address may be mistyped or the page may have moved.</p>
      <p style="margin:0"><a href="/" style="display:inline-block;padding:12px 22px;border-radius:10px;background:#087a42;color:#fff;text-decoration:none;font-weight:700">Go to the home page</a></p>
    </main>
  </body>
</html>
`,
)

// Launch check: the legal pages read these. Warn loudly at build time if any is missing.
const missingLegal = ['VITE_COMPANY_NAME', 'VITE_COMPANY_ADDRESS', 'VITE_SUPPORT_EMAIL'].filter((name) => !(process.env[name] ?? '').trim())
if (missingLegal.length)
  console.warn(
    `\n[prepare-pages] Missing ${missingLegal.join(', ')}. The Terms and Privacy pages will show no company name, address or email until these are set in your hosting environment variables.\n`,
  )
