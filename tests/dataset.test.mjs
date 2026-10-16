import test from 'node:test'
import assert from 'node:assert/strict'
import { distribution, evaluate, metrics, splitParticipants } from '../scripts/evaluate-form-dataset.mjs'

test('participant split never leaks either form label into holdout subjects', () => {
  const records = Array.from({ length: 8 }, (_, index) => ['good', 'bad'].map((label) =>
    ({ subject: String(index + 1).padStart(3, '0'), label, exercise: 'squat' }))).flat()
  const split = splitParticipants(records)
  assert.deepEqual(split.testSubjects, ['007', '008'])
  assert.equal(split.train.length, 12)
  assert.equal(split.test.length, 4)
  assert.equal(new Set(split.train.map((record) => record.subject)).intersection(new Set(split.testSubjects)).size, 0)
})

test('classification metrics and feature summaries use video records, not frames', () => {
  const videos = [
    { label: 'good', score: 8, features: { minAngle: 82 } },
    { label: 'good', score: 6, features: { minAngle: 91 } },
    { label: 'bad', score: 7.5, features: { minAngle: 121 } },
    { label: 'bad', score: null, features: { minAngle: null } },
  ]
  const result = metrics(videos, 7)
  assert.equal(result.n, 3)
  assert.equal(result.coverage, 0.75)
  assert.deepEqual(result.confusion, { trueGood: 1, trueBad: 0, falseGood: 1, falseBad: 1 })
  assert.equal(distribution(videos).minAngle.bad.n, 1)
})

test('byte-identical dataset files are excluded before participant evaluation', () => {
  const raw = [
    { filename: 'subject_001_squat_good_side.mp4', sha256: 'a', subject: '001', exercise: 'squat', label: 'good', repetitions: [], uncertainCycles: 0 },
    { filename: 'subject_002_squat_good_side.mp4', sha256: 'a', subject: '002', exercise: 'squat', label: 'good', repetitions: [], uncertainCycles: 0 },
    { filename: 'subject_003_squat_bad_side.mp4', sha256: 'b', subject: '003', exercise: 'squat', label: 'bad', repetitions: [], uncertainCycles: 0 },
  ]
  const report = evaluate(raw)
  assert.equal(report.duplicateFilesExcluded.length, 1)
  assert.equal(report.files.length, 2)
  assert.equal(report.exercises.squat.counts.trainScored + report.exercises.squat.counts.testScored, 0)
})
