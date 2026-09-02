interface LogoProps {
  size?: number
}

/** InvaTrace app mark: a clover observed through a field lens. */
export function Logo({ size = 40 }: LogoProps) {
  return (
    <img
      className="brand-mark"
      src="/invatrace-logo-192.png"
      srcSet="/invatrace-logo-192.png 192w, /invatrace-logo-512.png 512w"
      sizes={`${size}px`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
    />
  )
}

/** Horizontal brand lockup for headers and entry screens. */
export function LogoWordmark() {
  return (
    <div className="brand-lockup" aria-label="InvaTrace">
      <Logo size={44} />
      <span className="brand-wordmark">InvaTrace</span>
    </div>
  )
}
