import { useEffect, useRef, useState } from 'react'
import type { PoseLandmarker } from '@mediapipe/tasks-vision'
import { createExerciseDetector, exerciseModes } from './exercises'
import type { ExerciseId } from './exercises'
import { notReady } from './analysis/types.ts'
import type { ExerciseDetector } from './analysis/types.ts'
import { createPoseTracker, drawSkeleton } from './pose'

type BridgeStatus = { connected: boolean; sequence: number; error: string | null }
type ViewState = 'loading' | 'waiting' | 'tracking' | 'no-pose' | 'error'

const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [viewState, setViewState] = useState<ViewState>('loading')
  const [modelReady, setModelReady] = useState(false)
  const [bridgeConnected, setBridgeConnected] = useState(false)
  const [fps, setFps] = useState(0)
  const [landmarkCount, setLandmarkCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [exerciseId, setExerciseId] = useState<ExerciseId>('squat')
  const detectorRef = useRef<ExerciseDetector | null>(null)
  detectorRef.current ??= createExerciseDetector('squat')
  const [phaseSnapshot, setPhaseSnapshot] = useState(notReady)
  const selectedExercise = exerciseModes.find((mode) => mode.id === exerciseId)!

  const selectExercise = (id: ExerciseId) => {
    if (id === exerciseId) return
    detectorRef.current = createExerciseDetector(id)
    setPhaseSnapshot(notReady())
    setExerciseId(id)
  }

  useEffect(() => {
    let active = true
    let tracker: PoseLandmarker | null = null
    let lastSequence = -1
    let frames = 0
    let fpsStarted = performance.now()

    const pollStatus = async () => {
      while (active) {
        try {
          const response = await fetch('/api/status', { cache: 'no-store' })
          if (!response.ok) throw new Error('Kinect bridge is unavailable. Start python3 backend/server.py.')
          const status = (await response.json()) as BridgeStatus
          if (!active) break
          setBridgeConnected(status.connected)
          if (status.error) {
            setError(status.error)
            setViewState('error')
            setPhaseSnapshot(detectorRef.current!.missing(performance.now()))
          } else if (!status.connected) {
            setViewState('waiting')
            setPhaseSnapshot(detectorRef.current!.missing(performance.now()))
          } else {
            setError(null)
          }
        } catch {
          if (active) {
            setBridgeConnected(false)
            setError('Kinect bridge is unavailable. Start python3 backend/server.py in a separate terminal.')
            setViewState('error')
            setPhaseSnapshot(detectorRef.current!.missing(performance.now()))
          }
        }
        await delay(1500)
      }
    }

    const run = async () => {
      try {
        tracker = await createPoseTracker()
        if (!active) {
          tracker.close()
          return
        }
        setModelReady(true)
        setViewState('waiting')
      } catch (cause) {
        if (active) {
          setError(`Pose model failed to load: ${cause instanceof Error ? cause.message : String(cause)}. Run npm run prepare:assets and reload.`)
          setViewState('error')
        }
        return
      }

      while (active) {
        try {
          const response = await fetch('/api/frame', { cache: 'no-store' })
          if (!response.ok) {
            await delay(250)
            continue
          }
          const sequence = Number(response.headers.get('X-Frame-Sequence'))
          if (sequence === lastSequence) {
            await delay(15)
            continue
          }
          const bitmap = await createImageBitmap(await response.blob())
          if (!active) {
            bitmap.close()
            break
          }
          const canvas = canvasRef.current
          const context = canvas?.getContext('2d')
          if (!canvas || !context || !tracker) {
            bitmap.close()
            break
          }
          canvas.width = bitmap.width
          canvas.height = bitmap.height
          context.drawImage(bitmap, 0, 0)
          bitmap.close()

          // MediaPipe requires a monotonic timestamp for VIDEO mode.
          const timestamp = performance.now()
          const result = tracker.detectForVideo(canvas, timestamp)
          setPhaseSnapshot(detectorRef.current!.update(result, timestamp))
          if (result.landmarks.length > 0) {
            setViewState('tracking')
            setLandmarkCount(result.landmarks[0].length)
            drawSkeleton(context, result.landmarks)
          } else {
            setViewState('no-pose')
            setLandmarkCount(0)
          }
          lastSequence = sequence
          frames += 1
          const now = performance.now()
          if (now - fpsStarted >= 1000) {
            setFps(Math.round(frames * 1000 / (now - fpsStarted)))
            frames = 0
            fpsStarted = now
          }
        } catch (cause) {
          if (active) {
            setError(`Frame processing failed: ${cause instanceof Error ? cause.message : String(cause)}`)
            setViewState('error')
          }
          await delay(500)
        }
      }
    }

    void pollStatus()
    void run()
    return () => {
      active = false
      tracker?.close()
    }
  }, [])

  const statusText = {
    loading: 'Loading pose model',
    waiting: 'Waiting for Kinect',
    tracking: 'Body tracking active',
    'no-pose': 'No body detected',
    error: 'Attention needed',
  }[viewState]

  return (
    <main className="app">
      <header className="header">
        <div className="brand"><span className="brand-mark">K</span><div><strong>KINETIQ <span>V2</span></strong><small>Movement intelligence lab</small></div></div>
        <div className="header-tag">KINECT V1 · RGB</div>
      </header>
      <section className="intro">
        <div className="eyebrow"><span className="eyebrow-line" /> LIVE POSE TRACKING</div>
        <h1>See every move<br /><em>in real time.</em></h1>
        <p>Live Kinect pose tracking for squats and push-ups, powered by MediaPipe Pose Landmarker Full.</p>
      </section>
      <section className="mode-picker" aria-label="Exercise mode">
        <div className="mode-copy"><span>EXERCISE MODE</span><p>{selectedExercise.framingTip} Phase and joint angles update live.</p></div>
        <div className="mode-options">
          {exerciseModes.map((mode) => (
            <button
              type="button"
              key={mode.id}
              className={mode.id === exerciseId ? 'mode-button active' : 'mode-button'}
              aria-pressed={mode.id === exerciseId}
              onClick={() => selectExercise(mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </section>
      <section className="workspace" aria-label="Live camera workspace">
        <div className="stage">
          <div className="stage-top"><span className="live-chip"><span /> LIVE VIEW</span><span className="resolution">640 × 480 RGB</span></div>
          <div className="video-area">
            <canvas ref={canvasRef} width="640" height="480" aria-label="Live Kinect camera feed with skeleton overlay" />
            {!bridgeConnected && <div className="empty-state"><div className="reticle">＋</div><strong>Waiting for camera feed</strong><span>Connect your Kinect V1 and start the Python bridge.</span></div>}
          </div>
          <div className="stage-bottom"><span>POSE LANDMARKER · FULL</span><span>{selectedExercise.label.toUpperCase()} MODE · LIVE SESSION</span></div>
        </div>
        <aside className="sidebar">
          <div className={`panel phase-panel ${phaseSnapshot.phase === 'Tracking Lost' || phaseSnapshot.phase === 'Not Ready' ? 'phase-unavailable' : ''}`}>
            <div className="panel-label">{selectedExercise.label.toUpperCase()} · MOVEMENT PHASE</div>
            <h2 aria-live="polite">{phaseSnapshot.phase}</h2>
            <p>{phaseSnapshot.detail}</p>
            <div className="angle-grid">
              {phaseSnapshot.angles.length > 0 ? phaseSnapshot.angles.map((angle) => (
                <div className="angle-reading" key={angle.label}>
                  <span>{angle.label}</span><strong>{Math.round(angle.degrees)}°</strong>
                </div>
              )) : <span className="angles-empty">Angles available when joints are visible.</span>}
            </div>
            {phaseSnapshot.side && <small>Using {phaseSnapshot.side} side landmarks</small>}
          </div>
          <div className="panel status-panel"><div className="panel-label">SYSTEM STATUS</div><div className={`status-icon ${viewState}`}><span /></div><h2>{statusText}</h2><p>{viewState === 'tracking' ? 'Skeleton locked onto your movement.' : viewState === 'no-pose' ? 'Step back until your full body is visible.' : viewState === 'loading' ? 'Preparing the 33-point pose model.' : viewState === 'waiting' ? 'The bridge is searching for RGB frames.' : 'Check the message below and retry.'}</p><div className="status-rows"><div><span>Kinect feed</span><b className={bridgeConnected ? 'good' : 'muted'}>{bridgeConnected ? 'Connected' : 'Offline'}</b></div><div><span>Pose model</span><b className={modelReady ? 'good' : 'muted'}>{modelReady ? 'Ready' : 'Loading'}</b></div></div></div>
          <div className="metrics"><div className="metric"><span>TRACKING FPS</span><strong>{fps}</strong><small>processed frames / sec</small></div><div className="metric"><span>LANDMARKS</span><strong>{landmarkCount}<i>/ 33</i></strong><small>{landmarkCount ? 'body points visible' : 'awaiting subject'}</small></div></div>
          {error && <div className="error-panel" role="alert"><strong>Connection or tracking error</strong><p>{error}</p></div>}
          <div className="hint"><span>✦</span><p>Stand far enough back for your head, hands, and feet to fit inside the frame. Bright, even lighting improves tracking.</p></div>
        </aside>
      </section>
      <footer>KINETIQ V2 <span>•</span> KINECT V1 + MEDIAPIPE <span>•</span> LOCAL SESSION</footer>
    </main>
  )
}
