export type Handedness = 'right' | 'left'
export type GolfPhase = 'Not Ready' | 'Address' | 'Backswing' | 'Top' | 'Downswing' | 'Follow-through' | 'Finish' | 'Tracking Lost'
export type GolfStatus = 'Idle' | 'Waiting for Address' | 'Ready' | 'Recording' | 'Paused' | 'Completed' | 'Tracking Lost'
export type GolfCategory = { name: string; score: number | null; explanation: string; suggestion: string }
export type GolfMeasurements = {
  handBackswing: number
  handFollowThrough: number
  shoulderTravel: number
  hipSway: number
  torsoOffset: number
  torsoDrift: number
  stanceRatio: number | null
  leadElbowAngle: number | null
  trailElbowAngle: number | null
  trailElbowHipDistance: number | null
  trailElbowTorsoDistance: number | null
}
export type GolfResult = {
  id: number
  handedness: Handedness
  score: number | null
  reason: string | null
  categories: GolfCategory[]
  durationMs: number
  backswingMs: number
  downswingMs: number
  measurements: GolfMeasurements | null
  wentWell: string[]
  improve: string[]
}
export type GolfSnapshot = {
  status: GolfStatus
  phase: GolfPhase
  tracking: 'tracking' | 'partial' | 'lost' | 'not-ready'
  handedness: Handedness
  swings: number
  latest: GolfResult | null
  history: GolfResult[]
  detail: string
}
