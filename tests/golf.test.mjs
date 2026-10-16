import test from 'node:test'
import assert from 'node:assert/strict'
import { GolfSwingSession } from '../src/golf/golf.ts'
import { measureGolf } from '../src/golf/measure.ts'
import { scoreGolfSwing } from '../src/golf/score.ts'

const point = (x, y, visibility = 1) => ({ x, y, z: 0, visibility, presence: visibility })
function pose(handedness, travel = 0, lift = 0, options = {}) {
  const { headShift = 0, shoulderShift = 0, hipShift = 0, ankleShift = 0, wristVisible = true, headVisible = true, wristSpread = 0.016 } = options
  const points = Array.from({ length: 33 }, () => point(0, 0, 0))
  const scale = 0.2
  const sign = handedness === 'right' ? -1 : 1
  const handX = 0.5 + sign * travel * scale
  const handY = 0.64 - lift * scale
  points[0] = point(0.5 + headShift * scale, 0.18, headVisible ? 1 : 0.1)
  points[11] = point(0.6 + shoulderShift * scale, 0.35)
  points[12] = point(0.4 + shoulderShift * scale, 0.35)
  points[15] = point(handX + wristSpread / 2, handY, wristVisible ? 1 : 0.1)
  points[16] = point(handX - wristSpread / 2, handY, wristVisible ? 1 : 0.1)
  points[23] = point(0.57 + hipShift * scale, 0.56)
  points[24] = point(0.43 + hipShift * scale, 0.56)
  points[27] = point(0.6 + ankleShift * scale, 0.88)
  points[28] = point(0.4 + ankleShift * scale, 0.88)
  return { landmarks: [points], worldLandmarks: [points] }
}

const path = [
  [0.35, 0.05], [0.55, 0.15], [0.80, 0.40], [1.00, 0.65], [1.10, 0.80],
  [1.08, 0.80], [0.85, 0.70], [0.65, 0.55], [0.20, 0.20], [-0.15, 0.05],
  [-0.50, 0.15], [-0.70, 0.35], [-0.80, 0.50], [-0.82, 0.55], [-0.83, 0.55],
  [-0.83, 0.55], [-0.83, 0.55], [-0.83, 0.55],
]

function address(session, handedness, firstAt = 0, frames = 5) {
  for (let index = 0; index < frames; index++) session.update(pose(handedness), firstAt + index * 100)
  assert.equal(session.snapshot().status, 'Ready')
  assert.equal(session.snapshot().phase, 'Address')
}

function swing(session, handedness, firstAt = 600, interval = 100, options = {}) {
  const phases = []
  for (const [index, [travel, lift]] of path.entries()) {
    const movement = index < 10 ? { headShift: options.headShift ?? 0, hipShift: options.hipShift ?? 0 } : {}
    const snapshot = session.update(pose(handedness, travel, lift, { ...movement, headVisible: options.headVisible ?? true }), firstAt + index * interval)
    phases.push(snapshot.phase)
  }
  return phases
}

test('right-handed complete swing detects every stage and calculates five measured scores', () => {
  const session = new GolfSwingSession('right')
  session.start()
  address(session, 'right')
  const phases = swing(session, 'right')
  for (const phase of ['Backswing', 'Top', 'Downswing', 'Follow-through', 'Finish']) assert.ok(phases.includes(phase), `${phase}: ${phases.join(', ')}`)
  const result = session.snapshot().latest
  assert.ok(result)
  assert.ok(result.score >= 0 && result.score <= 10)
  assert.equal(result.categories.length, 5)
  assert.equal(result.score, Math.round(result.categories.reduce((sum, item) => sum + item.score, 0) * 10) / 10)
  assert.ok(result.measurements.handBackswing >= 1)
  assert.ok(result.measurements.handFollowThrough >= 0.8)
  assert.ok(result.durationMs > result.backswingMs + result.downswingMs)
  assert.ok(result.categories.every((item) => item.explanation && item.suggestion))
  for (let at = 2400; at <= 3000; at += 100) session.update(pose('right', -0.83, 0.55), at)
  assert.equal(session.snapshot().phase, 'Finish')
})

test('left-handed and different-speed swings score without mirrored-position assumptions', () => {
  for (const [hand, interval] of [['left', 90], ['right', 150]]) {
    const session = new GolfSwingSession(hand)
    session.start()
    address(session, hand)
    const phases = swing(session, hand, 600, interval)
    assert.ok(session.snapshot().latest, `${hand} ${interval}: ${phases.join(', ')}`)
    assert.notEqual(session.snapshot().latest?.score, null)
    assert.equal(session.snapshot().latest?.handedness, hand)
  }
})

test('consecutive swings keep separate results and allow comparison', () => {
  const session = new GolfSwingSession('right')
  session.start()
  address(session, 'right')
  swing(session, 'right')
  assert.equal(session.snapshot().swings, 1)
  address(session, 'right', 2400, 7)
  const secondPhases = swing(session, 'right', 3200, 100, { hipShift: 0.55, headShift: 0.7 })
  const { history } = session.snapshot()
  assert.equal(history.length, 2, secondPhases.join(', '))
  assert.ok(history[1].score < history[0].score)
  assert.ok(history[1].measurements.hipSway > history[0].measurements.hipSway)
  assert.equal(session.stop().status, 'Completed')
  assert.equal(session.start().swings, 0)
})

test('incomplete motions before readiness or without turnaround and finish are not scored', () => {
  const session = new GolfSwingSession('right')
  session.start()
  session.update(pose('right', 1), 0)
  session.update(pose('right', -1), 100)
  assert.equal(session.snapshot().swings, 0)
  address(session, 'right', 300)
  for (const [index, travel] of [0.35, 0.55, 0.8, 1.1, 1.05].entries()) {
    session.update(pose('right', travel, 0.5), 900 + index * 100)
  }
  assert.equal(session.snapshot().swings, 0)
  assert.notEqual(session.snapshot().phase, 'Finish')
})

test('brief missing wrists pause movement and a long gap discards the swing', () => {
  const session = new GolfSwingSession('right')
  session.start()
  address(session, 'right')
  for (let index = 0; index <= 4; index++) session.update(pose('right', ...path[index]), 600 + index * 100)
  assert.equal(session.missing(1030).tracking, 'partial')
  assert.equal(session.update(pose('right', 1.08, 0.8), 1100).phase, 'Backswing')
  for (let index = 6; index < path.length; index++) session.update(pose('right', ...path[index]), 600 + index * 100)
  assert.equal(session.snapshot().swings, 1)
  const another = new GolfSwingSession('right')
  another.start()
  address(another, 'right')
  another.update(pose('right', 0.35), 600)
  another.update(pose('right', 0.8), 700)
  another.missing(750)
  assert.equal(another.missing(1200).tracking, 'lost')
  assert.equal(another.snapshot().swings, 0)
})

test('missing head landmarks do not reduce a score derived from visible upper body', () => {
  const session = new GolfSwingSession('left')
  session.start()
  address(session, 'left')
  swing(session, 'left', 600, 100, { headVisible: false })
  const result = session.snapshot().latest
  assert.ok(result?.score !== null)
  assert.equal(result.measurements.headTravel, null)
  assert.match(result.categories[1].explanation, /head motion was excluded/)
})

test('pause and resume discard a partial swing and require a new address', () => {
  const session = new GolfSwingSession('right')
  session.start()
  address(session, 'right')
  session.update(pose('right', 0.5), 600)
  assert.equal(session.pause().status, 'Paused')
  assert.equal(session.resume().status, 'Waiting for Address')
  assert.equal(session.update(pose('right', -0.8, 0.5), 700).swings, 0)
  address(session, 'right', 900)
  swing(session, 'right', 1500)
  assert.equal(session.snapshot().swings, 1)
})

test('small address jitter cannot start or score a practice motion', () => {
  const session = new GolfSwingSession('right')
  session.start()
  address(session, 'right')
  for (const [index, travel] of [0.05, 0.12, -0.03, 0.19, 0.08, -0.10, 0].entries()) {
    session.update(pose('right', travel), 600 + index * 90)
  }
  assert.equal(session.snapshot().phase, 'Address')
  assert.equal(session.snapshot().swings, 0)
})

test('a stable arms-apart pose is not accepted as a golf address', () => {
  const session = new GolfSwingSession('right')
  session.start()
  for (let index = 0; index <= 5; index++) session.update(pose('right', 0, 0, { wristSpread: 0.40 }), index * 100)
  assert.equal(session.snapshot().status, 'Waiting for Address')
  address(session, 'right', 700, 7)
})

test('scoring declines when measured tempo changes and refuses insufficient samples', () => {
  const addressSample = measureGolf(pose('right'), 0, 'right')
  const samples = path.map(([travel, lift], index) => measureGolf(pose('right', travel, lift), 600 + index * 100, 'right'))
  const input = {
    id: 1, handedness: 'right', address: addressSample,
    addressSamples: [addressSample, addressSample, addressSample],
    samples, finishSamples: samples.slice(-5), startAt: 600, finishAt: 2300, missingMs: 0,
  }
  const rushed = scoreGolfSwing({ ...input, topAt: 900, passAt: 1200 })
  const steadier = scoreGolfSwing({ ...input, topAt: 1300, passAt: 1500 })
  assert.ok(steadier.categories[3].score > rushed.categories[3].score)
  assert.ok(steadier.score > rushed.score)
  const insufficient = scoreGolfSwing({ ...input, samples: samples.slice(0, 5), topAt: 1300, passAt: 1500 })
  assert.equal(insufficient.score, null)
  assert.match(insufficient.reason, /Unable to Score/)
})
