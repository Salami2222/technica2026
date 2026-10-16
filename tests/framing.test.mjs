import test from 'node:test'
import assert from 'node:assert/strict'
import { assessFraming } from '../src/setup/framing.ts'

const landmark = (x, y, visibility = 0.9) => ({ x, y, z: 0, visibility, presence: 0.9 })
function pose(exercise) {
  const landmarks = Array.from({ length: 33 }, () => landmark(0.5, 0.5, 0))
  if (exercise === 'squat') {
    landmarks[11] = landmark(0.48, 0.30)
    landmarks[23] = landmark(0.50, 0.52)
    landmarks[25] = landmark(0.52, 0.72)
    landmarks[27] = landmark(0.54, 0.88)
    landmarks[0] = landmark(0.49, 0.13)
  } else {
    landmarks[11] = landmark(0.24, 0.55)
    landmarks[13] = landmark(0.23, 0.72)
    landmarks[15] = landmark(0.23, 0.86)
    landmarks[23] = landmark(0.51, 0.57)
    landmarks[27] = landmark(0.81, 0.64)
  }
  return { landmarks: [landmarks] }
}

test('framing accepts complete side views without demanding both sides or facial joints', () => {
  const squat = pose('squat')
  squat.landmarks[0][0].visibility = 0
  assert.equal(assessFraming('squat', squat).status, 'Ready')
  assert.equal(assessFraming('push-up', pose('push-up')).status, 'Ready')
})

test('squat gives observed crop and missing leg suggestions', () => {
  const cropped = pose('squat')
  cropped.landmarks[0][27].y = 0.98
  assert.match(assessFraming('squat', cropped).suggestion, /feet.*frame/i)
  const missing = pose('squat')
  missing.landmarks[0][25].visibility = 0.2
  assert.match(assessFraming('squat', missing).suggestion, /hip, knee, and ankle/i)
})

test('push-up distinguishes side profile, camera elevation, crop, and missing joints', () => {
  const front = pose('push-up')
  front.landmarks[0][27].x = 0.36
  assert.match(assessFraming('push-up', front).suggestion, /Rotate your body/i)
  const high = pose('push-up')
  high.landmarks[0][27].y = 0.94
  assert.match(assessFraming('push-up', high).suggestion, /Lower the Kinect/i)
  const foot = pose('push-up')
  foot.landmarks[0][27].x = 0.98
  assert.match(assessFraming('push-up', foot).suggestion, /feet farther/i)
  const wrist = pose('push-up')
  wrist.landmarks[0][15].visibility = 0.1
  assert.match(assessFraming('push-up', wrist).suggestion, /shoulder, elbow, and wrist/i)
  assert.equal(assessFraming('push-up', { landmarks: [] }).status, 'Tracking Unavailable')
})

function golfPose() {
  const landmarks = Array.from({ length: 33 }, () => landmark(0.5, 0.5, 0))
  landmarks[11] = landmark(0.43, 0.31)
  landmarks[12] = landmark(0.57, 0.31)
  landmarks[23] = landmark(0.46, 0.55)
  landmarks[24] = landmark(0.54, 0.55)
  landmarks[15] = landmark(0.49, 0.58)
  landmarks[16] = landmark(0.51, 0.58)
  landmarks[27] = landmark(0.41, 0.87)
  landmarks[28] = landmark(0.59, 0.87)
  return { landmarks: [landmarks] }
}

test('golf setup uses face-on shoulder width and room for the entire swing', () => {
  assert.equal(assessFraming('golf', golfPose()).status, 'Ready')
  const edgeOn = golfPose()
  edgeOn.landmarks[0][12].x = 0.46
  assert.match(assessFraming('golf', edgeOn).suggestion, /face the Kinect squarely/i)
  const narrow = golfPose()
  narrow.landmarks[0][15].x = 0.91
  assert.match(assessFraming('golf', narrow).suggestion, /room for the backswing/i)
  const nearEdge = golfPose()
  nearEdge.landmarks[0][12].x = 0.85
  assert.match(assessFraming('golf', nearEdge).suggestion, /room for the backswing/i)
})

test('golf setup reports missing torso, hands, and feet without requiring a face landmark', () => {
  const noHead = golfPose()
  noHead.landmarks[0][0].visibility = 0
  assert.equal(assessFraming('golf', noHead).status, 'Ready')
  const noHip = golfPose()
  noHip.landmarks[0][23].visibility = 0
  assert.match(assessFraming('golf', noHip).suggestion, /shoulders and hips/i)
  const noHands = golfPose()
  noHands.landmarks[0][15].visibility = 0
  noHands.landmarks[0][16].visibility = 0
  assert.match(assessFraming('golf', noHands).suggestion, /hands visible/i)
  const noFeet = golfPose()
  noFeet.landmarks[0][27].visibility = 0
  assert.match(assessFraming('golf', noFeet).suggestion, /both feet/i)
})

test('face landmark jumps cannot change readiness for any mode', () => {
  for (const mode of ['squat', 'push-up', 'golf']) {
    const baseline = mode === 'golf' ? golfPose() : pose(mode)
    const changed = structuredClone(baseline)
    for (let index = 0; index <= 10; index++) {
      changed.landmarks[0][index] = landmark(index % 2 ? -10 : 10, index % 2 ? -10 : 10)
    }
    assert.deepEqual(assessFraming(mode, changed), assessFraming(mode, baseline))
  }
  const faceOnly = { landmarks: [Array.from({ length: 33 }, (_, index) =>
    landmark(0.5, 0.5, index < 11 ? 0.9 : 0))] }
  assert.equal(assessFraming('golf', faceOnly).status, 'Tracking Unavailable')
})
