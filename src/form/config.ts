// Initial single-camera technique estimates. Tune from real Kinect recordings.
// Each pair is [full credit, zero credit], with interpolation between them.
export const formConfig = {
  minSamples: 6,
  minCoverage: 0.6,
  acceptableScore: 7,
  feedbackIntervalMs: 1200,
  squat: {
    depthKnee: [85, 120],
    depthExcursion: [75, 40],
    torsoLeanChange: [14, 42],
    hipPathJitter: [0.09, 0.34],
  },
  pushUp: {
    depthElbow: [75, 112],
    depthExcursion: [78, 42],
    bodyOffset: [0.08, 0.27],
    wristDrift: [0.05, 0.20],
  },
  controlReversals: [0, 3],
  controlSpeedRatio: [3, 8],
  finishExtensionGap: [8, 35],
  depthConsistencyGap: [12, 38],
} as const
