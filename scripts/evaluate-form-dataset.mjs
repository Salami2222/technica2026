import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { hipJitter, motionControl, scoreExerciseRep } from '../src/form/score.ts'
import { formConfig } from '../src/form/config.ts'

export function splitParticipants(records) {
  const subjects = [...new Set(records.map((record) => record.subject))].sort()
  const holdoutCount = Math.max(1, Math.round(subjects.length * 0.25))
  const testSubjects = new Set(subjects.slice(-holdoutCount))
  const train = records.filter((record) => !testSubjects.has(record.subject))
  const test = records.filter((record) => testSubjects.has(record.subject))
  if (new Set(train.map((record) => record.subject)).intersection(testSubjects).size) {
    throw new Error('participant leakage')
  }
  return { train, test, trainSubjects: subjects.slice(0, -holdoutCount), testSubjects: [...testSubjects] }
}

const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
const median = (values) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
const quantile = (values, fraction) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) * fraction)]
}

export function featureSummary(samples, exercise, previousDepth = null) {
  const angles = samples.map((sample) => sample.angle)
  const control = motionControl(samples)
  const result = {
    minAngle: Math.min(...angles),
    angleExcursion: Math.max(...angles) - Math.min(...angles),
    finishExtensionGap: Math.abs(angles.at(-1) - angles[0]),
    depthConsistencyGap: previousDepth === null ? null : Math.abs(Math.min(...angles) - previousDepth),
    durationMs: samples.at(-1).at - samples[0].at,
    controlReversals: control?.reversals ?? null,
    controlSpeedRatio: control?.speedRatio ?? null,
  }
  if (exercise === 'squat') {
    const torso = samples.filter((sample) => sample.torsoLean !== null).map((sample) => sample.torsoLean)
    result.torsoLeanChange = torso.length >= 3 ? Math.max(...torso.map((value) => Math.abs(value - torso[0]))) : null
    result.hipPathJitter = hipJitter(samples)
  } else {
    const offset = samples.filter((sample) => sample.bodyOffset !== null).map((sample) => sample.bodyOffset)
    result.peakSag = offset.length >= 3 ? Math.max(0, ...offset) : null
    result.peakPike = offset.length >= 3 ? Math.max(0, ...offset.map((value) => -value)) : null
    const wrist = samples.filter((sample) => sample.wristX !== null && sample.wristY !== null && sample.bodyScale !== null)
    result.wristDrift = wrist.length >= 3 ? Math.max(...wrist.map((sample) =>
      Math.hypot(sample.wristX - wrist[0].wristX, sample.wristY - wrist[0].wristY) / sample.bodyScale)) : null
  }
  return result
}

export function prepareRecords(raw) {
  return raw.map((video) => {
    let previousDepth = null
    const repetitions = video.repetitions.map((samples, index) => {
      const features = featureSummary(samples, video.exercise, previousDepth)
      const scored = scoreExerciseRep(video.exercise, index + 1, samples, previousDepth)
      if (scored.depthAngle !== null) previousDepth = scored.depthAngle
      return { score: scored.score, categories: scored.categories,
        features }
    })
    const scores = repetitions.map((item) => item.score).filter((score) => score !== null)
    const features = Object.fromEntries([...new Set(repetitions.flatMap((item) => Object.keys(item.features)))].map((name) =>
      [name, average(repetitions.map((item) => item.features[name]).filter((value) => value !== null && value !== undefined))]))
    return { filename: video.filename, sha256: video.sha256, subject: video.subject, exercise: video.exercise,
      label: video.label, completeRepetitions: repetitions.length, uncertainCycles: video.uncertainCycles,
      trackedFrames: video.trackedFrames, sampledFrames: video.sampledFrames,
      scoredRepetitions: scores.length, score: average(scores), features }
  })
}

export function metrics(videos, threshold) {
  const measured = videos.filter((video) => video.score !== null)
  let tp = 0, tn = 0, fp = 0, fn = 0
  for (const video of measured) {
    const predictedGood = video.score >= threshold
    if (predictedGood && video.label === 'good') tp++
    else if (predictedGood) fp++
    else if (video.label === 'good') fn++
    else tn++
  }
  const precision = tp + fp ? tp / (tp + fp) : 0
  const recall = tp + fn ? tp / (tp + fn) : 0
  return { n: measured.length, coverage: videos.length ? measured.length / videos.length : 0,
    accuracy: measured.length ? (tp + tn) / measured.length : null,
    precision: measured.length ? precision : null, recall: measured.length ? recall : null,
    f1: measured.length && precision + recall ? 2 * precision * recall / (precision + recall) : measured.length ? 0 : null,
    confusion: { trueGood: tp, trueBad: tn, falseGood: fp, falseBad: fn } }
}

export function distribution(videos) {
  const names = [...new Set(videos.flatMap((video) => Object.keys(video.features)))].sort()
  return Object.fromEntries(names.map((name) => [name, Object.fromEntries(['good', 'bad'].map((label) => {
    const values = videos.filter((video) => video.label === label).map((video) => video.features[name]).filter((value) => value !== null && value !== undefined)
    return [label, { n: values.length, median: median(values), q25: quantile(values, 0.25), q75: quantile(values, 0.75) }]
  }))]))
}

export function evaluate(raw) {
  const seen = new Map()
  const duplicates = []
  const unique = raw.filter((video) => {
    if (!video.sha256) throw new Error(`missing source-video hash: ${video.filename}`)
    const first = seen.get(video.sha256)
    if (!first) { seen.set(video.sha256, video); return true }
    if (first.exercise !== video.exercise || first.label !== video.label) {
      throw new Error(`identical video has conflicting labels: ${first.filename}, ${video.filename}`)
    }
    duplicates.push({ kept: first.filename, excluded: video.filename })
    return false
  })
  const records = prepareRecords(unique)
  const split = splitParticipants(records)
  const report = { dataset: '10.17632/kgbb3yn47p.2', view: 'side',
    duplicateFilesExcluded: duplicates,
    files: records.map(({ filename, completeRepetitions, uncertainCycles, scoredRepetitions }) =>
      ({ filename, completeRepetitions, uncertainCycles, scoredRepetitions })),
    split: { trainSubjects: split.trainSubjects, testSubjects: split.testSubjects }, exercises: {} }
  for (const exercise of ['squat', 'push-up']) {
    const train = split.train.filter((record) => record.exercise === exercise)
    const test = split.test.filter((record) => record.exercise === exercise)
    const baselineTrain = metrics(train, formConfig.acceptableScore)
    const baselineTest = metrics(test, formConfig.acceptableScore)
    // Exploratory threshold selection uses training participants only.
    const candidates = Array.from({ length: 21 }, (_, index) => index / 2)
    const ranked = candidates.map((threshold) => ({ threshold, train: metrics(train, threshold) }))
      .sort((a, b) => (b.train.f1 ?? -1) - (a.train.f1 ?? -1) ||
        Math.abs(a.threshold - formConfig.acceptableScore) - Math.abs(b.threshold - formConfig.acceptableScore))
    const candidate = ranked[0]
    report.exercises[exercise] = {
      counts: { trainVideos: train.length, testVideos: test.length,
        trainScored: baselineTrain.n, testScored: baselineTest.n },
      trainingFeatureDistribution: distribution(train),
      baseline: { threshold: formConfig.acceptableScore, train: baselineTrain, test: baselineTest },
      exploratoryCandidate: { threshold: candidate.threshold, train: candidate.train, test: metrics(test, candidate.threshold) },
      applied: false,
      reason: 'A binary whole-video label does not validate category bands or a 0–10 scale. Require larger participant-disjoint validation and Kinect transfer testing before changing live thresholds.',
    }
  }
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const input = process.argv[2] ?? 'work/form-dataset/measurements.jsonl'
  const output = process.argv[3] ?? 'work/form-dataset/report.json'
  const raw = readFileSync(input, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  const report = evaluate(raw)
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
  console.log(`Evaluated ${raw.length} source videos; report: ${output}`)
}
