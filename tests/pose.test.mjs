import test from 'node:test'
import assert from 'node:assert/strict'
import { bodyConnections, bodyLandmarks } from '../src/pose.ts'

test('skeleton input keeps body joints and excludes every facial point and connector', () => {
  const pose = Array.from({ length: 33 }, (_, index) => ({ x: index, y: 0, z: 0 }))
  assert.deepEqual(bodyLandmarks(pose).map((point) => point.x), Array.from({ length: 22 }, (_, index) => index + 11))
  assert.ok(bodyConnections.length > 0)
  assert.ok(bodyConnections.every(({ start, end }) => start >= 11 && end >= 11))
  assert.ok(bodyConnections.some(({ start, end }) => start === 11 && end === 13))
  assert.ok(bodyConnections.some(({ start, end }) => start === 23 && end === 25))
})
