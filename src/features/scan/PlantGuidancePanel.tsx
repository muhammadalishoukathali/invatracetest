import { useEffect, useMemo, useState } from 'react'
import { Icon } from '@/components/Icon'
import {
  getGuidanceDecision,
  saveGuidanceDecision,
  type GuidanceDecision,
} from '@/features/scan/guidance-decision-store'
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
import {
  catalogueSourceById,
  catalogueVersion,
  findPlantStatus,
  type PlantStatusRecord,
} from '@shared/catalogue'

interface Props {
  scientificName?: string | null
  speciesName?: string | null
  plantId?: string | null
  /** When this comes back explicitly false, I hide the active-removal steps no
   *  matter what the user picked in the permission radio. Undefined means there's
   *  no server-side gate at all, so it just falls back to the panel's own logic. */
  actionEligible?: boolean
  /** The map sheet already shows this image as its hero, so I let it turn the
   *  duplicate off here. Scan results just keep the default (true). */
  showReferenceImage?: boolean
  /** Either a scan capture id or a map sighting id. The permission choice tied to
   *  this gets saved as a private note on the device only - it's not touching any
   *  official land status, just remembering what the user picked. */
  decisionContext?: { id: string; kind: 'scan' | 'sighting' }
}

type PermissionContext = 'unknown' | 'explicit_permission'
type PermissionChoice = PermissionContext | 'none'

const MODE_COPY: Record<GuidanceMode, { label: string; tone: 'info' | 'warn' | 'danger' | 'ok'; help: string }> = {
  general_information: {
    label: 'Identification only',
    tone: 'ok',
    help: 'Use this result to learn about the plant. Do not remove it based on this scan.',
  },
  active_guidance: {
    label: 'Check before acting',
    tone: 'warn',
    help: 'Before touching the plant, check who manages the land and whether you have permission.',
  },
  site_manager_confirmation_required: {
    label: 'Land manager approval needed',
    tone: 'warn',
    help: 'Leave the plant alone until the land manager approves work at this exact site.',
  },
  report_only: {
    label: 'Report this plant. Do not remove it.',
    tone: 'danger',
    help: 'Take clear photos and report the sighting. InvaTrace does not provide removal steps for this species.',
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

/**
 * This is the big one - it shows the Malaysia status, the identification
 * caveats, and then, only once the user has answered the permission question,
 * the actual removal/reporting steps for whatever plant got matched. It's
 * reused on both ScanResultPage after a scan and on the map's sighting detail
 * sheet, which is the whole reason props like showReferenceImage and
 * decisionContext exist - the same guidance content but the two screens need
 * slightly different framing around it. If there's no guidance entry for the
 * plant, or the sources it points to can't be resolved, it falls back to a
 * plain observe-and-report notice instead of showing broken/half-sourced advice.
 */
export function PlantGuidancePanel({
  scientificName,
  speciesName,
  plantId,
  actionEligible,
  showReferenceImage = true,
  decisionContext,
}: Props) {
  const plant = useMemo(
    () => findPlantGuidance({ scientificName, modelLabel: speciesName, plantId }),
    [scientificName, speciesName, plantId],
  )
  // No action path should show up until the user has actually made a permission
  // choice - otherwise it's too easy to skim past and remove something you
  // shouldn't have.
  const decisionContextId = decisionContext?.id
  const initialDecision = useMemo(
    () => decisionContextId ? getGuidanceDecision(decisionContextId) : null,
    [decisionContextId],
  )
  const [permission, setPermission] = useState<PermissionChoice>(() => decisionToPermission(initialDecision))
  const [savedDecision, setSavedDecision] = useState<GuidanceDecision | null>(initialDecision)
  const [saveFailed, setSaveFailed] = useState(false)
  const [siteManagerConfirmed, setSiteManagerConfirmed] = useState(false)
  const [stopConditionsClear, setStopConditionsClear] = useState(false)

  useEffect(() => {
    setPermission(decisionToPermission(initialDecision))
    setSavedDecision(initialDecision)
    setSaveFailed(false)
    setSiteManagerConfirmed(false)
    setStopConditionsClear(false)
  }, [initialDecision])

  if (!plant) {
    // Even if there's no reviewed guidance card for this plant, I still want to
    // fall back to the shared catalogue so the user gets the status chip, the
    // safety message, and where it came from - rather than nothing at all,
    // which matters for the offline case too.
    const catalogueRecord = findPlantStatus({
      speciesId: plantId ?? null,
      scientificName: scientificName ?? null,
      modelLabel: speciesName ?? null,
    })
    return (
      <MissingGuidanceFallback
        speciesName={speciesName ?? scientificName ?? null}
        catalogueRecord={catalogueRecord}
      />
    )
  }

  // If even one source id on this plant can't be resolved, I don't trust the
  // rest of it either - better to drop to the safe observe-and-report fallback
  // than show guidance where part of the provenance chain is broken.
  if (!hasResolvableSources(plant)) {
    if (typeof console !== 'undefined') {
      console.error(
        `Plant guidance for ${plant.plant_id} references sources absent from the registry - falling back to observe-and-report.`,
      )
    }
    const catalogueRecord = findPlantStatus({
      speciesId: plant.plant_id,
      scientificName: plant.scientific_name,
      modelLabel: plant.model_label,
    })
    return (
      <MissingGuidanceFallback
        speciesName={speciesName ?? scientificName ?? null}
        catalogueRecord={catalogueRecord}
      />
    )
  }

  const modeInfo = MODE_COPY[plant.guidance_mode]

  // AC 3.3.4 fail-closed: undefined / null must NOT unlock the active
  // path. Require an explicit ``true`` from the caller.
  const activePathAllowed =
    actionEligible === true
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
      <header style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
        <h3 id="plant-guidance-heading" style={{ fontSize: 15, fontWeight: 700 }}>
          Guidance for Malaysia
        </h3>
        <StatusChip status={plant.malaysia_status} />
      </header>

      <ModeBanner help={modeInfo.help} tone={modeInfo.tone} label={modeInfo.label} />

      {showReferenceImage && plant.reference_image && (
        <figure style={{ margin: '12px 0 0' }}>
          <img
            src={plant.reference_image}
            alt={`Reference photo of ${plant.scientific_name}`}
            loading="lazy"
            style={{
              width: '100%', maxHeight: 220, objectFit: 'cover',
              borderRadius: 'var(--r-input)', display: 'block',
            }}
          />
          <figcaption style={{ marginTop: 4, fontSize: 10.5, color: 'var(--muted)' }}>
            Reference photo · {plant.reference_image_credit ?? 'Wikimedia'}
          </figcaption>
        </figure>
      )}

      <Block title="About this plant" icon="Info">
        <p style={{ fontSize: 13.5, color: 'var(--body)', lineHeight: 1.6 }}>{plant.general_information}</p>
        <SourceLine ids={plant.general_information_source_ids} />
      </Block>

      <Block title="Check the match" icon="Info">
        <p style={{ fontSize: 13, color: 'var(--body)', lineHeight: 1.6 }}>
          {naturalIdentificationNote(plant.identification_note)}
        </p>
      </Block>

      {plant.risk_flags.length > 0 && (
        <Block title="Things to watch for" icon="AlertTriangle">
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
            if (decisionContext && next !== 'none') {
              const saved = saveGuidanceDecision({
                contextId: decisionContext.id,
                choice: next === 'unknown' ? 'protected_or_unsure' : 'manager_permission',
                plantId: plant.plant_id,
              })
              setSavedDecision(saved)
              setSaveFailed(!saved)
            }
            if (next !== 'explicit_permission') {
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

      {plant.actions && decisionContext && permission !== 'none' && (
        <DecisionSaveNote
          contextKind={decisionContext.kind}
          decision={savedDecision}
          saveFailed={saveFailed}
        />
      )}

      {plant.actions && permission === 'none' && (
        <div
          role="note"
          style={{
            marginTop: 12, padding: '12px 14px',
            borderRadius: 'var(--r-input)',
            background: '#FFF9ED', border: '1px solid #E8C879',
            fontSize: 13, color: 'var(--body)', lineHeight: 1.55,
          }}
        >
          Choose one option above to see what you can safely do here.
        </div>
      )}

      {plant.actions && permission === 'unknown' && (
        <ActionPathBlock
          title="Protected land or no permission"
          icon="Shield"
          path={plant.actions.protected_or_permission_unknown}
          tone="danger"
          renderSteps
        />
      )}

      {plant.actions && activePathAllowed && (
        <ActionPathBlock
          title="If the land manager has approved it"
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
          Removal steps will appear after you confirm every safety check
          {plant.guidance_mode === 'site_manager_confirmation_required' && ' and the land manager has approved this plant for removal'}.
        </div>
      )}

      <SpreadPreventionBlock items={plant.spread_prevention} />

      {plant.do_not_do.length > 0 && (
        <Block title="Avoid these actions" icon="XOctagon" tone="danger">
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

function MissingGuidanceFallback({
  speciesName,
  catalogueRecord,
}: {
  speciesName: string | null
  catalogueRecord: PlantStatusRecord | null
}) {
  // A species can exist in the shared catalogue (status + safety message) without
  // having a full reviewed-guidance card yet - that gap is the whole reason this
  // fallback function exists. Rather than show a bare "observe and report" box
  // that throws away info we actually have, pull the catalogue's note in here so
  // the user still sees the status and where it's sourced from.
  const uiStatePresentation = catalogueRecord
    ? UI_STATE_FALLBACK_PRESENTATION[catalogueRecord.ui_state]
    : null
  const sources = (catalogueRecord?.status_source_ids ?? [])
    .map((id) => catalogueSourceById(id))
    .filter((source): source is NonNullable<typeof source> => Boolean(source))
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
      <header style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
        <h3 id="plant-guidance-heading" style={{ fontSize: 15, fontWeight: 700 }}>
          Guidance for Malaysia
        </h3>
        {uiStatePresentation && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 10px', borderRadius: 'var(--r-chip)',
            fontSize: 11.5, fontWeight: 700,
            background: uiStatePresentation.bg,
            border: `1px solid ${uiStatePresentation.border}`,
            color: uiStatePresentation.color,
          }}>{uiStatePresentation.label}</span>
        )}
      </header>
      <div
        role="note"
        style={{
          marginTop: 12,
          padding: '10px 14px',
          borderRadius: 'var(--r-input)',
          background: TONE_STYLES.warn.bg,
          border: `1px solid ${TONE_STYLES.warn.border}`,
        }}
      >
        <div style={{ fontSize: 12.5, fontWeight: 700, color: TONE_STYLES.warn.color }}>Observe and report only</div>
        <p style={{ marginTop: 4, fontSize: 12.5, color: 'var(--body)', lineHeight: 1.55 }}>
          {catalogueRecord?.safety_message
            || (speciesName
              ? `We do not have reviewed guidance for ${speciesName} yet. Leave it where it is. Take clear photos and report the sighting for review.`
              : 'We do not have reviewed guidance for this plant yet. Leave it where it is. Take clear photos and report the sighting for review.')}
        </p>
      </div>
      {catalogueRecord && (
        <p style={{ marginTop: 10, fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.55 }}>
          Status from InvaTrace catalogue {catalogueVersion()}
          {catalogueRecord.status_reviewed_at
            ? ` · reviewed ${catalogueRecord.status_reviewed_at}`
            : ''}
          {sources.length > 0 && (
            <>
              {' · sources: '}
              {sources.map((source, index) => (
                <span key={source.source_id}>
                  {index > 0 ? ', ' : ''}[{source.source_id}]{' '}
                  <a href={source.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--body)' }}>
                    {source.title}
                  </a>
                </span>
              ))}
            </>
          )}
        </p>
      )}
    </section>
  )
}

// Chip colours/labels for the catalogue-only fallback above. Kept right next to
// the function that uses it so the invasive/info-only/uncertain mapping stays
// one obvious block instead of being scattered somewhere else in the file.
const UI_STATE_FALLBACK_PRESENTATION: Record<
  PlantStatusRecord['ui_state'],
  { label: string; bg: string; border: string; color: string }
> = {
  invasive: {
    label: 'Invasive in Malaysia',
    bg: 'var(--red-light)', border: 'var(--red-border)', color: 'var(--red)',
  },
  information_only: {
    label: 'Information only',
    bg: '#EEF3F7', border: '#D5DEE7', color: '#2F5F86',
  },
  status_uncertain: {
    label: 'Status uncertain',
    bg: '#FEF3E2', border: '#F0D9A8', color: 'var(--amber)',
  },
}

function naturalIdentificationNote(note: string): string {
  if (note === 'Treat the model result as a suggestion. Check diagnostic features and obtain site approval before acting.') {
    return 'A photo is not enough to confirm the species. Compare the leaves, stems and flowers before doing anything, and ask the land manager first.'
  }
  return note
}

function decisionToPermission(decision: GuidanceDecision | null): PermissionChoice {
  // Until the user has actually made a permission choice for this scan, treat it
  // as "protected land or permission unknown" by default - that's the safer
  // assumption. The observe/photograph/report guidance shows straight away from
  // that path either way; active removal stays locked behind an explicit choice
  // plus the safety checks further down.
  if (!decision) return 'unknown'
  return decision.choice === 'protected_or_unsure' ? 'unknown' : 'explicit_permission'
}

function DecisionSaveNote({
  contextKind,
  decision,
  saveFailed,
}: {
  contextKind: 'scan' | 'sighting'
  decision: GuidanceDecision | null
  saveFailed: boolean
}) {
  if (saveFailed || !decision) {
    return (
      <p role="status" style={{ marginTop: 10, fontSize: 12, color: 'var(--red-text)', lineHeight: 1.5 }}>
        This choice is active for now, but this browser could not save it.
      </p>
    )
  }
  const choice = decision.choice === 'protected_or_unsure'
    ? 'Protected land or unsure'
    : 'Land manager permission confirmed'
  return (
    <div role="status" style={{
      marginTop: 10, padding: '10px 12px', borderRadius: 'var(--r-input)',
      background: 'var(--green-light)', border: '1px solid var(--green-border)',
      fontSize: 12, color: 'var(--body)', lineHeight: 1.5,
    }}>
      <strong>Saved on this device for this {contextKind}:</strong> {choice}.
      {decision.choice === 'protected_or_unsure' && (
        <> This records that you chose the cautious path; it does not mark the land as officially protected.</>
      )}
    </div>
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
  permission: PermissionChoice
  setPermission: (value: PermissionChoice) => void
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
        marginTop: 18,
        padding: '16px',
        borderRadius: 'var(--r-card)',
        background: '#FFF9ED',
        border: '2px solid #E8C879',
        boxShadow: '0 8px 22px rgb(136 93 12 / 10%)',
      }}
    >
      <div>
        <div style={{ fontSize: 11, fontWeight: 750, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Before you act
        </div>
        <div style={{ marginTop: 2, fontSize: 16, fontWeight: 750, color: 'var(--heading)', lineHeight: 1.3 }}>
          Do you have permission at this site?
        </div>
      </div>
      <p style={{ marginTop: 10, fontSize: 13.5, color: 'var(--body)', lineHeight: 1.6 }}>
        If the land is protected, or you are unsure, do not touch or remove the plant. Photograph it and report the sighting instead. A map boundary does not prove that you have permission.
      </p>
      <div role="radiogroup" style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <RadioRow
          checked={permission === 'unknown'}
          onSelect={() => setPermission('unknown')}
          label="This is protected land, or I am not sure"
        />
        <RadioRow
          checked={permission === 'explicit_permission'}
          onSelect={() => setPermission('explicit_permission')}
          disabled={!canActEver}
          label={
            canActEver
              ? 'I have permission from the land manager'
              : 'Removal is not allowed for this species'
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
            The land manager has approved removal of <em>{plant.scientific_name}</em> at this exact site.
          </span>
        </label>
      )}

      {permission === 'explicit_permission' && stopConditions.length > 0 && (
        <StopConditionsGate
          conditions={stopConditions}
          allClear={stopConditionsClear}
          setAllClear={setStopConditionsClear}
        />
      )}
    </div>
  )
}

// Each stop condition gets its own checkbox instead of one bulk "none apply"
// checkbox. The reasoning: with a single bulk checkbox it was too easy for
// someone to tick it without actually reading each condition, which could
// unlock active steps when one specific condition genuinely did apply. So
// ticking any individual condition here immediately hides the active steps
// (setAllClear(false)), and the "none of these apply" confirmation stays
// disabled until every triggered condition gets cleared again.
function StopConditionsGate({
  conditions,
  allClear,
  setAllClear,
}: {
  conditions: { text: string; source_ids: string[] }[] | string[]
  allClear: boolean
  setAllClear: (value: boolean) => void
}) {
  const [triggered, setTriggered] = useState<Set<number>>(new Set())
  const anyTriggered = triggered.size > 0
  useEffect(() => {
    if (anyTriggered && allClear) setAllClear(false)
  }, [anyTriggered, allClear, setAllClear])
  const toggle = (index: number) => {
    const next = new Set(triggered)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    setTriggered(next)
  }
  return (
    <div style={{ marginTop: 12 }} role="group" aria-label="Stop conditions">
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--red)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Stop and leave the plant if any of these apply
      </div>
      <ul style={{ marginTop: 8, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {conditions.map((condition, index) => {
          const text = typeof condition === 'string' ? condition : condition.text
          const isOn = triggered.has(index)
          return (
            <li key={index}>
              <label style={{
                display: 'flex', gap: 8, alignItems: 'flex-start',
                fontSize: 12.5, color: 'var(--body)', lineHeight: 1.5,
                padding: '8px 10px', borderRadius: 'var(--r-input)',
                background: isOn ? 'var(--red-light)' : 'var(--bg-alt)',
                border: `1px solid ${isOn ? 'var(--red-border)' : 'var(--border)'}`,
                cursor: 'pointer',
              }}>
                <input
                  type="checkbox"
                  checked={isOn}
                  onChange={() => toggle(index)}
                  aria-label={`This condition applies: ${text}`}
                />
                <span><strong>This applies:</strong> {text}</span>
              </label>
            </li>
          )
        })}
      </ul>
      {anyTriggered && (
        <p role="alert" style={{ marginTop: 8, fontSize: 12, color: 'var(--red-text)', lineHeight: 1.5 }}>
          A stop condition applies. Do not disturb the plant. Report the sighting for review.
        </p>
      )}
      <label style={{
        marginTop: 10, display: 'flex', gap: 8, alignItems: 'flex-start',
        fontSize: 12.5, color: 'var(--body)', lineHeight: 1.5,
        opacity: anyTriggered ? 0.5 : 1,
      }}>
        <input
          type="checkbox"
          checked={allClear}
          disabled={anyTriggered}
          onChange={(event) => setAllClear(event.target.checked)}
        />
        <span>None of these apply here.</span>
      </label>
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
        display: 'flex', gap: 10, alignItems: 'center', minHeight: 48,
        padding: '10px 12px', borderRadius: 'var(--r-input)',
        border: checked ? '1.5px solid var(--amber)' : '1px solid #E6D8B8',
        background: checked ? '#FFF3D7' : 'var(--surface)',
        fontSize: 13, fontWeight: checked ? 650 : 500,
        color: disabled ? 'var(--muted)' : 'var(--body)',
        lineHeight: 1.45, cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <input
        type="radio"
        checked={checked}
        onChange={onSelect}
        disabled={disabled}
        style={{ width: 18, height: 18, flex: '0 0 18px', accentColor: 'var(--amber)' }}
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
        whiteSpace: 'normal',
        wordBreak: 'break-word',
        overflowWrap: 'anywhere',
        maxWidth: '100%',
        lineHeight: 1.4,
      }}
    >
      {status.display_label}
    </span>
  )
}

function ModeBanner({
  label,
  help,
  tone,
}: {
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
            Stop if any of these apply
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
            title={`${src.title} - ${src.publisher}`}
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
  // Showing the review date and content version here lets the user see for
  // themselves how current the guidance they're reading actually is.
  const reviewLabel = plantGuidanceDataset.last_reviewed
    ? `Guidance last reviewed ${plantGuidanceDataset.last_reviewed}`
    : 'Guidance review date unavailable'
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
        Safety notes and sources
      </summary>
      <p style={{ marginTop: 6, fontSize: 11.5, color: 'var(--muted)' }}>
        <strong>{reviewLabel}</strong> · Content version {plantGuidanceDataset.content_version} · Plant {plant.plant_id}
      </p>
      <div style={{ marginTop: 10, fontSize: 12, color: 'var(--body)', lineHeight: 1.6 }}>
        <p><strong>Identification:</strong> A photo can suggest a species, but it cannot confirm one. If the result is unclear, photograph and report the plant without disturbing it.</p>
        <p style={{ marginTop: 6 }}><strong>Permission:</strong> Being outside a mapped protected area does not give you permission to remove a plant. Removal steps only appear after you confirm approval from the land or waterbody manager.</p>
        {policy.protected_land_rule && (
          <p style={{ marginTop: 6 }}><strong>Protected land:</strong> Do not touch, collect, cut or remove plants on protected land. Take photos from a safe place and report the sighting.</p>
        )}
        {policy.never_recommend?.length > 0 && (
          <>
            <p style={{ marginTop: 8, fontWeight: 700 }}>InvaTrace does not provide instructions for</p>
            <ul style={{ paddingLeft: 18 }}>
              {policy.never_recommend.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </>
        )}
        <p style={{ marginTop: 10, fontWeight: 700 }}>Sources used for this plant</p>
        <ul style={{ paddingLeft: 18 }}>
          {getSources(collectSourceIds(plant)).map((src) => (
            <li key={src.source_id}>
              [{src.source_id}]{' '}
              <a href={src.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--body)' }}>
                {src.title}
              </a>{' '}
              - <span style={{ color: 'var(--muted)' }}>{src.publisher}</span>
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
