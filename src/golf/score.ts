import { golfConfig } from './config.ts'
import { handLift, imageYToX, range, torsoTurn, trailTravel } from './measure.ts'
import type { GolfSample } from './measure.ts'
import type { GolfCategory, GolfResult, Handedness } from './types.ts'

const clamp = (value: number) => Math.max(0, Math.min(1, value))
const lower = (value: number, full: number, poor: number) => clamp((poor - value) / (poor - full))
const higher = (value: number, full: number, poor: number) => clamp((value - poor) / (full - poor))
const round = (value: number) => Math.round(value * 10) / 10
const widths = (value: number) => `${round(value)} shoulder widths`
const percentile = (values: number[], fraction: number) => {
  const ordered = [...values].sort((a, b) => a - b)
  return ordered[Math.floor((ordered.length - 1) * fraction)]
}
const categoryNames = ['Setup and posture', 'Upper-body stability', 'Balance and lower-body control',
  'Swing tempo', 'Follow-through and finish']

export function scoreGolfSwing(input: {
  id: number
  handedness: Handedness
  address: GolfSample
  addressSamples: GolfSample[]
  samples: GolfSample[]
  finishSamples: GolfSample[]
  startAt: number
  topAt: number
  passAt: number
  finishAt: number
  missingMs: number
}): GolfResult {
  const { id, handedness, address, addressSamples, samples, finishSamples, startAt, topAt, passAt, finishAt, missingMs } = input
  const durationMs = finishAt - startAt
  const backswingMs = topAt - startAt
  const downswingMs = passAt - topAt
  const base = { id, handedness, durationMs, backswingMs, downswingMs }
  const fail = (reason: string): GolfResult => ({
    ...base, score: null, reason,
    categories: categoryNames.map((name) => ({
      name, score: null, explanation: 'Unavailable: too few reliable measurements for this swing.',
      suggestion: 'Keep your body and hands in view through a complete swing.',
    })), measurements: null,
    wentWell: [], improve: [],
  })
  if (samples.length < golfConfig.minSwingSamples || finishSamples.length < 3 ||
    backswingMs <= 0 || downswingMs <= 0 || durationMs <= 0 ||
    missingMs / durationMs > golfConfig.maxMissingFraction) {
    return fail('Unable to Score: too few reliable body measurements or an interrupted swing.')
  }

  const scale = address.scale
  const handSamples = samples.filter((sample) => sample.handX !== null)
  if (handSamples.length < golfConfig.minSwingSamples * 0.6) {
    return fail('Unable to Score: too little observed hand travel.')
  }
  // Ankle width can inform address posture, but never becomes a swing-motion signal.
  const stanceValues = addressSamples.map((sample) => sample.stanceRatio)
    .filter((value): value is number => value !== null && Number.isFinite(value))
  const stanceRatio = stanceValues.length >= 3 &&
    stanceValues.length / addressSamples.length >= 0.6 &&
    Math.max(...stanceValues) - Math.min(...stanceValues) <= golfConfig.stanceStabilityMax
    ? percentile(stanceValues, 0.5) : null
  // A single mislocated landmark should not become the worst observed movement.
  const shoulderTravel = percentile(samples.map((sample) => Math.abs(sample.shoulderX - address.shoulderX) / scale), 0.8)
  const hipSway = percentile(samples.map((sample) => Math.abs(sample.hipX - address.hipX) / scale), 0.8)
  const torsoOffset = percentile(samples.map((sample) =>
    Math.abs((sample.shoulderX - sample.hipX) - (address.shoulderX - address.hipX)) / scale), 0.8)
  const torsoDrift = percentile(samples.map((sample) =>
    Math.abs((sample.shoulderX + sample.hipX - address.shoulderX - address.hipX) / (2 * scale))), 0.8)
  const handBackswing = Math.max(...handSamples.map((sample) => trailTravel(sample, address)!))
  const handFollowThrough = Math.max(...handSamples.map((sample) => -trailTravel(sample, address)!))
  const followLift = Math.max(0, ...samples.map((sample) => handLift(sample, address) ?? 0))
  const finishTurn = Math.max(...finishSamples.map((sample) => torsoTurn(sample, address)))
  const addressStill = Math.max(range(addressSamples, 'handX'), range(addressSamples, 'handY') * imageYToX) / scale
  const finishStill = Math.max(range(finishSamples, 'shoulderX'), range(finishSamples, 'hipX'), range(finishSamples, 'scale')) / scale
  const ratio = backswingMs / downswingMs
  const setupMeasures = [lower(address.alignment, ...golfConfig.setupAlignment),
    lower(addressStill, ...golfConfig.setupStability)]
  if (stanceRatio !== null) setupMeasures.push(Math.min(
    higher(stanceRatio, ...golfConfig.stanceRatio),
    lower(stanceRatio, ...golfConfig.stanceTooWide)))

  const categories: GolfCategory[] = [
    {
      name: 'Setup and posture',
      score: 2 * setupMeasures.reduce((sum, value) => sum + value, 0) / setupMeasures.length,
      explanation: `Shoulder–hip offset ${widths(address.alignment)}; address movement ${widths(addressStill)}; ${stanceRatio === null ? 'stance width unavailable from stable ankle landmarks and excluded' : `stance width ${round(stanceRatio)}× shoulder width`}.`,
      suggestion: 'Settle into a comfortable, steady address before starting.',
    },
    {
      name: 'Upper-body stability',
      score: 2 * (lower(shoulderTravel, ...golfConfig.shoulderTravel) +
        lower(torsoOffset, ...golfConfig.torsoOffset)) / 2,
      explanation: `Sustained shoulder-center travel ${widths(shoulderTravel)}; torso-offset change ${widths(torsoOffset)}.`,
      suggestion: 'Keep your upper body controlled as your arms move through the swing.',
    },
    {
      name: 'Balance and lower-body control',
      score: 2 * (lower(hipSway, ...golfConfig.hipSway) + lower(torsoDrift, ...golfConfig.torsoDrift)) / 2,
      explanation: `Sustained hip-center drift ${widths(hipSway)}; torso-center drift ${widths(torsoDrift)}. Natural rotation and weight transfer are allowed.`,
      suggestion: 'Allow natural hip turn and weight transfer while keeping your body centered through the finish.',
    },
    {
      name: 'Swing tempo',
      score: 2 * lower(Math.abs(Math.log(ratio / golfConfig.tempoIdeal)),
        golfConfig.tempoLogTolerance, golfConfig.tempoLogPoor),
      explanation: `Backswing ${round(backswingMs / 1000)}s; downswing to strike region ${round(downswingMs / 1000)}s; tempo ratio ${round(ratio)}:1.`,
      suggestion: 'Let the backswing develop steadily, then move through the strike region without rushing.',
    },
    {
      name: 'Follow-through and finish',
      score: 2 * (higher(handFollowThrough, ...golfConfig.finishTravel) +
        higher(followLift, ...golfConfig.finishLiftScore) +
        higher(finishTurn, ...golfConfig.finishTurnScore) +
        lower(finishStill, ...golfConfig.finishStability)) / 4,
      explanation: `Observed lead-side hand travel ${widths(handFollowThrough)}; lift ${widths(followLift)}; torso turn ${round(finishTurn)}; finish movement ${widths(finishStill)}.`,
      suggestion: 'Continue your hands toward the lead side and hold a balanced finish.',
    },
  ].map((category) => ({ ...category, score: round(category.score) }))
  const score = round(categories.reduce((sum, category) => sum + category.score!, 0))
  return {
    ...base, score, reason: null, categories,
    measurements: {
      handBackswing: round(handBackswing), handFollowThrough: round(handFollowThrough),
      shoulderTravel: round(shoulderTravel), torsoOffset: round(torsoOffset),
      hipSway: round(hipSway), torsoDrift: round(torsoDrift),
      stanceRatio: stanceRatio === null ? null : round(stanceRatio),
    },
    wentWell: categories.filter((category) => category.score !== null && category.score >= 1.5).map((category) => `${category.name}: ${category.explanation}`),
    improve: categories.filter((category) => category.score !== null && category.score < 1.5).map((category) => category.suggestion),
  }
}
