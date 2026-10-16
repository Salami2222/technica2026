import type { ExerciseId } from '../exercises.ts'
import { formConfig } from './config.ts'
import { scoreExerciseRep, summarizeForm } from './score.ts'
import type { FormResult, FormSample, FormSummary } from './types.ts'

export class ExerciseFormTracker {
  private readonly exercise: ExerciseId
  private samples: FormSample[] = []
  private history: FormResult[] = []
  private previousDepth: number | null = null
  private feedback: string | null = null
  private feedbackAt = -Infinity

  constructor(exercise: ExerciseId) { this.exercise = exercise }

  get results(): FormResult[] { return [...this.history] }
  get latest(): FormResult | null { return this.history.at(-1) ?? null }
  get liveFeedback(): string | null { return this.feedback }
  summary(): FormSummary { return summarizeForm(this.history) }

  resetSession(): void {
    this.history = []
    this.previousDepth = null
    this.discard()
  }

  discard(): void {
    this.samples = []
    this.feedback = null
    this.feedbackAt = -Infinity
  }

  begin(start: FormSample | null, current: FormSample | null): void {
    this.discard()
    if (start) this.samples.push(start)
    this.add(current)
  }

  add(sample: FormSample | null): void {
    if (!sample || this.samples.at(-1)?.at === sample.at) return
    this.samples.push(sample)
    if (sample.at - this.feedbackAt < formConfig.feedbackIntervalMs) return
    const first = this.samples[0]
    if (!first) return
    let next: string | null = null
    if (this.exercise === 'squat' && sample.torsoLean !== null && first.torsoLean !== null &&
      Math.abs(sample.torsoLean - first.torsoLean) > formConfig.squat.torsoLeanChange[0] * 2) {
      next = `Torso angle changed ${Math.round(Math.abs(sample.torsoLean - first.torsoLean))}°. Try a steadier descent.`
    }
    if (this.exercise === 'push-up' && sample.bodyOffset !== null &&
      Math.abs(sample.bodyOffset) > formConfig.pushUp.bodyOffset[0] * 2) {
      next = `Hip line offset ${Math.abs(sample.bodyOffset).toFixed(2)}× body length. Keep shoulders, hips, and ankles aligned.`
    }
    if (next) { this.feedback = next; this.feedbackAt = sample.at }
  }

  complete(repetition: number, current: FormSample | null): FormResult {
    this.add(current)
    const result = scoreExerciseRep(this.exercise, repetition, this.samples, this.previousDepth)
    if (result.depthAngle !== null) this.previousDepth = result.depthAngle
    this.history.push(result)
    this.samples = []
    this.feedback = null
    return result
  }
}
