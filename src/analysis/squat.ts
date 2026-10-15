import type { PoseLandmarkerResult } from '@mediapipe/tasks-vision'
import { squatConfig, trackingConfig } from './config.ts'
import { SmoothedSignal, TrackingGate } from './filter.ts'
import { hasVisibleJoint, jointAngle, visibleSide } from './geometry.ts'
import type { ExerciseDetector, PhaseSnapshot } from './types.ts'
import { notReady } from './types.ts'

type SquatPhase = 'Standing' | 'Descending' | 'Bottom' | 'Ascending'

export class SquatDetector implements ExerciseDetector {
  private phase: SquatPhase | null = null
  private transitionedAt = -Infinity
  private knee = new SmoothedSignal()
  private hip = new SmoothedSignal()
  private bend = new SmoothedSignal()
  private tracking = new TrackingGate()
  private side: 'left' | 'right' | null = null

  update(result: PoseLandmarkerResult, timestampMs: number): PhaseSnapshot {
    const points = visibleSide(result, ['hip', 'knee', 'ankle'], this.side)
    if (!points) return this.missing(timestampMs)

    const kneeAngle = jointAngle(points, 'hip', 'knee', 'ankle')
    if (kneeAngle === null) return this.missing(timestampMs)
    const hipAngle = hasVisibleJoint(points, 'shoulder') ? jointAngle(points, 'shoulder', 'hip', 'knee') : null

    if (this.tracking.expired(timestampMs)) this.resetMeasurements()
    const sideChanged = this.side !== null && this.side !== points.side
    const resumed = this.tracking.valid(timestampMs)
    if (resumed || sideChanged) this.resetSignals()
    this.side = points.side
    const knee = this.knee.update(kneeAngle, timestampMs)
    const hip = hipAngle === null ? null : this.hip.update(hipAngle, timestampMs)
    if (hipAngle === null) this.hip.reset()
    const bend = this.bend.update(knee, timestampMs)
    const descending = this.bend.velocity < -trackingConfig.directionDegreesPerSecond
    const ascending = this.bend.velocity > trackingConfig.directionDegreesPerSecond
    const canTransition = timestampMs - this.transitionedAt >= trackingConfig.minimumPhaseMs

    if (this.phase === null) {
      if (bend >= squatConfig.standingEnter) this.enter('Standing', timestampMs)
      else if (bend <= squatConfig.bottomEnter) this.enter('Bottom', timestampMs)
      else if (descending) this.enter('Descending', timestampMs)
      else if (ascending) this.enter('Ascending', timestampMs)
    } else if (canTransition && !resumed && !sideChanged) {
      switch (this.phase) {
        case 'Standing':
          if (bend <= squatConfig.standingExit && descending) this.enter('Descending', timestampMs)
          break
        case 'Descending':
          if (bend <= squatConfig.bottomEnter) this.enter('Bottom', timestampMs)
          else if (bend >= squatConfig.bottomExit && ascending) this.enter('Ascending', timestampMs)
          break
        case 'Bottom':
          if (bend >= squatConfig.bottomExit && ascending) this.enter('Ascending', timestampMs)
          break
        case 'Ascending':
          if (bend >= squatConfig.standingEnter) this.enter('Standing', timestampMs)
          else if (bend <= squatConfig.standingExit && descending) this.enter('Descending', timestampMs)
          break
      }
    }

    const angles = [{ label: 'Knee', degrees: knee }]
    if (hip !== null) angles.push({ label: 'Hip', degrees: hip })
    if (!this.phase) return {
      ...notReady(),
      tracking: 'tracking',
      angles,
      side: points.side,
      detail: 'Begin upright or move through a squat to establish a phase.',
    }
    return {
      phase: this.phase,
      tracking: 'tracking',
      angles,
      side: points.side,
      detail: 'Phase follows smoothed knee bend direction.',
    }
  }

  missing(timestampMs: number): PhaseSnapshot {
    return this.tracking.missing(timestampMs, this.phase ?? 'Not Ready', this.side, () => this.resetMeasurements())
  }

  reset(): void {
    this.tracking.reset()
    this.resetMeasurements()
  }

  private enter(phase: SquatPhase, timestampMs: number): void {
    this.phase = phase
    this.transitionedAt = timestampMs
  }

  private resetMeasurements(): void {
    this.phase = null
    this.transitionedAt = -Infinity
    this.resetSignals()
    this.side = null
  }

  private resetSignals(): void {
    this.knee.reset()
    this.hip.reset()
    this.bend.reset()
  }
}
