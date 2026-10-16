import test from 'node:test'
import assert from 'node:assert/strict'
import { ExerciseSession } from '../src/session/session.ts'
import { measureForm } from '../src/form/measure.ts'

const point = (x, y, visibility = 1) => ({ x, y, z: 0, visibility, presence: visibility })
function pose(exercise, options = {}) {
  const points = Array.from({ length: 33 }, () => point(0, 0, 0))
  if (exercise === 'squat') {
    points[11] = point(options.shoulderX ?? 0.46, 0.28, options.hideShoulder ? 0.1 : 1)
    points[23] = point(options.hipX ?? 0.48, 0.53)
    points[25] = point(0.51, 0.7)
    points[27] = point(0.5, 0.9)
  } else {
    points[11] = point(0.23, 0.55)
    points[13] = point(0.19, 0.68)
    points[15] = point(options.wristX ?? 0.17, options.wristY ?? 0.77)
    points[23] = point(0.53, options.hipY ?? 0.55, options.hideHip ? 0.1 : 1)
    points[27] = point(0.86, 0.55, options.hideAnkle ? 0.1 : 1)
  }
  return { landmarks: [points], worldLandmarks: [points] }
}

function phase(exercise, angle, status = 'tracking') {
  return {
    phase: angle >= 158 ? exercise === 'squat' ? 'Standing' : 'Top' :
      angle <= 105 ? 'Bottom' : exercise === 'squat' ? 'Descending' : 'Lowering',
    tracking: status,
    side: 'left', detail: '',
    angles: status === 'tracking' ? [
      { label: exercise === 'squat' ? 'Knee' : 'Elbow', degrees: angle },
      ...(exercise === 'push-up' ? [{ label: 'Body line', degrees: 170 }] : []),
    ] : [],
  }
}

function start(exercise) {
  const session = new ExerciseSession(exercise)
  session.start()
  session.observe(phase(exercise, 170), 0, pose(exercise))
  assert.equal(session.observe(phase(exercise, 170), 350, pose(exercise)).status, 'Ready')
  return session
}

const goodAngles = [135, 120, 102, 85, 95, 112, 130, 150, 170]
const poorAngles = [135, 118, 145, 103, 125, 101, 117, 142, 170]
function rep(session, exercise, at, interval = 80, quality = 'good') {
  const angles = quality === 'poor' ? exercise === 'push-up' ?
    [135, 118, 145, 93, 125, 91, 117, 142, 170] : poorAngles : goodAngles
  let state
  for (const [index, angle] of angles.entries()) {
    let options = {}
    if (quality === 'poor' && exercise === 'squat') options = {
      shoulderX: 0.23, hipX: index % 2 ? 0.59 : 0.43,
    }
    if (quality === 'poor' && exercise === 'push-up') options = {
      hipY: 0.73, wristX: 0.17 + index * 0.012,
    }
    if (quality === 'missing' && exercise === 'squat' && index < 7) options = { hideShoulder: true }
    if (quality === 'missing' && exercise === 'push-up' && index < 7) options = { hideHip: true, hideAnkle: true }
    state = session.observe(phase(exercise, angle), at + index * interval, pose(exercise, options))
  }
  return state
}

test('good and poor squat repetitions get bounded, measured category scores without changing counts', () => {
  const session = start('squat')
  const good = rep(session, 'squat', 600)
  assert.equal(good.repetitions, 1)
  assert.ok(good.latestForm.score >= 0 && good.latestForm.score <= 10)
  assert.equal(good.latestForm.categories.length, 5)
  assert.ok(good.latestForm.suggestions.length >= 1 && good.latestForm.suggestions.length <= 2)
  assert.equal(good.latestForm.score, Math.round(good.latestForm.categories.reduce((sum, item) => sum + item.score, 0) * 10) / 10)
  const poor = rep(session, 'squat', 1500, 80, 'poor')
  assert.equal(poor.repetitions, 2)
  assert.ok(poor.latestForm.score < good.latestForm.score)
  assert.match(poor.latestForm.categories[1].explanation, /Torso inclination changed/)
  assert.match(poor.latestForm.categories[3].explanation, /Hip-path irregularity/)
  assert.ok(poor.latestForm.suggestions.length > 0)
})

test('good and poor push-up sequences score body line and hand stability from landmarks', () => {
  const session = start('push-up')
  const good = rep(session, 'push-up', 600)
  const poor = rep(session, 'push-up', 1500, 90, 'poor')
  assert.equal(poor.repetitions, 2)
  assert.ok(good.latestForm.score > poor.latestForm.score)
  assert.match(poor.latestForm.categories[1].explanation, /hip offset/)
  assert.match(poor.latestForm.categories[3].explanation, /wrist-anchor drift/)
  assert.ok(poor.latestForm.issues.length > 0)
})

test('multiple consecutive reps at different speeds retain independent scores and correct summary averages', () => {
  for (const exercise of ['squat', 'push-up']) {
    const session = start(exercise)
    let at = 600
    for (const interval of [55, 70, 95, 130]) {
      const snapshot = rep(session, exercise, at, interval)
      at += interval * goodAngles.length + 100
      assert.equal(snapshot.repetitions, snapshot.formResults.length)
      assert.ok(snapshot.latestForm.score >= 0 && snapshot.latestForm.score <= 10)
    }
    const completed = session.stop()
    assert.equal(completed.summary.repetitions, 4)
    assert.equal(completed.formSummary.scoredRepetitions, 4)
    assert.equal(completed.formSummary.acceptableRepetitions, 4)
    const expected = Math.round(completed.formResults.reduce((sum, item) => sum + item.score, 0) / 4 * 10) / 10
    assert.equal(completed.formSummary.averageScore, expected)
    assert.ok(completed.formSummary.strongestCategory)
  }
})

test('missing form landmarks mark categories unavailable while the observed rep still counts', () => {
  for (const exercise of ['squat', 'push-up']) {
    const session = start(exercise)
    const state = rep(session, exercise, 600, 80, 'missing')
    assert.equal(state.repetitions, 1)
    assert.equal(state.latestForm.score, null)
    assert.match(state.latestForm.reason, /Unable to Score/)
    assert.ok(state.latestForm.categories.some((item) => item.score === null))
    assert.match(state.latestForm.suggestions[0], /Keep the joints needed/)
    const stopped = session.stop()
    assert.equal(stopped.summary.repetitions, 1)
    assert.equal(stopped.formSummary.scoredRepetitions, 0)
    assert.equal(stopped.formSummary.averageScore, null)
  }
})

test('live feedback is tied to observed torso or hip-line deviation', () => {
  for (const exercise of ['squat', 'push-up']) {
    const session = start(exercise)
    const normal = session.observe(phase(exercise, 135), 600, pose(exercise))
    assert.equal(normal.liveFeedback, null)
    const issue = session.observe(phase(exercise, 120), 700,
      pose(exercise, exercise === 'squat' ? { shoulderX: 0.2 } : { hipY: 0.73 }))
    assert.match(issue.liveFeedback, exercise === 'squat' ? /Torso angle changed/ : /Hip line offset/)
    session.pause()
    assert.equal(session.snapshot().liveFeedback, null)
  }
})

test('session average excludes an unscored rep while preserving all completed repetitions', () => {
  const session = start('squat')
  const first = rep(session, 'squat', 600)
  rep(session, 'squat', 1500, 80, 'missing')
  const third = rep(session, 'squat', 2400, 80, 'poor')
  assert.equal(third.repetitions, 3)
  assert.equal(third.formResults[1].score, null)
  const summary = session.stop().formSummary
  assert.equal(summary.scoredRepetitions, 2)
  assert.equal(summary.averageScore,
    Math.round((first.latestForm.score + third.latestForm.score) / 2 * 10) / 10)
})

test('push-up sag direction is independent of which way the body faces', () => {
  const forward = measureForm('push-up', pose('push-up', { hipY: 0.7 }), phase('push-up', 110), 0)
  const points = Array.from({ length: 33 }, () => point(0, 0, 0))
  points[12] = point(0.77, 0.55)
  points[14] = point(0.81, 0.68)
  points[16] = point(0.83, 0.77)
  points[24] = point(0.47, 0.7)
  points[28] = point(0.14, 0.55)
  const reversed = measureForm('push-up', { landmarks: [points], worldLandmarks: [points] },
    { ...phase('push-up', 110), side: 'right' }, 0)
  assert.ok(forward.bodyOffset > 0)
  assert.ok(reversed.bodyOffset > 0)
  assert.ok(Math.abs(forward.bodyOffset - reversed.bodyOffset) < 0.01)
})

test('a brief essential-joint tracking gap preserves a real count and collects only observed form samples', () => {
  const session = start('squat')
  for (const [at, angle] of [[600, 135], [680, 115], [760, 95]]) {
    session.observe(phase('squat', angle), at, pose('squat'))
  }
  assert.equal(session.observe(phase('squat', 95, 'partial'), 790).status, 'Tracking Lost')
  assert.equal(session.observe(phase('squat', 94), 830, pose('squat')).status, 'Recording')
  for (const [at, angle] of [[900, 118], [980, 145], [1060, 170]]) {
    session.observe(phase('squat', angle), at, pose('squat'))
  }
  assert.equal(session.snapshot().repetitions, 1)
  assert.equal(session.snapshot().formResults.length, 1)
  assert.equal(session.snapshot().latestForm.durationMs, 710)
  assert.equal(session.observe(phase('squat', 170), 1100, pose('squat')).repetitions, 1)
})
