// The current face-on pipeline observes body landmarks, not the clubhead,
// target line, or ball contact. Hand travel is not a club-path measurement.
export const clubPathAssessment = {
  status: 'unavailable',
  label: 'Club path unavailable with current tracking',
  explanation: 'The face-on Kinect pose feed does not observe clubhead direction relative to a target line at impact. Hand travel is shown separately and is only a body-motion proxy.',
} as const
