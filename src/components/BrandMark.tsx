import { appPath } from '../lib/routing'

/** The Zerøbyte symbol. Used wherever the product name appears next to a logo. */
export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <img
      className={`brand-logo ${className}`.trim()}
      src={appPath('/logo-mark.png')}
      alt=""
      width={40}
      height={27}
      decoding="async"
    />
  )
}
