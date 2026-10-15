import type { PoseLandmarkerResult } from '@mediapipe/tasks-vision'
import { squatConfig, trackingConfig } from './config.ts'
import { SmoothedSignal, TrackingGate } from './filter.ts'
import { jointAngle, visibleSide } from './geometry.ts'
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
    const points = visibleSide(result, ['shoulder', 'hip', 'knee', 'ankle'], this.side)
    if (!points) return this.missing(timestampMs)

    const kneeAngle = jointAngle(points, 'hip', 'knee', 'ankle')
    const hipAngle = jointAngle(points, 'shoulder', 'hip', 'knee')
    if (kneeAngle === null || hipAngle === null) return this.missing(timestampMs)

    this.tracking.valid(timestampMs)
    this.side = points.side
    const knee = this.knee.update(kneeAngle, timestampMs)
    const hip = this.hip.update(hipAngle, timestampMs)
    const bend = this.bend.update(knee * 0.7 + hip * 0.3, timestampMs)
    const descending = this.bend.velocity < -trackingConfig.directionDegreesPerSecond
    const ascending = this.bend.velocity > trackingConfig.directionDegreesPerSecond
    const canTransition = timestampMs - this.transitionedAt >= trackingConfig.minimumPhaseMs

    if (this.phase === null) {
      if (bend >= squatConfig.standingEnter) this.enter('Standing', timestampMs)
      else if (bend <= squatConfig.bottomEnter) this.enter('Bottom', timestampMs)
      else if (descending) this.enter('Descending', timestampMs)
      else if (ascending) this.enter('Ascending', timestampMs)
    } else if (canTransition) {
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

    if (!this.phase) return {
      ...notReady(),
      angles: [
        { label: 'Knee', degrees: knee },
        { label: 'Hip', degrees: hip },
      ],
      side: points.side,
      detail: 'Begin upright or move through a squat to establish a phase.',
    }
    return {
      phase: this.phase,
      angles: [
        { label: 'Knee', degrees: knee },
        { label: 'Hip', degrees: hip },
      ],
      side: points.side,
      detail: 'Phase follows smoothed knee and hip bend direction.',
    }
  }

  missing(timestampMs: number): PhaseSnapshot {
    return this.tracking.missing(timestampMs, () => this.resetMeasurements())
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
    this.knee.reset()
    this.hip.reset()
    this.bend.reset()
    this.side = null
  }
}
