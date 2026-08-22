/** Grey shimmer block for cold-fetch loading. Uses inline keyframes so no
 *  extra CSS file is needed. */
export function Skeleton({ w = '100%', h = 12, radius = 6 }: {
  w?: number | string; h?: number | string; radius?: number
}) {
  return (
    <>
      <style>{SKELETON_CSS}</style>
      <span aria-hidden className="invatrace-skeleton" style={{
        display: 'block', width: w, height: h, borderRadius: radius,
      }} />
    </>
  )
}

const SKELETON_CSS = `
.invatrace-skeleton {
  background: linear-gradient(90deg, var(--bg-alt) 0%, var(--hover) 50%, var(--bg-alt) 100%);
  background-size: 200% 100%;
  animation: invatrace-skeleton-shimmer 1.2s linear infinite;
}
@keyframes invatrace-skeleton-shimmer { to { background-position: -200% 0 } }
`
