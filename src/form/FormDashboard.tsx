import type { SessionSnapshot } from '../session/session.ts'
import { formConfig } from './config.ts'

type Props = { session: SessionSnapshot; selectedRep: number | null; onSelectRep: (rep: number | null) => void }

export function FormDashboard({ session, selectedRep, onSelectRep }: Props) {
  const result = session.formResults.find((item) => item.repetition === selectedRep) ?? session.latestForm
  const summary = session.formSummary
  return <section className="panel form-panel" aria-label="Exercise form analysis">
    <div className="form-top"><span className="panel-label">FORM ANALYSIS · PRELIMINARY ESTIMATE</span>
      <strong aria-live="polite">{result ? result.score === null ? 'Unable to Score' : <>{result.score.toFixed(1)} <small>/ 10</small></> : '—'}</strong></div>
    <p className="form-coach" aria-live="polite">{session.liveFeedback ?? (session.status === 'Recording' ? 'Continue the full movement with control.' :
      result?.suggestions[0] ?? 'A score appears after a completed, reliably tracked repetition.')}</p>
    {result && <>
      <div className="form-result-label">COMPLETED REP #{result.repetition} · {result.score === null ? 'NOT SCORED' : result.score >= formConfig.acceptableScore ? 'ACCEPTABLE FORM ESTIMATE' : 'FORM CAN IMPROVE'}</div>
      {result.reason && <p className="form-unavailable">{result.reason} The repetition still counts.</p>}
      {result.score === null && <p className="form-unavailable">Next rep: {result.suggestions[0]}</p>}
      <div className="form-categories">{result.categories.map((item) => <details key={item.name}>
        <summary><span>{item.name}</span><b>{item.score === null ? 'N/A' : `${item.score.toFixed(1)} / 2`}</b></summary>
        <p>{item.explanation}</p>{item.score !== null && item.score < 1.5 && <p>{item.suggestion}</p>}
      </details>)}</div>
      {result.score !== null && <div className="form-feedback"><p><b>Went well</b> {result.positives.length ? result.positives.slice(0, 2).join(' ') : 'No category reached 1.5 / 2.'}</p>
        <p><b>Improve</b> {result.issues.length ? result.issues.slice(0, 2).join(' ') : 'No major measured issue.'}</p>
        <p><b>Next rep</b> {result.suggestions.length ? result.suggestions.join(' ') : 'Repeat the measured range and control.'}</p></div>}
    </>}
    {session.formResults.length > 0 && <div className="form-history"><span className="panel-label">REPETITION SCORES</span><div>
      {session.formResults.map((item) => <button type="button" key={item.repetition} onClick={() => onSelectRep(item.repetition)}
        className={result?.repetition === item.repetition ? 'active' : ''}>#{item.repetition} {item.score === null ? 'N/A' : item.score.toFixed(1)}</button>)}
      <button type="button" onClick={() => onSelectRep(null)}>Latest</button>
    </div></div>}
    {summary && <div className="form-summary"><span className="panel-label">SESSION SUMMARY</span>
      <p><b>{session.repetitions}</b> completed · <b>{summary.scoredRepetitions}</b> scored · <b>{summary.acceptableRepetitions}</b> at or above {formConfig.acceptableScore} / 10</p>
      <p>Average <b>{summary.averageScore === null ? 'Unable to Score' : `${summary.averageScore.toFixed(1)} / 10`}</b></p>
      <p>Strongest: {summary.strongestCategory ?? 'Unavailable'} · Improve: {summary.scoredRepetitions === 0 ? 'Unavailable' : summary.areasToImprove.join(', ') || 'No category below 1.5 / 2'}</p>
      <p>{summary.feedback}</p>
    </div>}
  </section>
}
