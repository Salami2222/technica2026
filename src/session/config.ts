// Stability windows for arming and confirming a completed return to the start pose.
export const sessionConfig = {
  startingHoldMs: 500,
  returnHoldMs: 180,
  pushUpBodyLineMinDegrees: 155,
} as const
