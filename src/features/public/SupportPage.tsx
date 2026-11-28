import { PublicFooter, PublicHeader } from '../../components/PublicChrome'
import { BookOpen, Mail, MessageCircle } from 'lucide-react'
import { usePublicPageMeta } from '../../lib/pageMeta'
import { appPath } from '../../lib/routing'
import { siteConfig } from '../../lib/siteConfig'
import { toWhatsAppNumber, whatsappUrl } from '../../lib/whatsapp'

const FAQ: [string, string][] = [
  [
    'I forgot my password',
    'Business owners: open Sign in and choose Forgot password. Team members: ask your business owner to reset it for you in User Accounts. Promoters: message us and we will send a new setup link.',
  ],
  [
    'I paid for a plan but it did not change',
    'Plans normally update within a minute of paying: when you return to the app it confirms the payment with Paystack for you. If you see "Still confirming", wait a moment and press Check again. If it still has not changed, contact us and include your Paystack payment reference (it starts with zb_) and the email you sign in with. We never need your card details.',
  ],
  [
    'How do I add a team member?',
    'Open Workforce, add the person, and choose what they can access. They sign in on the Worker tab with the details you give them. Their access is limited to what you allow.',
  ],
  [
    'My receipt does not show my logo',
    'Open Settings, then Business profile, and upload a PNG, JPG or WEBP logo up to 2 MB. It saves as soon as it uploads and appears on new receipts straight away.',
  ],
  [
    'Can I use it without internet?',
    'Yes. Sales and customers you record while offline are saved on your device and sent automatically when you are back online.',
  ],
  [
    'Does my plan renew automatically?',
    'No. Each payment covers one period and nothing renews by itself. When the period ends your business is locked until you pay again: you can still sign in and see your records, which stay safe, but you cannot add or change anything. Pay from Settings, then Billing, and it unlocks as soon as the payment is confirmed.',
  ],
  [
    'How do I add many products at once?',
    'Open Inventory and choose Import from CSV. Download the template, fill it in Excel or Google Sheets (one product per row), save it as a CSV file and upload it. We show you any row with a problem before anything is added, and you can import up to 1,000 products per file. Leave the SKU empty and we number it for you.',
  ],
  [
    'How do I count my stock?',
    'Open Inventory and choose Count stock. Type what is really on your shelves, review the differences, then apply them. Every change appears in your stock history as a stock count adjustment, and each count is kept under Stock counts so you can review it later.',
  ],
  [
    'Can I print receipts on my roll printer?',
    'Yes. Open Receipts, choose 80 mm or 58 mm roll printer under Print receipts for, then use Download PDF or Share. You get one narrow page in black and white that prints cleanly on a roll. The choice is remembered on that device.',
  ],
  [
    'How do I see my totals for the month or the year?',
    'Open Records and choose Monthly or Yearly under the period filter. Day by day shows each day with its total, and you can export the monthly or yearly table as a CSV file. Reports shows your best sellers and the products that are not selling.',
  ],
  [
    'Is the service working?',
    'Open the Status page. It checks sign-in and your records from your device and shows whether everything is working. If it says everything is fine but you still have a problem, message us.',
  ],
  [
    'How do I get a copy of my data, or delete my account?',
    'Your records are yours. Open Settings, then Business profile, and choose Download all my data (ZIP): you get your products, customers, sales, expenses, invoices, purchase orders and stock history as spreadsheets, free on every plan. To correct your information or delete your account, contact us from the email address on your account. We respond as described in our Privacy Policy.',
  ],
  [
    'How do promoters get paid?',
    'When a business you referred pays for a plan, your commission is recorded automatically and shown in your promoter dashboard. We pay out commissions once they are confirmed. The current rates are shown on the Promoters page.',
  ],
]

export function SupportPage({ navigate }: { navigate: (path: string) => void }) {
  usePublicPageMeta('/support')
  const whatsapp = toWhatsAppNumber(siteConfig.supportWhatsApp)
  return (
    <div className="legal-shell public-page support-page">
      <PublicHeader navigate={navigate} />
      <main className="legal-content support-content">
        <span className="section-label">Support</span>
        <h1>How can we help?</h1>
        <p className="legal-intro">
          Most questions have a quick answer below. If you cannot find yours, message us and a real person will reply.
        </p>
        <div className="support-cards">
          {whatsapp && (
            <a
              className="support-card"
              href={whatsappUrl('Hello Zerøbyte support, I need help with: ', siteConfig.supportWhatsApp)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <MessageCircle size={22} />
              <strong>WhatsApp</strong>
              <span>The fastest way to reach us. Send a message and we will reply there.</span>
            </a>
          )}
          {siteConfig.supportEmail && (
            <a className="support-card" href={`mailto:${siteConfig.supportEmail}`}>
              <Mail size={22} />
              <strong>Email</strong>
              <span>{siteConfig.supportEmail}</span>
            </a>
          )}
          <a className="support-card" href={appPath('/guide')}>
            <BookOpen size={22} />
            <strong>User guide</strong>
            <span>Step-by-step help with screenshots for every part of the app.</span>
          </a>
        </div>
        {!whatsapp && !siteConfig.supportEmail && (
          <p className="field-help">Signed in? Use the Support button inside the app to message us.</p>
        )}
        <section>
          <h2>Help us help you</h2>
          <p>When you contact us, please include:</p>
          <ul>
            <li>Your business name and the email you sign in with</li>
            <li>What you were trying to do and what happened instead</li>
            <li>Any message you saw on the screen</li>
            <li>For payment questions: your Paystack payment reference (it starts with zb_)</li>
          </ul>
          <p>Never send your password or card details. We will never ask for them.</p>
        </section>
        <section>
          <h2>Quick answers</h2>
          <div className="faq">
            {FAQ.map(([question, answer]) => (
              <details key={question}>
                <summary>{question}</summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <PublicFooter onStart={() => navigate('/auth')} />
    </div>
  )
}
