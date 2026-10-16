import type { PoseLandmarkerResult } from '@mediapipe/tasks-vision'
import { golfConfig } from './config.ts'
import type { Handedness } from './types.ts'

// MediaPipe image coordinates use independent width and height normalization.
export const imageYToX = 480 / 640

type Point = { x: number; y: number; visibility?: number; presence?: number }
export type GolfSample = {
  at: number
  handX: number
  handY: number
  shoulderX: number
  shoulderY: number
  hipX: number
  hipY: number
  ankleX: number
  headX: number | null
  scale: number
  stanceRatio: number
  wristSeparation: number | null
  alignment: number
  trailSign: number
}

const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const visible = (point?: Point): point is Point => !!point && Number.isFinite(point.x) &&
  Number.isFinite(point.y) && (point.visibility ?? 0) >= golfConfig.minVisibility &&
  (point.presence ?? 1) >= golfConfig.minVisibility

export function measureGolf(result: PoseLandmarkerResult, at: number, handedness: Handedness): GolfSample | null {
  const points = result.landmarks[0]
  if (!points) return null
  const [leftShoulder, rightShoulder, leftHip, rightHip, leftAnkle, rightAnkle] =
    [11, 12, 23, 24, 27, 28].map((index) => points[index])
  if (![leftShoulder, rightShoulder, leftHip, rightHip, leftAnkle, rightAnkle].every(visible)) return null
  const wrists = [points[15], points[16]].filter(visible)
  if (!wrists.length) return null
  const shoulders = mid(leftShoulder, rightShoulder)
  const hips = mid(leftHip, rightHip)
  const ankles = mid(leftAnkle, rightAnkle)
  const scale = Math.abs(leftShoulder.x - rightShoulder.x)
  if (scale < 0.06 || (hips.y - shoulders.y) * imageYToX < scale * 0.4) return null
  const trail = handedness === 'right' ? rightShoulder : leftShoulder
  const lead = handedness === 'right' ? leftShoulder : rightShoulder
  const trailSign = Math.sign(trail.x - lead.x)
  if (!trailSign) return null
  const handX = wrists.reduce((sum, wrist) => sum + wrist.x, 0) / wrists.length
  const handY = wrists.reduce((sum, wrist) => sum + wrist.y, 0) / wrists.length
  const headX = visible(points[0]) ? points[0].x : null
  return {
    at, handX, handY,
    shoulderX: shoulders.x, shoulderY: shoulders.y,
    hipX: hips.x, hipY: hips.y, ankleX: ankles.x, headX,
    scale, stanceRatio: Math.abs(leftAnkle.x - rightAnkle.x) / scale,
    wristSeparation: wrists.length === 2 ? Math.abs(wrists[0].x - wrists[1].x) / scale : null,
    alignment: Math.abs(shoulders.x - hips.x) / scale,
    trailSign,
  }
}

export function trailTravel(sample: GolfSample, address: GolfSample): number {
  return (sample.handX - address.handX) * address.trailSign / address.scale
}

export function handLift(sample: GolfSample, address: GolfSample): number {
  return (address.handY - sample.handY) * imageYToX / address.scale
}

export function addressLike(sample: GolfSample): boolean {
  return sample.stanceRatio >= golfConfig.minStanceRatio &&
    (sample.handY - sample.shoulderY) * imageYToX > sample.scale * 0.2 &&
    Math.abs(sample.handX - sample.hipX) / sample.scale <= golfConfig.addressHandCenterMax &&
    (sample.wristSeparation === null || sample.wristSeparation <= golfConfig.addressWristSeparationMax) &&
    (sample.hipY - sample.shoulderY) * imageYToX > sample.scale * 0.4
}

export function range(samples: readonly GolfSample[], key: 'handX' | 'handY' | 'shoulderX' | 'hipX'): number {
  const values = samples.map((sample) => sample[key])
  return Math.max(...values) - Math.min(...values)
}
