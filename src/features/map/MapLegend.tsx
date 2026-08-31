import { useEffect, useState } from 'react'
import { Icon } from '@/components/Icon'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import './map-controls.css'

/**
 * Map legend. Desktop shows the card inline in the bottom-left corner.
 * Mobile shows a small "Legend" pill that expands into a centered card
 * anchored above the scan button, so the reveal reads as a proper popover
 * rather than a small tooltip crammed against the map edge.
 */
export function MapLegend() {
  const isDesktop = useIsDesktop()
  const [open, setOpen] = useState(isDesktop)

  // If the viewport crosses the desktop breakpoint, keep the legend visible on
  // desktop and collapsed on mobile so the state matches what the layout expects.
  useEffect(() => { setOpen(isDesktop) }, [isDesktop])

  // Close the mobile popover when the user presses Escape.
  useEffect(() => {
    if (isDesktop || !open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isDesktop, open])

  if (!isDesktop && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Show map legend"
        aria-expanded="false"
        className="map-legend-toggle"
      >
        <Icon name="Info" size={14} color="var(--body)" />
        Legend
      </button>
    )
  }

  const card = (
    <div
      role={isDesktop ? undefined : 'dialog'}
      aria-label={isDesktop ? undefined : 'Map legend'}
      aria-modal={isDesktop ? undefined : 'false'}
      className={`map-legend-card${isDesktop ? '' : ' map-legend-card--popover'}`}
    >
      <div className="map-legend-card__header">
        <span className="map-legend-card__title">Legend</span>
        {!isDesktop && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Hide legend"
            className="map-legend-card__close"
          >
            <Icon name="X" size={14} color="var(--muted)" />
          </button>
        )}
      </div>
      <Row colour="#C2412D" label="Hotspot (5+ reports)" />
      <Row colour="#D9880F" label="Spreading (2–4 reports)" />
      <Row colour="#2E7D3F" label="Isolated (1 report)" />
      <Row colour="#8B978F" label="Removed" muted />
      <p className="map-legend-card__note">
        Colour reflects how many community reports share the same spot.
        Reports appear once they pass automated checks.
      </p>
    </div>
  )

  // On mobile the popover overlays the map with a light scrim so the tap-outside
  // gesture is discoverable. Clicking the scrim closes the popover.
  if (!isDesktop) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-hidden
          tabIndex={-1}
          className="map-legend-scrim"
        />
        {card}
      </>
    )
  }

  return card
}

function Row({ colour, label, muted }: { colour: string; label: string; muted?: boolean }) {
  return (
    <div className="map-legend-card__row">
      <span aria-hidden className="map-legend-card__dot" style={{ background: colour, opacity: muted ? 0.65 : 1 }} />
      <span>{label}</span>
    </div>
  )
}
