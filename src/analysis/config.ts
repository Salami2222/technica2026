// Starting values for a side-on view. Tune these with real exercise recordings.
export const trackingConfig = {
  minVisibility: 0.40,
  sideSwitchMargin: 0.15,
  lostResetMs: 2000,
  smoothingTimeMs: 70,
  minimumPhaseMs: 70,
  directionDegreesPerSecond: 9,
} as const

export const squatConfig = {
  standingEnter: 160,
  standingExit: 148,
  bottomEnter: 105,
  bottomExit: 116,
} as const

export const pushUpConfig = {
  maxBodyAxisDegreesFromHorizontal: 45,
  topEnter: 158,
  topExit: 145,
  bottomEnter: 95,
  bottomExit: 108,
  shoulderTravelPerSecond: 0.06,
} as const
