import { useMemo, useState } from 'react'
import { Icon } from '@/components/Icon'
import {
  findPlantGuidance,
  getSources,
  plantGuidanceDataset,
  type ActionPath,
  type GuidanceMode,
  type MalaysiaStatus,
  type PlantGuidance,
  type SourcedItem,
} from '@/data/plant-guidance'

interface Props {
  scientificName?: string | null
  speciesName?: string | null
  plantId?: string | null
  /** AC 1.2.3 — when explicitly false, active-removal steps must stay hidden
   *  regardless of the user's permission selection. Undefined = no server
   *  gate; the panel's own permission logic applies. */
  actionEligible?: boolean
}

type PermissionContext = 'unknown' | 'explicit_permission'

const MODE_COPY: Record<GuidanceMode, { label: string; tone: 'info' | 'warn' | 'danger' | 'ok'; help: string }> = {
  general_information: {
    label: 'General information only',
    tone: 'ok',
    help: 'InvaTrace provides identification background. No removal action is recommended.',
  },
  active_guidance: {
    label: 'Active guidance available',
    tone: 'warn',
    help: 'Choose the correct action path based on land status and permission.',
  },
  site_manager_confirmation_required: {
    label: 'Site manager confirmation required',
    tone: 'warn',
    help: 'Do not act until the responsible land manager has explicitly authorised the site.',
  },
  report_only: {
    label: 'Report only — do not remove',
    tone: 'danger',
    help: 'Record and report the sighting. Removal is out of scope for this species in InvaTrace.',
  },
}

const TONE_STYLES: Record<
  'info' | 'warn' | 'danger' | 'ok',
  { bg: string; border: string; color: string }
> = {
  info: { bg: 'var(--surface)', border: 'var(--border)', color: 'var(--body)' },
  warn: { bg: '#FEF3E2', border: '#F0D9A8', color: 'var(--amber)' },
  danger: { bg: 'var(--red-light)', border: 'var(--red-border)', color: 'var(--red)' },
  ok: { bg: 'var(--green-light)', border: 'var(--green-border)', color: 'var(--green)' },
}

export function PlantGuidancePanel({ scientificName, speciesName, plantId, actionEligible }: Props) {
  const plant = useMemo(
    () => findPlantGuidance({ scientificName, modelLabel: speciesName, plantId }),
    [scientificName, speciesName, plantId],
  )
  const [permission, setPermission] = useState<PermissionContext>('unknown')
  const [siteManagerConfirmed, setSiteManagerConfirmed] = useState(false)
  const [stopConditionsClear, setStopConditionsClear] = useState(false)

  if (!plant) {
    return <MissingGuidanceFallback speciesName={speciesName ?? scientificName ?? null} />
  }

  // AC 3.2.4 — every advertised source ID must resolve in the sources index.
  // Any dangling ID triggers observe-and-report fallback so the UI never shows
  // guidance whose provenance chain is broken.
  if (!hasResolvableSources(plant)) {
    if (typeof console !== 'undefined') {
      console.error(
        `Plant guidance for ${plant.plant_id} references sources absent from the registry — falling back to observe-and-report.`,
      )
    }
    return <MissingGuidanceFallback speciesName={speciesName ?? scientificName ?? null} />
  }

  const modeInfo = MODE_COPY[plant.guidance_mode]

  const activePathAllowed =
    actionEligible !== false
    && permission === 'explicit_permission'
    && plant.guidance_mode !== 'report_only'
    && plant.guidance_mode !== 'general_information'
    && (plant.guidance_mode !== 'site_manager_confirmation_required' || siteManagerConfirmed)
    && stopConditionsClear

  return (
    <section
      aria-labelledby="plant-guidance-heading"
      style={{
        marginTop: 24,
        padding: 16,
        borderRadius: 'var(--r-card)',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'flex-start', gap: 10, justifyContent: 'space-between' }}>
        <div>
          <h3 id="plant-guidance-heading" style={{ fontSize: 15, fontWeight: 700 }}>
            Malaysia plant guidance
          </h3>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
            Dataset v{plantGuidanceDataset.content_version} · {plantGuidanceDataset.jurisdiction}
            {plantGuidanceDataset.last_reviewed ? ` · reviewed ${plantGuidanceDataset.last_reviewed}` : ''}
          </p>
        </div>
        <StatusChip status={plant.malaysia_status} />
      </header>

      <ModeBanner mode={plant.guidance_mode} help={modeInfo.help} tone={modeInfo.tone} label={modeInfo.label} />

      <Block title="About this plant" icon="Info">
        <p style={{ fontSize: 13.5, color: 'var(--body)', lineHeight: 1.6 }}>{plant.general_information}</p>
        <SourceLine ids={plant.general_information_source_ids} />
      </Block>

      <Block title="Identification note" icon="Info">
        <p style={{ fontSize: 13, color: 'var(--body)', lineHeight: 1.6 }}>{plant.identification_note}</p>
      </Block>

      {plant.risk_flags.length > 0 && (
        <Block title="Risk flags" icon="AlertTriangle">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {plant.risk_flags.map((flag) => (
              <span
                key={flag}
                style={{
                  padding: '4px 10px',
                  borderRadius: 'var(--r-chip)',
                  fontSize: 11.5,
                  fontWeight: 600,
                  background: 'var(--red-light)',
                  color: 'var(--red)',
                  border: '1px solid var(--red-border)',
                }}
              >
                {flag}
              </span>
            ))}
          </div>
        </Block>
      )}

      {plant.actions && (
        <PermissionGate
          plant={plant}
          permission={permission}
          setPermission={(next) => {
            setPermission(next)
            if (next === 'unknown') {
              setSiteManagerConfirmed(false)
              setStopConditionsClear(false)
            }
          }}
          siteManagerConfirmed={siteManagerConfirmed}
          setSiteManagerConfirmed={setSiteManagerConfirmed}
          stopConditionsClear={stopConditionsClear}
          setStopConditionsClear={setStopConditionsClear}
        />
      )}

      {plant.actions && permission === 'unknown' && (
        <ActionPathBlock
          title="If protected or permission is unknown"
          icon="Shield"
          path={plant.actions.protected_or_permission_unknown}
          tone="danger"
          renderSteps
        />
      )}

      {plant.actions && activePathAllowed && (
        <ActionPathBlock
          title="Only on an authorised site"
          icon="ShieldCheck"
          path={plant.actions.authorised_site}
          tone="warn"
          renderSteps
        />
      )}

      {plant.actions && !activePathAllowed && permission === 'explicit_permission' && (
        <div
          role="note"
          style={{
            marginTop: 12,
            padding: '10px 14px',
            borderRadius: 'var(--r-input)',
            background: 'var(--bg-alt)',
            border: '1px solid var(--border)',
            fontSize: 12.5,
            color: 'var(--body)',
            lineHeight: 1.55,
          }}
        >
          Active steps stay hidden until every stop condition is cleared
          {plant.guidance_mode === 'site_manager_confirmation_required' && ' and the site-manager designation is confirmed'}.
        </div>
      )}

      <SpreadPreventionBlock items={plant.spread_prevention} />

      {plant.do_not_do.length > 0 && (
        <Block title="Do NOT do" icon="XOctagon" tone="danger">
          <SourcedList items={plant.do_not_do} tone="danger" />
        </Block>
      )}

      {plant.follow_up.length > 0 && (
        <Block title="Follow up" icon="Clock">
          <SourcedList items={plant.follow_up} />
        </Block>
      )}

      <SafetyPolicyFooter plant={plant} />
    </section>
  )
}

function MissingGuidanceFallback({ speciesName }: { speciesName: string | null }) {
  return (
    <section
      aria-labelledby="plant-guidance-heading"
      style={{
        marginTop: 24,
        padding: 16,
        borderRadius: 'var(--r-card)',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
      }}
    >
      <h3 id="plant-guidance-heading" style={{ fontSize: 15, fontWeight: 700 }}>
        Malaysia plant guidance
      </h3>
      <div
        role="note"
        style={{
          marginTop: 10,
          padding: '10px 14px',
          borderRadius: 'var(--r-input)',
          background: TONE_STYLES.warn.bg,
          border: `1px solid ${TONE_STYLES.warn.border}`,
        }}
      >
        <div style={{ fontSize: 12.5, fontWeight: 700, color: TONE_STYLES.warn.color }}>Observe and report only</div>
        <p style={{ marginTop: 4, fontSize: 12.5, color: 'var(--body)', lineHeight: 1.55 }}>
          {speciesName
            ? `No reviewed guidance record is available for ${speciesName} in this Malaysia dataset.`
            : 'No reviewed guidance record is available for this identification.'}{' '}
          Do not disturb the plant. Record it, photograph it and report the sighting so a reviewer can act.
        </p>
      </div>
    </section>
  )
}

function PermissionGate({
  plant,
  permission,
  setPermission,
  siteManagerConfirmed,
  setSiteManagerConfirmed,
  stopConditionsClear,
  setStopConditionsClear,
}: {
  plant: PlantGuidance
  permission: PermissionContext
  setPermission: (value: PermissionContext) => void
  siteManagerConfirmed: boolean
  setSiteManagerConfirmed: (value: boolean) => void
  stopConditionsClear: boolean
  setStopConditionsClear: (value: boolean) => void
}) {
  const canActEver = plant.guidance_mode === 'active_guidance'
    || plant.guidance_mode === 'site_manager_confirmation_required'
  const stopConditions = plant.actions?.authorised_site.stop_conditions ?? []

  return (
    <div
      role="group"
      aria-label="Permission and safety gate"
      style={{
        marginTop: 16,
        padding: '12px 14px',
        borderRadius: 'var(--r-input)',
        background: 'var(--bg-alt)',
        border: '1px solid var(--border)',
      }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--body)' }}>
        Do you have explicit permission to act at this site?
      </div>
      <p style={{ marginTop: 4, fontSize: 12, color: 'var(--muted)', lineHeight: 1.55 }}>
        Being outside a mapped protected area does not grant permission. Nearby OpenStreetMap features do not grant permission.
      </p>
      <div role="radiogroup" style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <RadioRow
          checked={permission === 'unknown'}
          onSelect={() => setPermission('unknown')}
          label="Protected land or permission unknown (default)"
        />
        <RadioRow
          checked={permission === 'explicit_permission'}
          onSelect={() => setPermission('explicit_permission')}
          disabled={!canActEver}
          label={
            canActEver
              ? 'I have explicit permission to act on this site'
              : 'Explicit-permission path is not available for this species'
          }
        />
      </div>

      {permission === 'explicit_permission' && plant.guidance_mode === 'site_manager_confirmation_required' && (
        <label
          style={{
            marginTop: 10, display: 'flex', gap: 8, alignItems: 'flex-start',
            fontSize: 12.5, color: 'var(--body)', lineHeight: 1.5,
          }}
        >
          <input
            type="checkbox"
            checked={siteManagerConfirmed}
            onChange={(event) => setSiteManagerConfirmed(event.target.checked)}
          />
          <span>
            The site manager has designated <em>{plant.scientific_name}</em> for action at this exact site.
          </span>
        </label>
      )}

      {permission === 'explicit_permission' && stopConditions.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--red)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Stop conditions — read before acting
          </div>
          <SourcedList items={stopConditions} tone="danger" />
          <label
            style={{
              marginTop: 8, display: 'flex', gap: 8, alignItems: 'flex-start',
              fontSize: 12.5, color: 'var(--body)', lineHeight: 1.5,
            }}
          >
            <input
              type="checkbox"
              checked={stopConditionsClear}
              onChange={(event) => setStopConditionsClear(event.target.checked)}
            />
            <span>I have read the stop conditions and none of them apply here.</span>
          </label>
          <p style={{ marginTop: 6, fontSize: 11.5, color: 'var(--muted)' }}>
            If any condition applies, leave this unchecked. The panel switches back to observation and reporting only.
          </p>
        </div>
      )}
    </div>
  )
}

function RadioRow({
  checked,
  onSelect,
  disabled,
  label,
}: {
  checked: boolean
  onSelect: () => void
  disabled?: boolean
  label: string
}) {
  return (
    <label
      style={{
        display: 'flex', gap: 8, alignItems: 'flex-start',
        fontSize: 12.5, color: disabled ? 'var(--muted)' : 'var(--body)',
        lineHeight: 1.5, cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <input
        type="radio"
        checked={checked}
        onChange={onSelect}
        disabled={disabled}
        style={{ marginTop: 2 }}
      />
      <span>{label}</span>
    </label>
  )
}

function StatusChip({ status }: { status: MalaysiaStatus }) {
  const isInvasive = /invasive/i.test(status.category) || /invasive/i.test(status.display_label)
  const tone = isInvasive ? TONE_STYLES.danger : TONE_STYLES.ok
  return (
    <span
      title={status.note}
      style={{
        display: 'inline-block',
        padding: '4px 10px',
        borderRadius: 'var(--r-chip)',
        fontSize: 11,
        fontWeight: 700,
        background: tone.bg,
        color: tone.color,
        border: `1px solid ${tone.border}`,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        whiteSpace: 'nowrap',
      }}
    >
      {status.display_label}
    </span>
  )
}

function ModeBanner({
  mode: _mode,
  label,
  help,
  tone,
}: {
  mode: GuidanceMode
  label: string
  help: string
  tone: 'info' | 'warn' | 'danger' | 'ok'
}) {
  const style = TONE_STYLES[tone]
  return (
    <div
      role="note"
      style={{
        marginTop: 12,
        padding: '10px 14px',
        borderRadius: 'var(--r-input)',
        background: style.bg,
        border: `1px solid ${style.border}`,
      }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 700, color: style.color, letterSpacing: '0.02em' }}>{label}</div>
      <p style={{ marginTop: 4, fontSize: 12.5, color: 'var(--body)', lineHeight: 1.55 }}>{help}</p>
    </div>
  )
}

function ActionPathBlock({
  title,
  icon,
  path,
  tone,
  renderSteps,
}: {
  title: string
  icon: string
  path: ActionPath
  tone: 'warn' | 'danger'
  renderSteps: boolean
}) {
  const style = TONE_STYLES[tone]
  return (
    <div
      style={{
        marginTop: 18,
        padding: 14,
        borderRadius: 'var(--r-input)',
        background: style.bg,
        border: `1px solid ${style.border}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <Icon name={icon} size={16} color={style.color} />
        <h4 style={{ fontSize: 13.5, fontWeight: 700, color: style.color }}>{title}</h4>
      </div>
      <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--body)' }}>{path.title}</div>
      <p style={{ marginTop: 4, fontSize: 12.5, color: 'var(--body)', lineHeight: 1.55 }}>{path.eligibility}</p>

      {renderSteps && path.steps.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Steps
          </div>
          <ol style={{ paddingLeft: 18, fontSize: 13, color: 'var(--body)', lineHeight: 1.65, marginTop: 6 }}>
            {path.steps.map((step, index) => (
              <li key={index} style={{ marginBottom: 6 }}>
                {step.text}
                <SourceLine ids={step.source_ids} inline />
              </li>
            ))}
          </ol>
        </div>
      )}

      {renderSteps && path.stop_conditions.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--red)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Stop conditions (recap)
          </div>
          <SourcedList items={path.stop_conditions} tone="danger" />
        </div>
      )}

      {renderSteps && path.disposal.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Disposal
          </div>
          <SourcedList items={path.disposal} />
        </div>
      )}
    </div>
  )
}

function SpreadPreventionBlock({ items }: { items: SourcedItem[] }) {
  if (items.length === 0) {
    return (
      <Block title="Spread prevention" icon="ShieldCheck">
        <p style={{ fontSize: 13, color: 'var(--body)', lineHeight: 1.6 }}>
          Do not disturb; report the sighting instead.
        </p>
      </Block>
    )
  }
  return (
    <Block title="Spread prevention" icon="ShieldCheck">
      <SourcedList items={items} />
    </Block>
  )
}

function Block({
  title,
  icon,
  tone,
  children,
}: {
  title: string
  icon: string
  tone?: 'info' | 'warn' | 'danger' | 'ok'
  children: React.ReactNode
}) {
  const style = tone ? TONE_STYLES[tone] : TONE_STYLES.info
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <Icon name={icon} size={16} color={style.color} />
        <h4 style={{ fontSize: 13.5, fontWeight: 650, color: 'var(--body)' }}>{title}</h4>
      </div>
      {children}
    </div>
  )
}

function SourcedList({ items, tone }: { items: SourcedItem[]; tone?: 'danger' }) {
  return (
    <ul
      style={{
        marginTop: 6,
        paddingLeft: 18,
        fontSize: 13,
        color: tone === 'danger' ? 'var(--red)' : 'var(--body)',
        lineHeight: 1.65,
      }}
    >
      {items.map((item, index) => (
        <li key={index} style={{ marginBottom: 4 }}>
          {item.text}
          <SourceLine ids={item.source_ids} inline />
        </li>
      ))}
    </ul>
  )
}

function SourceLine({ ids, inline }: { ids: string[]; inline?: boolean }) {
  if (!ids || ids.length === 0) return null
  const sources = getSources(ids)
  if (sources.length === 0) return null
  return (
    <span
      style={{
        display: inline ? 'inline' : 'block',
        marginLeft: inline ? 6 : 0,
        marginTop: inline ? 0 : 4,
        fontSize: 11,
        color: 'var(--muted)',
      }}
    >
      {sources.map((src, index) => (
        <span key={src.source_id}>
          {index > 0 && ' · '}
          <a
            href={src.url}
            target="_blank"
            rel="noopener noreferrer"
            title={`${src.title} — ${src.publisher}`}
            style={{ color: 'var(--muted)', textDecoration: 'underline' }}
          >
            [{src.source_id}]
          </a>
        </span>
      ))}
    </span>
  )
}

function SafetyPolicyFooter({ plant }: { plant: PlantGuidance }) {
  const policy = plantGuidanceDataset.safety_policy
  return (
    <details
      style={{
        marginTop: 18,
        padding: '10px 12px',
        borderRadius: 'var(--r-input)',
        background: 'var(--bg-alt)',
        border: '1px solid var(--border)',
      }}
    >
      <summary style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: 'var(--body)' }}>
        Safety policy &amp; sources
      </summary>
      <div style={{ marginTop: 10, fontSize: 12, color: 'var(--body)', lineHeight: 1.6 }}>
        <p><strong>Model:</strong> {policy.model_rule}</p>
        <p style={{ marginTop: 6 }}><strong>Permission:</strong> {policy.permission_rule}</p>
        {policy.protected_land_rule && (
          <p style={{ marginTop: 6 }}><strong>Protected land:</strong> {policy.protected_land_rule}</p>
        )}
        {policy.never_recommend?.length > 0 && (
          <>
            <p style={{ marginTop: 8, fontWeight: 700 }}>Never recommend</p>
            <ul style={{ paddingLeft: 18 }}>
              {policy.never_recommend.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </>
        )}
        <p style={{ marginTop: 10, fontWeight: 700 }}>Cited sources for this plant</p>
        <ul style={{ paddingLeft: 18 }}>
          {getSources(collectSourceIds(plant)).map((src) => (
            <li key={src.source_id}>
              [{src.source_id}]{' '}
              <a href={src.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--body)' }}>
                {src.title}
              </a>{' '}
              — <span style={{ color: 'var(--muted)' }}>{src.publisher}</span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  )
}

function hasResolvableSources(plant: PlantGuidance): boolean {
  const ids = collectSourceIds(plant)
  if (ids.length === 0) return false
  const resolved = new Set(getSources(ids).map((s) => s.source_id))
  return ids.every((id) => resolved.has(id))
}

function collectSourceIds(plant: PlantGuidance): string[] {
  const ids: string[] = []
  ids.push(...plant.malaysia_status.source_ids)
  ids.push(...plant.general_information_source_ids)
  const pushItems = (items: SourcedItem[]) => items.forEach((item) => ids.push(...item.source_ids))
  pushItems(plant.spread_prevention)
  pushItems(plant.do_not_do)
  pushItems(plant.follow_up)
  if (plant.actions) {
    for (const key of ['protected_or_permission_unknown', 'authorised_site'] as const) {
      const path = plant.actions[key]
      pushItems(path.steps)
      pushItems(path.stop_conditions)
      pushItems(path.disposal)
    }
  }
  return ids
}
