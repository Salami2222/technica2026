import test from 'node:test'
import assert from 'node:assert/strict'
import { SquatDetector } from '../src/analysis/squat.ts'
import { PushUpDetector } from '../src/analysis/pushUp.ts'
import { angleDegrees, visibleSide } from '../src/analysis/geometry.ts'

const point = (x, y, z = 0, visibility = 1) => ({ x, y, z, visibility, presence: visibility })
const blank = () => Array.from({ length: 33 }, () => point(0, 0, 0, 0))

function squatPose(kneeDegrees, visible = true) {
  const world = blank()
  const image = blank()
  const radians = kneeDegrees * Math.PI / 180
  const knee = point(0, 0)
  const ankle = point(0, -1)
  const hip = point(Math.sin(radians), -Math.cos(radians))
  const toKnee = { x: -hip.x, y: -hip.y }
  const hipRadians = 170 * Math.PI / 180
  const shoulder = point(
    hip.x + toKnee.x * Math.cos(hipRadians) - toKnee.y * Math.sin(hipRadians),
    hip.y + toKnee.x * Math.sin(hipRadians) + toKnee.y * Math.cos(hipRadians),
  )
  for (const [index, value] of [[11, shoulder], [23, hip], [25, knee], [27, ankle]]) {
    world[index] = value
    image[index] = point(value.x, value.y, 0, visible ? 1 : 0.1)
  }
  return { landmarks: [image], worldLandmarks: [world] }
}

function pushUpPose(elbowDegrees, visible = true) {
  const world = blank()
  const image = blank()
  const radians = elbowDegrees * Math.PI / 180
  const elbow = point(0, 0)
  const wrist = point(0, -1)
  const shoulder = point(Math.sin(radians), -Math.cos(radians))
  const hip = point(shoulder.x + 1, shoulder.y + 0.3)
  const ankle = point(hip.x + 1, hip.y + 0.1)
  for (const [index, value] of [[11, shoulder], [13, elbow], [15, wrist], [23, hip], [27, ankle]]) {
    world[index] = value
    image[index] = point(value.x, value.y, 0, visible ? 1 : 0.1)
  }
  // A side-view shoulder moves toward the fixed wrist as the elbows bend.
  image[11].x = 0.3
  image[11].y = 0.2 + (170 - elbowDegrees) / 250
  image[13].x = 0.34
  image[13].y = 0.5
  image[15].x = 0.3
  image[15].y = 0.8
  image[23].x = 0.5
  image[23].y = image[11].y + 0.03
  image[27].x = 0.8
  image[27].y = image[11].y + 0.06
  return { landmarks: [image], worldLandmarks: [world] }
}

const sweep = (from, to, frames) => Array.from({ length: frames }, (_, index) =>
  from + (to - from) * (index + 1) / frames)

function phasesFor(detector, pose, angles) {
  const phases = []
  let timestamp = 0
  for (const angle of angles) {
    const phase = detector.update(pose(angle), timestamp).phase
    if (phases.at(-1) !== phase) phases.push(phase)
    timestamp += 33
  }
  return phases
}

test('3D angle calculation handles a right angle', () => {
  assert.equal(angleDegrees(point(1, 0), point(0, 0), point(0, 1)), 90)
})

test('side selection holds the previous side through small visibility changes', () => {
  const pose = squatPose(170)
  for (const [left, right] of [[11, 12], [23, 24], [25, 26], [27, 28]]) {
    pose.landmarks[0][left].visibility = 0.8
    pose.landmarks[0][right] = point(0, 0, 0, 0.9)
    pose.worldLandmarks[0][right] = point(1, 1)
  }
  const required = ['shoulder', 'hip', 'knee', 'ankle']
  assert.equal(visibleSide(pose, required).side, 'right')
  assert.equal(visibleSide(pose, required, 'left').side, 'left')
})

test('squat advances through all four phases without threshold chatter', () => {
  const sequence = [
    ...Array(8).fill(170),
    ...sweep(170, 70, 34),
    ...Array(12).fill(70),
    ...sweep(70, 170, 34),
    ...Array(8).fill(170),
  ]
  assert.deepEqual(phasesFor(new SquatDetector(), squatPose, sequence), [
    'Standing', 'Descending', 'Bottom', 'Ascending', 'Standing',
  ])
})

test('push-up advances through all four phases', () => {
  const sequence = [
    ...Array(8).fill(170),
    ...sweep(170, 70, 34),
    ...Array(12).fill(70),
    ...sweep(70, 170, 34),
    ...Array(8).fill(170),
  ]
  assert.deepEqual(phasesFor(new PushUpDetector(), pushUpPose, sequence), [
    'Top', 'Lowering', 'Bottom', 'Pushing', 'Top',
  ])
})

test('lost landmarks and reset clear stale phase readings', () => {
  const detector = new SquatDetector()
  assert.equal(detector.update(squatPose(170), 0).phase, 'Standing')
  assert.equal(detector.update(squatPose(170, false), 33).phase, 'Tracking Lost')
  assert.equal(detector.missing(600).phase, 'Tracking Lost')
  detector.reset()
  assert.equal(detector.missing(633).phase, 'Not Ready')
})

test('bottom-phase jitter does not switch the squat phase', () => {
  const detector = new SquatDetector()
  let timestamp = 0
  for (const angle of [...Array(8).fill(170), ...sweep(170, 70, 34), ...Array(15).fill(70)]) {
    detector.update(squatPose(angle), timestamp)
    timestamp += 33
  }
  assert.equal(detector.update(squatPose(70), timestamp).phase, 'Bottom')
  for (const angle of [75, 79, 76, 80, 77, 74, 78, 76, 79, 75]) {
    timestamp += 33
    assert.equal(detector.update(squatPose(angle), timestamp).phase, 'Bottom')
  }
})

test('push-up stays Not Ready when the visible body is upright', () => {
  const pose = pushUpPose(170)
  pose.landmarks[0][27].x = pose.landmarks[0][11].x + 0.02
  pose.landmarks[0][27].y = pose.landmarks[0][11].y + 0.6
  assert.equal(new PushUpDetector().update(pose, 0).phase, 'Not Ready')
})
