import { PushUpDetector } from './analysis/pushUp.ts'
import { SquatDetector } from './analysis/squat.ts'
import type { ExerciseDetector } from './analysis/types.ts'

export type ExerciseId = 'squat' | 'push-up'

export type ExerciseMode = {
  id: ExerciseId
  label: string
  framingTip: string
  createDetector: () => ExerciseDetector
}

export const exerciseModes: readonly ExerciseMode[] = [
  {
    id: 'squat',
    label: 'Squat',
    framingTip: 'Keep your full body visible in the frame.',
    createDetector: () => new SquatDetector(),
  },
  {
    id: 'push-up',
    label: 'Push-up',
    framingTip: 'Use a side view with your shoulder, arm, hip, and ankle visible.',
    createDetector: () => new PushUpDetector(),
  },
]

export function createExerciseDetector(id: ExerciseId): ExerciseDetector {
  return exerciseModes.find((mode) => mode.id === id)!.createDetector()
}
