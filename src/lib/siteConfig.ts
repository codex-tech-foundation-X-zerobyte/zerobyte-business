// One place for the public identity of the site. Everything here comes from build-time environment variables
// (see .env.example) so the policies, footer and SEO tags never show placeholder text.
const env = import.meta.env as Record<string, string | undefined>
const clean = (value: string | undefined) => (value ?? '').trim()
const email = clean(env.VITE_SUPPORT_EMAIL)
const ga = clean(env.VITE_GA_MEASUREMENT_ID)

export const siteConfig = {
  productName: 'Zerøbyte Business',
  // Legal name of the business that runs the service, used in the Terms and Privacy pages.
  companyName: clean(env.VITE_COMPANY_NAME) || 'Zerøbyte',
  companyAddress: clean(env.VITE_COMPANY_ADDRESS),
  // WhatsApp number people use to reach support (international format, e.g. 2348012345678); also powers the Support button.
  supportWhatsApp: clean(env.VITE_SUPPORT_WHATSAPP),
  supportEmail: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '',
  // Google Analytics 4 measurement ID (G-XXXXXXXXXX). Analytics only loads after a visitor accepts analytics cookies.
  gaMeasurementId: /^G-[A-Z0-9]{6,14}$/.test(ga) ? ga : '',
  siteUrl: (clean(env.VITE_SITE_URL) || (typeof window !== 'undefined' ? window.location.origin : '')).replace(
    /\/+$/,
    '',
  ),
}
