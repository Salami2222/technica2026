import type { ExerciseId } from '../exercises.ts'
import { formConfig } from './config.ts'
import type { FormCategory, FormResult, FormSample, FormSummary } from './types.ts'

const clamp = (value: number) => Math.max(0, Math.min(1, value))
const lower = (value: number, full: number, poor: number) => clamp((poor - value) / (poor - full))
const higher = (value: number, full: number, poor: number) => clamp((value - poor) / (full - poor))
const round = (value: number) => Math.round(value * 10) / 10
const category = (name: string, score: number | null, explanation: string, suggestion: string): FormCategory =>
  ({ name, score: score === null ? null : round(score), explanation, suggestion })
const unavailable = 'Unavailable: too few reliable landmarks during this repetition.'
const enough = (count: number, total: number, minimum = 3) => count >= minimum && count / total >= formConfig.minCoverage

export function motionControl(samples: readonly FormSample[]): { reversals: number; speedRatio: number } | null {
  const speeds: number[] = []
  let direction = 0
  let reversals = 0
  for (let i = 1; i < samples.length; i++) {
    const delta = samples[i].angle - samples[i - 1].angle
    const elapsed = samples[i].at - samples[i - 1].at
    if (elapsed <= 0 || elapsed > 400) continue
    if (Math.abs(delta) >= 5) {
      const next = Math.sign(delta)
      if (direction && direction !== next) reversals++
      direction = next
      speeds.push(Math.abs(delta) / elapsed)
    }
  }
  if (speeds.length < 3) return null
  const ordered = [...speeds].sort((a, b) => a - b)
  const median = ordered[Math.floor(ordered.length / 2)]
  return { reversals: Math.max(0, reversals - 1), speedRatio: Math.max(...speeds) / Math.max(median, 0.001) }
}

export function hipJitter(samples: readonly FormSample[]): number | null {
  const hip = samples.filter((sample) => sample.hipX !== null && sample.torsoScale !== null)
  if (!enough(hip.length, samples.length) || hip.length < 4) return null
  const residuals: number[] = []
  for (let i = 1; i < hip.length - 1; i++) {
    const before = hip[i - 1], current = hip[i], after = hip[i + 1]
    const span = after.at - before.at
    if (span <= 0 || span > 500) continue
    const expected = before.hipX! + (after.hipX! - before.hipX!) * (current.at - before.at) / span
    residuals.push(Math.abs(current.hipX! - expected) / current.torsoScale!)
  }
  if (!residuals.length) return null
  residuals.sort((a, b) => a - b)
  return residuals[Math.floor((residuals.length - 1) * 0.8)]
}

export function scoreExerciseRep(exercise: ExerciseId, repetition: number,
  samples: readonly FormSample[], previousDepth: number | null): FormResult {
  const valid = samples.length >= formConfig.minSamples && samples.every((sample) => sample.side === samples[0].side)
  const depthAngle = valid ? Math.min(...samples.map((sample) => sample.angle)) : null
  const durationMs = valid ? samples.at(-1)!.at - samples[0].at : null
  const startAngle = valid ? samples[0].angle : null
  const endAngle = valid ? samples.at(-1)!.angle : null
  const excursion = valid ? Math.max(...samples.map((sample) => sample.angle)) - depthAngle! : null
  const control = valid ? motionControl(samples) : null
  const depth = exercise === 'squat' ? formConfig.squat.depthKnee : formConfig.pushUp.depthElbow
  const range = exercise === 'squat' ? formConfig.squat.depthExcursion : formConfig.pushUp.depthExcursion
  const depthScore = valid ? 2 * (lower(depthAngle!, depth[0], depth[1]) + higher(excursion!, range[0], range[1])) / 2 : null
  const depthName = exercise === 'squat' ? 'Squat depth' : 'Range of motion'
  const depthCategory = category(depthName, depthScore,
    valid ? `Lowest ${exercise === 'squat' ? 'knee' : 'elbow'} angle ${round(depthAngle!)}°; excursion ${round(excursion!)}°.` : unavailable,
    exercise === 'squat' ? 'Lower into a comfortable deeper squat while keeping control.' : 'Lower with control to increase elbow range, then return to extended arms.')

  let posture: FormCategory
  let stability: FormCategory
  if (exercise === 'squat') {
    const torso = samples.filter((sample) => sample.torsoLean !== null)
    const leanChange = valid && enough(torso.length, samples.length) ?
      Math.max(...torso.map((sample) => Math.abs(sample.torsoLean! - torso[0].torsoLean!))) : null
    posture = category('Torso control', leanChange === null ? null : 2 * lower(leanChange, ...formConfig.squat.torsoLeanChange),
      leanChange === null ? unavailable : `Torso inclination changed ${round(leanChange)}° from the observed start.`,
      'Keep your torso angle steadier through the descent and ascent; use a comfortable natural lean.')
    const jitter = valid ? hipJitter(samples) : null
    stability = category('Stability', jitter === null ? null : 2 * lower(jitter, ...formConfig.squat.hipPathJitter),
      jitter === null ? unavailable : `Hip-path irregularity ${round(jitter)}× torso length.`,
      'Move your hips on a smoother path without abrupt side-to-side corrections.')
  } else {
    const body = samples.filter((sample) => sample.bodyOffset !== null)
    const offset = valid && enough(body.length, samples.length) ?
      body.reduce((worst, sample) => Math.abs(sample.bodyOffset!) > Math.abs(worst) ? sample.bodyOffset! : worst, 0) : null
    posture = category('Body alignment', offset === null ? null : 2 * lower(Math.abs(offset), ...formConfig.pushUp.bodyOffset),
      offset === null ? unavailable : `Peak hip offset ${round(Math.abs(offset))}× body length (${offset >= 0 ? 'sag' : 'pike'} direction in the image).`,
      offset !== null && offset < 0 ? 'Keep your hips in line with shoulders and ankles instead of lifting them.' :
        'Brace your midsection to keep hips aligned between shoulders and ankles.')
    const wrists = samples.filter((sample) => sample.wristX !== null && sample.wristY !== null && sample.bodyScale !== null)
    const drift = valid && enough(wrists.length, samples.length) ?
      Math.max(...wrists.map((sample) => Math.hypot(sample.wristX! - wrists[0].wristX!, sample.wristY! - wrists[0].wristY!) / sample.bodyScale!)) : null
    stability = category('Stability', drift === null ? null : 2 * lower(drift, ...formConfig.pushUp.wristDrift),
      drift === null ? unavailable : `Tracked wrist-anchor drift ${round(drift)}× body length.`,
      'Keep your hands planted and reduce side-to-side movement during the repetition.')
  }

  const controlCategory = category('Movement control', control ?
    2 * (lower(control.reversals, ...formConfig.controlReversals) +
      lower(control.speedRatio, ...formConfig.controlSpeedRatio)) / 2 : null,
  control ? `${control.reversals} extra angle reversals; peak-to-median angular speed ${round(control.speedRatio)}×.` : unavailable,
  'Use a smooth descent and return without extra reversals or sudden speed spikes.')
  const finishGap = valid ? Math.abs(endAngle! - startAngle!) : null
  const depthGap = valid && previousDepth !== null ? Math.abs(depthAngle! - previousDepth) : null
  const consistencyCategory = category('Movement consistency', finishGap === null ? null :
    2 * (lower(finishGap, ...formConfig.finishExtensionGap) +
      (depthGap === null ? lower(finishGap, ...formConfig.finishExtensionGap) :
        lower(depthGap, ...formConfig.depthConsistencyGap))) / 2,
  finishGap === null ? unavailable : `Return-to-start angle gap ${round(finishGap)}°${depthGap === null ? '; first measured repetition.' : `; depth changed ${round(depthGap)}° from prior rep.`}`,
  'Return to a similar fully extended start and aim for a repeatable depth.')
  const categories = [depthCategory, posture, controlCategory, stability, consistencyCategory]
  const unavailableNames = categories.filter((item) => item.score === null).map((item) => item.name)
  const score = unavailableNames.length ? null : round(categories.reduce((sum, item) => sum + item.score!, 0))
  const positives = categories.filter((item) => item.score !== null && item.score >= 1.5).map((item) => `${item.name}: ${item.explanation}`)
  const issues = categories.filter((item) => item.score !== null && item.score < 1.3).map((item) => `${item.name}: ${item.explanation}`)
  const suggestions = categories.filter((item) => item.score !== null && item.score < 1.5).sort((a, b) => a.score! - b.score!)
    .slice(0, 2).map((item) => item.suggestion)
  if (score === null) {
    suggestions.unshift(`Keep the joints needed for ${unavailableNames.join(' and ').toLowerCase()} visible throughout the next repetition.`)
    suggestions.length = Math.min(suggestions.length, 2)
  }
  else if (!suggestions.length) {
    const lowest = [...categories].sort((a, b) => a.score! - b.score!)[0]
    suggestions.push(`Maintain your measured ${lowest.name.toLowerCase()} (${lowest.score!.toFixed(1)} / 2) on the next repetition.`)
  }
  return { repetition, exercise, score,
    reason: score === null ? `Unable to Score: ${unavailableNames.join(', ')} unavailable.` : null,
    categories, positives, issues, suggestions, depthAngle, durationMs }
}

export function summarizeForm(history: readonly FormResult[]): FormSummary {
  const scored = history.filter((result) => result.score !== null)
  const averageScore = scored.length ? round(scored.reduce((sum, result) => sum + result.score!, 0) / scored.length) : null
  const names = history[0]?.categories.map((item) => item.name) ?? []
  const averages = names.map((name) => {
    const values = scored.map((result) => result.categories.find((item) => item.name === name)?.score).filter((value): value is number => value !== null && value !== undefined)
    return { name, score: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null }
  }).filter((item): item is { name: string; score: number } => item.score !== null)
  const strongestCategory = averages.length ? [...averages].sort((a, b) => b.score - a.score)[0].name : null
  const areasToImprove = averages.filter((item) => item.score < 1.5).sort((a, b) => a.score - b.score).slice(0, 2).map((item) => item.name)
  return {
    scoredRepetitions: scored.length,
    acceptableRepetitions: scored.filter((result) => result.score! >= formConfig.acceptableScore).length,
    averageScore,
    strongestCategory,
    areasToImprove,
    feedback: !scored.length ? 'No repetition had enough reliable landmarks for a form score.' :
      areasToImprove.length ? `Focus on ${areasToImprove.join(' and ').toLowerCase()} next session.` :
        `Most consistent measured category: ${strongestCategory}.`,
  }
}
