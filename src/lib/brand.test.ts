import { describe, expect, it } from 'vitest'
import brand from './brand.json'
import policies from '../features/public/policies.json'
import seo from './seoPages.json'
import { builderNameWithHistory, builtByStatement, siteConfig } from './siteConfig'

// The builder's name appears on the landing page, the legal pages, the footers, the search-engine tags and the build
// script. They all read brand.json; these checks make sure nobody can quietly change one and leave the others behind.
describe('who builds Zerøbyte Business', () => {
  it('uses one source for the name', () => {
    expect(brand.builder.name).toBe('Sephry Tech')
    expect(brand.builder.formerName).toBe('Codex Tech Foundation')
    expect(siteConfig.builderName).toBe(brand.builder.name)
    expect(siteConfig.builderFormerName).toBe(brand.builder.formerName)
  })
  it('says it the same way everywhere', () => {
    expect(builtByStatement).toBe('Zerøbyte Business is built by Sephry Tech, formerly known as Codex Tech Foundation.')
    expect(builderNameWithHistory).toBe('Sephry Tech (formerly Codex Tech Foundation)')
  })
  it('has an About page for people and search engines, with both names', () => {
    const about = policies.about
    expect(about.title).toContain('Sephry Tech')
    expect(about.intro).toBe(builtByStatement)
    expect(JSON.stringify(about.sections)).toContain('Codex Tech Foundation')
    const page = seo.indexable['/about' as keyof typeof seo.indexable] as {
      title: string
      description: string
      intro: string
    }
    expect(page.title).toContain('Sephry Tech')
    expect(page.title).toContain('Codex Tech Foundation')
    expect(page.description).toContain('Sephry Tech')
    expect(page.intro).toBe(builtByStatement)
  })
  it('only accepts a safe https address for the builder website', () => {
    expect(siteConfig.builderUrl === '' || siteConfig.builderUrl.startsWith('https://')).toBe(true)
  })
})
