import { Icon } from '@/components/Icon'
import { useReportDraft } from '@/features/report/report-draft-store'
import type { ExtentSize } from '@/types'
import { ReportNextButton } from './components/ReportNextButton'

const EXTENT_OPTIONS: { value: ExtentSize; title: string; desc: string; ha: string }[] = [
  { value: 'single', title: 'Single plant', desc: 'A lone specimen you can easily point at.', ha: '~1 m²' },
  { value: 'small_patch', title: 'Small patch', desc: 'A cluster you could walk around in under a minute.', ha: '5–50 m²' },
  { value: 'large_area', title: 'Large area', desc: 'Spread widely — needs a crew to survey.', ha: '> 500 m²' },
]

export function ReportExtentStep() {
  const { draft, setExtent, setNotes, next } = useReportDraft()
  if (!draft) return null

  return (
    <div style={{ padding: 16, maxWidth: 520, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ fontSize: 14, color: 'var(--body)', lineHeight: 1.6 }}>
        Roughly how much of this species is present? This helps the shared record describe the scale accurately.
      </p>

      <div role="radiogroup" aria-label="Extent" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {EXTENT_OPTIONS.map((opt) => {
          const selected = draft.extent === opt.value
          return (
            <label
              key={opt.value} className="radio-card"
              style={{
                textAlign: 'left', padding: '14px 16px', borderRadius: 'var(--r-card)',
                background: selected ? 'var(--green-light)' : 'var(--surface)',
                border: `1px solid ${selected ? 'var(--green)' : 'var(--control-border)'}`,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12,
              }}
            >
              <input className="sr-only" type="radio" name="extent" value={opt.value}
                checked={selected} onChange={() => setExtent(opt.value)} />
              <div style={{
                width: 40, height: 40, borderRadius: '50%',
                background: selected ? 'var(--green)' : 'var(--bg-alt)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <Icon name="Grid3x3" size={20} color={selected ? '#fff' : 'var(--body)'} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{opt.title}</span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{opt.ha}</span>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5 }}>
                  {opt.desc}
                </div>
              </div>
              {selected && <Icon name="Check" size={20} color="var(--green)" />}
            </label>
          )
        })}
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--body)' }}>
          Notes <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span>
        </span>
        <textarea
          value={draft.notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={280}
          rows={3}
          placeholder="Landmarks, access, urgency…"
          className="field-shell" style={{
            padding: '10px 12px', borderRadius: 'var(--r-input)',
            border: '1px solid var(--control-border)', background: 'var(--surface)',
            fontSize: 14, fontFamily: 'var(--font-sans)', color: 'var(--ink)',
            resize: 'vertical', lineHeight: 1.5,
          }}
        />
        <span style={{ fontSize: 11, color: 'var(--muted)', alignSelf: 'flex-end' }}>
          {draft.notes.length}/280
        </span>
      </label>

      <ReportNextButton onClick={next} label="Continue" />
    </div>
  )
}
