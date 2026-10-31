import { ArrowRight } from 'lucide-react'
import { openCookieSettings } from '../../lib/consent'
import { usePageMeta } from '../../lib/pageMeta'
import { appPath } from '../../lib/routing'
import { siteConfig } from '../../lib/siteConfig'
import { toWhatsAppNumber } from '../../lib/whatsapp'
import policies from './policies.json'

type PolicyKey = 'terms' | 'privacy' | 'cookies'
type Body = string | string[]

// The policy text lives in policies.json (easy to edit, no code). {{company}}, {{address}} and {{contact}} are filled in from
// siteConfig so the pages show your real business details.
function contactLine() {
  const parts: string[] = []
  if (siteConfig.supportEmail) parts.push(`email ${siteConfig.supportEmail}`)
  if (toWhatsAppNumber(siteConfig.supportWhatsApp)) parts.push('message us on WhatsApp')
  parts.push('use the Support button inside the app')
  return `You can ${parts.join(', ')}. See the Support page for all the ways to reach us.`
}
const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
const fill = (text: string) => text.replace(/\{\{company\}\}/g, siteConfig.companyName).replace(/\{\{address\}\}/g, siteConfig.companyAddress ? ` Our address is ${siteConfig.companyAddress}.` : '').replace(/\{\{contact\}\}/g, contactLine())

export function LegalPage({ type, navigate }: { type: PolicyKey; navigate: (path: string) => void }) {
  const content = policies[type] as { label: string; title: string; intro: string; highlights?: string[]; sections: [string, Body][] }
  const phone = toWhatsAppNumber(siteConfig.supportWhatsApp)
  usePageMeta({ title: content.title, description: fill(content.intro).slice(0, 155), path: `/${type}` })
  return <div className="legal-shell">
    <header className="legal-nav"><button type="button" className="brand-link" onClick={() => navigate('/')}><span className="brand-mark">ø</span> <strong>Zerøbyte</strong></button><button className="text-btn" onClick={() => navigate('/auth')}>Sign in <ArrowRight size={14} /></button></header>
    <main className="legal-content">
      <span className="section-label">{content.label}</span><h1>{content.title}</h1>
      <p className="legal-intro">{fill(content.intro)}</p>
      <div className="legal-updated">Last updated {policies.updated}</div>
      {content.highlights && <aside className="legal-glance" aria-label="Summary"><strong>In short</strong><ul>{content.highlights.map((item) => <li key={item}>{item}</li>)}</ul><small>This summary is for convenience. The full text below is what applies.</small></aside>}
      <nav className="legal-toc" aria-label="Contents"><strong>Contents</strong><ol>{content.sections.map(([heading]) => <li key={heading}><a href={`#${slug(heading)}`}>{heading}</a></li>)}</ol></nav>
      {content.sections.map(([heading, body], index) => <section key={heading} id={slug(heading)}><h2><span className="legal-num">{index + 1}</span>{heading}</h2>{Array.isArray(body) ? <ul>{body.map((item) => <li key={item}>{fill(item)}</li>)}</ul> : <p>{fill(body)}</p>}</section>)}
      {type === 'cookies' && <section><h2>Change your choice</h2><p>You can change or withdraw your choice at any time.</p><button type="button" className="secondary" onClick={openCookieSettings}>Open cookie settings</button></section>}
      <section className="legal-contact" aria-label="Company details"><h2>Company details</h2><dl><dt>Operated by</dt><dd>{siteConfig.companyName}</dd>{siteConfig.companyAddress && <><dt>Address</dt><dd>{siteConfig.companyAddress}</dd></>}{siteConfig.supportEmail && <><dt>Email</dt><dd><a href={`mailto:${siteConfig.supportEmail}`}>{siteConfig.supportEmail}</a></dd></>}{phone && <><dt>WhatsApp</dt><dd><a href={`https://wa.me/${phone}`} target="_blank" rel="noopener noreferrer">+{phone}</a></dd></>}<dt>In the app</dt><dd>Use the Support button</dd></dl></section>
    </main>
    <footer className="landing-footer legal-footer"><span>{siteConfig.productName}</span><div className="legal-links"><a href={appPath('/privacy')}>Privacy</a><a href={appPath('/terms')}>Terms</a><a href={appPath('/cookies')}>Cookies</a><a href={appPath('/support')}>Support</a><button type="button" onClick={openCookieSettings}>Cookie settings</button></div></footer>
  </div>
}

