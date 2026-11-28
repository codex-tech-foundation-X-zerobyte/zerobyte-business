import { appPath } from '../lib/routing'
import { siteConfig } from '../lib/siteConfig'

/** "Built by Sephry Tech (formerly Codex Tech Foundation)": shown on every public page so people and search engines see it. */
export function BuiltBy({ link = true }: { link?: boolean }) {
  const name = (
    <>
      Built by <strong>{siteConfig.builderName}</strong> <span>(formerly {siteConfig.builderFormerName})</span>
    </>
  )
  return <small className="built-by">{link ? <a href={appPath('/about')}>{name}</a> : name}</small>
}
