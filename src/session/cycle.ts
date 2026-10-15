import type { PhaseSnapshot } from '../analysis/types.ts'
import type { ExerciseId } from '../exercises.ts'
import { cycleConfig, sessionConfig } from './config.ts'

type MovementState = 'armed' | 'descending' | 'deep' | 'ascending'
export type CycleEvent = 'none' | 'started' | 'incomplete' | 'completed'

export class MovementCycle {
  private readonly config: (typeof cycleConfig)[ExerciseId]
  private state: MovementState = 'armed'
  private peak = -Infinity
  private trough = Infinity
  private departedAt: number | null = null
  private lastAngle: number | null = null
  private lastValidAt: number | null = null
  private side: PhaseSnapshot['side'] = null

  constructor(exercise: ExerciseId) {
    this.config = cycleConfig[exercise]
  }

  get inProgress(): boolean {
    return this.state !== 'armed'
  }

  angle(snapshot: PhaseSnapshot): number | null {
    return snapshot.angles.find((reading) => reading.label === this.config.angleLabel)?.degrees ?? null
  }

  arm(angle: number, side: PhaseSnapshot['side'], timestampMs: number): void {
    this.state = 'armed'
    this.peak = angle
    this.trough = Infinity
    this.departedAt = null
    this.lastAngle = angle
    this.lastValidAt = timestampMs
    this.side = side
  }

  reset(): void {
    this.state = 'armed'
    this.peak = -Infinity
    this.trough = Infinity
    this.departedAt = null
    this.lastAngle = null
    this.lastValidAt = null
    this.side = null
  }

  // A recovered frame is an anchor, never evidence of movement across missing frames.
  resume(angle: number, atStart: boolean, side: PhaseSnapshot['side'], timestampMs: number): boolean {
    const continuous = this.lastAngle !== null && this.lastValidAt !== null &&
      timestampMs - this.lastValidAt <= sessionConfig.maxCycleGapMs &&
      this.side === side && Math.abs(angle - this.lastAngle) <= sessionConfig.maxRecoveryJumpDegrees &&
      !(this.inProgress && atStart)
    if (continuous) {
      this.lastAngle = angle
      this.lastValidAt = timestampMs
      this.trough = Math.min(this.trough, angle)
      if (this.state === 'descending' && angle <= this.config.depthEnter) this.state = 'deep'
    }
    return continuous
  }

  observe(angle: number, atStart: boolean, side: PhaseSnapshot['side'], timestampMs: number): CycleEvent {
    if (this.side !== side || (this.lastValidAt !== null && timestampMs - this.lastValidAt > sessionConfig.maxCycleGapMs)) {
      this.reset()
      if (atStart) this.arm(angle, side, timestampMs)
      return 'incomplete'
    }
    this.lastAngle = angle
    this.lastValidAt = timestampMs

    if (this.state === 'armed') {
      if (atStart) this.peak = Math.max(this.peak, angle)
      else if (angle <= this.config.startExit && this.peak - angle >= this.config.startEnter - this.config.startExit) {
        this.state = 'descending'
        this.departedAt = timestampMs
        this.trough = angle
        return 'started'
      }
      return 'none'
    }

    this.trough = Math.min(this.trough, angle)
    if (this.state === 'descending') {
      if (angle <= this.config.depthEnter) this.state = 'deep'
      else if (atStart) {
        this.arm(angle, side, timestampMs)
        return 'incomplete'
      }
      return 'none'
    }

    if (this.state === 'deep' && angle >= this.config.depthExit) this.state = 'ascending'
    else if (this.state === 'ascending' && angle <= this.config.depthEnter) this.state = 'deep'

    if (this.state === 'ascending' && atStart && this.departedAt !== null) {
      const completed = timestampMs - this.departedAt >= sessionConfig.minimumCycleMs
      this.arm(angle, side, timestampMs)
      return completed ? 'completed' : 'incomplete'
    }
    return 'none'
  }
}
