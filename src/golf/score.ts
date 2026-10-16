import { golfConfig } from './config.ts'
import { handLift, imageYToX, range, torsoTurn, trailTravel } from './measure.ts'
import type { GolfSample } from './measure.ts'
import type { GolfCategory, GolfResult, Handedness } from './types.ts'

const clamp = (value: number) => Math.max(0, Math.min(1, value))
const lower = (value: number, full: number, poor: number) => clamp((poor - value) / (poor - full))
const higher = (value: number, full: number, poor: number) => clamp((value - poor) / (full - poor))
const within = (value: number, fullLow: number, fullHigh: number, poorLow: number, poorHigh: number) =>
  Math.min(higher(value, fullLow, poorLow), lower(value, fullHigh, poorHigh))
const round = (value: number) => Math.round(value * 10) / 10
const widths = (value: number) => `${round(value)} shoulder widths`
const percentile = (values: number[], fraction: number) => {
  const ordered = [...values].sort((a, b) => a - b)
  return ordered[Math.floor((ordered.length - 1) * fraction)]
}
const categoryNames = ['Setup and posture', 'Arm mechanics', 'Balance and lower-body control',
  'Swing tempo', 'Follow-through and finish']
const observed = (samples: GolfSample[], key: keyof GolfSample, minCount: number): number[] | null => {
  const values = samples.map((sample) => sample[key]).filter((value): value is number =>
    typeof value === 'number' && Number.isFinite(value))
  return values.length >= minCount && values.length / samples.length >= golfConfig.minArmCoverage ? values : null
}

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
  const leadWindow = samples.filter((sample) => sample.at <= passAt)
  const deliveryWindow = samples.filter((sample) => sample.at >= topAt && sample.at <= passAt)
  const leadAngles = observed(leadWindow, 'leadElbowAngle', golfConfig.minLeadSamples)
  const trailAngles = observed(deliveryWindow, 'trailElbowAngle', golfConfig.minTrailSamples)
  const trailHipDistances = observed(deliveryWindow, 'trailElbowHipDistance', golfConfig.minTrailSamples)
  const trailTorsoDistances = observed(deliveryWindow, 'trailElbowTorsoDistance', golfConfig.minTrailSamples)
  // Quantiles require a sustained observation, not a single outlier frame.
  const leadElbowAngle = leadAngles ? percentile(leadAngles, 0.25) : null
  const trailElbowAngle = trailAngles ? percentile(trailAngles, 0.5) : null
  const trailElbowHipDistance = trailHipDistances ? percentile(trailHipDistances, 0.70) : null
  const trailElbowTorsoDistance = trailTorsoDistances ? percentile(trailTorsoDistances, 0.70) : null
  const trailAvailable = trailElbowAngle !== null &&
    trailElbowHipDistance !== null && trailElbowTorsoDistance !== null
  const armsAvailable = leadElbowAngle !== null && trailAvailable
  const setupMeasures = [lower(address.alignment, ...golfConfig.setupAlignment),
    lower(addressStill, ...golfConfig.setupStability)]
  if (stanceRatio !== null) setupMeasures.push(Math.min(
    higher(stanceRatio, ...golfConfig.stanceRatio),
    lower(stanceRatio, ...golfConfig.stanceTooWide)))
  const setupScore = 2 * (setupMeasures[0] * 0.4 + setupMeasures[1] * 0.4 +
    (setupMeasures[2] ?? (setupMeasures[0] + setupMeasures[1]) / 2) * 0.2)
  const leadScore = leadElbowAngle === null ? null : higher(leadElbowAngle, ...golfConfig.leadExtension)
  const trailScore = !trailAvailable ? null : (
    within(trailElbowAngle!, ...golfConfig.trailFlexion) * 0.25 +
    lower(trailElbowHipDistance!, ...golfConfig.trailHipDistance) * 0.40 +
    lower(trailElbowTorsoDistance!, ...golfConfig.trailTorsoDistance) * 0.35)
  const armScore = leadScore === null || trailScore === null ? null : round(leadScore + trailScore)
  const leadIssue = leadElbowAngle !== null && leadElbowAngle < golfConfig.leadExtension[0]
  const trailIssue = trailElbowHipDistance !== null && trailElbowTorsoDistance !== null &&
    (trailElbowHipDistance > golfConfig.trailHipDistance[0] ||
      trailElbowTorsoDistance > golfConfig.trailTorsoDistance[0])

  const categories: GolfCategory[] = [
    {
      name: 'Setup and posture',
      score: setupScore,
      explanation: `Shoulder–hip offset ${widths(address.alignment)}; address movement ${widths(addressStill)}; ${stanceRatio === null ? 'stance width unavailable from stable ankle landmarks and excluded' : `stance width ${round(stanceRatio)}× shoulder width`}.`,
      suggestion: addressStill > golfConfig.setupStability[0]
        ? `Address movement was ${widths(addressStill)}; pause briefly before starting.`
        : address.alignment > golfConfig.setupAlignment[0]
          ? `Shoulder–hip offset was ${widths(address.alignment)} at address; check your face-on framing and stance.`
          : stanceRatio !== null && (stanceRatio < golfConfig.stanceRatio[0] || stanceRatio > golfConfig.stanceTooWide[0])
            ? `Measured stance width was ${round(stanceRatio)}× shoulder width; check that both feet are visible and comfortably placed.`
            : 'Address measurements were within the broad pilot bands.',
    },
    {
      name: 'Arm mechanics',
      score: armScore,
      explanation: `Lead Arm Extension: ${leadElbowAngle === null ? 'unavailable (insufficient visible shoulder–elbow–wrist samples)' : `${round(leadElbowAngle)}° lower-quartile angle through the estimated strike region`}. Trail Elbow Delivery: ${!trailAvailable ? 'unavailable (insufficient visible trail arm/hip samples)' : `${round(trailElbowAngle!)}° median flexion, ${round(trailElbowHipDistance!)}× torso length from trail hip, ${round(trailElbowTorsoDistance!)}× torso length from trail torso during delivery`}.`,
      suggestion: !armsAvailable ? `Keep the ${leadElbowAngle === null ? 'lead shoulder, elbow, and wrist' : 'trail shoulder, elbow, wrist, and hip'} visible through the ${leadElbowAngle === null ? 'backswing' : 'downswing delivery'}.`
        : leadIssue ? `Lead elbow angle fell to ${round(leadElbowAngle!)}° across observed pre-strike frames; try keeping a wider arc near the top.`
          : trailIssue ? `Trail elbow measured ${round(trailElbowHipDistance!)}× torso length from the hip and ${round(trailElbowTorsoDistance!)}× from the torso during delivery; try a more connected downswing.`
            : trailElbowAngle! < golfConfig.trailFlexion[0] || trailElbowAngle! > golfConfig.trailFlexion[1]
              ? `Trail elbow flexion measured ${round(trailElbowAngle!)}° during delivery; review the arm position in your recording.`
              : 'Observed lead-arm extension and trail-elbow delivery were within the broad pilot bands.',
    },
    {
      name: 'Balance and lower-body control',
      score: 2 * (lower(hipSway, ...golfConfig.hipSway) + lower(torsoDrift, ...golfConfig.torsoDrift)) / 2,
      explanation: `Sustained hip-center drift ${widths(hipSway)}; torso-center drift ${widths(torsoDrift)}. Natural rotation and weight transfer are allowed.`,
      suggestion: hipSway > golfConfig.hipSway[0] || torsoDrift > golfConfig.torsoDrift[0]
        ? `Body-center drift was sustained (hip ${widths(hipSway)}, torso ${widths(torsoDrift)}); review lateral movement in your face-on recording.`
        : 'Measured body-center travel was within the broad pilot bands; natural rotation is expected.',
    },
    {
      name: 'Swing tempo',
      score: 2 * lower(Math.abs(Math.log(ratio / golfConfig.tempoIdeal)),
        golfConfig.tempoLogTolerance, golfConfig.tempoLogPoor),
      explanation: `Backswing ${round(backswingMs / 1000)}s; downswing to strike region ${round(downswingMs / 1000)}s; tempo ratio ${round(ratio)}:1.`,
      suggestion: `Observed backswing-to-delivery timing was ${round(ratio)}:1; try a steadier transition if that differs from your intended tempo.`,
    },
    {
      name: 'Follow-through and finish',
      score: 2 * (higher(handFollowThrough, ...golfConfig.finishTravel) +
        higher(followLift, ...golfConfig.finishLiftScore) +
        higher(finishTurn, ...golfConfig.finishTurnScore) +
        lower(finishStill, ...golfConfig.finishStability)) / 4,
      explanation: `Observed lead-side hand travel ${widths(handFollowThrough)}; lift ${widths(followLift)}; torso turn ${round(finishTurn)}; finish movement ${widths(finishStill)}.`,
      suggestion: `Observed follow-through travel was ${widths(handFollowThrough)} and finish movement ${widths(finishStill)}; continue toward the lead side and hold the finish.`,
    },
  ].map((category) => ({ ...category, score: category.score === null ? null : round(category.score) }))
  const score = categories.some((category) => category.score === null) ? null :
    round(categories.reduce((sum, category) => sum + category.score!, 0))
  return {
    ...base, score, reason: score === null ? 'Unable to Score: lead or trail arm coverage was insufficient. Visible categories remain available below.' : null, categories,
    measurements: {
      handBackswing: round(handBackswing), handFollowThrough: round(handFollowThrough),
      shoulderTravel: round(shoulderTravel), torsoOffset: round(torsoOffset),
      hipSway: round(hipSway), torsoDrift: round(torsoDrift),
      stanceRatio: stanceRatio === null ? null : round(stanceRatio),
      leadElbowAngle: leadElbowAngle === null ? null : round(leadElbowAngle),
      trailElbowAngle: trailElbowAngle === null ? null : round(trailElbowAngle),
      trailElbowHipDistance: trailElbowHipDistance === null ? null : round(trailElbowHipDistance),
      trailElbowTorsoDistance: trailElbowTorsoDistance === null ? null : round(trailElbowTorsoDistance),
    },
    wentWell: categories.filter((category) => category.score !== null && category.score >= 1.5).map((category) => `${category.name}: ${category.explanation}`),
    improve: categories.filter((category) => category.score !== null && category.score < 1.5).map((category) => category.suggestion),
  }
}
