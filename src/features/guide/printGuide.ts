import { GUIDE_SECTIONS } from './guideContent'

const esc = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// The app has a global print rule that hides everything except receipts, which is why printing the guide used to
// produce blank pages. The guide is therefore printed from its own clean document in a hidden frame, so no app CSS
// can interfere, and the browser's "Save as PDF" gives a proper, readable file.
function buildDocument() {
  const today = new Date().toLocaleDateString('en-NG', { dateStyle: 'long' })
  const toc = GUIDE_SECTIONS.map((section, index) => `<li>${index + 1}. ${esc(section.title)}</li>`).join('')
  const body = GUIDE_SECTIONS.map(
    (section, index) => `<section>
    <h2><span>${index + 1}</span>${esc(section.title)}</h2>
    <p class="summary">${esc(section.summary)}</p>
    ${section.image ? `<figure><img src="${esc(new URL(section.image, window.location.href).href)}" alt="${esc(section.alt ?? section.title)}"><figcaption>${esc(section.alt ?? '')}</figcaption></figure>` : ''}
    <ol>${section.steps.map((step) => `<li>${esc(step)}</li>`).join('')}</ol>
    ${section.tip ? `<p class="tip"><strong>Tip:</strong> ${esc(section.tip)}</p>` : ''}
  </section>`,
  ).join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Zerobyte Business - User guide</title><style>
    @page { size: A4; margin: 16mm 14mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: #14201a; font-size: 12.5px; line-height: 1.6; }
    header { border-bottom: 3px solid #087f45; padding-bottom: 14px; margin-bottom: 18px; }
    .brand { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 15px; }
    .mark { display: inline-grid; place-items: center; width: 30px; height: 30px; border-radius: 8px; background: #087f45; color: #fff; font-size: 17px; }
    h1 { margin: 14px 0 4px; font-size: 26px; line-height: 1.2; }
    header p { margin: 0; color: #56605a; }
    .toc { margin: 0 0 22px; padding: 14px 18px; border: 1px solid #dfe5e1; border-radius: 10px; background: #f7f9f8; break-after: page; }
    .toc strong { display: block; margin-bottom: 6px; }
    .toc ul { list-style: none; margin: 0; padding: 0; columns: 2; }
    .toc li { margin: 2px 0; }
    section { break-inside: avoid-page; margin: 0 0 22px; padding-top: 4px; }
    h2 { display: flex; align-items: center; gap: 10px; margin: 0 0 4px; font-size: 18px; }
    h2 span { display: inline-grid; place-items: center; min-width: 24px; height: 24px; padding: 0 6px; border-radius: 6px; background: #e4f3ea; color: #087f45; font-size: 13px; }
    .summary { margin: 0 0 10px; color: #56605a; }
    figure { margin: 0 0 10px; }
    img { display: block; width: 100%; max-height: 118mm; object-fit: contain; border: 1px solid #dfe5e1; border-radius: 8px; }
    figcaption { margin-top: 4px; color: #7d8780; font-size: 11px; }
    ol { margin: 0; padding-left: 20px; } li { margin: 3px 0; }
    .tip { margin: 10px 0 0; padding: 8px 12px; border-left: 3px solid #087f45; background: #f1f8f4; border-radius: 4px; }
    footer { margin-top: 16px; padding-top: 10px; border-top: 1px solid #dfe5e1; color: #7d8780; font-size: 11px; }
  </style></head><body>
    <header><div class="brand"><span class="mark">&oslash;</span> Zer&oslash;byte Business</div><h1>User guide</h1><p>Step-by-step help for running your business. Printed ${esc(today)}.</p></header>
    <div class="toc"><strong>Contents</strong><ul>${toc}</ul></div>
    ${body}
    <footer>Zer&oslash;byte Business &middot; This guide always has the latest version online at /guide.</footer>
  </body></html>`
}

export function printGuide() {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  const cleanup = () => window.setTimeout(() => frame.remove(), 1000)
  frame.onload = async () => {
    const doc = frame.contentDocument
    const win = frame.contentWindow
    if (!doc || !win) {
      cleanup()
      return
    }
    // Wait for the screenshots (max 6 seconds) so the PDF is never missing pictures.
    const pending = [...doc.images]
      .filter((image) => !image.complete)
      .map(
        (image) =>
          new Promise<void>((resolve) => {
            image.onload = image.onerror = () => resolve()
          }),
      )
    await Promise.race([Promise.all(pending), new Promise((resolve) => window.setTimeout(resolve, 6000))])
    win.focus()
    win.print()
    win.onafterprint = cleanup
    window.setTimeout(cleanup, 120000)
  }
  frame.srcdoc = buildDocument()
  document.body.appendChild(frame)
}
