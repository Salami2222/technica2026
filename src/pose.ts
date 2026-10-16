import { DrawingUtils, FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'

// MediaPipe pose indices 0–10 are facial points. Keep the model output intact,
// but draw only body points and connections with two body endpoints.
export const bodyConnections = PoseLandmarker.POSE_CONNECTIONS.filter(({ start, end }) => start >= 11 && end >= 11)
export const bodyLandmarks = <T>(pose: readonly T[]): T[] => pose.slice(11)

export async function createPoseTracker(): Promise<PoseLandmarker> {
  const vision = await FilesetResolver.forVisionTasks('/wasm')
  const options = {
    runningMode: 'VIDEO' as const,
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  }
  try {
    return await PoseLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: { modelAssetPath: '/models/pose_landmarker_full.task', delegate: 'GPU' },
    })
  } catch {
    return PoseLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: { modelAssetPath: '/models/pose_landmarker_full.task', delegate: 'CPU' },
    })
  }
}

export function drawSkeleton(
  context: CanvasRenderingContext2D,
  landmarks: ReturnType<PoseLandmarker['detectForVideo']>['landmarks'],
): void {
  const drawing = new DrawingUtils(context)
  for (const pose of landmarks) {
    drawing.drawConnectors(pose, bodyConnections, {
      color: '#ff4b5f',
      lineWidth: 3,
    })
    drawing.drawLandmarks(bodyLandmarks(pose), {
      color: '#ffffff',
      fillColor: '#e4263d',
      radius: 4,
      lineWidth: 1,
    })
  }
}
