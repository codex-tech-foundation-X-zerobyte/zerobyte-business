import { useEffect } from 'react'
import seo from './seoPages.json'
import { siteConfig } from './siteConfig'

// Sets the page title, description, canonical address and search-engine instructions for each page. The same wording is
// written into the built HTML of every public page (scripts/prepare-pages.mjs reads seoPages.json), so search engines,
// WhatsApp and social previews that do not run JavaScript see the right text too.

const setMeta = (attribute: 'name' | 'property', key: string, content: string) => {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`)
  if (!tag) {
    tag = document.createElement('meta')
    tag.setAttribute(attribute, key)
    document.head.appendChild(tag)
  }
  tag.setAttribute('content', content)
}

/** index = a public page search engines should list; noindex = a private or signed-in screen they must not. */
export function setRobots(mode: 'index' | 'noindex') {
  setMeta('name', 'robots', mode === 'index' ? 'index, follow, max-image-preview:large' : 'noindex, nofollow')
}

function usePageMeta({ title, description, path }: { title: string; description: string; path: string }) {
  useEffect(() => {
    const full = title.includes('Zerøbyte') ? title : `${title} | Zerøbyte Business`
    const url = `${siteConfig.siteUrl}${path === '/' ? '/' : path}`
    document.title = full
    setMeta('name', 'description', description)
    setMeta('property', 'og:title', full)
    setMeta('property', 'og:description', description)
    setMeta('property', 'og:url', url)
    setMeta('name', 'twitter:title', full)
    setMeta('name', 'twitter:description', description)
    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (!canonical) {
      canonical = document.createElement('link')
      canonical.rel = 'canonical'
      document.head.appendChild(canonical)
    }
    canonical.href = url
  }, [title, description, path])
}

/** The wording of one public page, from the shared list. */
export const usePublicPageMeta = (path: keyof typeof seo.indexable) =>
  usePageMeta({ title: seo.indexable[path].title, description: seo.indexable[path].description, path })
