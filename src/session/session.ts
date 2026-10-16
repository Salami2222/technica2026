import type { PhaseSnapshot } from '../analysis/types.ts'
import type { ExerciseId } from '../exercises.ts'
import type { PoseLandmarkerResult } from '@mediapipe/tasks-vision'
import { ExerciseFormTracker } from '../form/form.ts'
import { measureForm } from '../form/measure.ts'
import type { FormResult, FormSample, FormSummary } from '../form/types.ts'
import { MovementCycle } from './cycle.ts'
import { cycleConfig, sessionConfig } from './config.ts'

export type SessionStatus = 'Idle' | 'Waiting for Position' | 'Ready' | 'Recording' | 'Paused' | 'Completed' | 'Tracking Lost'
export type SessionSummary = { exercise: ExerciseId; repetitions: number }
export type SessionSnapshot = {
  status: SessionStatus
  exercise: ExerciseId
  repetitions: number
  summary: SessionSummary | null
  formResults: FormResult[]
  latestForm: FormResult | null
  liveFeedback: string | null
  formSummary: FormSummary | null
}

function angle(snapshot: PhaseSnapshot, label: string): number | null {
  return snapshot.angles.find((reading) => reading.label === label)?.degrees ?? null
}

export class ExerciseSession {
  readonly exercise: ExerciseId
  private readonly cycle: MovementCycle
  private readonly form: ExerciseFormTracker
  private status: SessionStatus = 'Idle'
  private repetitions = 0
  private summary: SessionSummary | null = null
  private startingSince: number | null = null
  private interrupted = false
  private lastReadyForm: FormSample | null = null
  private formSummary: FormSummary | null = null

  constructor(exercise: ExerciseId) {
    this.exercise = exercise
    this.cycle = new MovementCycle(exercise)
    this.form = new ExerciseFormTracker(exercise)
  }

  snapshot(): SessionSnapshot {
    return { status: this.status, exercise: this.exercise, repetitions: this.repetitions, summary: this.summary,
      formResults: this.form.results, latestForm: this.form.latest, liveFeedback: this.form.liveFeedback,
      formSummary: this.formSummary }
  }

  start(): SessionSnapshot {
    if (this.isActive() || this.status === 'Paused') return this.snapshot()
    this.repetitions = 0
    this.summary = null
    this.formSummary = null
    this.form.resetSession()
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
      this.formSummary = this.form.summary()
    }
    return this.snapshot()
  }

  observe(phase: PhaseSnapshot, timestampMs: number, pose?: PoseLandmarkerResult): SessionSnapshot {
    if (!this.isActive()) return this.snapshot()
    const measuredAngle = phase.tracking === 'tracking' ? this.cycle.angle(phase) : null
    if (measuredAngle === null) {
      if (this.status === 'Waiting for Position') {
        this.startingSince = null
        this.lastReadyForm = null
      } else {
        this.interrupted = phase.tracking === 'partial' && (this.interrupted || this.status !== 'Tracking Lost')
        if (phase.tracking !== 'partial') { this.cycle.reset(); this.form.discard() }
        this.status = 'Tracking Lost'
      }
      return this.snapshot()
    }

    const formSample = pose ? measureForm(this.exercise, pose, phase, timestampMs) : null
    const atStart = this.isStartingPosition(phase, measuredAngle)
    if (this.status === 'Waiting for Position') {
      this.waitForStart(atStart, measuredAngle, phase.side, timestampMs)
      if (this.snapshot().status === 'Ready') this.lastReadyForm = formSample
      return this.snapshot()
    }

    if (this.status === 'Tracking Lost') {
      if (this.interrupted && this.cycle.resume(measuredAngle, atStart, phase.side, timestampMs)) {
        this.status = this.cycle.inProgress ? 'Recording' : 'Ready'
        if (this.cycle.inProgress) this.form.add(formSample)
        else this.lastReadyForm = formSample
      } else {
        this.cycle.reset()
        this.form.discard()
        if (atStart) {
          this.cycle.arm(measuredAngle, phase.side, timestampMs)
          this.status = 'Ready'
          this.lastReadyForm = formSample
        }
      }
      this.interrupted = false
      return this.snapshot()
    }

    const event = this.cycle.observe(measuredAngle, atStart, phase.side, timestampMs)
    if (event === 'started') this.form.begin(this.lastReadyForm, formSample)
    else if (event === 'completed') {
      this.repetitions += 1
      this.form.complete(this.repetitions, formSample)
      this.lastReadyForm = formSample
    } else if (event === 'incomplete') {
      this.form.discard()
      this.lastReadyForm = atStart ? formSample : null
    } else if (this.cycle.inProgress) this.form.add(formSample)
    else this.lastReadyForm = formSample
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
    this.lastReadyForm = null
    this.form.discard()
  }

  private isActive(): boolean {
    return this.status === 'Waiting for Position' || this.status === 'Ready' ||
      this.status === 'Recording' || this.status === 'Tracking Lost'
  }
}
