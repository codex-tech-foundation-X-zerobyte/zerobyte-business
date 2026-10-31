import { ArrowRight, BookOpen, Mail, MessageCircle } from 'lucide-react'
import { openCookieSettings } from '../../lib/consent'
import { usePageMeta } from '../../lib/pageMeta'
import { appPath } from '../../lib/routing'
import { siteConfig } from '../../lib/siteConfig'
import { toWhatsAppNumber, whatsappUrl } from '../../lib/whatsapp'

const FAQ: [string, string][] = [
  ['I forgot my password', 'Business owners: open Sign in and choose Forgot password. Team members: ask your business owner to reset it for you in User Accounts. Promoters: message us and we will send a new setup link.'],
  ['I paid for a plan but it did not change', 'Plans normally update within a minute of paying: when you return to the app it confirms the payment with Paystack for you. If you see "Still confirming", wait a moment and press Check again. If it still has not changed, contact us and include your Paystack payment reference (it starts with zb_) and the email you sign in with. We never need your card details.'],
  ['How do I add a team member?', 'Open Workforce, add the person, and choose what they can access. They sign in on the Worker tab with the details you give them. Their access is limited to what you allow.'],
  ['My receipt does not show my logo', 'Open Settings, then Business profile, and upload a PNG, JPG or WEBP logo up to 2 MB. It saves as soon as it uploads and appears on new receipts straight away.'],
  ['Can I use it without internet?', 'Yes. Sales and customers you record while offline are saved on your device and sent automatically when you are back online.'],
  ['Does my plan renew automatically?', 'No. Each payment covers one period and nothing renews by itself. When the period ends your business is locked until you pay again: you can still sign in and see your records, which stay safe, but you cannot add or change anything. Pay from Settings, then Billing, and it unlocks as soon as the payment is confirmed.'],
  ['How do I get a copy of my data, or delete my account?', 'Contact us from the email address on your account and tell us what you need. We respond to access, correction and deletion requests as described in our Privacy Policy.'],
  ['How do promoters get paid?', 'When a business you referred pays for a plan, your commission is recorded automatically and shown in your promoter dashboard. We pay out commissions once they are confirmed. The current rates are shown on the Promoters page.'],
]

export function SupportPage({ navigate }: { navigate: (path: string) => void }) {
  usePageMeta({ title: 'Support', description: 'Get help with Zerøbyte Business: contact us, find quick answers about passwords, payments, receipts and your team.', path: '/support' })
  const whatsapp = toWhatsAppNumber(siteConfig.supportWhatsApp)
  return <div className="legal-shell support-page">
    <header className="legal-nav"><button type="button" className="brand-link" onClick={() => navigate('/')}><span className="brand-mark">ø</span> <strong>Zerøbyte</strong></button><button className="text-btn" onClick={() => navigate('/auth')}>Sign in <ArrowRight size={14} /></button></header>
    <main className="legal-content support-content">
      <span className="section-label">Support</span><h1>How can we help?</h1>
      <p className="legal-intro">Most questions have a quick answer below. If you cannot find yours, message us and a real person will reply.</p>
      <div className="support-cards">
        {whatsapp && <a className="support-card" href={whatsappUrl('Hello Zerøbyte support, I need help with: ', siteConfig.supportWhatsApp)} target="_blank" rel="noopener noreferrer"><MessageCircle size={22} /><strong>WhatsApp</strong><span>The fastest way to reach us. Send a message and we will reply there.</span></a>}
        {siteConfig.supportEmail && <a className="support-card" href={`mailto:${siteConfig.supportEmail}`}><Mail size={22} /><strong>Email</strong><span>{siteConfig.supportEmail}</span></a>}
        <a className="support-card" href={appPath('/guide')}><BookOpen size={22} /><strong>User guide</strong><span>Step-by-step help with screenshots for every part of the app.</span></a>
      </div>
      {!whatsapp && !siteConfig.supportEmail && <p className="field-help">Signed in? Use the Support button inside the app to message us.</p>}
      <section><h2>Help us help you</h2><p>When you contact us, please include:</p><ul><li>Your business name and the email you sign in with</li><li>What you were trying to do and what happened instead</li><li>Any message you saw on the screen</li><li>For payment questions: your Paystack payment reference (it starts with zb_)</li></ul><p>Never send your password or card details. We will never ask for them.</p></section>
      <section><h2>Quick answers</h2><div className="faq">{FAQ.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div></section>
    </main>
    <footer className="landing-footer legal-footer"><span>{siteConfig.productName}</span><div className="legal-links"><a href={appPath('/privacy')}>Privacy</a><a href={appPath('/terms')}>Terms</a><a href={appPath('/cookies')}>Cookies</a><button type="button" onClick={openCookieSettings}>Cookie settings</button></div></footer>
  </div>
}
