import type { GolfResult, GolfSnapshot, Handedness } from './types.ts'

type Props = {
  snapshot: GolfSnapshot
  result: GolfResult | null
  handedness: Handedness
  sessionOpen: boolean
  connected: boolean
  modelReady: boolean
  onHandedness: (value: Handedness) => void
  onStart: () => void
  onPause: () => void
  onStop: () => void
  onSelectSwing: (id: number | null) => void
  instructions: string
}

const seconds = (milliseconds: number) => `${(milliseconds / 1000).toFixed(1)}s`

export function GolfDashboard({ snapshot, result, handedness, sessionOpen, connected, modelReady,
  onHandedness, onStart, onPause, onStop, onSelectSwing, instructions }: Props) {
  const previous = result ? snapshot.history.find((swing) => swing.id === result.id - 1) : null
  const scoreChange = result?.score !== null && result?.score !== undefined && previous?.score !== null && previous?.score !== undefined
    ? result.score - previous.score : null
  return <>
    <section className="session-panel golf-session" aria-label="Golf swing session">
      <div className="session-head"><div className="session-count"><span>SWINGS</span><strong>{snapshot.swings}</strong></div><div className="session-status"><span>SESSION</span><strong aria-live="polite">{snapshot.status}</strong><p>{instructions}</p></div></div>
      <div className="golf-hands" aria-label="Golfer handedness">
        <span>HAND</span>
        {(['right', 'left'] as const).map((hand) => <button type="button" key={hand}
          className={handedness === hand ? 'hand-button active' : 'hand-button'}
          aria-pressed={handedness === hand} disabled={sessionOpen}
          onClick={() => onHandedness(hand)}>{hand === 'right' ? 'Right' : 'Left'}</button>)}
      </div>
      <div className="session-controls">
        <button type="button" className="session-button primary" onClick={onStart} disabled={sessionOpen}>Start</button>
        <button type="button" className="session-button" onClick={onPause} disabled={!sessionOpen}>{snapshot.status === 'Paused' ? 'Resume' : 'Pause'}</button>
        <button type="button" className="session-button" onClick={onStop} disabled={!sessionOpen}>Stop</button>
      </div>
    </section>
    <section className="panel golf-phase" aria-label="Golf swing stage">
      <div className="panel-label">GOLF SWING · STAGE</div>
      <div className="golf-phase-line"><h2 aria-live="polite">{snapshot.phase}</h2><span className={`tracking-badge ${snapshot.tracking}`}>{connected ? snapshot.tracking.replace('-', ' ') : 'Kinect disconnected'}</span></div>
      <p>{snapshot.detail}</p>
    </section>
    <section className="panel golf-result" aria-label="Golf swing results">
      {result ? <>
        <div className="golf-result-head"><div><span className="panel-label">SWING {result.id} · {result.handedness.toUpperCase()}-HANDED</span><h2>{result.score === null ? 'Unable to Score' : <>{result.score.toFixed(1)} <small>/ 10</small></>}</h2></div><span>{seconds(result.durationMs)} total{scoreChange !== null && <> · {scoreChange >= 0 ? '+' : ''}{scoreChange.toFixed(1)} vs prior</>}</span></div>
        {result.score === null ? <p className="golf-unscored">{result.reason}</p> :
          <div className="golf-timing"><span>Backswing <b>{seconds(result.backswingMs)}</b></span><span>Downswing <b>{seconds(result.downswingMs)}</b></span><span>Hand path <b>{result.measurements!.handBackswing} / {result.measurements!.handFollowThrough}× shoulder width</b></span></div>}
        <div className="golf-category-list">{result.categories.map((category) => <details key={category.name}>
          <summary><span>{category.name}</span><b>{category.score === null ? 'N/A' : `${category.score.toFixed(1)} / 2`}</b></summary>
          <p>{category.explanation}</p><p>{category.suggestion}</p>
        </details>)}</div>
        {result.score !== null && <>
          <div className="golf-feedback"><div><b>What went well</b><p>{result.wentWell.length ? result.wentWell.join(' · ') : 'No category reached 1.5 / 2 in this swing.'}</p></div><div><b>Next swing</b><p>{result.improve.length ? result.improve.slice(0, 2).join(' ') : 'Repeat the measured movement and aim for the same balance and tempo.'}</p></div></div>
          <div className="golf-measures">Hip drift {result.measurements!.hipSway}× · torso drift {result.measurements!.torsoDrift}× · shoulder travel {result.measurements!.shoulderTravel}×</div>
        </>}
      </> : <div className="golf-setup"><span className="panel-label">SWING RESULTS</span><h2>Your next swing appears here</h2><p>Open Setup / Reference above the camera to check your position, then start a session and hold a steady address. Recorded practice swings and scores will appear in this panel.</p><p>Scores estimate visible body movement from one RGB camera. Clubhead, clubface, exact impact, and ball flight are not measured.</p></div>}
      {snapshot.history.length > 0 && <div className="golf-history"><span className="panel-label">THIS SESSION</span><div>{snapshot.history.map((swing) => <button type="button" key={swing.id} onClick={() => onSelectSwing(swing.id)}>#{swing.id} {swing.score === null ? 'N/A' : swing.score.toFixed(1)}</button>)}<button type="button" onClick={() => onSelectSwing(null)}>Latest</button></div></div>}
    </section>
    <div className="golf-system"><span>Kinect <b>{connected ? 'Connected' : 'Offline'}</b></span><span>Pose <b>{modelReady ? 'Ready' : 'Loading'}</b></span><span>Tracking <b>{snapshot.tracking}</b></span></div>
  </>
}
