/** Full-colour InvaTrace mark made from a search lens, leaves, and sighting
 *  ticks. The SVG scales without needing separate image files. */

interface LogoProps {
  size?: number
}

export function Logo({ size = 40 }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true"
         style={{ display: 'block', flexShrink: 0 }}>
      <circle cx="82" cy="82" r="66" fill="#FFFFFF" />
      <g stroke="#1B7A50" strokeWidth="4" strokeLinecap="round" opacity="0.35">
        <line x1="82" y1="16" x2="82" y2="27" />
        <line x1="148" y1="82" x2="137" y2="82" />
        <line x1="16" y1="82" x2="27" y2="82" />
      </g>
      <path d="M44 116 Q 82 126 120 116" stroke="#1B7A50" strokeWidth="3.5"
            strokeLinecap="round" fill="none" opacity="0.32" />
      <path d="M82 118 C 82 104, 81 92, 82 70" stroke="#1B7A50" strokeWidth="5.5"
            strokeLinecap="round" fill="none" />
      <path d="M82 96 C 68 100, 52 94, 44 78 C 60 70, 76 78, 82 96 Z" fill="#D9880F" />
      <path d="M82 96 C 72 90, 62 85, 50 79" stroke="#FFFFFF" strokeWidth="2.2"
            strokeLinecap="round" fill="none" opacity="0.7" />
      <path d="M82 82 C 98 82, 114 71, 120 52 C 103 47, 88 60, 82 82 Z" fill="#1B7A50" />
      <path d="M82 82 C 93 72, 104 63, 116 56" stroke="#FFFFFF" strokeWidth="2.2"
            strokeLinecap="round" fill="none" opacity="0.6" />
      <path d="M82 70 C 82 62, 85 55, 91 50" stroke="#1B7A50" strokeWidth="4.5"
            strokeLinecap="round" fill="none" />
      <circle cx="82" cy="82" r="66" fill="none" stroke="#1B7A50" strokeWidth="12" />
      <line x1="129" y1="129" x2="176" y2="176" stroke="#1B7A50" strokeWidth="16"
            strokeLinecap="round" />
    </svg>
  )
}

/** Horizontal brand lockup used when there is enough room for both the mark
 *  and the InvaTrace name. */
export function LogoWordmark({ size = 20 }: { size?: number }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.5 }}>
      <Logo size={size * 1.8} />
      <span style={{
        fontSize: size * 1.4, fontWeight: 600, letterSpacing: '-0.042em',
        lineHeight: 1, color: 'var(--green)',
      }}>
        inva<span style={{ fontWeight: 400, color: 'var(--ink)' }}>trace</span>
      </span>
    </div>
  )
}
