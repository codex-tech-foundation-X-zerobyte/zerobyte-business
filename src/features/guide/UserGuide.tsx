import { useState } from 'react'
import { BookOpen, PlayCircle, Printer } from 'lucide-react'
import { START_TOUR_EVENT } from '../onboarding/Onboarding'

type Section = { id: string; title: string; summary: string; image?: string; alt?: string; steps: string[]; tip?: string }

const img = (name: string) => `${import.meta.env.BASE_URL}guide/${name}.png`

export const GUIDE_SECTIONS: Section[] = [
  { id: 'start', title: 'Getting started', summary: 'Five things to do on your first day so everything works smoothly.', steps: [
    'Create your account and your business. You become the owner.',
    'Open Settings > Business profile and add your business name, logo, address and phone number. They appear on every receipt.',
    'Add the products you sell in Inventory, then receive your opening stock.',
    'Add your regular customers in Customers (optional, but it keeps balances tidy).',
    'Record your first sale in Sales, then open Receipts to see the receipt.'] },
  { id: 'overview', title: 'Overview', summary: 'Your daily snapshot. It shows revenue, gross profit, net profit and the cost of the goods you sold for the last 30 days, plus recent sales and anything running low.', image: img('01-overview'), alt: 'Overview page with revenue, profit, recent sales and low-stock items',
    steps: ['Use Record a sale (top right) to start a sale from anywhere.', 'Check Running low to see products that need restocking.', 'Tap View all next to Recent sales, or open Records, for the full history.'] },
  { id: 'sales', title: 'Recording a sale', summary: 'A sale is two steps: who it is for, then what they are buying.', image: img('02-sales'), alt: 'New sale page with a customer selected and the item cart',
    steps: ['Choose the customer. Their name stays attached while you add products.', 'Pick a product and quantity, then press Add item. Repeat for each product.', 'Choose how they paid: cash, bank transfer, card, mobile money, on credit, split or other.', 'Complete the sale. The server checks totals and stock again, so the numbers are always right.'],
    tip: 'If you leave in the middle of a sale, your draft is kept. If your internet drops, the sale is saved on your device and sent when you are back online.' },
  { id: 'inventory', title: 'Inventory', summary: 'Your product catalogue and stock levels.', image: img('03-inventory'), alt: 'Inventory table with products, stock levels, prices and branches',
    steps: ['Add product creates a new product with its cost price and selling price.', 'Receive stock records new stock arriving and keeps a traceable history.', 'Edit changes a product. Delete removes it from the catalogue.', 'The stock label turns amber when a product reaches its reorder point and shows 0 left when it is out of stock.'],
    tip: 'Long lists show 50 at a time. Use Load more for older items, or the search box at the top to find one quickly. Purchase Orders lets you order stock from suppliers and receive it into inventory when it arrives.' },
  { id: 'customers', title: 'Customers', summary: 'A customer book with running balances.', image: img('04-customers'), alt: 'Customers table showing contact details and balance owed',
    steps: ['Add customer saves a name, phone, email and address.', 'Balance owed shows what a customer still owes you from sales marked On credit.', 'Record payment reduces their balance when they pay you.'] },
  { id: 'receipts', title: 'Receipts', summary: 'Every completed sale has a receipt with your logo, business details, the customer and the items.', image: img('05-receipts'), alt: 'Receipts list with Preview, Download PDF and Share actions',
    steps: ['Preview shows the receipt on screen.', 'Download PDF saves a copy you can print or send. Older receipts load 25 at a time with Load older receipts.', 'Share sends the receipt to the customer.'],
    tip: 'Receipt numbers use your own prefix (for example AS-1001). Change the prefix and details in Settings > Business profile.' },
  { id: 'expenses', title: 'Expenses', summary: 'Record the costs of running your business so profit is honest.', image: img('06-expenses'), alt: 'Expenses list with category, date and amount',
    steps: ['Record expense adds a cost with a title, category, date, amount and how you paid.', 'Expenses flow into Reports as operating expenses and reduce net profit.'] },
  { id: 'reports', title: 'Reports', summary: 'Choose a period and see how the business performed, calculated from your real records.', image: img('07-reports'), alt: 'Reports page with revenue, cost of goods, gross profit, expenses and net profit',
    steps: ['Pick 7 days, 30 days, 12 months, or set your own From and To dates.', 'Revenue is what you sold. Cost of goods is what that stock cost you. Gross profit is the difference.', 'Net profit is gross profit minus your operating expenses.'] },
  { id: 'settings', title: 'Business profile', summary: 'Make your receipts look professional.', image: img('08-settings-business'), alt: 'Settings business profile with logo, contact details and a receipt preview',
    steps: ['Upload a PNG, JPG or WEBP logo (up to 2 MB). It saves as soon as it uploads.', 'Fill in your address, phone, email and website.', 'Set your receipt prefix and tax rate, then press Save changes.', 'The Receipt preview at the top updates as you type.'] },
  { id: 'billing', title: 'Plans and billing', summary: 'Start free and upgrade when you grow.', image: img('09-settings-billing'), alt: 'Billing tab showing the current plan, its limits and available plans',
    steps: ['Settings > Billing shows your current plan and its limits for products, branches and workers.', 'Pay with Paystack opens a secure Paystack page. Your plan changes only after Paystack confirms the payment.', 'Each payment covers one month and does not renew by itself. Renew from the same screen.', 'Some plans offer a free trial, once per business. When a trial or paid month ends your business returns to Free limits and your records stay safe.'],
    tip: 'Charged but your plan did not change? Wait a few minutes, press Check again if you see it, then message Support with your Paystack receipt.' },
  { id: 'notifications', title: 'Notifications', summary: 'Alerts for low and out-of-stock products and other important messages.', image: img('10-notifications'), alt: 'Notification panel listing low stock alerts',
    steps: ['The bell shows how many notifications are unread.', 'Open a notification to mark it read, or choose Mark all read.'] },
  { id: 'team', title: 'Branches and team', summary: 'For owners with more than one location or staff.', steps: [
    'Branches lets you add locations. Products and sales belong to a branch.',
    'Workforce is where you add team members and give them access.',
    'User Accounts lets the owner reset a team member\u2019s password.',
    'Workers see only what they need: Overview, Sales, Customers and Receipts. Inventory costs, reports and settings stay with the owner.'] },
  { id: 'tips', title: 'Good to know', summary: 'Small things that make daily use easier.', steps: [
    'Dark mode: use the Dark mode button at the top, or Settings > Appearance.',
    'Support: tap the Support button to message us on WhatsApp.',
    'Promoters: anyone can apply to earn by referring businesses at the Promoters page.',
    'Forgot your password? Use Forgot password on the sign-in page. Workers ask their owner to reset it.'] },
]

export function UserGuide({ embedded = false, canReplayTour = false }: { embedded?: boolean; canReplayTour?: boolean }) {
  const [active, setActive] = useState(GUIDE_SECTIONS[0].id)
  return <div className={`user-guide${embedded ? ' embedded' : ''}`}>
    <header className="guide-header">
      <div><span className="section-label"><BookOpen size={14} /> User guide</span><h1>How to use Zerøbyte Business</h1><p>Step-by-step help with screenshots. Jump to a topic on the left, or read it top to bottom.</p></div>
      <div className="guide-header-actions">
        {canReplayTour && <button type="button" className="secondary" onClick={() => window.dispatchEvent(new Event(START_TOUR_EVENT))}><PlayCircle size={16} /> Take the product tour</button>}
        <button type="button" className="secondary guide-print" onClick={() => window.print()}><Printer size={16} /> Print or save as PDF</button>
      </div>
    </header>
    <div className="guide-layout">
      <nav className="guide-toc" aria-label="Guide topics">{GUIDE_SECTIONS.map((section) => <a key={section.id} href={`#guide-${section.id}`} className={active === section.id ? 'active' : ''} onClick={() => setActive(section.id)}>{section.title}</a>)}</nav>
      <div className="guide-body">{GUIDE_SECTIONS.map((section) => <section key={section.id} id={`guide-${section.id}`} className="guide-section">
        <h2>{section.title}</h2><p className="guide-summary">{section.summary}</p>
        {section.image && <figure><img src={section.image} alt={section.alt ?? section.title} loading="lazy" /><figcaption>{section.alt}</figcaption></figure>}
        <ol>{section.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
        {section.tip && <p className="guide-tip"><strong>Tip:</strong> {section.tip}</p>}
      </section>)}</div>
    </div>
  </div>
}

// Public page at /guide, readable without signing in (and shareable with new staff).
export function GuidePage({ navigate }: { navigate: (path: string) => void }) {
  return <div className="legal-shell guide-page">
    <header className="legal-nav"><button type="button" className="brand-link" onClick={() => navigate('/')}><span className="brand-mark">ø</span> <strong>Zerøbyte</strong></button><button type="button" className="secondary" onClick={() => navigate('/auth')}>Sign in</button></header>
    <main className="legal-main guide-main"><UserGuide /></main>
  </div>
}
