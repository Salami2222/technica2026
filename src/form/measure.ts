import type { PoseLandmarkerResult } from '@mediapipe/tasks-vision'
import { trackingConfig } from '../analysis/config.ts'
import { jointIndex } from '../analysis/geometry.ts'
import type { Landmark } from '../analysis/geometry.ts'
import type { PhaseSnapshot } from '../analysis/types.ts'
import type { ExerciseId } from '../exercises.ts'
import type { FormSample } from './types.ts'

const visible = (point?: Landmark): point is Landmark => !!point &&
  Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z) &&
  (point.visibility ?? 0) >= trackingConfig.minVisibility &&
  (point.presence ?? 1) >= trackingConfig.minVisibility
const px = (point: Landmark) => ({ x: point.x * 640, y: point.y * 480 })

export function measureForm(exercise: ExerciseId, result: PoseLandmarkerResult,
  phase: PhaseSnapshot, at: number): FormSample | null {
  if (phase.tracking !== 'tracking' || !phase.side) return null
  const angle = phase.angles.find((item) => item.label === (exercise === 'squat' ? 'Knee' : 'Elbow'))?.degrees
  const points = result.landmarks[0]
  if (!points || angle === undefined || !Number.isFinite(angle)) return null
  const get = (name: 'shoulder' | 'hip' | 'ankle' | 'wrist') => {
    const point = points[jointIndex(phase.side!, name)]
    return visible(point) ? px(point) : null
  }
  const shoulder = get('shoulder')
  const hip = get('hip')
  const ankle = get('ankle')
  const wrist = get('wrist')
  const torsoScale = shoulder && hip ? Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y) : null
  const bodyScale = shoulder && ankle ? Math.hypot(shoulder.x - ankle.x, shoulder.y - ankle.y) : null
  const torsoLean = shoulder && hip ? Math.atan2(Math.abs(shoulder.x - hip.x), Math.abs(shoulder.y - hip.y)) * 180 / Math.PI : null
  // Signed vertical hip offset from the shoulder–ankle line, independent of facing direction.
  const bodyOffset = shoulder && hip && ankle && bodyScale && bodyScale > 20 && Math.abs(ankle.x - shoulder.x) > 30 ?
    (hip.y - (shoulder.y + (ankle.y - shoulder.y) * (hip.x - shoulder.x) / (ankle.x - shoulder.x))) / bodyScale : null
  return {
    at, side: phase.side, angle,
    torsoLean: exercise === 'squat' ? torsoLean : null,
    hipX: exercise === 'squat' ? hip?.x ?? null : null,
    torsoScale: exercise === 'squat' && torsoScale && torsoScale > 15 ? torsoScale : null,
    bodyOffset: exercise === 'push-up' ? bodyOffset : null,
    wristX: exercise === 'push-up' ? wrist?.x ?? null : null,
    wristY: exercise === 'push-up' ? wrist?.y ?? null : null,
    bodyScale: exercise === 'push-up' && bodyScale && bodyScale > 30 ? bodyScale : null,
  }
}
