import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { captureScanLocation, useScan } from '@/features/scan/scan-store'
import { resizeImage } from '@/features/scan/image-processing'
import { getAdapter } from '@/features/scan/plant-model-adapter'
import { api } from '@/services/api-client'
import type { SpeciesDetail } from '@/types'
import './scan-capture.css'

/** The camera and gallery use separate file inputs so each button always does
 *  one clear job. The `capture` attribute asks supported phones to open the
 *  rear camera, while the other input opens the normal file picker. */
export function ScanCapturePage() {
  const navigate = useNavigate()
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const mountedRef = useRef(false)
  const cameraRequestRef = useRef(0)
  const imageRequestRef = useRef(0)
  const analysisRequestRef = useRef(0)
  const analysisRunningRef = useRef(false)
  const {
    imageUrl, quality, setImage, setQuality, startProcessing, cancelProcessing, setResult,
  } = useScan()
  const [checking, setChecking] = useState(false)
  const [analysing, setAnalysing] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraStarting, setCameraStarting] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [modelProgress, setModelProgress] = useState<number | null>(null)

  const stopCamera = useCallback((message?: string) => {
    cameraRequestRef.current += 1
    const stream = streamRef.current
    streamRef.current = null
    stream?.getTracks().forEach((track) => track.stop())
    setCameraOpen(false)
    setCameraStarting(false)
    if (message) setCameraError(message)
  }, [])

  useEffect(() => {
    mountedRef.current = true
    const interruptCamera = () => {
      if (streamRef.current) {
        stopCamera('Camera closed when the app was interrupted. Reopen it when you are ready.')
      }
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') interruptCamera()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('pagehide', interruptCamera)
    return () => {
      mountedRef.current = false
      cameraRequestRef.current += 1
      imageRequestRef.current += 1
      analysisRequestRef.current += 1
      analysisRunningRef.current = false
      const stream = streamRef.current
      streamRef.current = null
      stream?.getTracks().forEach((track) => track.stop())
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('pagehide', interruptCamera)
    }
  }, [stopCamera])

  const prepareImage = async (input: Blob, source: 'camera' | 'gallery') => {
    const requestId = ++imageRequestRef.current
    setChecking(true)
    setAnalysisError(null)
    try {
      const { bitmap, url, blob } = await resizeImage(input)
      if (!mountedRef.current || requestId !== imageRequestRef.current) {
        bitmap.close()
        URL.revokeObjectURL(url)
        return
      }
      setImage(url, bitmap, blob, source, crypto.randomUUID(), new Date().toISOString())

      const adapter = getAdapter()
      const qualityResult = await adapter.quality(bitmap)
      if (requestId === imageRequestRef.current) setQuality(qualityResult)
    } catch (error) {
      if (requestId === imageRequestRef.current) {
        setQuality({
          ok: false,
          reason: error instanceof Error && error.message.startsWith('Photo is too large')
            ? error.message
            : 'Could not process this image. Try another photo.',
        })
      }
    } finally {
      if (requestId === imageRequestRef.current) setChecking(false)
    }
  }

  const handleFile = async (
    e: React.ChangeEvent<HTMLInputElement>,
    source: 'camera' | 'gallery',
  ) => {
    const input = e.currentTarget
    const file = input.files?.[0]
    if (file) await prepareImage(file, source)
    input.value = ''
  }

  const openCamera = async () => {
    if (cameraStarting || streamRef.current) return
    captureScanLocation()
    setCameraError(null)
    const requestId = ++cameraRequestRef.current
    setCameraStarting(true)
    if (!navigator.mediaDevices?.getUserMedia) {
      cameraRef.current?.click()
      setCameraStarting(false)
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
        audio: false,
      })
      if (!mountedRef.current || requestId !== cameraRequestRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      const handleEnded = () => {
        if (streamRef.current !== stream || !mountedRef.current) return
        streamRef.current = null
        setCameraOpen(false)
        setCameraError('Camera stopped unexpectedly. Reopen it to continue.')
      }
      stream.getTracks().forEach((track) => track.addEventListener('ended', handleEnded, { once: true }))
      streamRef.current = stream
      setCameraOpen(true)
      requestAnimationFrame(() => {
        const video = videoRef.current
        if (video && streamRef.current === stream) {
          video.srcObject = stream
          void video.play().catch(() => {
            if (streamRef.current === stream) {
              stopCamera('Camera preview could not start. Reopen the camera and try again.')
            }
          })
        }
      })
    } catch {
      if (requestId === cameraRequestRef.current) {
        setCameraError('Camera access was unavailable. Allow camera access and try again.')
      }
    } finally {
      if (requestId === cameraRequestRef.current && mountedRef.current) setCameraStarting(false)
    }
  }

  const captureFrame = async () => {
    const video = videoRef.current
    if (!video?.videoWidth || !video.videoHeight) return
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight))
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) return
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    stopCamera()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
    if (blob) await prepareImage(blob, 'camera')
  }

  const analyse = async () => {
    if (analysisRunningRef.current) return
    const { imageBitmap: bitmap, imageBlob } = useScan.getState()
    if (!bitmap || !imageBlob) return

    const requestId = ++analysisRequestRef.current
    analysisRunningRef.current = true
    setAnalysing(true)
    setAnalysisError(null)
    startProcessing()
    try {
      const adapter = getAdapter()
      await adapter.detect(bitmap)
      const identifyPromise = adapter.identify(imageBlob, (loaded, total) => {
        if (requestId === analysisRequestRef.current) {
          setModelProgress(Math.round((loaded / total) * 100))
        }
      })
      const result = await Promise.race<Awaited<ReturnType<typeof adapter.identify>>>([
        identifyPromise,
        new Promise((_, reject) => setTimeout(
          () => reject(new Error('Plant analysis timed out after 15 seconds. Retake the photo and try again.')),
          15_000,
        )),
      ])
      if (!mountedRef.current || requestId !== analysisRequestRef.current) return

      let detail: SpeciesDetail | null = null
      if (result.outcome === 'target' && result.speciesId) {
        try {
          detail = await api<SpeciesDetail>(`/api/v1/species/${result.speciesId}`)
        } catch {
          // Species details are optional. The result can still be shown using
          // the identification response when this extra request fails.
        }
      }

      setResult({ ...result, reportable: Boolean(detail?.reportable ?? detail) }, detail)
      navigate('/scan/result', { replace: true })
    } catch {
      if (requestId === analysisRequestRef.current) {
        cancelProcessing()
        setAnalysisError(
          navigator.onLine
            ? 'Plant analysis could not finish. Your photo is still available — try again.'
            : 'Plant analysis needs a connection for its first model download. Reconnect and try again.',
        )
      }
    } finally {
      if (requestId === analysisRequestRef.current) {
        analysisRunningRef.current = false
        setAnalysing(false)
        setModelProgress(null)
      }
    }
  }

  const retake = () => {
    imageRequestRef.current += 1
    analysisRequestRef.current += 1
    analysisRunningRef.current = false
    setAnalysisError(null)
    setAnalysing(false)
    setModelProgress(null)
    useScan.getState().reset()
    stopCamera()
    if (cameraRef.current) cameraRef.current.value = ''
    if (galleryRef.current) galleryRef.current.value = ''
  }

  const qualityFailed = quality && !quality.ok

  return (
    <div className="scan-capture">
      <input
        ref={cameraRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment"
        onChange={(event) => void handleFile(event, 'camera')} hidden
        aria-label="Take photo"
      />
      <input
        ref={galleryRef} type="file" accept="image/jpeg,image/png,image/webp"
        onChange={(event) => void handleFile(event, 'gallery')} hidden
        aria-label="Choose photo from gallery"
      />

      {!imageUrl && cameraOpen ? (
        <section className="scan-capture__live" aria-labelledby="live-camera-heading">
          <div className="scan-capture__live-heading">
            <div>
              <h2 id="live-camera-heading">Frame one clear plant feature</h2>
              <p>Keep the leaf or flower cluster inside the guide, then capture.</p>
            </div>
            <button type="button" onClick={() => stopCamera()} aria-label="Close camera">
              <Icon name="X" size={18} />
            </button>
          </div>
          <div className="scan-capture__live-view">
            <video ref={videoRef} playsInline muted aria-label="Live rear camera preview" />
            <span aria-hidden className="scan-capture__live-guide" />
          </div>
          <button type="button" onClick={() => void captureFrame()} className="scan-capture__shutter">
            <span aria-hidden />
            Capture plant photo
          </button>
        </section>
      ) : !imageUrl ? (
        <section className="scan-capture__start" aria-labelledby="capture-heading">
          <div className="scan-capture__intro">
            <h2 id="capture-heading">Photograph a clear plant feature</h2>
            <p>A close, well-lit view of one leaf or flower cluster gives the model useful evidence.</p>
          </div>

          <button
            type="button"
            onClick={() => void openCamera()}
            disabled={checking || cameraStarting}
            aria-busy={checking || cameraStarting}
            className="scan-capture__camera"
          >
            <span aria-hidden className="scan-capture__corner scan-capture__corner--tl" />
            <span aria-hidden className="scan-capture__corner scan-capture__corner--tr" />
            <span aria-hidden className="scan-capture__corner scan-capture__corner--bl" />
            <span aria-hidden className="scan-capture__corner scan-capture__corner--br" />
            <span className="scan-capture__camera-icon" aria-hidden>
              {checking || cameraStarting ? <Spinner /> : <Icon name="Camera" size={30} color="#fff" />}
            </span>
            <strong>{checking ? 'Preparing photo…' : cameraStarting ? 'Starting camera…' : 'Open camera'}</strong>
            <span>{checking ? 'Checking image quality' : cameraStarting ? 'Waiting for camera access' : 'Uses your phone’s rear camera'}</span>
            <small>Fill the frame with the plant feature</small>
          </button>

          {cameraError && <p className="scan-capture__camera-error" role="alert">{cameraError}</p>}

          {import.meta.env.DEV && (
            <>
              <button
                type="button"
                onClick={() => { captureScanLocation(); galleryRef.current?.click() }}
                disabled={checking}
                className="scan-capture__gallery"
              >
                <Icon name="ImagePlus" size={16} color="var(--body)" />
                Identify a gallery photo (dev only)
              </button>
              <p className="scan-capture__gallery-note">Dev-only gallery upload. Production builds accept live camera capture only.</p>
            </>
          )}
        </section>
      ) : (
        <div className="scan-capture__preview">
          <img src={imageUrl} alt="Captured plant" />

          {qualityFailed && (
            <div className="scan-capture__quality-fail" role="alert">
              <Icon name="AlertTriangle" size={24} color="#fff" />
              <div>
                <strong>Photo needs another try</strong>
                <p>{quality.reason}</p>
              </div>
              <button type="button" onClick={retake} className="scan-capture__retake">
                <Icon name="RotateCcw" size={16} color="var(--ink)" />
                Retake photo
              </button>
            </div>
          )}

          {!qualityFailed && (
            <button type="button" onClick={retake} aria-label="Discard photo and retake"
              className="scan-capture__discard">
              <Icon name="X" size={16} color="#fff" />
            </button>
          )}
        </div>
      )}

      {imageUrl && quality?.ok && (
        <div className="scan-capture__ready">
          <div className="scan-capture__quality-pass" role="status">
            <Icon name="Check" size={16} color="var(--green)" />
            <span>Photo quality check passed</span>
          </div>

          <button
            type="button"
            onClick={analyse}
            disabled={analysing}
            aria-busy={analysing}
            className="scan-capture__analyse"
          >
            {analysing ? (
              <>
                <Spinner />
                {modelProgress === null ? 'Preparing model…' : `Loading model… ${modelProgress}%`}
              </>
            ) : (
              <>
                <Icon name="Search" size={18} color="#fff" />
                Analyse plant
              </>
            )}
          </button>
          {analysisError && (
            <p className="scan-capture__analysis-error" role="alert">{analysisError}</p>
          )}
        </div>
      )}

      <section className="scan-capture__guidance" aria-labelledby="capture-guidance-heading">
        <h3 id="capture-guidance-heading">Before you capture</h3>
        <ul>
          <li><Icon name="Check" size={15} color="var(--green)" /><span>Use one leaf or flower cluster as the subject.</span></li>
          <li><Icon name="Check" size={15} color="var(--green)" /><span>Move close enough for it to fill most of the frame.</span></li>
          <li><Icon name="Check" size={15} color="var(--green)" /><span>Use even light and hold the phone steady.</span></li>
        </ul>
      </section>
    </div>
  )
}

function Spinner() {
  return (
    <svg className="scan-capture__spinner" width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <circle cx="9" cy="9" r="7" stroke="rgba(255,255,255,0.3)" strokeWidth="2.5" fill="none" />
      <path d="M9 2a7 7 0 0 1 7 7" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" fill="none" />
    </svg>
  )
}
