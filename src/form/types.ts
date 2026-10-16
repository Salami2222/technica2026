import type { ExerciseId } from '../exercises.ts'

export type FormSample = {
  at: number
  side: 'left' | 'right'
  angle: number
  torsoLean: number | null
  hipX: number | null
  torsoScale: number | null
  bodyOffset: number | null
  wristX: number | null
  wristY: number | null
  bodyScale: number | null
}

export type FormCategory = {
  name: string
  score: number | null
  explanation: string
  suggestion: string
}

export type FormResult = {
  repetition: number
  exercise: ExerciseId
  score: number | null
  reason: string | null
  categories: FormCategory[]
  positives: string[]
  issues: string[]
  suggestions: string[]
  depthAngle: number | null
  durationMs: number | null
}

export type FormSummary = {
  scoredRepetitions: number
  acceptableRepetitions: number
  averageScore: number | null
  strongestCategory: string | null
  areasToImprove: string[]
  feedback: string
}
