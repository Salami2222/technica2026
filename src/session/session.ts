import { pushUpConfig, squatConfig } from '../analysis/config.ts'
import type { PhaseLabel, PhaseSnapshot } from '../analysis/types.ts'
import type { ExerciseId } from '../exercises.ts'
import { sessionConfig } from './config.ts'

export type SessionStatus = 'Idle' | 'Waiting for Position' | 'Ready' | 'Recording' | 'Paused' | 'Completed' | 'Tracking Lost'
export type SessionSummary = { exercise: ExerciseId; repetitions: number }
export type SessionSnapshot = {
  status: SessionStatus
  exercise: ExerciseId
  repetitions: number
  summary: SessionSummary | null
}

type ExerciseCycle = readonly [PhaseLabel, PhaseLabel, PhaseLabel, PhaseLabel, PhaseLabel]

const cycles: Record<ExerciseId, ExerciseCycle> = {
  squat: ['Standing', 'Descending', 'Bottom', 'Ascending', 'Standing'],
  'push-up': ['Top', 'Lowering', 'Bottom', 'Pushing', 'Top'],
}

function angle(snapshot: PhaseSnapshot, label: string): number | null {
  return snapshot.angles.find((reading) => reading.label === label)?.degrees ?? null
}

export class ExerciseSession {
  readonly exercise: ExerciseId
  private status: SessionStatus = 'Idle'
  private repetitions = 0
  private summary: SessionSummary | null = null
  private startingSince: number | null = null
  private returnSince: number | null = null
  private stage = 0

  constructor(exercise: ExerciseId) {
    this.exercise = exercise
  }

  snapshot(): SessionSnapshot {
    return {
      status: this.status,
      exercise: this.exercise,
      repetitions: this.repetitions,
      summary: this.summary,
    }
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
    if (phase.tracking !== 'tracking') {
      this.resetProgress()
      if (this.status !== 'Waiting for Position') this.status = 'Tracking Lost'
      return this.snapshot()
    }

    const atStart = this.isStartingPosition(phase)
    if (this.status === 'Tracking Lost' || this.status === 'Waiting for Position') {
      this.waitForStart(atStart, timestampMs)
      return this.snapshot()
    }

    const cycle = cycles[this.exercise]
    if (this.stage === 0) {
      if (phase.phase === cycle[1]) {
        this.stage = 1
        this.status = 'Recording'
      } else if (phase.phase !== cycle[0]) {
        this.invalidateCycle()
      }
      return this.snapshot()
    }

    if (this.stage === 3 && phase.phase === cycle[4] && atStart) {
      this.returnSince ??= timestampMs
      if (timestampMs - this.returnSince >= sessionConfig.returnHoldMs) {
        this.repetitions += 1
        this.stage = 0
        this.returnSince = null
        this.status = 'Ready'
      }
      return this.snapshot()
    }

    this.returnSince = null
    if (phase.phase === cycle[this.stage]) return this.snapshot()
    if (phase.phase === cycle[this.stage + 1] && this.stage < 3) {
      this.stage += 1
      return this.snapshot()
    }
    this.invalidateCycle()
    return this.snapshot()
  }

  private isStartingPosition(phase: PhaseSnapshot): boolean {
    if (phase.tracking !== 'tracking') return false
    if (this.exercise === 'squat') {
      const knee = angle(phase, 'Knee')
      return phase.phase === 'Standing' && knee !== null && knee >= squatConfig.standingEnter
    }
    const elbow = angle(phase, 'Elbow')
    const bodyLine = angle(phase, 'Body line')
    return phase.phase === 'Top' && elbow !== null && elbow >= pushUpConfig.topEnter &&
      bodyLine !== null && bodyLine >= sessionConfig.pushUpBodyLineMinDegrees
  }

  private waitForStart(atStart: boolean, timestampMs: number): void {
    this.status = 'Waiting for Position'
    if (!atStart) {
      this.startingSince = null
      return
    }
    this.startingSince ??= timestampMs
    if (timestampMs - this.startingSince >= sessionConfig.startingHoldMs) {
      this.status = 'Ready'
      this.stage = 0
      this.startingSince = null
    }
  }

  private invalidateCycle(): void {
    this.resetProgress()
    this.status = 'Waiting for Position'
  }

  private resetProgress(): void {
    this.stage = 0
    this.startingSince = null
    this.returnSince = null
  }

  private isActive(): boolean {
    return this.status === 'Waiting for Position' || this.status === 'Ready' ||
      this.status === 'Recording' || this.status === 'Tracking Lost'
  }
}
