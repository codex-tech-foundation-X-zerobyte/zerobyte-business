// One place for the public identity of the site. Everything here comes from build-time environment variables
// (see .env.example) so the policies, footer and SEO tags never show placeholder text.
import brand from './brand.json'

const env = import.meta.env as Record<string, string | undefined>
const clean = (value: string | undefined) => (value ?? '').trim()
const email = clean(env.VITE_SUPPORT_EMAIL)
const ga = clean(env.VITE_GA_MEASUREMENT_ID)

// Who builds the product. One source (brand.json) shared by the pages, the legal text, the search-engine tags and the
// build script, so the name can never differ between them. Update it there if the company name changes again.
const builderUrl = clean(env.VITE_BUILDER_URL)

export const siteConfig = {
  productName: brand.product,
  builderName: brand.builder.name,
  builderFormerName: brand.builder.formerName,
  /** Optional: the builder's own website, linked from the About page and listed in the search-engine data. */
  builderUrl: /^https:\/\/[^\s"<>]+$/.test(builderUrl) ? builderUrl : '',
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

/** "Sephry Tech (formerly Codex Tech Foundation)": the form used in footers and company details. */
export const builderNameWithHistory = `${siteConfig.builderName} (formerly ${siteConfig.builderFormerName})`
/** The sentence people and search engines read: who builds the product, and the earlier name. */
export const builtByStatement = `${siteConfig.productName} is built by ${siteConfig.builderName}, formerly known as ${siteConfig.builderFormerName}.`
