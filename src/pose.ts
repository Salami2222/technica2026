import { DrawingUtils, FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'

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
    drawing.drawConnectors(pose, PoseLandmarker.POSE_CONNECTIONS, {
      color: '#ff4b5f',
      lineWidth: 3,
    })
    drawing.drawLandmarks(pose, {
      color: '#ffffff',
      fillColor: '#e4263d',
      radius: 4,
      lineWidth: 1,
    })
  }
}
