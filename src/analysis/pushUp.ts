import type { PoseLandmarkerResult } from '@mediapipe/tasks-vision'
import { pushUpConfig, trackingConfig } from './config.ts'
import { SmoothedSignal, TrackingGate } from './filter.ts'
import { jointAngle, jointIndex, visibleSide } from './geometry.ts'
import type { ExerciseDetector, PhaseSnapshot } from './types.ts'
import { notReady } from './types.ts'

type PushUpPhase = 'Top' | 'Lowering' | 'Bottom' | 'Pushing'

export class PushUpDetector implements ExerciseDetector {
  private phase: PushUpPhase | null = null
  private transitionedAt = -Infinity
  private elbow = new SmoothedSignal()
  private shoulder = new SmoothedSignal()
  private bodyLine = new SmoothedSignal()
  private shoulderHeight = new SmoothedSignal()
  private tracking = new TrackingGate()
  private side: 'left' | 'right' | null = null

  update(result: PoseLandmarkerResult, timestampMs: number): PhaseSnapshot {
    const points = visibleSide(result, ['shoulder', 'elbow', 'wrist', 'hip', 'ankle'], this.side)
    if (!points) return this.missing(timestampMs)

    const elbowAngle = jointAngle(points, 'shoulder', 'elbow', 'wrist')
    const shoulderAngle = jointAngle(points, 'elbow', 'shoulder', 'hip')
    const bodyAngle = jointAngle(points, 'shoulder', 'hip', 'ankle')
    if (elbowAngle === null || shoulderAngle === null || bodyAngle === null) return this.missing(timestampMs)

    const shoulderPoint = points.image[jointIndex(points.side, 'shoulder')]
    const wristPoint = points.image[jointIndex(points.side, 'wrist')]
    const hipPoint = points.image[jointIndex(points.side, 'hip')]
    const anklePoint = points.image[jointIndex(points.side, 'ankle')]
    // A side-on push-up is roughly horizontal in the camera image.
    // This is only a mode-readiness check, not a form-quality judgment.
    const bodyAxisDegrees = Math.atan2(
      Math.abs((anklePoint.y - shoulderPoint.y) * 480),
      Math.abs((anklePoint.x - shoulderPoint.x) * 640),
    ) * 180 / Math.PI
    if (bodyAxisDegrees > pushUpConfig.maxBodyAxisDegreesFromHorizontal) {
      this.resetMeasurements()
      return {
        ...notReady(),
        detail: 'Use a side view so your body runs across the camera frame.',
      }
    }
    const torsoLength = Math.max(Math.hypot(shoulderPoint.x - hipPoint.x, shoulderPoint.y - hipPoint.y), 0.05)
    const relativeHeight = (wristPoint.y - shoulderPoint.y) / torsoLength

    this.tracking.valid(timestampMs)
    this.side = points.side
    const elbow = this.elbow.update(elbowAngle, timestampMs)
    const shoulder = this.shoulder.update(shoulderAngle, timestampMs)
    const bodyLine = this.bodyLine.update(bodyAngle, timestampMs)
    this.shoulderHeight.update(relativeHeight, timestampMs)

    // Elbow flexion is primary; shoulder travel helps reject a noisy angle reversal.
    const lowering = this.elbow.velocity < -trackingConfig.directionDegreesPerSecond &&
      (this.shoulderHeight.velocity < -pushUpConfig.shoulderTravelPerSecond ||
        this.elbow.velocity < -trackingConfig.directionDegreesPerSecond * 2)
    const pushing = this.elbow.velocity > trackingConfig.directionDegreesPerSecond &&
      (this.shoulderHeight.velocity > pushUpConfig.shoulderTravelPerSecond ||
        this.elbow.velocity > trackingConfig.directionDegreesPerSecond * 2)
    const canTransition = timestampMs - this.transitionedAt >= trackingConfig.minimumPhaseMs

    if (this.phase === null) {
      if (elbow >= pushUpConfig.topEnter) this.enter('Top', timestampMs)
      else if (elbow <= pushUpConfig.bottomEnter) this.enter('Bottom', timestampMs)
      else if (lowering) this.enter('Lowering', timestampMs)
      else if (pushing) this.enter('Pushing', timestampMs)
    } else if (canTransition) {
      switch (this.phase) {
        case 'Top':
          if (elbow <= pushUpConfig.topExit && lowering) this.enter('Lowering', timestampMs)
          break
        case 'Lowering':
          if (elbow <= pushUpConfig.bottomEnter) this.enter('Bottom', timestampMs)
          else if (elbow >= pushUpConfig.bottomExit && pushing) this.enter('Pushing', timestampMs)
          break
        case 'Bottom':
          if (elbow >= pushUpConfig.bottomExit && pushing) this.enter('Pushing', timestampMs)
          break
        case 'Pushing':
          if (elbow >= pushUpConfig.topEnter) this.enter('Top', timestampMs)
          else if (elbow <= pushUpConfig.topExit && lowering) this.enter('Lowering', timestampMs)
          break
      }
    }

    if (!this.phase) return {
      ...notReady(),
      angles: [
        { label: 'Elbow', degrees: elbow },
        { label: 'Shoulder', degrees: shoulder },
        { label: 'Body line', degrees: bodyLine },
      ],
      side: points.side,
      detail: 'Start with extended arms or move through a push-up to establish a phase.',
    }
    return {
      phase: this.phase,
      angles: [
        { label: 'Elbow', degrees: elbow },
        { label: 'Shoulder', degrees: shoulder },
        { label: 'Body line', degrees: bodyLine },
      ],
      side: points.side,
      detail: 'Phase follows elbow bend and shoulder travel.',
    }
  }

  missing(timestampMs: number): PhaseSnapshot {
    return this.tracking.missing(timestampMs, () => this.resetMeasurements())
  }

  reset(): void {
    this.tracking.reset()
    this.resetMeasurements()
  }

  private enter(phase: PushUpPhase, timestampMs: number): void {
    this.phase = phase
    this.transitionedAt = timestampMs
  }

  private resetMeasurements(): void {
    this.phase = null
    this.transitionedAt = -Infinity
    this.elbow.reset()
    this.shoulder.reset()
    this.bodyLine.reset()
    this.shoulderHeight.reset()
    this.side = null
  }
}
