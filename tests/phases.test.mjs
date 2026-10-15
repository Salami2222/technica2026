import test from 'node:test'
import assert from 'node:assert/strict'
import { SquatDetector } from '../src/analysis/squat.ts'
import { PushUpDetector } from '../src/analysis/pushUp.ts'
import { angleDegrees, visibleSide } from '../src/analysis/geometry.ts'
import { ExerciseSession } from '../src/session/session.ts'

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

function withRightSide(pose, visibility = 0.9) {
  for (const [left, right] of [[11, 12], [13, 14], [15, 16], [23, 24], [25, 26], [27, 28]]) {
    pose.landmarks[0][right] = { ...pose.landmarks[0][left], visibility, presence: visibility }
    pose.worldLandmarks[0][right] = { ...pose.worldLandmarks[0][left] }
  }
  return pose
}

function hide(pose, indices, visibility = 0.1) {
  for (const index of indices) pose.landmarks[0][index].visibility = visibility
  return pose
}

const sweep = (from, to, frames) => Array.from({ length: frames }, (_, index) =>
  from + (to - from) * (index + 1) / frames)

function continuousReps(exercise, detector, pose, count, halfFrames) {
  const session = new ExerciseSession(exercise)
  session.start()
  let timestamp = 0
  const feed = (value) => {
    session.observe(detector.update(pose(value), timestamp), timestamp)
    timestamp += 33
  }
  for (let frame = 0; frame < 12; frame++) feed(170)
  assert.equal(session.snapshot().status, 'Ready')
  for (let rep = 1; rep <= count; rep++) {
    for (const value of sweep(170, 70, halfFrames)) feed(value)
    feed(70)
    feed(70)
    for (const value of sweep(70, 170, halfFrames)) feed(value)
    feed(170)
    feed(170)
    assert.equal(session.snapshot().repetitions, rep, `${exercise} rep ${rep} at ${halfFrames} frames per half`)
  }
}

test('live detectors count 3–10 consecutive squats and push-ups at varied speeds', () => {
  for (const [count, halfFrames] of [[3, 6], [5, 8], [10, 12]]) {
    continuousReps('squat', new SquatDetector(), squatPose, count, halfFrames)
    continuousReps('push-up', new PushUpDetector(), pushUpPose, count, halfFrames)
  }
})

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

test('briefly missing squat joints hold the phase without stale angles', () => {
  const detector = new SquatDetector()
  assert.equal(detector.update(squatPose(170), 0).phase, 'Standing')
  const partial = detector.update(squatPose(70, false), 33)
  assert.equal(partial.phase, 'Standing')
  assert.equal(partial.tracking, 'partial')
  assert.deepEqual(partial.angles, [])
  assert.equal(detector.missing(1500).phase, 'Standing')
  const resumed = detector.update(squatPose(70), 1600)
  assert.equal(resumed.phase, 'Standing')
  assert.equal(resumed.tracking, 'tracking')
  assert.equal(Math.round(resumed.angles[0].degrees), 70)
  assert.equal(detector.update(squatPose(70), 1633).phase, 'Standing')
})

test('tracking loss after two seconds clears the detector', () => {
  const detector = new SquatDetector()
  assert.equal(detector.update(squatPose(170), 0).phase, 'Standing')
  assert.equal(detector.missing(2000).tracking, 'partial')
  const lost = detector.missing(2001)
  assert.equal(lost.phase, 'Tracking Lost')
  assert.equal(lost.tracking, 'lost')
  assert.deepEqual(lost.angles, [])
  assert.equal(detector.update(squatPose(70), 2033).phase, 'Bottom')
  detector.reset()
  assert.equal(detector.missing(2066).phase, 'Not Ready')
})

test('squat knee tracking ignores missing shoulder and accepts 0.40 visibility', () => {
  const detector = new SquatDetector()
  const pose = hide(squatPose(170), [11], 0)
  for (const index of [23, 25, 27]) pose.landmarks[0][index].visibility = 0.4
  const snapshot = detector.update(pose, 0)
  assert.equal(snapshot.phase, 'Standing')
  assert.equal(snapshot.tracking, 'tracking')
  assert.deepEqual(snapshot.angles.map((angle) => angle.label), ['Knee'])
  assert.equal(detector.update(hide(squatPose(170), [25], 0.39), 33).tracking, 'partial')
})

test('push-up elbow tracking continues when optional hip and ankle disappear', () => {
  const detector = new PushUpDetector()
  assert.equal(detector.update(pushUpPose(170), 0).phase, 'Top')
  const snapshot = detector.update(hide(pushUpPose(170), [23, 27]), 33)
  assert.equal(snapshot.phase, 'Top')
  assert.equal(snapshot.tracking, 'tracking')
  assert.deepEqual(snapshot.angles.map((angle) => angle.label), ['Elbow'])
  const partial = detector.update(hide(pushUpPose(100), [13]), 66)
  assert.equal(partial.phase, 'Top')
  assert.equal(partial.tracking, 'partial')
  assert.deepEqual(partial.angles, [])
})

test('side switches on unreliable essential joints without a phase jump', () => {
  const squat = new SquatDetector()
  assert.equal(squat.update(withRightSide(squatPose(170)), 0).side, 'left')
  const switched = withRightSide(squatPose(70))
  hide(switched, [25])
  const snapshot = squat.update(switched, 33)
  assert.equal(snapshot.side, 'right')
  assert.equal(snapshot.phase, 'Standing')
  assert.equal(Math.round(snapshot.angles[0].degrees), 70)
  assert.equal(squat.update(switched, 66).phase, 'Standing')

  const pushUp = new PushUpDetector()
  assert.equal(pushUp.update(withRightSide(pushUpPose(170)), 0).side, 'left')
  const rightOnly = withRightSide(pushUpPose(70))
  hide(rightOnly, [13])
  const pushSnapshot = pushUp.update(rightOnly, 33)
  assert.equal(pushSnapshot.side, 'right')
  assert.equal(pushSnapshot.phase, 'Top')
  assert.equal(Math.round(pushSnapshot.angles[0].degrees), 70)
  assert.equal(pushUp.update(rightOnly, 66).phase, 'Top')
})

test('push-up recovery within the grace period preserves its last phase', () => {
  const detector = new PushUpDetector()
  assert.equal(detector.update(pushUpPose(170), 0).phase, 'Top')
  assert.equal(detector.update(pushUpPose(70, false), 100).tracking, 'partial')
  assert.equal(detector.missing(1900).phase, 'Top')
  const recovered = detector.update(pushUpPose(70), 1950)
  assert.equal(recovered.phase, 'Top')
  assert.equal(recovered.tracking, 'tracking')
  assert.equal(Math.round(recovered.angles[0].degrees), 70)
  assert.equal(detector.update(pushUpPose(70), 1983).phase, 'Top')
})

test('bottom phase stays stable through a short occlusion', () => {
  const detector = new SquatDetector()
  let timestamp = 0
  for (const angle of [...Array(8).fill(170), ...sweep(170, 70, 34), ...Array(8).fill(70)]) {
    detector.update(squatPose(angle), timestamp)
    timestamp += 33
  }
  assert.equal(detector.missing(timestamp + 500).phase, 'Bottom')
  const resumed = detector.update(squatPose(170), timestamp + 700)
  assert.equal(resumed.phase, 'Bottom')
  assert.equal(resumed.tracking, 'tracking')
})

test('a gap over two seconds resets even if no missing update was sampled', () => {
  const detector = new PushUpDetector()
  assert.equal(detector.update(pushUpPose(170), 0).phase, 'Top')
  const fresh = detector.update(pushUpPose(70), 2100)
  assert.equal(fresh.phase, 'Bottom')
  assert.equal(fresh.tracking, 'tracking')
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
