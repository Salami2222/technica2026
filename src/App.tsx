import { useEffect, useRef, useState } from 'react'
import type { PoseLandmarker, PoseLandmarkerResult } from '@mediapipe/tasks-vision'
import { createExerciseDetector, exerciseModes } from './exercises'
import type { ExerciseId } from './exercises'
import { notReady } from './analysis/types.ts'
import type { ExerciseDetector, PhaseSnapshot } from './analysis/types.ts'
import { createPoseTracker, drawSkeleton } from './pose'
import { ExerciseSession } from './session/session.ts'
import type { SessionStatus } from './session/session.ts'
import { GolfSwingSession } from './golf/golf.ts'
import type { GolfStatus, Handedness } from './golf/types.ts'
import { GolfDashboard } from './golf/GolfDashboard.tsx'
import { FormDashboard } from './form/FormDashboard.tsx'
import { CameraGuide } from './setup/CameraGuide.tsx'
import { assessFraming, noFraming } from './setup/framing.ts'

type BridgeStatus = { connected: boolean; state?: 'starting' | 'connected' | 'recovering' | 'stopped'; sequence: number; error: string | null; restartCount?: number }
type ViewState = 'loading' | 'waiting' | 'tracking' | 'partial' | 'lost' | 'no-pose' | 'error'

const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
const sessionOpen = (status: SessionStatus) => status !== 'Idle' && status !== 'Completed'
type ModeId = ExerciseId | 'golf'
const modeOptions: { id: ModeId; label: string }[] = [...exerciseModes, { id: 'golf', label: 'Golf Swing' }]
const golfInstructions: Record<GolfStatus, string> = {
  Idle: 'Choose a hand and start a swing session.',
  'Waiting for Address': 'Face the Kinect and hold a steady address.',
  Ready: 'Make a full practice swing, then hold your finish.',
  Recording: 'Swing in progress. Continue through the finish.',
  Paused: 'Swings saved. Resume and return to address.',
  Completed: 'Session complete. Review your recorded swings.',
  'Tracking Lost': 'Movement paused until reliable landmarks return.',
}

const sessionInstructions: Record<SessionStatus, string> = {
  Idle: 'Choose an exercise, then start a new session.',
  'Waiting for Position': 'Hold the starting position steadily. Counting begins automatically.',
  Ready: 'Starting position confirmed. Begin your next repetition.',
  Recording: 'Complete the full movement and return to the starting position.',
  Paused: 'Progress is saved. Resume and hold the starting position again.',
  Completed: 'Your session is complete. Start again when you are ready.',
  'Tracking Lost': 'Counting is suspended. A brief interruption may resume the current rep.',
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [viewState, setViewState] = useState<ViewState>('loading')
  const [modelReady, setModelReady] = useState(false)
  const [bridgeConnected, setBridgeConnected] = useState(false)
  const [bridgeState, setBridgeState] = useState<BridgeStatus['state'] | 'offline'>('starting')
  const [bridgeMessage, setBridgeMessage] = useState<string | null>(null)
  const [restartCount, setRestartCount] = useState(0)
  const [fps, setFps] = useState(0)
  const [landmarkCount, setLandmarkCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [exerciseId, setExerciseId] = useState<ModeId>('squat')
  const [workspaceTab, setWorkspaceTab] = useState<'live' | 'setup'>('live')
  const modeRef = useRef<ModeId>('squat')
  const [handedness, setHandedness] = useState<Handedness>('right')
  const golfRef = useRef(new GolfSwingSession('right'))
  const latestSwingCountRef = useRef(0)
  const [golfSnapshot, setGolfSnapshot] = useState(() => golfRef.current.snapshot())
  const [selectedSwingId, setSelectedSwingId] = useState<number | null>(null)
  const [selectedFormRep, setSelectedFormRep] = useState<number | null>(null)
  const [framing, setFraming] = useState(noFraming)
  const detectorRef = useRef<ExerciseDetector | null>(null)
  detectorRef.current ??= createExerciseDetector('squat')
  const sessionRef = useRef<ExerciseSession | null>(null)
  sessionRef.current ??= new ExerciseSession('squat')
  const [phaseSnapshot, setPhaseSnapshot] = useState(notReady)
  const [sessionSnapshot, setSessionSnapshot] = useState(() => sessionRef.current!.snapshot())
  const selectedExercise = modeOptions.find((mode) => mode.id === exerciseId)!
  const isGolf = exerciseId === 'golf'
  const isSessionOpen = isGolf
    ? golfSnapshot.status !== 'Idle' && golfSnapshot.status !== 'Completed'
    : sessionOpen(sessionSnapshot.status)
  const displayedSwing = golfSnapshot.history.find((swing) => swing.id === selectedSwingId) ?? golfSnapshot.latest

  const selectExercise = (id: ModeId) => {
    if (id === exerciseId || isSessionOpen) return
    modeRef.current = id
    if (id !== 'golf') {
      detectorRef.current = createExerciseDetector(id)
      sessionRef.current = new ExerciseSession(id)
      setSessionSnapshot(sessionRef.current.snapshot())
      setSelectedFormRep(null)
    }
    setPhaseSnapshot(notReady())
    setFraming(noFraming)
    setExerciseId(id)
  }

  const startSession = () => {
    if (isSessionOpen) return
    if (isGolf) {
      golfRef.current = new GolfSwingSession(handedness)
      latestSwingCountRef.current = 0
      setGolfSnapshot(golfRef.current.start())
      setSelectedSwingId(null)
      return
    }
    detectorRef.current = createExerciseDetector(exerciseId)
    setPhaseSnapshot(notReady())
    sessionRef.current = new ExerciseSession(exerciseId)
    setSessionSnapshot(sessionRef.current.start())
    setSelectedFormRep(null)
  }

  const pauseOrResume = () => {
    if (isGolf) {
      setGolfSnapshot(golfSnapshot.status === 'Paused' ? golfRef.current.resume() : golfRef.current.pause())
      return
    }
    const session = sessionRef.current!
    setSessionSnapshot(sessionSnapshot.status === 'Paused' ? session.resume() : session.pause())
  }

  const stopSession = () => isGolf ? setGolfSnapshot(golfRef.current.stop()) : setSessionSnapshot(sessionRef.current!.stop())

  useEffect(() => {
    let active = true
    let tracker: PoseLandmarker | null = null
    let lastSequence = -1
    let lastDetectorCheck = performance.now()
    let lastFrameAt = performance.now()
    let frames = 0
    let fpsStarted = performance.now()

    const observeSession = (snapshot: PhaseSnapshot, timestampMs: number, pose?: PoseLandmarkerResult) => {
      setSessionSnapshot(sessionRef.current!.observe(snapshot, timestampMs, pose))
    }
    const observeMissing = (timestampMs: number) => {
      if (modeRef.current === 'golf') {
        const snapshot = golfRef.current.missing(timestampMs)
        setGolfSnapshot(snapshot)
        setViewState(snapshot.tracking === 'partial' ? 'partial' : snapshot.tracking === 'lost' ? 'lost' : 'no-pose')
      } else {
        const snapshot = detectorRef.current!.missing(timestampMs)
        setPhaseSnapshot(snapshot)
        observeSession(snapshot, timestampMs)
        setViewState(snapshot.tracking === 'partial' ? 'partial' : snapshot.tracking === 'lost' ? 'lost' : 'no-pose')
      }
    }

    const pollStatus = async () => {
      while (active) {
        try {
          const response = await fetch('/api/status', { cache: 'no-store' })
          if (!response.ok) throw new Error('Kinect bridge is unavailable. Start python3 backend/server.py.')
          const status = (await response.json()) as BridgeStatus
          if (!active) break
          setBridgeConnected(status.connected)
          setBridgeState(status.state ?? (status.connected ? 'connected' : 'recovering'))
          setBridgeMessage(status.connected ? null : status.error)
          setRestartCount(status.restartCount ?? 0)
          if (!status.connected) {
            setFraming(noFraming)
            setViewState('waiting')
            if (modeRef.current === 'golf') setGolfSnapshot(golfRef.current.missing(performance.now()))
            else {
              detectorRef.current!.reset()
              setPhaseSnapshot(notReady())
              observeSession(notReady(), performance.now())
            }
            setFps(0)
            setLandmarkCount(0)
          } else {
            setError(null)
          }
        } catch {
          if (active) {
            setBridgeConnected(false)
            setFraming(noFraming)
            setBridgeState('offline')
            setBridgeMessage('Kinect bridge is unavailable. Start python3 backend/server.py in a separate terminal.')
            setViewState('error')
            if (modeRef.current === 'golf') setGolfSnapshot(golfRef.current.missing(performance.now()))
            else {
              detectorRef.current!.reset()
              setPhaseSnapshot(notReady())
              observeSession(notReady(), performance.now())
            }
            setFps(0)
            setLandmarkCount(0)
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
            const now = performance.now()
            if (now - lastFrameAt > 1000) setFps(0)
            if (now - lastDetectorCheck >= 200) {
              observeMissing(now)
              lastDetectorCheck = now
            }
            await delay(250)
            continue
          }
          const sequence = Number(response.headers.get('X-Frame-Sequence'))
          if (sequence === lastSequence) {
            const now = performance.now()
            if (now - lastFrameAt > 1000) setFps(0)
            if (now - lastDetectorCheck >= 200) {
              observeMissing(now)
              lastDetectorCheck = now
            }
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
          lastFrameAt = timestamp
          const result = tracker.detectForVideo(canvas, timestamp)
          setFraming(assessFraming(modeRef.current, result))
          if (modeRef.current === 'golf') {
            const snapshot = golfRef.current.update(result, timestamp)
            if (snapshot.swings > latestSwingCountRef.current) setSelectedSwingId(null)
            latestSwingCountRef.current = snapshot.swings
            setGolfSnapshot(snapshot)
            setViewState(snapshot.tracking === 'tracking' ? 'tracking' : snapshot.tracking === 'partial' ? 'partial' : snapshot.tracking === 'lost' ? 'lost' : 'no-pose')
          } else {
            const snapshot = detectorRef.current!.update(result, timestamp)
            setPhaseSnapshot(snapshot)
            observeSession(snapshot, timestamp, result)
            setViewState(snapshot.tracking === 'tracking' ? 'tracking' : snapshot.tracking === 'partial' ? 'partial' : snapshot.tracking === 'lost' ? 'lost' : 'no-pose')
          }
          lastDetectorCheck = timestamp
          if (result.landmarks.length > 0) {
            setLandmarkCount(result.landmarks[0].length)
            drawSkeleton(context, result.landmarks)
          } else {
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
            if (modeRef.current === 'golf') setGolfSnapshot(golfRef.current.missing(performance.now()))
            else observeSession(notReady(), performance.now())
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

  const cameraDisconnected = !bridgeConnected && bridgeState !== 'starting'
  const statusText = cameraDisconnected ? 'Kinect Disconnected' : {
    loading: 'Loading pose model',
    waiting: 'Waiting for Kinect',
    tracking: 'Tracking',
    partial: 'Partial Tracking',
    lost: 'Tracking Lost',
    'no-pose': 'Not Ready',
    error: 'Attention needed',
  }[viewState]

  return (
    <main className="app">
      <header className="header">
        <div className="brand"><span className="brand-mark">K</span><div><strong>KINETIQ <span>V2</span></strong><small>Movement intelligence lab</small></div></div>
        <div className="header-tag">KINECT V1 · RGB</div>
      </header>
      <section className="mode-picker" aria-label="Exercise mode">
        <div className="mode-copy"><span>EXERCISE MODE</span><p>{isSessionOpen ? 'Stop the session to switch modes.' : isGolf ? 'Face-on practice swings with full-body tracking.' : exerciseModes.find((mode) => mode.id === exerciseId)?.framingTip}</p></div>
        <div className="mode-options">
          {modeOptions.map((mode) => (
            <button
              type="button"
              key={mode.id}
              className={mode.id === exerciseId ? 'mode-button active' : 'mode-button'}
              aria-pressed={mode.id === exerciseId}
              disabled={isSessionOpen}
              onClick={() => selectExercise(mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </section>
      <section className={isGolf ? 'workspace golf-workspace' : 'workspace'} aria-label="Live camera workspace">
        <div className="stage">
          <div className="stage-top">
            <div className="stage-tabs" role="tablist" aria-label={`${selectedExercise.label} workspace view`}>
              <button id="live-view-tab" type="button" role="tab" aria-selected={workspaceTab === 'live'} aria-controls="workspace-panel" onClick={() => setWorkspaceTab('live')}>Live</button>
              <button id="setup-view-tab" type="button" role="tab" aria-selected={workspaceTab === 'setup'} aria-controls="workspace-panel" onClick={() => setWorkspaceTab('setup')}>Setup / Reference</button>
            </div>
            <span className="resolution">{workspaceTab === 'live' ? '640 × 480 RGB' : selectedExercise.label.toUpperCase() + ' · CAMERA GUIDE'}</span>
          </div>
          <div id="workspace-panel" className={workspaceTab === 'setup' ? 'video-area reference-active' : 'video-area'} role="tabpanel" aria-labelledby={workspaceTab === 'live' ? 'live-view-tab' : 'setup-view-tab'}>
            <canvas ref={canvasRef} width="640" height="480" aria-label="Live Kinect camera feed with skeleton overlay" aria-hidden={workspaceTab === 'setup'} />
            {workspaceTab === 'setup' && <CameraGuide mode={exerciseId} framing={framing} connected={bridgeConnected} modelReady={modelReady} />}
            {!bridgeConnected && workspaceTab === 'live' && <div className="empty-state"><div className="reticle">＋</div><strong>{bridgeState === 'recovering' ? 'Restarting camera capture' : 'Waiting for camera feed'}</strong><span>{bridgeMessage ?? 'Connect your Kinect V1 and start the Python bridge.'}</span></div>}
          </div>
          <div className="stage-bottom"><span>POSE LANDMARKER · FULL</span><div className="feed-metrics"><span>FPS <strong>{fps}</strong></span><span>LANDMARKS <strong>{landmarkCount}<i>/ 33</i></strong></span></div></div>
        </div>
        <aside className={isGolf ? 'sidebar golf-sidebar' : 'sidebar'}>
          {isGolf ? <GolfDashboard snapshot={golfSnapshot} result={displayedSwing} handedness={handedness}
            sessionOpen={isSessionOpen} connected={bridgeConnected} modelReady={modelReady}
            onHandedness={setHandedness} onStart={startSession} onPause={pauseOrResume} onStop={stopSession}
            onSelectSwing={setSelectedSwingId} instructions={golfInstructions[golfSnapshot.status]} /> : <>
          <section className="session-panel" aria-label="Exercise session">
            <div className="session-head"><div className="session-count"><span>REPETITIONS</span><strong aria-live="polite">{sessionSnapshot.repetitions}</strong></div><div className="session-status"><span>SESSION</span><strong aria-live="polite">{sessionSnapshot.status}</strong><p>{sessionInstructions[sessionSnapshot.status]}</p></div></div>
            <div className="session-controls">
              <button type="button" className="session-button primary" onClick={startSession} disabled={isSessionOpen}>Start</button>
              <button type="button" className="session-button" onClick={pauseOrResume} disabled={!isSessionOpen}>{sessionSnapshot.status === 'Paused' ? 'Resume' : 'Pause'}</button>
              <button type="button" className="session-button" onClick={stopSession} disabled={!isSessionOpen}>Stop</button>
            </div>
            {sessionSnapshot.summary && <div className="session-summary" role="status"><strong>Session complete</strong><span>{exerciseModes.find((mode) => mode.id === sessionSnapshot.summary?.exercise)?.label}: {sessionSnapshot.summary.repetitions} completed {sessionSnapshot.summary.repetitions === 1 ? 'repetition' : 'repetitions'}</span></div>}
          </section>
          <div className={`panel phase-panel ${phaseSnapshot.phase === 'Tracking Lost' || phaseSnapshot.phase === 'Not Ready' ? 'phase-unavailable' : ''}`}>
            <div className="panel-label">{selectedExercise.label.toUpperCase()} · MOVEMENT PHASE</div>
            <div className={`tracking-badge ${phaseSnapshot.tracking}`}>{cameraDisconnected ? 'Kinect Disconnected' : phaseSnapshot.tracking === 'partial' ? 'Partial Tracking' : phaseSnapshot.tracking === 'lost' ? 'Tracking Lost' : phaseSnapshot.tracking === 'tracking' ? 'Tracking' : 'Not Ready'}</div>
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
          <FormDashboard session={sessionSnapshot} selectedRep={selectedFormRep} onSelectRep={setSelectedFormRep} />
          <div className="exercise-system"><span>{statusText}</span><span>Kinect <b>{bridgeConnected ? 'Connected' : bridgeState === 'recovering' ? 'Recovering' : 'Offline'}</b></span><span>Pose <b>{modelReady ? 'Ready' : 'Loading'}</b></span><span>Restarts <b>{restartCount}</b></span></div>
          {error && <div className="error-panel" role="alert"><strong>Connection or tracking error</strong><p>{error}</p></div>}
          </>}
        </aside>
      </section>
    </main>
  )
}
