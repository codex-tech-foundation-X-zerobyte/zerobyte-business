// Runs after `vite build`. Produces the files search engines and static hosts need, using the real site address
// (VITE_SITE_URL) instead of a hard-coded one:
//   dist/robots.txt, dist/sitemap.xml, the Google Search Console verification tag, structured data, and dist/404.html
import { copyFile, readFile, writeFile } from 'node:fs/promises'

const siteUrl = (process.env.VITE_SITE_URL ?? '').trim().replace(/\/+$/, '')
const verification = (process.env.VITE_GOOGLE_SITE_VERIFICATION ?? '').trim()
const publicPaths = ['/', '/promoters', '/guide', '/support', '/privacy', '/terms', '/cookies']

if (!/^https:\/\/[^\s/]+$/.test(siteUrl))
  console.warn(
    '\n[prepare-pages] VITE_SITE_URL is not set to an https address (for example https://zerobyte-business.vercel.app). robots.txt will not list a sitemap and no sitemap.xml is written. Set it in your hosting environment variables before launch.\n',
  )

const robots = [
  'User-agent: *',
  'Allow: /',
  'Disallow: /admin',
  'Disallow: /admin.html',
  'Disallow: /auth',
  'Disallow: /promoter-setup',
  'Disallow: /promoter-dashboard',
  ...(siteUrl ? ['', `Sitemap: ${siteUrl}/sitemap.xml`] : []),
  '',
].join('\n')
await writeFile('dist/robots.txt', robots)

if (siteUrl) {
  const today = new Date().toISOString().slice(0, 10)
  const urls = publicPaths
    .map(
      (path) =>
        `  <url><loc>${siteUrl}${path === '/' ? '/' : path}</loc><lastmod>${today}</lastmod><changefreq>${path === '/' ? 'weekly' : 'monthly'}</changefreq><priority>${path === '/' ? '1.0' : '0.7'}</priority></url>`,
    )
    .join('\n')
  await writeFile(
    'dist/sitemap.xml',
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
  )
}

let html = await readFile('dist/index.html', 'utf8')
const extra = []
if (/^[A-Za-z0-9_-]{20,100}$/.test(verification))
  extra.push(`<meta name="google-site-verification" content="${verification}" />`)
if (siteUrl) {
  extra.push(
    `<link rel="canonical" href="${siteUrl}/" />`,
    `<meta property="og:url" content="${siteUrl}/" />`,
    `<meta property="og:image" content="${siteUrl}/og-image.png" />`,
    `<meta name="twitter:image" content="${siteUrl}/og-image.png" />`,
  )
  const data = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        name: process.env.VITE_COMPANY_NAME || 'Zerøbyte',
        url: siteUrl,
        logo: `${siteUrl}/icon-192.png`,
      },
      { '@type': 'WebSite', name: 'Zerøbyte Business', url: siteUrl },
      {
        '@type': 'SoftwareApplication',
        name: 'Zerøbyte Business',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'NGN' },
      },
    ],
  }
  extra.push(`<script type="application/ld+json">${JSON.stringify(data)}</script>`)
}
if (extra.length) html = html.replace('</head>', `    ${extra.join('\n    ')}\n  </head>`)
await writeFile('dist/index.html', html)
await copyFile('dist/index.html', 'dist/404.html')
// Launch check: the legal pages read these. Warn loudly at build time if any is missing.
const missingLegal = ['VITE_COMPANY_NAME', 'VITE_COMPANY_ADDRESS', 'VITE_SUPPORT_EMAIL'].filter(
  (name) => !(process.env[name] ?? '').trim(),
)
if (missingLegal.length)
  console.warn(
    `\n[prepare-pages] Missing ${missingLegal.join(', ')}. The Terms and Privacy pages will show no company name, address or email until these are set in your hosting environment variables.\n`,
  )
