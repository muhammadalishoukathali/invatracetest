interface LogoProps {
  size?: number
}

/** The InvaTrace mark: a young plant observed through a field lens. */
export function Logo({ size = 40 }: LogoProps) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path d="M30.6 30.6 43 43" fill="none" stroke="currentColor" strokeWidth="6.5" strokeLinecap="round" />
      <circle cx="20.5" cy="20.5" r="15.5" fill="currentColor" />
      <circle cx="20.5" cy="20.5" r="13.75" fill="none" stroke="white" strokeOpacity="0.18" strokeWidth="1" />
      <path
        d="M20.5 28V14.3"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path d="M20.5 22.7c-5.2.1-8.25-2.35-8.85-7.2 5.05-.2 8.1 2.25 8.85 7.2Z" fill="#fff" />
      <path d="M20.5 20.2c5.1 0 8.1-2.5 8.75-7.3-5-.15-8 2.35-8.75 7.3Z" fill="#fff" />
    </svg>
  )
}

/** Horizontal brand lockup for headers and entry screens. */
export function LogoWordmark() {
  return (
    <div className="brand-lockup" aria-label="InvaTrace">
      <Logo size={36} />
      <span className="brand-wordmark">InvaTrace</span>
    </div>
  )
}
