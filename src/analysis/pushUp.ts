import type { PoseLandmarkerResult } from '@mediapipe/tasks-vision'
import { pushUpConfig, trackingConfig } from './config.ts'
import { SmoothedSignal, TrackingGate } from './filter.ts'
import { hasVisibleJoint, jointAngle, jointIndex, visibleSide } from './geometry.ts'
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
    const points = visibleSide(result, ['shoulder', 'elbow', 'wrist'], this.side)
    if (!points) return this.missing(timestampMs)

    const elbowAngle = jointAngle(points, 'shoulder', 'elbow', 'wrist')
    if (elbowAngle === null) return this.missing(timestampMs)
    const hipVisible = hasVisibleJoint(points, 'hip')
    const ankleVisible = hasVisibleJoint(points, 'ankle')
    const shoulderAngle = hipVisible ? jointAngle(points, 'elbow', 'shoulder', 'hip') : null
    const bodyAngle = hipVisible && ankleVisible ? jointAngle(points, 'shoulder', 'hip', 'ankle') : null

    const shoulderPoint = points.image[jointIndex(points.side, 'shoulder')]
    const elbowPoint = points.image[jointIndex(points.side, 'elbow')]
    const wristPoint = points.image[jointIndex(points.side, 'wrist')]
    const axisPoint = ankleVisible ? points.image[jointIndex(points.side, 'ankle')]
      : hipVisible ? points.image[jointIndex(points.side, 'hip')] : null
    if (this.tracking.expired(timestampMs)) this.resetMeasurements()
    // A side-on push-up is roughly horizontal in the camera image.
    // This is only a mode-readiness check, not a form-quality judgment.
    const bodyAxisDegrees = axisPoint ? Math.atan2(
      Math.abs((axisPoint.y - shoulderPoint.y) * 480),
      Math.abs((axisPoint.x - shoulderPoint.x) * 640),
    ) * 180 / Math.PI : null
    if (bodyAxisDegrees !== null && bodyAxisDegrees > pushUpConfig.maxBodyAxisDegreesFromHorizontal) {
      this.reset()
      return {
        ...notReady(),
        detail: 'Use a side view so your body runs across the camera frame.',
      }
    }
    if (bodyAxisDegrees === null && this.phase === null) return {
      ...notReady(),
      angles: [{ label: 'Elbow', degrees: elbowAngle }],
      side: points.side,
      detail: 'Show your hip or ankle briefly to establish a side-on push-up view.',
    }
    const sideChanged = this.side !== null && this.side !== points.side
    const resumed = this.tracking.valid(timestampMs)
    if (resumed || sideChanged) this.resetSignals()
    this.side = points.side
    const armLength = Math.max(
      Math.hypot(shoulderPoint.x - elbowPoint.x, shoulderPoint.y - elbowPoint.y) +
      Math.hypot(elbowPoint.x - wristPoint.x, elbowPoint.y - wristPoint.y),
      0.05,
    )
    const relativeHeight = (wristPoint.y - shoulderPoint.y) / armLength

    const elbow = this.elbow.update(elbowAngle, timestampMs)
    const shoulder = shoulderAngle === null ? null : this.shoulder.update(shoulderAngle, timestampMs)
    const bodyLine = bodyAngle === null ? null : this.bodyLine.update(bodyAngle, timestampMs)
    if (shoulderAngle === null) this.shoulder.reset()
    if (bodyAngle === null) this.bodyLine.reset()
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
    } else if (canTransition && !resumed && !sideChanged) {
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

    const angles = [{ label: 'Elbow', degrees: elbow }]
    if (shoulder !== null) angles.push({ label: 'Shoulder', degrees: shoulder })
    if (bodyLine !== null) angles.push({ label: 'Body line', degrees: bodyLine })
    if (!this.phase) return {
      ...notReady(),
      tracking: 'tracking',
      angles,
      side: points.side,
      detail: 'Start with extended arms or move through a push-up to establish a phase.',
    }
    return {
      phase: this.phase,
      tracking: 'tracking',
      angles,
      side: points.side,
      detail: 'Phase follows elbow bend and shoulder travel.',
    }
  }

  missing(timestampMs: number): PhaseSnapshot {
    return this.tracking.missing(timestampMs, this.phase ?? 'Not Ready', this.side, () => this.resetMeasurements())
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
    this.resetSignals()
    this.side = null
  }

  private resetSignals(): void {
    this.elbow.reset()
    this.shoulder.reset()
    this.bodyLine.reset()
    this.shoulderHeight.reset()
  }
}
