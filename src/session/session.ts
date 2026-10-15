import type { PhaseSnapshot } from '../analysis/types.ts'
import type { ExerciseId } from '../exercises.ts'
import { MovementCycle } from './cycle.ts'
import { cycleConfig, sessionConfig } from './config.ts'

export type SessionStatus = 'Idle' | 'Waiting for Position' | 'Ready' | 'Recording' | 'Paused' | 'Completed' | 'Tracking Lost'
export type SessionSummary = { exercise: ExerciseId; repetitions: number }
export type SessionSnapshot = {
  status: SessionStatus
  exercise: ExerciseId
  repetitions: number
  summary: SessionSummary | null
}

function angle(snapshot: PhaseSnapshot, label: string): number | null {
  return snapshot.angles.find((reading) => reading.label === label)?.degrees ?? null
}

export class ExerciseSession {
  readonly exercise: ExerciseId
  private readonly cycle: MovementCycle
  private status: SessionStatus = 'Idle'
  private repetitions = 0
  private summary: SessionSummary | null = null
  private startingSince: number | null = null
  private interrupted = false

  constructor(exercise: ExerciseId) {
    this.exercise = exercise
    this.cycle = new MovementCycle(exercise)
  }

  snapshot(): SessionSnapshot {
    return { status: this.status, exercise: this.exercise, repetitions: this.repetitions, summary: this.summary }
  }

  start(): SessionSnapshot {
    if (this.isActive() || this.status === 'Paused') return this.snapshot()
    this.repetitions = 0
    this.summary = null
    this.resetProgress()
    this.status = 'Waiting for Position'
    return this.snapshot()
  }

  pause(): SessionSnapshot {
    if (this.isActive()) {
      this.resetProgress()
      this.status = 'Paused'
    }
    return this.snapshot()
  }

  resume(): SessionSnapshot {
    if (this.status === 'Paused') {
      this.resetProgress()
      this.status = 'Waiting for Position'
    }
    return this.snapshot()
  }

  stop(): SessionSnapshot {
    if (this.isActive() || this.status === 'Paused') {
      this.resetProgress()
      this.status = 'Completed'
      this.summary = { exercise: this.exercise, repetitions: this.repetitions }
    }
    return this.snapshot()
  }

  observe(phase: PhaseSnapshot, timestampMs: number): SessionSnapshot {
    if (!this.isActive()) return this.snapshot()
    const measuredAngle = phase.tracking === 'tracking' ? this.cycle.angle(phase) : null
    if (measuredAngle === null) {
      if (this.status === 'Waiting for Position') {
        this.startingSince = null
      } else {
        this.interrupted = phase.tracking === 'partial' && (this.interrupted || this.status !== 'Tracking Lost')
        if (phase.tracking !== 'partial') this.cycle.reset()
        this.status = 'Tracking Lost'
      }
      return this.snapshot()
    }

    const atStart = this.isStartingPosition(phase, measuredAngle)
    if (this.status === 'Waiting for Position') {
      this.waitForStart(atStart, measuredAngle, phase.side, timestampMs)
      return this.snapshot()
    }

    if (this.status === 'Tracking Lost') {
      if (this.interrupted && this.cycle.resume(measuredAngle, atStart, phase.side, timestampMs)) {
        this.status = this.cycle.inProgress ? 'Recording' : 'Ready'
      } else {
        this.cycle.reset()
        if (atStart) {
          this.cycle.arm(measuredAngle, phase.side, timestampMs)
          this.status = 'Ready'
        }
      }
      this.interrupted = false
      return this.snapshot()
    }

    const event = this.cycle.observe(measuredAngle, atStart, phase.side, timestampMs)
    if (event === 'completed') this.repetitions += 1
    this.status = this.cycle.inProgress ? 'Recording' : 'Ready'
    return this.snapshot()
  }

  private isStartingPosition(phase: PhaseSnapshot, measuredAngle: number): boolean {
    if (this.exercise === 'squat') return measuredAngle >= cycleConfig.squat.startEnter
    const bodyLine = angle(phase, 'Body line')
    return measuredAngle >= cycleConfig['push-up'].startEnter && bodyLine !== null && bodyLine >= sessionConfig.pushUpBodyLineMinDegrees
  }

  private waitForStart(atStart: boolean, measuredAngle: number, side: PhaseSnapshot['side'], timestampMs: number): void {
    if (!atStart) {
      this.startingSince = null
      return
    }
    this.startingSince ??= timestampMs
    if (timestampMs - this.startingSince >= sessionConfig.startingHoldMs) {
      this.cycle.arm(measuredAngle, side, timestampMs)
      this.status = 'Ready'
      this.startingSince = null
    }
  }

  private resetProgress(): void {
    this.cycle.reset()
    this.startingSince = null
    this.interrupted = false
  }

  private isActive(): boolean {
    return this.status === 'Waiting for Position' || this.status === 'Ready' ||
      this.status === 'Recording' || this.status === 'Tracking Lost'
  }
}
