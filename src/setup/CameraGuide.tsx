import type { Framing, SetupMode } from './framing.ts'

type Props = { mode: SetupMode; framing: Framing; connected: boolean; modelReady: boolean }

const guidance: Record<SetupMode, { title: string; camera: string; position: string; checklist: string[] }> = {
  squat: {
    title: 'Standing side profile',
    camera: 'Place the Kinect to your side at about hip height, aimed across your movement.',
    position: 'Face left or right across the image. Stand back enough to keep your head, hips, knees, ankles, and feet visible from start to bottom.',
    checklist: ['Full head-to-feet view', 'One clear hip–knee–ankle chain', 'Room to descend without leaving the frame'],
  },
  'push-up': {
    title: 'Full-body side profile',
    camera: 'Place the Kinect low beside the mat, aimed across your body—not toward your head and not steeply down.',
    position: 'Lie across the image with arms extended. Leave space beyond your hands and feet so your entire plank remains visible as you lower.',
    checklist: ['Hands and feet inside the frame', 'Shoulder–elbow–wrist chain visible', 'Shoulder, hip, and ankle visible in a horizontal side view'],
  },
  golf: {
    title: 'Face-on address view',
    camera: 'Place the Kinect in front of your stance, aimed toward your chest. The current swing detector uses a face-on view.',
    position: 'Face the camera with both shoulders and hips visible. Step back and center your body so both feet and the full path of your arms fit during backswing and follow-through.',
    checklist: ['Both shoulders, hips, and feet visible', 'Hands visible at address', 'Open space on both sides for the full swing'],
  },
}

function CameraIcon() {
  return <g transform="translate(320 286)" stroke="#ff6879" strokeWidth="2.5" fill="none" strokeLinejoin="round">
    <rect x="-19" y="-10" width="38" height="20" rx="5" fill="#2a2025" />
    <circle r="6" fill="#141216" /><circle cx="-12" cy="0" r="1.6" fill="#ff6879" stroke="none" />
    <path d="M-14 12v7m28-7v7M-21 19h42" />
  </g>
}

function SquatPose() {
  return <g stroke="#f5e7e7" strokeWidth="2" strokeLinejoin="round">
    <path d="M311 97 Q298 107 299 130 L303 167 Q306 181 317 184 L340 180 Q343 160 338 132 L329 100Z" fill="#d84054" />
    <path d="M318 177 Q309 195 311 219 L309 244 Q310 253 318 253 L328 252 Q333 247 328 241 L331 210 335 184Z" fill="#a69ba0" />
    <path d="M330 181 Q335 202 334 222 L337 245 Q339 252 347 252 L357 250 Q360 245 354 241 L352 210 344 177Z" fill="#777179" />
    <path d="M309 245 Q306 256 311 259 L339 259 Q344 255 336 251 L327 245Z M337 245 Q333 256 339 259 L369 259 Q374 255 364 250 L355 244Z" fill="#f2e6e6" />
    <path d="M308 106 Q300 113 299 128 L298 161 Q300 168 306 168 L313 166 Q317 161 313 156 L318 127Z" fill="#dec9c9" />
    <path d="M332 106 Q341 113 341 127 L346 160 Q348 167 342 168 L336 166 Q333 161 335 156 L329 127Z" fill="#c9b4b6" />
    <path d="M312 90 L314 101 330 103 329 89Z" fill="#dbbfc0" />
    <circle cx="320" cy="73" r="20" fill="#dec9c9" /><path d="M336 70 L347 76 336 80Z" fill="#dec9c9" />
    <path d="M301 72 Q299 48 319 47 Q338 48 340 66 Q325 61 309 67Z" fill="#252128" stroke="none" />
  </g>
}

function PushUpPose() {
  return <g stroke="#f5e7e7" strokeWidth="2" strokeLinejoin="round">
    <path d="M108 141 Q91 133 77 142 Q68 150 73 161 Q80 172 97 169 L113 159Z" fill="#dcc5c5" />
    <path d="M73 146 Q75 127 92 130 Q105 132 110 141 L91 146Z" fill="#252128" stroke="none" />
    <path d="M106 147 L123 143 135 153 118 164Z" fill="#dcc5c5" />
    <path d="M126 142 Q157 130 188 139 L315 148 Q348 151 377 157 L388 173 347 180 306 166 192 155 Q158 165 131 159Z" fill="#d84054" />
    <path d="M377 158 Q418 158 455 166 L510 179 Q522 184 517 196 L497 201 444 182 379 179Z" fill="#9e969c" />
    <path d="M505 185 L530 187 547 201 Q553 207 544 210 L510 210 496 198Z" fill="#f2e6e6" />
    <path d="M171 146 Q179 153 178 165 L182 224 Q181 232 173 232 L164 229 159 167Z" fill="#dac5c5" />
    <path d="M197 147 Q205 154 205 166 L210 224 Q208 232 201 232 L191 229 186 168Z" fill="#c7b2b4" />
    <path d="M162 227 L185 227 Q190 233 185 236 L158 236 Q154 233 162 227Z M190 227 L214 227 Q219 233 213 236 L187 236 Q182 233 190 227Z" fill="#f2e6e6" />
  </g>
}

function GolfPose() {
  return <g stroke="#f5e7e7" strokeWidth="2" strokeLinejoin="round">
    <path d="M300 87 L298 100 319 102 320 87Z" fill="#d8bfc0" />
    <circle cx="309" cy="69" r="19" fill="#dec7c7" />
    <path d="M291 69 Q292 47 309 47 Q328 49 328 69 Q314 62 300 68Z" fill="#252128" stroke="none" />
    <path d="M289 101 Q307 96 329 102 L343 147 327 172 289 171 276 146Z" fill="#d84054" />
    <path d="M289 167 Q284 188 274 214 L263 244 276 249 292 218 306 184Z" fill="#9e969c" />
    <path d="M313 173 Q324 190 337 215 L351 246 365 244 353 211 335 167Z" fill="#777179" />
    <path d="M262 239 L278 244 273 256 244 257 Q239 253 247 247Z M350 242 L366 238 379 248 Q384 254 377 257 L350 256Z" fill="#f2e6e6" />
    <path d="M285 108 Q270 116 266 132 L288 158 305 175 313 168 296 151 279 131 294 121Z" fill="#d9c2c2" />
    <path d="M335 108 Q349 116 350 132 L330 159 316 174 308 167 323 149 339 130 326 121Z" fill="#c7b0b3" />
    <path d="M305 167 Q310 163 316 166 L322 175 Q318 181 311 179Z" fill="#e4cece" />
    <path d="M318 177 L354 232" stroke="#c4d0d4" strokeWidth="3" />
  </g>
}

function ReferenceIllustration({ mode }: { mode: SetupMode }) {
  const golf = mode === 'golf'
  return <svg className="reference-illustration" viewBox="0 0 640 310" role="img"
    aria-label={golf ? 'Face-on golfer at address, centered with room for the swing; Kinect in front' : mode === 'squat' ? 'Standing side-profile athlete facing right, fully inside the frame; Kinect at the side' : 'Horizontal full-body push-up side profile from head and hands to feet; Kinect low beside the mat'}>
    <rect width="640" height="310" rx="12" fill="#1e191d" />
    <rect x="24" y="22" width="592" height="244" rx="8" fill="#262024" stroke="#ab5260" strokeWidth="2" strokeDasharray="8 6" />
    <text x="40" y="45" fill="#f2a6b1" fontSize="12" fontWeight="700" letterSpacing="1.4">{golf ? 'FACE-ON · FULL SWING IN FRAME' : 'SIDE VIEW · FULL BODY IN FRAME'}</text>
    <path d="M35 259 H605" stroke="#6d5b60" strokeWidth="3" />
    {mode === 'squat' && <><SquatPose /><path d="M360 86h80m-10-8 10 8-10 8" fill="none" stroke="#ff7585" strokeWidth="3" /><text x="367" y="74" fill="#f3b6be" fontSize="11">FACE THIS WAY</text></>}
    {mode === 'push-up' && <><PushUpPose /><text x="80" y="102" fill="#f3b6be" fontSize="11">HEAD + HANDS</text><text x="488" y="154" fill="#f3b6be" fontSize="11">FEET</text></>}
    {golf && <><path d="M135 101 Q309 -21 490 101" stroke="#794854" strokeWidth="2" strokeDasharray="7 7" fill="none" /><text x="57" y="135" fill="#f3b6be" fontSize="11">BACKSWING SPACE</text><text x="456" y="135" fill="#f3b6be" fontSize="11">FINISH SPACE</text><GolfPose /></>}
    <CameraIcon /><path d="M320 270 V247m-8 9 8-9 8 9" fill="none" stroke="#ff6879" strokeWidth="2.5" />
    <text x="347" y="291" fill="#f3b6be" fontSize="12" fontWeight="700">{golf ? 'KINECT IN FRONT' : mode === 'push-up' ? 'LOW KINECT AT SIDE' : 'KINECT AT SIDE'}</text>
  </svg>
}

export function CameraGuide({ mode, framing, connected, modelReady }: Props) {
  const guide = guidance[mode]
  const status = !connected || !modelReady ? 'Tracking Unavailable' : framing.status
  const suggestion = !connected ? 'Connect the Kinect to check your live position.' : !modelReady ? 'Loading body tracking for live positioning.' : framing.suggestion
  return <section className="reference-view" aria-label={`${mode === 'golf' ? 'Golf Swing' : mode === 'squat' ? 'Squat' : 'Push-up'} setup reference`}>
    <ReferenceIllustration mode={mode} />
    <div className="reference-copy">
      <span className="panel-label">SETUP / REFERENCE</span>
      <h2>{guide.title}</h2>
      <p><b>Camera</b> {guide.camera}</p>
      <p><b>Your position</b> {guide.position}</p>
      <div className="reference-checklist"><span className="panel-label">BEFORE YOU START</span>
        <ul>{guide.checklist.map((item) => <li key={item}>{item}</li>)}</ul>
      </div>
      <div className="reference-live" role="status" aria-live="polite">
        <strong className={`framing-status ${status.toLowerCase().replace(' ', '-')}`}>{status}</strong>
        <p>{suggestion}</p>
      </div>
      <small>Live guidance uses visible body landmarks. Verify camera height and view direction against the illustration.</small>
    </div>
  </section>
}
