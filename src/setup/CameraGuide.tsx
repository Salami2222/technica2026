import type { ExerciseId } from '../exercises.ts'
import type { Framing } from './framing.ts'

function CameraIcon({ x, y }: { x: number; y: number }) {
  return <g transform={`translate(${x} ${y})`} fill="none" stroke="#ff6675" strokeWidth="2.2" strokeLinejoin="round">
    <rect x="-13" y="-7" width="26" height="14" rx="4" fill="#2a2025" />
    <circle r="4" fill="#121014" /><circle cx="-8" cy="0" r="1" fill="#ff6675" stroke="none" />
    <path d="M-10 8v5m20-5v5M-15 13h30" />
  </g>
}

function SquatFigure() {
  return <g fill="#d5c5c6" stroke="#f1e9e9" strokeWidth="1.3" strokeLinejoin="round">
    <ellipse cx="122" cy="27" rx="12" ry="14" /><path d="M117 35l3 12 12 1-2-13z" />
    <path d="M117 43 Q110 42 108 54 L105 81 Q108 92 117 98 L135 96 Q139 86 132 70 L131 49 Q126 43 117 43Z" fill="#d84153" />
    <path d="M108 51 Q101 53 101 61 L98 81 Q97 86 101 87 L107 87 Q110 84 108 80 L113 62Z" />
    <path d="M131 51 Q138 53 139 60 L142 80 Q142 86 138 88 L134 87 Q132 84 134 79 L127 63Z" />
    <path d="M113 95 Q113 107 112 117 L112 140 Q112 145 117 145 L122 145 Q126 142 124 137 L126 112 L130 96Z" fill="#a59a9f" />
    <path d="M125 96 Q128 108 129 119 L132 140 Q134 145 139 144 L143 142 Q144 139 141 136 L141 116 L139 98Z" fill="#8b8288" />
    <path d="M111 141l-4 6q0 4 5 4h15q5-1 2-5l-7-4zM132 141l-3 7q1 4 6 4h14q4-2 0-5l-8-6z" fill="#faf1f0" />
    <path d="M115 16q3-8 13-4 5 3 5 10-3-4-8-4-7 3-13 1z" fill="#222128" stroke="none" />
  </g>
}

function PushUpFigure() {
  return <g stroke="#f1e9e9" strokeWidth="1.2" strokeLinejoin="round">
    <path d="M38 75q-8-4-14 0-7 6-4 15 2 7 11 8l13-6z" fill="#d5c5c6" />
    <path d="M23 75q6-12 15-7 5 3 7 7l-12 4z" fill="#242126" stroke="none" />
    <path d="M39 79l11-3 7 9-12 7z" fill="#d5c5c6" />
    <path d="M50 74 Q62 70 78 77 L127 88 167 93 Q174 94 170 104 L157 110 118 100 77 91 Q62 94 50 91Z" fill="#d84153" />
    <path d="M163 94 Q186 94 197 99 L223 106 Q228 109 225 115 L216 117 193 110 166 109Z" fill="#aaa0a4" />
    <path d="M214 108l17 2 10 8q3 4-3 5h-20q-6-1-8-5z" fill="#f5eded" />
    <path d="M64 82 Q68 84 70 93 L76 121 Q77 126 72 127 L66 127 Q62 124 63 120 L54 94Z" fill="#d5c5c6" />
    <path d="M85 83 Q91 86 92 95 L94 121 Q95 126 90 127 L84 127 Q80 124 81 120 L77 92Z" fill="#c9b8b9" />
    <path d="M62 123q-4 4-2 8h18q3-1 1-5l-6-3zM81 123q-4 4-2 8h18q3-1 1-5l-6-3z" fill="#f5eded" />
  </g>
}

function Illustration({ exercise }: { exercise: ExerciseId }) {
  const squat = exercise === 'squat'
  return <svg className="camera-illustration" viewBox="0 0 310 178" role="img"
    aria-label={squat ? 'Side view: whole standing person inside the frame, Kinect facing from the side' : 'Side view: entire horizontal plank with hands and feet inside the frame, low Kinect facing perpendicular to the body'}>
    <rect width="310" height="178" rx="10" fill="#1d191d" />
    <rect x="10" y="10" width="252" height={squat ? 146 : 126} rx="7" fill="#251e22" stroke="#a95663" strokeWidth="1.5" strokeDasharray="5 4" />
    <path d={squat ? 'M19 144h234' : 'M19 132h234'} stroke="#65575a" strokeWidth="2" />
    {squat ? <SquatFigure /> : <PushUpFigure />}
    <text x="17" y="24" fill="#f1b0b7" fontSize="8" fontWeight="700">FULL BODY IN FRAME · SIDE VIEW</text>
    {squat ? <>
      <CameraIcon x={282} y={106} />
      <path d="M273 104l-15-4m7-5l-7 5 5 7" fill="none" stroke="#ff6675" strokeWidth="2" />
      <text x="268" y="135" fill="#f1b0b7" fontSize="8" fontWeight="700">KINECT</text>
      <text x="13" y="170" fill="#aaa0a4" fontSize="8">Camera at hip height · full head-to-feet view</text>
    </> : <>
      <CameraIcon x={154} y={153} />
      <path d="M154 140v-9m-5 5 5-5 5 5" fill="none" stroke="#ff6675" strokeWidth="2" />
      <text x="177" y="157" fill="#f1b0b7" fontSize="8" fontWeight="700">LOW KINECT ↑</text>
      <text x="13" y="173" fill="#aaa0a4" fontSize="8">Point across the body · full side profile</text>
    </>}
  </svg>
}

export function CameraGuide({ exercise, framing }: { exercise: ExerciseId; framing: Framing }) {
  const squat = exercise === 'squat'
  return <details className="camera-setup panel">
    <summary><span>CAMERA SETUP</span><strong className={`framing-status ${framing.status.toLowerCase().replace(' ', '-')}`}>{framing.status}</strong></summary>
    <div className="camera-setup-content">
      <Illustration exercise={exercise} />
      <div className="camera-setup-copy">
        <p>{squat ? 'Place the Kinect to your side around hip height. Stand far enough back to show your head, hips, knees, and feet.' : 'Place the Kinect low beside your mat, perpendicular to your body. Show your entire side profile, from hands and head to feet.'}</p>
        <p className="framing-suggestion" aria-live="polite">{framing.suggestion}</p>
      </div>
    </div>
  </details>
}
