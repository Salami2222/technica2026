import { pushUpConfig, squatConfig } from '../analysis/config.ts'

// Session arming and continuity are separate from the live phase display.
export const sessionConfig = {
  startingHoldMs: 350,
  minimumCycleMs: 180,
  maxCycleGapMs: 400,
  maxRecoveryJumpDegrees: 22,
  pushUpBodyLineMinDegrees: 155,
} as const

export const cycleConfig = {
  squat: {
    angleLabel: 'Knee',
    startEnter: squatConfig.standingEnter,
    startExit: squatConfig.standingExit,
    depthEnter: squatConfig.bottomEnter,
    depthExit: squatConfig.bottomExit,
  },
  'push-up': {
    angleLabel: 'Elbow',
    startEnter: pushUpConfig.topEnter,
    startExit: pushUpConfig.topExit,
    depthEnter: pushUpConfig.bottomEnter,
    depthExit: pushUpConfig.bottomExit,
  },
} as const
