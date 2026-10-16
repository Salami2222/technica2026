import type { PoseLandmarkerResult } from '@mediapipe/tasks-vision'
import { golfConfig } from './config.ts'
import type { Handedness } from './types.ts'

// MediaPipe image coordinates use independent width and height normalization.
export const imageYToX = 480 / 640

type Point = { x: number; y: number; z: number; visibility?: number; presence?: number }
export type GolfSample = {
  at: number
  handX: number | null
  handY: number | null
  shoulderX: number
  shoulderY: number
  hipX: number
  hipY: number
  scale: number
  stanceRatio: number | null
  wristSeparation: number | null
  alignment: number
  trailSign: number
  shoulderDepth: number
  leadElbowAngle: number | null
  trailElbowAngle: number | null
  trailElbowHipDistance: number | null
  trailElbowTorsoDistance: number | null
}

const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const visible = (point?: Point): point is Point => !!point && Number.isFinite(point.x) &&
  Number.isFinite(point.y) && Number.isFinite(point.z) && (point.visibility ?? 0) >= golfConfig.minVisibility &&
  (point.presence ?? 1) >= golfConfig.minVisibility
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const angle = (shoulder: Point, elbow: Point, wrist: Point): number | null => {
  const a = [shoulder.x - elbow.x, shoulder.y - elbow.y, shoulder.z - elbow.z]
  const b = [wrist.x - elbow.x, wrist.y - elbow.y, wrist.z - elbow.z]
  const size = Math.hypot(...a) * Math.hypot(...b)
  return size < 1e-6 ? null : Math.acos(Math.max(-1, Math.min(1,
    a.reduce((sum, value, index) => sum + value * b[index], 0) / size))) * 180 / Math.PI
}

function armMeasurements(points: Point[] | undefined, handedness: Handedness) {
  const lead = handedness === 'right' ? [11, 13, 15] : [12, 14, 16]
  const trail = handedness === 'right' ? [12, 14, 16, 24] : [11, 13, 15, 23]
  const leadPoints = lead.map((index) => points?.[index])
  const trailPoints = trail.map((index) => points?.[index])
  const leadElbowAngle = leadPoints.every(visible)
    ? angle(leadPoints[0]!, leadPoints[1]!, leadPoints[2]!) : null
  if (!trailPoints.every(visible)) return {
    leadElbowAngle, trailElbowAngle: null, trailElbowHipDistance: null, trailElbowTorsoDistance: null,
  }
  const [shoulder, elbow, wrist, hip] = trailPoints as Point[]
  const torsoLength = distance(shoulder, hip)
  if (torsoLength < golfConfig.minWorldTorsoLength) return {
    leadElbowAngle, trailElbowAngle: null, trailElbowHipDistance: null, trailElbowTorsoDistance: null,
  }
  const torso = [hip.x - shoulder.x, hip.y - shoulder.y, hip.z - shoulder.z]
  const elbowFromShoulder = [elbow.x - shoulder.x, elbow.y - shoulder.y, elbow.z - shoulder.z]
  const projection = Math.max(0, Math.min(1,
    torso.reduce((sum, value, index) => sum + value * elbowFromShoulder[index], 0) / torsoLength ** 2))
  const nearest = {
    x: shoulder.x + projection * torso[0], y: shoulder.y + projection * torso[1],
    z: shoulder.z + projection * torso[2],
  }
  return {
    leadElbowAngle,
    trailElbowAngle: angle(shoulder, elbow, wrist),
    trailElbowHipDistance: distance(elbow, hip) / torsoLength,
    trailElbowTorsoDistance: distance(elbow, nearest) / torsoLength,
  }
}

export function measureGolf(result: PoseLandmarkerResult, at: number, handedness: Handedness, inSwing = false): GolfSample | null {
  const points = result.landmarks[0]
  if (!points) return null
  const [leftShoulder, rightShoulder, leftHip, rightHip, leftAnkle, rightAnkle] =
    [11, 12, 23, 24, 27, 28].map((index) => points[index])
  // A torso observation remains useful while the hands or feet are occluded.
  if (![leftShoulder, rightShoulder, leftHip, rightHip].every(visible)) return null
  const wrists = [points[15], points[16]].filter(visible)
  const shoulders = mid(leftShoulder, rightShoulder)
  const hips = mid(leftHip, rightHip)
  const ankles = visible(leftAnkle) && visible(rightAnkle) ? mid(leftAnkle, rightAnkle) : null
  const projectedWidth = Math.abs(leftShoulder.x - rightShoulder.x)
  const depthWidth = Math.abs(leftShoulder.z - rightShoulder.z)
  if ((!inSwing && projectedWidth < 0.06) ||
    (inSwing && projectedWidth < 0.015 && depthWidth < 0.04)) return null
  // Keep the image width as rotation evidence, with a small floor for ratios at edge-on.
  const scale = Math.max(projectedWidth, 0.015)
  if ((hips.y - shoulders.y) * imageYToX < scale * 0.4) return null
  const trail = handedness === 'right' ? rightShoulder : leftShoulder
  const lead = handedness === 'right' ? leftShoulder : rightShoulder
  const trailSign = Math.sign(trail.x - lead.x)
  if (!trailSign && !inSwing) return null
  const handX = wrists.length ? wrists.reduce((sum, wrist) => sum + wrist.x, 0) / wrists.length : null
  const handY = wrists.length ? wrists.reduce((sum, wrist) => sum + wrist.y, 0) / wrists.length : null
  // MediaPipe world landmarks are estimated 3D positions; absent or low-confidence
  // arm joints remain unavailable rather than being filled from prior frames.
  const arms = armMeasurements(result.worldLandmarks?.[0], handedness)
  return {
    at, handX, handY,
    shoulderX: shoulders.x, shoulderY: shoulders.y,
    hipX: hips.x, hipY: hips.y,
    scale, stanceRatio: ankles ? Math.abs(leftAnkle.x - rightAnkle.x) / scale : null,
    wristSeparation: wrists.length === 2 ? Math.abs(wrists[0].x - wrists[1].x) / scale : null,
    alignment: Math.abs(shoulders.x - hips.x) / scale,
    trailSign, shoulderDepth: depthWidth / Math.max(scale, 0.04),
    ...arms,
  }
}

export function trailTravel(sample: GolfSample, address: GolfSample): number | null {
  return sample.handX === null || address.handX === null ? null :
    ((sample.handX - sample.shoulderX) - (address.handX - address.shoulderX)) * address.trailSign / address.scale
}

export function handLift(sample: GolfSample, address: GolfSample): number | null {
  return sample.handY === null || address.handY === null ? null :
    ((address.handY - address.shoulderY) - (sample.handY - sample.shoulderY)) * imageYToX / address.scale
}

export function addressLike(sample: GolfSample): boolean {
  return sample.handX !== null && sample.handY !== null &&
    (sample.handY - sample.shoulderY) * imageYToX > sample.scale * golfConfig.addressHandBelowShoulder &&
    Math.abs(sample.handX - sample.hipX) / sample.scale <= golfConfig.addressHandCenterMax &&
    (sample.wristSeparation === null || sample.wristSeparation <= golfConfig.addressWristSeparationMax) &&
    (sample.hipY - sample.shoulderY) * imageYToX > sample.scale * 0.4
}

export function range(samples: readonly GolfSample[], key: 'handX' | 'handY' | 'shoulderX' | 'hipX' | 'scale'): number {
  const values = samples.map((sample) => sample[key]).filter((value): value is number => value !== null)
  if (!values.length) return Infinity
  return Math.max(...values) - Math.min(...values)
}

export function torsoTurn(sample: GolfSample, address: GolfSample): number {
  return Math.max(Math.abs(1 - sample.scale / address.scale),
    Math.abs(sample.shoulderDepth - address.shoulderDepth))
}
