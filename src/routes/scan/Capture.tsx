import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { captureScanLocation, useScan } from '@/lib/scan-store'
import { resizeImage } from '@/lib/image-utils'
import { getAdapter } from '@/lib/model-adapter'
import { api } from '@/lib/api'
import type { SpeciesDetail } from '@/types'

/** Two inputs so the user can force camera vs gallery independently. Some
 *  browsers (iOS Safari before 15, older Android WebView) ignore the
 *  `capture` attribute — separating the entry points gives a reliable
 *  "Take photo" affordance even where the attribute is honoured. */
export function Capture() {
  const navigate = useNavigate()
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const { imageUrl, quality, setImage, setQuality, startProcessing, setResult } = useScan()
  const [checking, setChecking] = useState(false)
  const [analysing, setAnalysing] = useState(false)

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setChecking(true)
    try {
      const { bitmap, url, blob } = await resizeImage(file)
      setImage(url, bitmap, blob)

      const adapter = getAdapter()
      const q = await adapter.quality(bitmap)
      setQuality(q)
    } catch {
      setQuality({ ok: false, reason: 'Could not process this image. Try another photo.' })
    } finally {
      setChecking(false)
    }
  }

  const analyse = async () => {
    const bitmap = useScan.getState().imageBitmap
    if (!bitmap) return

    setAnalysing(true)
    startProcessing()
    try {
      const adapter = getAdapter()
      await adapter.detect(bitmap)
      const result = await adapter.identify(bitmap)

      let detail: SpeciesDetail | null = null
      if (result.outcome === 'target' && result.speciesId) {
        try {
          detail = await api<SpeciesDetail>(`/api/v1/species/${result.speciesId}`)
        } catch { /* non-fatal */ }
      }

      setResult(result, detail)
      navigate('/scan/result', { replace: true })
    } catch {
      setQuality({ ok: false, reason: 'Analysis failed. Please try again.' })
      useScan.getState().reset()
    } finally {
      setAnalysing(false)
    }
  }

  const retake = () => {
    useScan.getState().reset()
    if (cameraRef.current) cameraRef.current.value = ''
    if (galleryRef.current) galleryRef.current.value = ''
  }

  const qualityFailed = quality && !quality.ok

  return (
    <div style={{ padding: 16, maxWidth: 520, margin: '0 auto' }}>
      <input
        ref={cameraRef} type="file" accept="image/*" capture="environment"
        onChange={handleFile} style={{ display: 'none' }}
        aria-label="Take photo"
      />
      <input
        ref={galleryRef} type="file" accept="image/*"
        onChange={handleFile} style={{ display: 'none' }}
        aria-label="Choose photo from gallery"
      />

      {!imageUrl ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <button
            type="button"
            onClick={() => { captureScanLocation(); cameraRef.current?.click() }}
            disabled={checking}
            style={{
              width: '100%', aspectRatio: '4 / 3', borderRadius: 'var(--r-card)',
              border: '2px dashed var(--control-border)', background: 'var(--surface)',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', gap: 12, cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <div style={{
              width: 56, height: 56, borderRadius: '50%', background: 'var(--green-light)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon name="Camera" size={26} color="var(--green)" />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>
                {checking ? 'Processing…' : 'Take a photo'}
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
                Opens the camera on your phone
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => { captureScanLocation(); galleryRef.current?.click() }}
            disabled={checking}
            style={{
              width: '100%', height: 'var(--h-primary)', borderRadius: 'var(--r-button)',
              border: '1px solid var(--control-border)', background: 'var(--surface)',
              color: 'var(--body)', fontWeight: 600, fontSize: 14, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <Icon name="ImagePlus" size={16} color="var(--body)" />
            Choose from gallery
          </button>
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <img
            src={imageUrl}
            alt="Captured plant"
            style={{
              width: '100%', borderRadius: 'var(--r-card)',
              display: 'block', maxHeight: 400, objectFit: 'cover',
            }}
          />

          {qualityFailed && (
            <div style={{
              position: 'absolute', inset: 0, borderRadius: 'var(--r-card)',
              background: 'rgba(0,0,0,0.65)', display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24,
            }}>
              <div style={{
                width: 48, height: 48, borderRadius: '50%', background: 'rgba(194,65,45,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Icon name="AlertTriangle" size={24} color="var(--red)" />
              </div>
              <p style={{
                fontSize: 14, color: '#fff', textAlign: 'center', lineHeight: 1.5, maxWidth: 280,
              }}>
                {quality.reason}
              </p>
              <button type="button" onClick={retake} style={{
                height: 'var(--h-primary)', padding: '0 24px', borderRadius: 'var(--r-button)',
                border: 'none', background: '#fff', color: 'var(--ink)',
                fontWeight: 600, fontSize: 14, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <Icon name="RotateCcw" size={16} color="var(--ink)" />
                Retake
              </button>
            </div>
          )}

          {!qualityFailed && (
            <button type="button" onClick={retake} aria-label="Discard photo and retake" style={{
              position: 'absolute', top: 8, right: 8, width: 44, height: 44,
              borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.5)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon name="X" size={16} color="#fff" />
            </button>
          )}
        </div>
      )}

      {imageUrl && quality?.ok && (
        <div style={{ marginTop: 16 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
            borderRadius: 'var(--r-input)', background: 'var(--green-light)',
            border: '1px solid var(--green-border)', marginBottom: 16,
          }}>
            <Icon name="Check" size={16} color="var(--green)" />
            <span style={{ fontSize: 13, color: 'var(--green-dark)', fontWeight: 500 }}>
              Photo quality check passed
            </span>
          </div>

          <button
            type="button"
            onClick={analyse}
            disabled={analysing}
            style={{
              width: '100%', height: 'var(--h-primary)', borderRadius: 'var(--r-button)',
              border: 'none', background: 'var(--green)', color: '#fff',
              fontWeight: 600, fontSize: 15, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            {analysing ? (
              <>
                <Spinner />
                Analysing...
              </>
            ) : (
              <>
                <Icon name="Search" size={18} color="#fff" />
                Analyse plant
              </>
            )}
          </button>
        </div>
      )}

      <div style={{ marginTop: 24, padding: '14px 16px', borderRadius: 'var(--r-card)', background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Tips for best results</h3>
        <ul style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.7, paddingLeft: 18 }}>
          <li>Photograph a single leaf or flower cluster</li>
          <li>Ensure the subject fills most of the frame</li>
          <li>Avoid heavy shadows or backlighting</li>
          <li>Hold steady to prevent blur</li>
        </ul>
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" style={{ animation: 'spin 0.8s linear infinite' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      <circle cx="9" cy="9" r="7" stroke="rgba(255,255,255,0.3)" strokeWidth="2.5" fill="none" />
      <path d="M9 2a7 7 0 0 1 7 7" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" fill="none" />
    </svg>
  )
}
