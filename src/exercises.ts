import type { PoseLandmarkerResult } from '@mediapipe/tasks-vision'

export type ExerciseId = 'squat' | 'push-up'

// Future analyzers can be implemented independently for each exercise.
// Mode selection does not run an analyzer in this milestone.
export type ExerciseAnalysis = {
  repetitionCount: number
  jointAnglesDegrees: Record<string, number>
  feedback: string[]
}

export type ExerciseAnalyzer = (
  landmarks: PoseLandmarkerResult['landmarks'][number],
  timestampMs: number,
) => ExerciseAnalysis

export type ExerciseMode = {
  id: ExerciseId
  label: string
  framingTip: string
  analyzer?: ExerciseAnalyzer
}

export const exerciseModes: readonly ExerciseMode[] = [
  {
    id: 'squat',
    label: 'Squat',
    framingTip: 'Keep your full body visible in the frame.',
  },
  {
    id: 'push-up',
    label: 'Push-up',
    framingTip: 'Position the camera so your full body stays visible.',
  },
]
