import type { PoseLandmarkerResult } from '@mediapipe/tasks-vision'

export type PhaseLabel =
  | 'Not Ready' | 'Tracking Lost'
  | 'Standing' | 'Descending' | 'Bottom' | 'Ascending'
  | 'Top' | 'Lowering' | 'Pushing'

export type AngleReading = { label: string; degrees: number }
export type PhaseSnapshot = {
  phase: PhaseLabel
  tracking: 'tracking' | 'partial' | 'lost' | 'not-ready'
  angles: AngleReading[]
  side: 'left' | 'right' | null
  detail: string
}

export interface ExerciseDetector {
  update(result: PoseLandmarkerResult, timestampMs: number): PhaseSnapshot
  missing(timestampMs: number): PhaseSnapshot
  reset(): void
}

export const notReady = (): PhaseSnapshot => ({
  phase: 'Not Ready',
  tracking: 'not-ready',
  angles: [],
  side: null,
  detail: 'Show the required joints clearly to begin tracking.',
})
