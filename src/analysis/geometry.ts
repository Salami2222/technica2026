import type { PoseLandmarkerResult } from '@mediapipe/tasks-vision'
import { trackingConfig } from './config.ts'

export type Landmark = PoseLandmarkerResult['landmarks'][number][number]
export type PosePoints = {
  image: readonly Landmark[]
  world: readonly Landmark[]
  side: 'left' | 'right'
}

const joints = {
  left: { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27 },
  right: { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28 },
} as const

export type JointName = keyof typeof joints.left

export function jointIndex(side: PosePoints['side'], joint: JointName): number {
  return joints[side][joint]
}

export function visibleSide(
  result: PoseLandmarkerResult,
  required: readonly JointName[],
  preferredSide: PosePoints['side'] | null = null,
): PosePoints | null {
  const image = result.landmarks[0]
  const world = result.worldLandmarks[0]
  if (!image || !world) return null

  const candidates = (['left', 'right'] as const).map((side) => {
    const confidence = Math.min(...required.map((name) => {
      return jointConfidence(image, world, side, name)
    }))
    return { side, confidence }
  })
  const best = candidates[0].confidence >= candidates[1].confidence ? candidates[0] : candidates[1]
  const preferred = candidates.find((candidate) => candidate.side === preferredSide)
  const selected = preferred && preferred.confidence >= trackingConfig.minVisibility &&
    best.confidence - preferred.confidence <= trackingConfig.sideSwitchMargin ? preferred : best
  if (selected.confidence < trackingConfig.minVisibility) return null
  return { image, world, side: selected.side }
}

export function hasVisibleJoint(points: PosePoints, joint: JointName): boolean {
  return jointConfidence(points.image, points.world, points.side, joint) >= trackingConfig.minVisibility
}

function jointConfidence(image: readonly Landmark[], world: readonly Landmark[], side: PosePoints['side'], name: JointName): number {
  const index = jointIndex(side, name)
  const point = image[index]
  const worldPoint = world[index]
  if (!point || !worldPoint || !finitePoint(point) || !finitePoint(worldPoint)) return 0
  return Math.min(point.visibility ?? 0, point.presence ?? 1)
}

function finitePoint(point: Landmark): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)
}

export function angleDegrees(a: Landmark, center: Landmark, b: Landmark): number | null {
  const ax = a.x - center.x
  const ay = a.y - center.y
  const az = a.z - center.z
  const bx = b.x - center.x
  const by = b.y - center.y
  const bz = b.z - center.z
  const lengthA = Math.hypot(ax, ay, az)
  const lengthB = Math.hypot(bx, by, bz)
  if (lengthA < 1e-5 || lengthB < 1e-5) return null
  const cosine = Math.max(-1, Math.min(1, (ax * bx + ay * by + az * bz) / (lengthA * lengthB)))
  return Math.acos(cosine) * 180 / Math.PI
}

export function jointAngle(points: PosePoints, a: JointName, center: JointName, b: JointName): number | null {
  const { side, world } = points
  return angleDegrees(world[jointIndex(side, a)], world[jointIndex(side, center)], world[jointIndex(side, b)])
}
