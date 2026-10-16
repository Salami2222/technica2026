import test from 'node:test'
import assert from 'node:assert/strict'
import { GolfSwingSession } from '../src/golf/golf.ts'
import { measureGolf } from '../src/golf/measure.ts'
import { scoreGolfSwing } from '../src/golf/score.ts'
import { clubPathAssessment } from '../src/golf/path.ts'

const point = (x, y, visibility = 1, z = 0) => ({ x, y, z, visibility, presence: visibility })
function pose(handedness, travel = 0, lift = 0, options = {}) {
  const { headShift = 0, shoulderShift = 0, hipShift = 0, ankleShift = 0, ankleSpread = 0, wristVisible = true,
    headVisible = true, wristSpread = 0.016, shoulderScale = 1, ankleVisible = true,
    leftWristVisible = wristVisible, rightWristVisible = wristVisible, handDrop = 0.64,
    shoulderDepth = 0, leadBend = 0.06, trailBend = 0.20, trailElbowGap = 0,
    leadElbowVisible = true, trailElbowVisible = true } = options
  const points = Array.from({ length: 33 }, () => point(0, 0, 0))
  const scale = 0.2
  const sign = handedness === 'right' ? -1 : 1
  const handX = 0.5 + sign * travel * scale
  const handY = handDrop - lift * scale
  points[0] = point(0.5 + headShift * scale, 0.18, headVisible ? 1 : 0.1)
  points[11] = point(0.5 + 0.1 * shoulderScale + shoulderShift * scale, 0.35, 1, shoulderDepth / 2)
  points[12] = point(0.5 - 0.1 * shoulderScale + shoulderShift * scale, 0.35, 1, -shoulderDepth / 2)
  points[15] = point(handX + wristSpread / 2, handY, leftWristVisible ? 1 : 0.1)
  points[16] = point(handX - wristSpread / 2, handY, rightWristVisible ? 1 : 0.1)
  points[23] = point(0.57 + hipShift * scale, 0.56)
  points[24] = point(0.43 + hipShift * scale, 0.56)
  points[27] = point(0.6 + (ankleShift + ankleSpread / 2) * scale, 0.88, ankleVisible ? 1 : 0.1)
  points[28] = point(0.4 + (ankleShift - ankleSpread / 2) * scale, 0.88, ankleVisible ? 1 : 0.1)
  for (const [shoulderIndex, elbowIndex, wristIndex, bend, gap, isLead] of [
    [11, 13, 15, handedness === 'right' ? leadBend : trailBend, handedness === 'right' ? 0 : trailElbowGap, handedness === 'right'],
    [12, 14, 16, handedness === 'left' ? leadBend : trailBend, handedness === 'left' ? 0 : trailElbowGap, handedness === 'left'],
  ]) {
    const shoulder = points[shoulderIndex], wrist = points[wristIndex]
    const dx = wrist.x - shoulder.x, dy = wrist.y - shoulder.y
    const outward = shoulderIndex === 11 ? 1 : -1
    points[elbowIndex] = point((shoulder.x + wrist.x) / 2 - dy * bend + outward * gap * scale,
      (shoulder.y + wrist.y) / 2 + dx * bend,
      (isLead ? leadElbowVisible : trailElbowVisible) ? 1 : 0.1)
  }
  return { landmarks: [points], worldLandmarks: [points] }
}

const path = [
  [0.35, 0.05], [0.55, 0.15], [0.80, 0.40], [1.00, 0.65], [1.10, 0.80],
  [1.08, 0.80], [0.85, 0.70], [0.65, 0.55], [0.20, 0.20], [-0.15, 0.05],
  [-0.50, 0.15], [-0.70, 0.35], [-0.80, 0.50], [-0.82, 0.55], [-0.83, 0.55],
  [-0.83, 0.55], [-0.83, 0.55], [-0.83, 0.55],
]

function address(session, handedness, firstAt = 0, frames = 5, options = {}) {
  for (let index = 0; index < frames; index++) {
    session.update(pose(handedness, 0, 0, typeof options === 'function' ? options(index) : options), firstAt + index * 100)
  }
  assert.equal(session.snapshot().status, 'Ready')
  assert.equal(session.snapshot().phase, 'Address')
}

function swing(session, handedness, firstAt = 600, interval = 100, options = {}) {
  const phases = []
  const atFrame = (value, index) => typeof value === 'function' ? value(index) : value
  for (const [index, [travel, lift]] of path.entries()) {
    const movement = {
      headShift: atFrame(options.headShift ?? 0, index),
      hipShift: index < 10 ? options.hipShift ?? 0 : 0,
      ankleShift: atFrame(options.ankleShift ?? 0, index),
      ankleSpread: atFrame(options.ankleSpread ?? 0, index),
      ankleVisible: atFrame(options.ankleVisible ?? true, index),
      headVisible: atFrame(options.headVisible ?? true, index),
      leadBend: atFrame(options.leadBend ?? 0.06, index),
      trailBend: atFrame(options.trailBend ?? 0.20, index),
      trailElbowGap: atFrame(options.trailElbowGap ?? 0, index),
      leadElbowVisible: atFrame(options.leadElbowVisible ?? true, index),
      trailElbowVisible: atFrame(options.trailElbowVisible ?? true, index),
      shoulderScale: atFrame(options.shoulderScale ?? 1, index),
      shoulderDepth: atFrame(options.shoulderDepth ?? 0, index),
    }
    const snapshot = session.update(pose(handedness, travel, lift, movement), firstAt + index * interval)
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
  assert.equal(another.missing(1500).tracking, 'lost')
  assert.equal(another.snapshot().swings, 0)
})

test('missing and wildly shifting face landmarks never change golf phase or scores', () => {
  const results = [{}, { headVisible: false }, { headShift: (index) => index % 2 ? 50 : -50 }]
    .map((options) => {
      const session = new GolfSwingSession('left')
      session.start()
      address(session, 'left', 0, 5, (index) => ({
        headVisible: options.headVisible ?? true,
        headShift: typeof options.headShift === 'function' ? options.headShift(index) : options.headShift ?? 0,
      }))
      const phases = swing(session, 'left', 600, 100, options)
      return { phases, result: session.snapshot().latest }
    })
  assert.ok(results.every(({ result }) => result?.score !== null))
  assert.deepEqual(results[1], results[0])
  assert.deepEqual(results[2], results[0])
  assert.equal(results[0].result.categories[1].name, 'Arm mechanics')
  assert.doesNotMatch(JSON.stringify(results[0].result), /head|nose|ankle.shift/i)
})

test('ankle jitter and normal leg rotation do not alter tracking or golf scores', () => {
  const recordings = [
    {},
    { ankleShift: (index) => index % 2 ? 1.2 : -1.2, ankleSpread: (index) => index % 2 ? 0.6 : -0.6 },
    { ankleVisible: (index) => index < 8 ? false : true },
  ].map((options) => {
    const session = new GolfSwingSession('right')
    session.start()
    address(session, 'right')
    const phases = swing(session, 'right', 600, 100, options)
    return { phases, result: session.snapshot().latest, tracking: session.snapshot().tracking }
  })
  for (const recording of recordings) {
    assert.equal(recording.tracking, 'tracking')
    assert.ok(recording.phases.includes('Finish'))
    assert.deepEqual(recording.result, recordings[0].result)
  }
})

test('unstable or missing address ankles make stance optional without losing a swing', () => {
  for (const ankleVisible of [true, false]) {
    const session = new GolfSwingSession('right')
    session.start()
    for (let index = 0; index < 5; index++) {
      session.update(pose('right', 0, 0, {
        ankleVisible, ankleSpread: index % 2 ? 0.8 : -0.8,
      }), index * 100)
    }
    assert.equal(session.snapshot().status, 'Ready')
    swing(session, 'right')
    const result = session.snapshot().latest
    assert.ok(result?.score !== null)
    assert.equal(result.measurements.stanceRatio, null)
    assert.match(result.categories[0].explanation, /stance width unavailable/i)
  }
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
  assert.equal(insufficient.categories.length, 5)
  assert.ok(insufficient.categories.every((category) => category.score === null))
})

test('follow-through finishes from observed torso turn after both wrists disappear', () => {
  for (const hand of ['right', 'left']) {
    const session = new GolfSwingSession(hand)
    session.start()
    address(session, hand)
    for (let index = 0; index <= 10; index++) session.update(pose(hand, ...path[index]), 600 + index * 100)
    assert.equal(session.snapshot().phase, 'Follow-through')
    let partial = false
    for (let index = 11; index < path.length; index++) {
      const state = session.update(pose(hand, ...path[index], { wristVisible: false, ankleVisible: false, shoulderScale: 0.7 }), 600 + index * 100)
      partial ||= state.tracking === 'partial'
    }
    assert.equal(partial, true)
    assert.equal(session.snapshot().phase, 'Finish')
    assert.equal(session.snapshot().swings, 1)
    assert.notEqual(session.snapshot().latest?.score, null)
  }
})

test('wrists can reappear after partial follow-through without restarting the swing', () => {
  const session = new GolfSwingSession('right')
  session.start()
  address(session, 'right')
  for (let index = 0; index <= 10; index++) session.update(pose('right', ...path[index]), 600 + index * 100)
  for (let index = 11; index <= 13; index++) {
    assert.equal(session.update(pose('right', ...path[index], { wristVisible: false, shoulderScale: 0.75 }), 600 + index * 100).tracking, 'partial')
  }
  for (let index = 14; index < path.length; index++) session.update(pose('right', ...path[index], { shoulderScale: 0.75 }), 600 + index * 100)
  assert.equal(session.snapshot().swings, 1)
  assert.equal(session.snapshot().phase, 'Finish')
})

test('address accepts natural hand spacing and brief ankle or wrist occlusion', () => {
  const session = new GolfSwingSession('left')
  session.start()
  session.update(pose('left', 0, 0, { wristSpread: 0.08, handDrop: 0.61 }), 0)
  session.update(pose('left', 0.06, 0, { wristSpread: 0.08, handDrop: 0.61, ankleVisible: false, rightWristVisible: false }), 80)
  session.update(pose('left', 0, 0, { wristVisible: false, ankleVisible: false }), 160)
  session.update(pose('left', 0.05, 0, { wristSpread: 0.08, handDrop: 0.61 }), 240)
  assert.equal(session.snapshot().status, 'Ready')
})

test('torso rotation alone cannot complete an unobserved follow-through', () => {
  const session = new GolfSwingSession('right')
  session.start()
  address(session, 'right')
  for (let index = 0; index <= 9; index++) session.update(pose('right', ...path[index]), 600 + index * 100)
  for (let index = 10; index < path.length; index++) {
    session.update(pose('right', ...path[index], { wristVisible: false, shoulderScale: 0.7 }), 600 + index * 100)
  }
  assert.equal(session.snapshot().swings, 0)
})

test('brief backswing hand occlusion preserves the phase and resumes from observed hands', () => {
  const session = new GolfSwingSession('right')
  session.start()
  address(session, 'right')
  session.update(pose('right', 0.35, 0.1), 600)
  session.update(pose('right', 0.55, 0.2), 700)
  assert.equal(session.update(pose('right', 0.75, 0.35, { wristVisible: false, shoulderScale: 0.85 }), 800).phase, 'Backswing')
  assert.equal(session.snapshot().tracking, 'partial')
  assert.equal(session.update(pose('right', 0.9, 0.6), 900).phase, 'Backswing')
  assert.equal(session.snapshot().swings, 0)
  for (let index = 4; index < path.length; index++) session.update(pose('right', ...path[index]), 600 + index * 100)
  assert.equal(session.snapshot().swings, 1)
})

test('near edge-on shoulders remain observable through depth separation at finish', () => {
  const session = new GolfSwingSession('right')
  session.start()
  address(session, 'right')
  for (let index = 0; index <= 10; index++) session.update(pose('right', ...path[index]), 600 + index * 100)
  for (let index = 11; index < path.length; index++) {
    session.update(pose('right', ...path[index], {
      wristVisible: false, shoulderScale: 0.03, shoulderDepth: 0.08,
    }), 600 + index * 100)
  }
  assert.equal(session.snapshot().phase, 'Finish')
  assert.equal(session.snapshot().swings, 1)
})

function scoredSwing(handedness, options = {}) {
  const session = new GolfSwingSession(handedness)
  session.start()
  address(session, handedness, 0, 5, options.addressOptions ?? {})
  swing(session, handedness, 600, 100, options)
  return session.snapshot().latest
}

test('lead-arm extension uses the correct elbow and rejects sustained bend before estimated strike', () => {
  for (const handedness of ['right', 'left']) {
    const straight = scoredSwing(handedness)
    const bent = scoredSwing(handedness, { leadBend: 0.48 })
    assert.ok(straight.score !== null && bent.score !== null)
    assert.ok(straight.measurements.leadElbowAngle > bent.measurements.leadElbowAngle + 35)
    assert.ok(straight.categories[1].score > bent.categories[1].score)
    assert.match(bent.categories[1].suggestion, /Lead elbow angle/)
    const nearTop = scoredSwing(handedness, { leadBend: (index) => index >= 3 && index <= 7 ? 0.48 : 0.06 })
    assert.ok(nearTop.measurements.leadElbowAngle < straight.measurements.leadElbowAngle - 20)
    const followOnly = scoredSwing(handedness, { leadBend: (index) => index >= 10 ? 0.48 : 0.06 })
    assert.equal(followOnly.measurements.leadElbowAngle, straight.measurements.leadElbowAngle)
  }
})

test('trail-elbow delivery compares visible elbow to its own hip and torso', () => {
  for (const handedness of ['right', 'left']) {
    const connected = scoredSwing(handedness)
    const separated = scoredSwing(handedness, { trailElbowGap: (index) => index >= 6 && index <= 10 ? 1.6 : 0 })
    assert.ok(connected.score !== null && separated.score !== null)
    assert.ok(separated.measurements.trailElbowHipDistance > connected.measurements.trailElbowHipDistance)
    assert.ok(separated.measurements.trailElbowTorsoDistance > connected.measurements.trailElbowTorsoDistance)
    assert.ok(connected.categories[1].score > separated.categories[1].score)
    assert.match(separated.categories[1].suggestion, /Trail elbow measured/)
  }
})

test('minor accepted address adjustments and simulated torso rotation retain fair scores', () => {
  const baseline = scoredSwing('right')
  const adjusted = scoredSwing('right', { addressOptions: (index) => ({
    handDrop: 0.64 + (index % 2 ? 0.004 : 0),
    shoulderShift: index % 2 ? 0.025 : 0,
  }) })
  const rotated = scoredSwing('right', {
    shoulderScale: (index) => index > 3 && index < 13 ? 0.75 : 1,
    shoulderDepth: (index) => index > 3 && index < 13 ? 0.08 : 0,
  })
  assert.ok(adjusted.categories[0].score >= 1.5)
  assert.ok(rotated.categories[2].score >= baseline.categories[2].score - 0.2)
  assert.doesNotMatch(adjusted.improve.join(' '), /Settle into a comfortable/)
})

test('brief arm occlusion is excluded, while missing or low-confidence arm coverage is unavailable', () => {
  const baseline = scoredSwing('right')
  const brief = scoredSwing('right', { leadElbowVisible: (index) => index !== 3 && index !== 7 })
  assert.ok(brief.score !== null)
  assert.ok(brief.measurements.leadElbowAngle >= baseline.measurements.leadElbowAngle - 4)
  const missingLead = scoredSwing('right', { leadElbowVisible: false })
  assert.equal(missingLead.categories[1].score, null)
  assert.equal(missingLead.measurements.leadElbowAngle, null)
  assert.equal(missingLead.score, null)
  assert.ok(missingLead.categories[0].score !== null)
  assert.match(missingLead.categories[1].explanation, /Trail Elbow Delivery: \d/)
  const missingTrail = scoredSwing('left', { trailElbowVisible: (index) => index < 6 || index > 10 })
  assert.equal(missingTrail.categories[1].score, null)
  assert.equal(missingTrail.measurements.trailElbowAngle, null)
  assert.equal(missingTrail.score, null)
  const noWorld = pose('right')
  noWorld.worldLandmarks = []
  const bodyOnly = measureGolf(noWorld, 0, 'right')
  assert.ok(bodyOnly)
  assert.equal(bodyOnly.leadElbowAngle, null)
  assert.equal(bodyOnly.trailElbowHipDistance, null)
})

test('club path is unavailable without clubhead and target-line evidence and never changes score', () => {
  assert.equal(clubPathAssessment.status, 'unavailable')
  assert.equal(clubPathAssessment.label, 'Club path unavailable with current tracking')
  assert.match(clubPathAssessment.explanation, /clubhead direction relative to a target line/)
  const result = scoredSwing('right')
  assert.ok(result.score >= 0 && result.score <= 10)
  assert.equal(result.categories.length, 5)
  assert.equal(result.score, Math.round(result.categories.reduce((total, category) => total + category.score, 0) * 10) / 10)
})
