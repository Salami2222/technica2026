import test from 'node:test'
import assert from 'node:assert/strict'
import { ExerciseSession } from '../src/session/session.ts'

function observed(phase, readings = {}, tracking = 'tracking') {
  return {
    phase,
    tracking,
    angles: Object.entries(readings).map(([label, degrees]) => ({ label, degrees })),
    side: 'left',
    detail: '',
  }
}

const squatStart = () => observed('Standing', { Knee: 170 })
const pushUpStart = () => observed('Top', { Elbow: 170, 'Body line': 170 })

function arm(session, startPose, firstAt = 0) {
  session.observe(startPose(), firstAt)
  return session.observe(startPose(), firstAt + 500)
}

function completeSquat(session, firstAt = 600) {
  session.observe(observed('Descending', { Knee: 140 }), firstAt)
  session.observe(observed('Bottom', { Knee: 85 }), firstAt + 100)
  session.observe(observed('Ascending', { Knee: 130 }), firstAt + 200)
  session.observe(squatStart(), firstAt + 300)
  return session.observe(squatStart(), firstAt + 480)
}

function completePushUp(session, firstAt = 600) {
  session.observe(observed('Lowering', { Elbow: 135 }), firstAt)
  session.observe(observed('Bottom', { Elbow: 80 }), firstAt + 100)
  session.observe(observed('Pushing', { Elbow: 120 }), firstAt + 200)
  session.observe(pushUpStart(), firstAt + 300)
  return session.observe(pushUpStart(), firstAt + 480)
}

test('squat session waits for a stable extended-leg start and does not count it', () => {
  const session = new ExerciseSession('squat')
  assert.equal(session.snapshot().status, 'Idle')
  assert.equal(session.start().status, 'Waiting for Position')
  assert.equal(session.observe(observed('Not Ready', {}, 'not-ready'), 0).status, 'Waiting for Position')
  assert.equal(session.observe(observed('Standing', { Knee: 150 }), 0).status, 'Waiting for Position')
  assert.equal(session.observe(squatStart(), 100).status, 'Waiting for Position')
  assert.equal(session.observe(squatStart(), 599).status, 'Waiting for Position')
  const ready = session.observe(squatStart(), 600)
  assert.equal(ready.status, 'Ready')
  assert.equal(ready.repetitions, 0)
  assert.equal(session.observe(squatStart(), 800).repetitions, 0)
})

test('push-up session requires extended arms and an aligned plank', () => {
  const session = new ExerciseSession('push-up')
  session.start()
  assert.equal(session.observe(observed('Top', { Elbow: 170 }), 0).status, 'Waiting for Position')
  assert.equal(session.observe(observed('Top', { Elbow: 170, 'Body line': 145 }), 100).status, 'Waiting for Position')
  assert.equal(session.observe(observed('Top', { Elbow: 150, 'Body line': 170 }), 200).status, 'Waiting for Position')
  assert.equal(arm(session, pushUpStart, 300).status, 'Ready')
  assert.equal(session.snapshot().repetitions, 0)
})

test('a full squat cycle counts once after a stable return', () => {
  const session = new ExerciseSession('squat')
  session.start()
  arm(session, squatStart)
  assert.equal(session.observe(observed('Descending', { Knee: 140 }), 600).status, 'Recording')
  session.observe(observed('Bottom', { Knee: 85 }), 700)
  session.observe(observed('Ascending', { Knee: 130 }), 800)
  assert.equal(session.observe(squatStart(), 900).repetitions, 0)
  assert.equal(session.observe(squatStart(), 1079).repetitions, 0)
  assert.equal(session.observe(squatStart(), 1080).repetitions, 1)
  assert.equal(session.snapshot().status, 'Ready')
  assert.equal(session.observe(squatStart(), 1200).repetitions, 1)
  assert.equal(completeSquat(session, 1300).repetitions, 2)
})

test('a full push-up cycle counts once and rejects an unaligned return', () => {
  const session = new ExerciseSession('push-up')
  session.start()
  arm(session, pushUpStart)
  assert.equal(completePushUp(session).repetitions, 1)
  session.observe(observed('Lowering', { Elbow: 135 }), 1200)
  session.observe(observed('Bottom', { Elbow: 80 }), 1300)
  session.observe(observed('Pushing', { Elbow: 120 }), 1400)
  assert.equal(session.observe(observed('Top', { Elbow: 170, 'Body line': 140 }), 1500).repetitions, 1)
  assert.equal(session.snapshot().status, 'Waiting for Position')
})

test('skipped or reversed phases cannot complete a repetition', () => {
  const session = new ExerciseSession('squat')
  session.start()
  arm(session, squatStart)
  session.observe(observed('Bottom', { Knee: 85 }), 600)
  session.observe(observed('Ascending', { Knee: 130 }), 700)
  session.observe(squatStart(), 800)
  session.observe(squatStart(), 1300)
  assert.equal(session.snapshot().repetitions, 0)
  session.observe(observed('Descending', { Knee: 140 }), 1400)
  session.observe(squatStart(), 1500)
  assert.equal(session.snapshot().repetitions, 0)
})

test('pause freezes count and resume requires a fresh starting-position hold', () => {
  const session = new ExerciseSession('squat')
  session.start()
  arm(session, squatStart)
  assert.equal(completeSquat(session).repetitions, 1)
  session.observe(observed('Descending', { Knee: 140 }), 1200)
  assert.equal(session.pause().status, 'Paused')
  assert.equal(completeSquat(session, 1300).repetitions, 1)
  assert.equal(session.resume().status, 'Waiting for Position')
  session.observe(observed('Bottom', { Knee: 85 }), 1900)
  session.observe(observed('Ascending', { Knee: 130 }), 2000)
  session.observe(squatStart(), 2100)
  assert.equal(session.observe(squatStart(), 2600).status, 'Ready')
  assert.equal(session.snapshot().repetitions, 1)
  assert.equal(completeSquat(session, 2700).repetitions, 2)
})

test('tracking loss preserves completed reps but discards the unfinished cycle', () => {
  const session = new ExerciseSession('push-up')
  session.start()
  arm(session, pushUpStart)
  assert.equal(completePushUp(session).repetitions, 1)
  session.observe(observed('Lowering', { Elbow: 135 }), 1200)
  session.observe(observed('Bottom', { Elbow: 80 }), 1300)
  assert.equal(session.observe(observed('Bottom', {}, 'partial'), 1350).status, 'Tracking Lost')
  assert.equal(session.snapshot().repetitions, 1)
  session.observe(observed('Pushing', { Elbow: 120 }), 1400)
  session.observe(pushUpStart(), 1500)
  assert.equal(session.observe(pushUpStart(), 2000).status, 'Ready')
  assert.equal(session.snapshot().repetitions, 1)
  assert.equal(completePushUp(session, 2100).repetitions, 2)
})

test('stop publishes a summary and only a new start resets the count', () => {
  const session = new ExerciseSession('squat')
  session.start()
  arm(session, squatStart)
  completeSquat(session)
  const completed = session.stop()
  assert.equal(completed.status, 'Completed')
  assert.deepEqual(completed.summary, { exercise: 'squat', repetitions: 1 })
  assert.equal(completed.repetitions, 1)
  assert.equal(session.observe(observed('Descending', { Knee: 140 }), 1200).repetitions, 1)
  const restarted = session.start()
  assert.equal(restarted.status, 'Waiting for Position')
  assert.equal(restarted.repetitions, 0)
  assert.equal(restarted.summary, null)
})

test('stopping during an unfinished return does not award a repetition', () => {
  const session = new ExerciseSession('push-up')
  session.start()
  arm(session, pushUpStart)
  session.observe(observed('Lowering', { Elbow: 135 }), 600)
  session.observe(observed('Bottom', { Elbow: 80 }), 700)
  session.observe(observed('Pushing', { Elbow: 120 }), 800)
  session.observe(pushUpStart(), 900)
  const stopped = session.stop()
  assert.equal(stopped.status, 'Completed')
  assert.equal(stopped.repetitions, 0)
  assert.deepEqual(stopped.summary, { exercise: 'push-up', repetitions: 0 })
})
