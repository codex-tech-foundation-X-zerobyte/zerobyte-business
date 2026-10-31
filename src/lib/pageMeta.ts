import { useEffect } from 'react'
import { siteConfig } from './siteConfig'

// Sets the page title, description and canonical address for public pages (helps Google Search and link previews).
const setMeta = (selector: string, attribute: 'name' | 'property', key: string, content: string) => {
  let tag = document.head.querySelector<HTMLMetaElement>(selector)
  if (!tag) {
    tag = document.createElement('meta')
    tag.setAttribute(attribute, key)
    document.head.appendChild(tag)
  }
  tag.setAttribute('content', content)
}

export function usePageMeta({ title, description, path }: { title: string; description: string; path: string }) {
  useEffect(() => {
    const full = title.includes('Zerøbyte') ? title : `${title} | Zerøbyte Business`
    document.title = full
    setMeta('meta[name="description"]', 'name', 'description', description)
    setMeta('meta[property="og:title"]', 'property', 'og:title', full)
    setMeta('meta[property="og:description"]', 'property', 'og:description', description)
    const url = `${siteConfig.siteUrl}${path === '/' ? '/' : path}`
    setMeta('meta[property="og:url"]', 'property', 'og:url', url)
    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (!canonical) {
      canonical = document.createElement('link')
      canonical.rel = 'canonical'
      document.head.appendChild(canonical)
    }
    canonical.href = url
  }, [title, description, path])
}
