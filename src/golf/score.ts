import { golfConfig } from './config.ts'
import { handLift, imageYToX, range, torsoTurn, trailTravel } from './measure.ts'
import type { GolfSample } from './measure.ts'
import type { GolfCategory, GolfResult, Handedness } from './types.ts'

const clamp = (value: number) => Math.max(0, Math.min(1, value))
const lower = (value: number, full: number, poor: number) => clamp((poor - value) / (poor - full))
const higher = (value: number, full: number, poor: number) => clamp((value - poor) / (full - poor))
const round = (value: number) => Math.round(value * 10) / 10
const widths = (value: number) => `${round(value)} shoulder widths`

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
    ...base, score: null, reason, categories: [], measurements: null,
    wentWell: [], improve: [],
  })
  if (samples.length < golfConfig.minSwingSamples || finishSamples.length < 3 ||
    backswingMs <= 0 || downswingMs <= 0 || durationMs <= 0 ||
    missingMs / durationMs > golfConfig.maxMissingFraction) {
    return fail('Unable to Score: too few reliable body measurements or an interrupted swing.')
  }

  const scale = address.scale
  const handSamples = samples.filter((sample) => sample.handX !== null)
  const ankleSamples = samples.filter((sample) => sample.ankleX !== null)
  const stanceRatio = addressSamples.find((sample) => sample.stanceRatio !== null)?.stanceRatio ?? null
  if (handSamples.length < golfConfig.minSwingSamples * 0.6 ||
    ankleSamples.length / samples.length < 0.6 || stanceRatio === null) {
    return fail('Unable to Score: hand path, stance, or lower-body measurements were insufficient.')
  }
  const shoulderTravel = Math.max(...samples.map((sample) => Math.abs(sample.shoulderX - address.shoulderX) / scale))
  const hipSway = Math.max(...samples.map((sample) => Math.abs(sample.hipX - address.hipX) / scale))
  const ankleAnchor = addressSamples.find((sample) => sample.ankleX !== null)?.ankleX
  if (ankleAnchor === null || ankleAnchor === undefined) return fail('Unable to Score: feet were not visible at address.')
  const ankleShift = Math.max(...ankleSamples.map((sample) => Math.abs(sample.ankleX! - ankleAnchor) / scale))
  const heads = samples.filter((sample) => sample.headX !== null)
  const headTravel = address.headX !== null && heads.length / samples.length >= 0.6
    ? Math.max(...heads.map((sample) => Math.abs(sample.headX! - address.headX!) / scale)) : null
  const handBackswing = Math.max(...handSamples.map((sample) => trailTravel(sample, address)!))
  const handFollowThrough = Math.max(...handSamples.map((sample) => -trailTravel(sample, address)!))
  const followLift = Math.max(0, ...samples.map((sample) => handLift(sample, address) ?? 0))
  const finishTurn = Math.max(...finishSamples.map((sample) => torsoTurn(sample, address)))
  const addressStill = Math.max(range(addressSamples, 'handX'), range(addressSamples, 'handY') * imageYToX) / scale
  const finishStill = Math.max(range(finishSamples, 'shoulderX'), range(finishSamples, 'hipX'), range(finishSamples, 'scale')) / scale
  const ratio = backswingMs / downswingMs

  const categories: GolfCategory[] = [
    {
      name: 'Setup and posture',
      score: 2 * (lower(address.alignment, ...golfConfig.setupAlignment) +
        Math.min(higher(stanceRatio, ...golfConfig.stanceRatio),
          lower(stanceRatio, ...golfConfig.stanceTooWide)) +
        lower(addressStill, ...golfConfig.setupStability)) / 3,
      explanation: `Shoulder–hip offset ${widths(address.alignment)}; stance ${round(stanceRatio)}× shoulder width; address movement ${widths(addressStill)}.`,
      suggestion: 'Set your feet at a comfortable width and settle your hands before starting.',
    },
    {
      name: 'Head and upper-body stability',
      score: 2 * (headTravel === null
        ? lower(shoulderTravel, ...golfConfig.shoulderTravel)
        : (lower(shoulderTravel, ...golfConfig.shoulderTravel) + lower(headTravel, ...golfConfig.headTravel)) / 2),
      explanation: `Shoulder-center travel ${widths(shoulderTravel)}; ${headTravel === null ? 'head landmarks were insufficient, so head motion was excluded' : `head travel ${widths(headTravel)}`}.`,
      suggestion: 'Keep your upper body centered as your arms move through the swing.',
    },
    {
      name: 'Balance and lower-body control',
      score: 2 * (lower(hipSway, ...golfConfig.hipSway) + lower(ankleShift, ...golfConfig.ankleShift)) / 2,
      explanation: `Hip-center sway ${widths(hipSway)}; ankle-center shift ${widths(ankleShift)}.`,
      suggestion: 'Stay balanced over your stance and limit excessive lateral hip sway.',
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
  const score = round(categories.reduce((sum, category) => sum + category.score, 0))
  return {
    ...base, score, reason: null, categories,
    measurements: {
      handBackswing: round(handBackswing), handFollowThrough: round(handFollowThrough),
      headTravel: headTravel === null ? null : round(headTravel), shoulderTravel: round(shoulderTravel),
      hipSway: round(hipSway), ankleShift: round(ankleShift), stanceRatio: round(stanceRatio),
    },
    wentWell: categories.filter((category) => category.score >= 1.5).map((category) => `${category.name}: ${category.explanation}`),
    improve: categories.filter((category) => category.score < 1.5).map((category) => category.suggestion),
  }
}
