import type { PoseLandmarkerResult } from '@mediapipe/tasks-vision'
import { trackingConfig } from '../analysis/config.ts'
import { jointIndex } from '../analysis/geometry.ts'
import type { Landmark } from '../analysis/geometry.ts'
import type { ExerciseId } from '../exercises.ts'

export type SetupMode = ExerciseId | 'golf'
export type Framing = { status: 'Ready' | 'Adjust Position' | 'Tracking Unavailable'; suggestion: string }
export const noFraming: Framing = {
  status: 'Tracking Unavailable', suggestion: 'Stand in view so the Kinect can find your body.',
}

const visible = (point?: Landmark): point is Landmark => !!point &&
  Number.isFinite(point.x) && Number.isFinite(point.y) &&
  (point.visibility ?? 0) >= trackingConfig.minVisibility &&
  (point.presence ?? 1) >= trackingConfig.minVisibility
const inside = (point: Landmark) => point.x >= 0.055 && point.x <= 0.945 && point.y >= 0.055 && point.y <= 0.945
type Side = 'left' | 'right'
const point = (landmarks: readonly Landmark[], side: Side, name: Parameters<typeof jointIndex>[1]) => {
  const candidate = landmarks[jointIndex(side, name)]
  return visible(candidate) ? candidate : null
}
const adjust = (suggestion: string): Framing => ({ status: 'Adjust Position', suggestion })

export function assessFraming(exercise: SetupMode, result: PoseLandmarkerResult): Framing {
  const landmarks = result.landmarks[0]
  if (!landmarks?.length) return noFraming
  if (landmarks.filter(visible).length < 3) return noFraming
  if (exercise === 'golf') {
    const shoulders = [landmarks[11], landmarks[12]]
    const hips = [landmarks[23], landmarks[24]]
    const ankles = [landmarks[27], landmarks[28]]
    const wrists = [landmarks[15], landmarks[16]]
    if (![...shoulders, ...hips].every(visible)) return adjust('Face the Kinect so both shoulders and hips are visible.')
    if (!ankles.every(visible)) return adjust('Step back until both feet are visible at address.')
    if (!wrists.some(visible)) return adjust('Keep your hands visible below your shoulders at address.')
    if (Math.abs(shoulders[0].x - shoulders[1].x) < 0.06) {
      return adjust('Turn to face the Kinect squarely so it sees both shoulders, not an edge-on view.')
    }
    const head = landmarks[0]
    if ((visible(head) && !inside(head)) || Math.min(...shoulders.map((joint) => joint.y)) < 0.15) {
      return adjust('Step back or aim the Kinect higher so your head stays in frame.')
    }
    if (ankles.some((ankle) => !inside(ankle))) return adjust('Step back so both feet stay inside the frame.')
    if ([...shoulders, ...hips, ...wrists.filter(visible)].some((joint) => !inside(joint))) {
      return adjust('Step back so your body and hands stay inside the frame.')
    }
    if ([...shoulders, ...wrists.filter(visible)].some((joint) => joint.x < 0.16 || joint.x > 0.84)) {
      return adjust('Move farther from the Kinect and center yourself to leave room for the backswing and follow-through.')
    }
    return { status: 'Ready', suggestion: 'Face-on address is visible. Keep hands and arms in frame through the full swing.' }
  }
  if (exercise === 'squat') {
    const sides = (['left', 'right'] as const).map((side) => ({
      side, hip: point(landmarks, side, 'hip'), knee: point(landmarks, side, 'knee'),
      ankle: point(landmarks, side, 'ankle'), shoulder: point(landmarks, side, 'shoulder'),
    }))
    const best = sides.sort((a, b) =>
      [b.hip, b.knee, b.ankle, b.shoulder].filter(Boolean).length -
      [a.hip, a.knee, a.ankle, a.shoulder].filter(Boolean).length)[0]
    if (!best.hip || !best.knee || !best.ankle) return adjust('Keep one complete hip, knee, and ankle chain visible. Step back or turn sideways.')
    if (best.ankle.y > 0.94 || best.ankle.x < 0.055 || best.ankle.x > 0.945) return adjust('Move farther from the camera so your feet stay inside the frame.')
    if (!best.shoulder) return adjust('Include your shoulders and head in the camera view.')
    // Head points help when available; shoulder clearance provides a lenient proxy otherwise.
    const head = [0, 7, 8].map((index) => landmarks[index]).find(visible)
    if ((head && !inside(head)) || (!head && best.shoulder.y < 0.18)) return adjust('Tilt the Kinect up or step back so your head fits in the frame.')
    if ([best.hip, best.knee, best.ankle, best.shoulder].some((joint) => !inside(joint))) return adjust('Move farther from the camera so your full body fits in the frame.')
    return { status: 'Ready', suggestion: 'Full side profile and leg joints are in view.' }
  }

  const sides = (['left', 'right'] as const).map((side) => ({
    side, shoulder: point(landmarks, side, 'shoulder'), elbow: point(landmarks, side, 'elbow'),
    wrist: point(landmarks, side, 'wrist'), hip: point(landmarks, side, 'hip'),
    ankle: point(landmarks, side, 'ankle'),
  }))
  const best = sides.sort((a, b) =>
    [b.shoulder, b.elbow, b.wrist, b.hip, b.ankle].filter(Boolean).length -
    [a.shoulder, a.elbow, a.wrist, a.hip, a.ankle].filter(Boolean).length)[0]
  if (!best.shoulder || !best.elbow || !best.wrist) return adjust('Keep your shoulder, elbow, and wrist visible from one side.')
  if (!best.hip || !best.ankle) return adjust('Move your hips and feet into view for body-alignment feedback.')
  const chain = [best.shoulder, best.elbow, best.wrist, best.hip, best.ankle]
  if (best.ankle.x < 0.055 || best.ankle.x > 0.945) return adjust('Move your feet farther into the frame.')
  if (best.wrist.x < 0.055 || best.wrist.x > 0.945) return adjust('Move your hands farther into the frame.')
  if (chain.some((joint) => !inside(joint))) return adjust('Move farther from the camera so hands, hips, and feet fit in the frame.')
  const dx = Math.abs(best.ankle.x - best.shoulder.x)
  const dy = Math.abs(best.ankle.y - best.shoulder.y)
  if (dx < 0.28) return adjust('Rotate your body so the camera sees your side, not toward your head.')
  if (dy / dx > 0.65) return adjust('Lower the Kinect to capture your push-up from the side.')
  if (Math.min(...chain.map((joint) => joint.x)) < 0.11 || Math.max(...chain.map((joint) => joint.x)) > 0.89) {
    return adjust('Move farther from the camera to leave room around your hands and feet.')
  }
  return { status: 'Ready', suggestion: 'Full side profile, planted hands, and feet are in view.' }
}
