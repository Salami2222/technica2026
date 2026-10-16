# Kinetiq V2

Kinetiq V2 is the live pose viewer in the `technica2026` repository. It supports **squats, push-ups, and golf swing analysis**. It shows Xbox 360 Kinect V1 RGB video with a live 33-landmark skeleton. A small Python process reads `libfreenect_sync`; React renders the frames and runs Google's Pose Landmarker Full model in the browser. All video stays on the Mac.

Choose **Squat** or **Push-up** in the app. Both modes share the same live tracking view, but each has its own phase detector under `src/analysis/`. Switching modes resets phase detection.

- **Squat:** Standing → Descending → Bottom → Ascending, using hip and knee angles from the more visible leg.
- **Push-up:** Top → Lowering → Bottom → Pushing, using elbow bend, shoulder travel, and body position from the more visible side. A side-on camera view is recommended.

The app displays smoothed joint angles and separate tracking status. Squats need a visible hip, knee, and ankle for the primary knee angle; the shoulder and hip angle are optional. Push-ups need a visible shoulder, elbow, and wrist for the primary elbow angle; the hip and ankle are optional after a side-on view has been established. Facial landmarks are never used for phase detection. The initial visibility threshold is **0.40**.

If essential joints disappear briefly, **Partial Tracking** preserves the last phase for up to **2 seconds** and hides angle readings rather than reusing old measurements. The first reliable observation after an occlusion or side switch reinitializes smoothing and cannot advance the phase by itself. After more than 2 seconds without reliable measurements, the detector resets and shows **Tracking Lost**. **Kinect Disconnected** means the camera feed itself stopped, separate from landmark occlusion. Initial visibility, angle, movement, smoothing, and side-switch hysteresis values are in `src/analysis/config.ts` for later calibration. Phase labels describe movement; the separate session controller counts completed cycles without judging form.

## Exercise sessions

Select **Squat** or **Push-up**, then press **Start**. The counter waits for a stable starting position for **350 ms**: extended legs for squats, or extended arms and an aligned shoulder–hip–ankle line for push-ups. The start pose arms the counter but does not count as a repetition. A rep counts when a tracked knee or elbow angle descends beyond the exercise's depth threshold and reliably rises back to the starting position. A minimum cycle duration rejects sudden angle spikes. The next rep can begin immediately; no return hold or new starting-position hold is required between reps. The session shows **Ready** between reps and **Recording** during a movement.

**Pause** preserves completed reps and discards any unfinished movement. **Resume** waits for the starting pose again. A brief partial-tracking gap can preserve an unfinished rep only if the returning angle and tracked side establish continuity; the first recovered measurement is never treated as movement. Larger gaps discard only the unfinished cycle, and counting rearms when the start pose is seen without another hold. Completed reps remain saved. **Stop** ends the session immediately and shows the exercise and total reps. Starting a new session resets the count. Exercise tabs are locked while a session is active. Cycle depth, continuity, and timing values are in `src/session/config.ts` for calibration.

## Golf Swing Analysis

Select **Golf Swing**, choose **Right** or **Left**, and press **Start**. Place the Kinect face-on with your entire body visible: both shoulders, hips, ankles, and at least one wrist. A stable address with hands below shoulders enables detection. The app follows the wrists relative to the address stance through **Address → Backswing → Top → Downswing → Follow-through → Finish**. Hold the finish briefly to record a swing. Return to a steady address to record another swing in the same session. Practice swings without a ball are supported. Pause discards only the swing in progress; Stop preserves the current session's results for review.

Each completed swing receives five measured category scores worth 2 points each: setup/posture, head and upper-body stability, balance/lower-body control, tempo, and follow-through/finish. Expand a category in the results card to see the measurement and a suggestion. Results also show timing, normalized hand and body movement, what went well, priorities for the next swing, and scores from earlier swings in the current session. If there are too few reliable measurements or too much missing tracking, the result says **Unable to Score**. Missing head landmarks are excluded from the head measurement; visible shoulder movement is still evaluated. Initial thresholds are documented in `src/golf/config.ts` and can be calibrated from recorded practice sessions.

This is a **single-camera practice estimate**, not professional biomechanical analysis. MediaPipe's estimated 3D body pose and the Kinect RGB feed cannot validate exact rotation, clubhead or clubface position, impact, or ball flight. The downswing timing ends when the hands pass the approximate address region, not at an observed club–ball strike.

To validate with the physical Kinect, stand fully in frame in a face-on view, select the correct handedness, and record several slow and normal-speed practice swings. Check stage order, finish detection, left/right mirroring, category measurements, and score changes when you deliberately vary head sway, balance, or tempo. Repeat with a briefly obscured wrist and with a longer tracking interruption; no incomplete swing should receive a score. The automated tests use **simulated landmark sequences** and do not establish real-world scoring accuracy.

## Requirements

- macOS with a powered Xbox 360 Kinect V1 connected by USB
- Homebrew `libfreenect` (already installed if `freenect-glview` works)
- Python 3.10 or newer, Node.js 20.19+ or 22.12+
- An internet connection during the first asset download

The official `libfreenect` project offers a Cython `freenect` Python module, but Homebrew's installation does not necessarily install that module for the current Python. This bridge uses Python's standard `ctypes` to call the **installed** `libfreenect_sync.dylib` directly, so no separate binding build is needed. It looks in Homebrew's Apple Silicon and Intel paths. Pillow is used only to encode RGB frames as JPEG.

## Install

```bash
git clone https://github.com/Salami2222/technica2026.git
cd technica2026
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
npm install
npm run prepare:assets
```

`prepare:assets` copies MediaPipe's WASM files from the installed npm package and downloads the [official Pose Landmarker Full model](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task) into `public/models/`. These generated assets are ignored by Git.

## Run

Close `freenect-glview` first; only one app should access the Kinect at a time. Then use two terminals from the project directory:

```bash
# Terminal 1
source .venv/bin/activate
python backend/server.py
```

```bash
# Terminal 2
npm run dev
```

Open **http://127.0.0.1:5173**. The Python bridge listens on `127.0.0.1:8765` and Vite forwards `/api` requests to it. The app reports exercise phase, joint angles, Kinect connection, pose model status, landmark count, and processed FPS. Step back so your full body is visible.

Kinect capture runs in a separate child process. If no frame arrives for more than **5 seconds** (including during startup), the bridge terminates that process and starts a fresh one after **2 seconds**. It repeats until frames return, without restarting the HTTP server. The app shows **Recovering** and the latest capture message during this time. Check `http://127.0.0.1:8765/api/status` for `state`, `error`, `ageSeconds`, and `restartCount`; `connected` becomes true again after a new frame arrives. A browser refresh is not required.

Run `npm test` for synthetic movement-cycle, temporary occlusion, tracking-loss, left/right switching, and exercise-session counting checks. Run `python -m unittest discover -s tests -p 'test_*.py'` from the activated virtual environment for simulated frozen capture, recovery, API, and worker cleanup checks. Physical Kinect testing is still needed to tune visibility, movement, start-pose, and return-hold thresholds under real lighting, camera angles, occlusion, and USB interruptions.

## Troubleshooting

- **Kinect bridge unavailable:** Start `python backend/server.py` and keep it running. Check `http://127.0.0.1:8765/api/status` for its current error.
- **`libfreenect_sync` not found:** Check `brew --prefix libfreenect`. The bridge expects Homebrew under `/opt/homebrew` or `/usr/local`.
- **Capture failed:** Check Kinect power and USB, close `freenect-glview`, and reconnect the device. On macOS, grant any requested USB or accessory access.
- **Feed freezes while the bridge stays open:** Watch `/api/status` move to `recovering` within about 5 seconds, then back to `connected` when frames resume. Check the restart count. If the device stays unplugged, the bridge keeps retrying. Confirm this behavior with the physical Kinect by interrupting its USB connection and reconnecting it; the automated tests simulate a blocked capture call but cannot verify USB or `libfreenect` behavior.
- **Pose model failed to load:** Run `npm run prepare:assets` again, then reload the page.
- **No body detected:** Show your full body in the RGB image, use even lighting, and avoid heavy occlusion.

Only RGB is read for this milestone. The camera view currently draws a 2D skeleton overlay from MediaPipe's pose landmarks; joint-angle calculations use its 3D world landmarks. Depth integration, inverse kinematics, and form evaluation are future work.
