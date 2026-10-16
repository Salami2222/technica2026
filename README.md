# Kinetiq V2

Kinetiq V2 is the live pose viewer in the `technica2026` repository. It supports **squats, push-ups, and golf swing analysis**. It shows Xbox 360 Kinect V1 RGB video with a live 33-landmark skeleton. A small Python process reads `libfreenect_sync`; React renders the frames and runs Google's Pose Landmarker Full model in the browser. All video stays on the Mac.

Choose **Squat** or **Push-up** in the app. Both modes share the same live tracking view, but each has its own phase detector under `src/analysis/`. Switching modes resets phase detection.

- **Squat:** Standing → Descending → Bottom → Ascending, using hip and knee angles from the more visible leg.
- **Push-up:** Top → Lowering → Bottom → Pushing, using elbow bend, shoulder travel, and body position from the more visible side. A side-on camera view is recommended.

The app displays smoothed joint angles and separate tracking status. Squats need a visible hip, knee, and ankle for the primary knee angle; the shoulder and hip angle are optional. Push-ups need a visible shoulder, elbow, and wrist for the primary elbow angle; the hip and ankle are optional after a side-on view has been established. Facial landmarks are never used for phase detection. The initial visibility threshold is **0.40**.

If essential joints disappear briefly, **Partial Tracking** preserves the last phase for up to **2 seconds** and hides angle readings rather than reusing old measurements. The first reliable observation after an occlusion or side switch reinitializes smoothing and cannot advance the phase by itself. After more than 2 seconds without reliable measurements, the detector resets and shows **Tracking Lost**. **Kinect Disconnected** means the camera feed itself stopped, separate from landmark occlusion. Initial visibility, angle, movement, smoothing, and side-switch hysteresis values are in `src/analysis/config.ts` for later calibration. Phase detection and repetition counting remain independent of form scoring.

## Exercise sessions

Select **Squat** or **Push-up**, then press **Start**. The counter waits for a stable starting position for **350 ms**: extended legs for squats, or extended arms and an aligned shoulder–hip–ankle line for push-ups. The start pose arms the counter but does not count as a repetition. A rep counts when a tracked knee or elbow angle descends beyond the exercise's depth threshold and reliably rises back to the starting position. A minimum cycle duration rejects sudden angle spikes. The next rep can begin immediately; no return hold or new starting-position hold is required between reps. The session shows **Ready** between reps and **Recording** during a movement.

**Pause** preserves completed reps and discards any unfinished movement. **Resume** waits for the starting pose again. A brief partial-tracking gap can preserve an unfinished rep only if the returning angle and tracked side establish continuity; the first recovered measurement is never treated as movement. Larger gaps discard only the unfinished cycle, and counting rearms when the start pose is seen without another hold. Completed reps remain saved. **Stop** ends the session immediately and shows the exercise and total reps. Starting a new session resets the count. Exercise tabs are locked while a session is active. Cycle depth, continuity, and timing values are in `src/session/config.ts` for calibration.

### Form feedback and scores

Every completed squat or push-up is analyzed from measurements gathered across the repetition. Five categories contribute up to 2 points each. Squats use knee-angle depth/range, torso-angle change, angle-path control, hip-path smoothness, and finish/depth consistency. Push-ups use elbow range, signed hip offset from the shoulder–ankle line, angle-path control, wrist-anchor drift, and finish/depth consistency. The dashboard shows the latest score, brief measured coaching cues, per-repetition breakdowns, score history, and a Stop summary with the average of valid scores. **Completed repetitions** remain separate from **scored** and **acceptable** repetitions; the initial acceptable-score marker is 7/10.

If a category lacks sufficient reliable observations, it is **N/A**. A numerical total appears only when all five categories can be measured; otherwise the rep still counts and says **Unable to Score**. First-rep consistency uses the observed return to the starting angle; later reps also compare measured depth. Rules and initial bands are in `src/form/config.ts`. These are preliminary single-camera technique estimates, not validated biomechanics or injury-risk assessments. For physical calibration, record multiple squat and side-on push-up sets at varied speeds. Check that hip hinging in a squat is not mistaken for wobble, body-line sag/pike labels are correct from either facing direction, and scores change only with clearly observable movement. Test intermittent shoulder/hip visibility and confirm counted reps stay counted when form is unscorable.

### Camera setup and live framing

Expand **Camera Setup** under the exercise analysis. Its exercise-specific SVG shows a full human side profile inside the image boundary and the Kinect beside the athlete. The indicator uses the current MediaPipe landmarks: **Ready**, **Adjust Position**, or **Tracking Unavailable**. The suggestion names the observed missing joint chain, crop, or projected viewing angle. It does not gate repetition counting or require both sides or facial landmarks. It cannot infer the camera's physical height or 3D viewing direction with certainty from one RGB image, so treat the suggestion as a placement check.

- **Squat:** Put the Kinect to your side at roughly hip height, pointing across your movement. Stand far enough away that your entire head, shoulders, hips, knees, and feet fit with space around them. One visible hip–knee–ankle chain is needed for the knee angle.
- **Push-up:** Put the Kinect low, beside the length of your mat, pointing **perpendicular** to your body's long axis. It should see your side profile rather than look toward your head. Frame your head, planted hands, shoulders, hips, and feet throughout the motion, with margin at both horizontal edges. One shoulder–elbow–wrist chain is needed for elbow tracking; shoulder, hip, and ankle should also be visible for body-line feedback.

### Offline labeled-data study

The selected source is [Mendeley Data v2, DOI 10.17632/kgbb3yn47p.2](https://data.mendeley.com/datasets/kgbb3yn47p/2), **CC BY 4.0**. It uses smartphone footage, not Kinect footage, and its good/bad labels apply to whole videos rather than individual repetitions or specific faults. The repository's [side-view manifest](scripts/mendeley-side-manifest.csv) identifies 32 individual MP4s: good and bad squats and floor push-ups from eight participants. This avoids downloading the entire 7.05 GB archive or its duplicate folder structures. Additional v2 MP4s can be added to the manifest using the same columns. Do not add videos from other versions or datasets when comparing this run.

Run the extraction separately from the live app, using Python 3.13, Node.js 22.18+ (native TypeScript stripping for the scorer import), and a virtual environment:

```bash
python3.13 -m venv work/calibration-venv
work/calibration-venv/bin/python -m pip install -r scripts/calibration-requirements.txt
npm run prepare:assets
work/calibration-venv/bin/python scripts/form_dataset.py --download --extract
node scripts/evaluate-form-dataset.mjs work/form-dataset/measurements.jsonl work/form-dataset/report.json
```

The downloader uses the public per-file links listed by Mendeley Data. Videos, extracted measurements, and the report stay in ignored `work/` storage. The extractor uses the **same Pose Landmarker Full model** and VIDEO-mode confidence settings as `src/pose.ts`, letterboxes footage into the app's 640×480 image geometry, and samples at 10 FPS. It records the same angle and optional image measurements consumed by the live scorer; the evaluation calls the **actual TypeScript `scoreExerciseRep`** function. A high–low–high angle cycle with a visible return is needed to form an offline repetition. Occlusions, side switches, and unclosed cycles are marked uncertain and are excluded from scoring. A whole-video score is the average of its scoreable repetitions, so many frames from one person do not inflate the sample count.

The evaluation splits by **participant** (first 75% sorted IDs for training, remainder held out), reports feature medians/interquartile ranges by label, and reports accuracy, precision, recall, F1, confusion matrix, and score coverage separately by exercise. It compares the existing 7/10 marker with a training-only exploratory cutoff. This cutoff is **not applied to the live app**. The dataset's binary whole-video labels cannot validate a 0–10 technique scale or a category-specific explanation, and smartphone-to-Kinect transfer still needs testing. Live bands in `src/form/config.ts` stay identified as manually selected until a larger, participant-disjoint study and physical Kinect checks support a change.

The [pilot report](docs/form-dataset-study.md) records which files were processed, exact duplicate exclusions, feature comparisons, held-out metrics, and the decision to retain the current live scoring bands.

## Golf Swing Analysis

Select **Golf Swing**, choose **Right** or **Left**, and press **Start**. Place the Kinect face-on with your full body in frame. A comfortable, briefly stable address with the hands near each other below the shoulders enables detection; a wrist or ankle can disappear momentarily. The app follows observed hand travel relative to address through **Address → Backswing → Top → Downswing → Follow-through → Finish**. In follow-through, it can continue from visible torso motion while both wrists are briefly hidden, provided lead-side hand travel was already observed. It still requires a stable finish; unseen hand movement is never invented. Hold the finish briefly to record a swing. Return to address to record another. Practice swings without a ball are supported. Pause discards only the swing in progress; Stop preserves results for review.

Each completed swing receives five measured category scores worth 2 points each: setup/posture, head and upper-body stability, balance/lower-body control, tempo, and follow-through/finish. Expand a category in the results card to see the measurement and a suggestion. Results also show timing, normalized hand and body movement, what went well, priorities for the next swing, and scores from earlier swings in the current session. If there are too few reliable measurements or too much missing tracking, the result says **Unable to Score**. Missing head landmarks are excluded from the head measurement; visible shoulder movement is still evaluated. Initial thresholds are documented in `src/golf/config.ts` and can be calibrated from recorded practice sessions.

This is a **single-camera practice estimate**, not professional biomechanical analysis. MediaPipe's estimated 3D body pose and the Kinect RGB feed cannot validate exact rotation, clubhead or clubface position, impact, or ball flight. The downswing timing ends when the hands pass the approximate address region, not at an observed club–ball strike.

To validate with the physical Kinect, stand fully in frame in a face-on view, select the correct handedness, and record several slow and normal-speed practice swings. Check stage order, finish detection, left/right mirroring, category measurements, and score changes when you deliberately vary head sway, balance, or tempo. Repeat with wrists briefly hidden behind the torso, then allow them to reappear; test several natural address widths and hand positions. A longer interruption or a finish without observed follow-through should not score. The automated tests use **simulated landmark sequences** and do not establish real-world scoring accuracy. Calibrate `src/golf/config.ts` address stability, hand travel, torso-turn, occlusion, finish, and scoring bands with these recordings.

## Requirements

- macOS with a powered Xbox 360 Kinect V1 connected by USB
- Homebrew `libfreenect` (already installed if `freenect-glview` works)
- Python 3.10 or newer for the Kinect bridge; Python 3.13 for the optional offline study; Node.js 22.18+ for the study and tests
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

Run `npm test` for synthetic movement-cycle, temporary occlusion, tracking-loss, left/right switching, exercise-session counting, golf completion, and form-scoring checks. Run `python -m unittest discover -s tests -p 'test_*.py'` from the activated virtual environment for simulated frozen capture, recovery, API, and worker cleanup checks. Physical Kinect testing is still needed to tune visibility, movement, starting positions, golf finish, and scoring thresholds under real lighting, camera angles, occlusion, and USB interruptions.

## Troubleshooting

- **Kinect bridge unavailable:** Start `python backend/server.py` and keep it running. Check `http://127.0.0.1:8765/api/status` for its current error.
- **`libfreenect_sync` not found:** Check `brew --prefix libfreenect`. The bridge expects Homebrew under `/opt/homebrew` or `/usr/local`.
- **Capture failed:** Check Kinect power and USB, close `freenect-glview`, and reconnect the device. On macOS, grant any requested USB or accessory access.
- **Feed freezes while the bridge stays open:** Watch `/api/status` move to `recovering` within about 5 seconds, then back to `connected` when frames resume. Check the restart count. If the device stays unplugged, the bridge keeps retrying. Confirm this behavior with the physical Kinect by interrupting its USB connection and reconnecting it; the automated tests simulate a blocked capture call but cannot verify USB or `libfreenect` behavior.
- **Pose model failed to load:** Run `npm run prepare:assets` again, then reload the page.
- **No body detected:** Show your full body in the RGB image, use even lighting, and avoid heavy occlusion.

Only RGB is read for this milestone. The camera view draws a 2D skeleton overlay from MediaPipe's pose landmarks; joint-angle calculations use its estimated 3D world landmarks. The new form estimates use visible RGB-image geometry alongside those tracked angles. Kinect depth integration, inverse kinematics, and clinical validation are outside this implementation.
