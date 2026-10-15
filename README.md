# Kinetiq V2

Kinetiq V2 is the live pose viewer in the `technica2026` repository. Its exercise scope is **squats and push-ups**. It shows Xbox 360 Kinect V1 RGB video with a live 33-landmark skeleton. A small Python process reads `libfreenect_sync`; React renders the frames and runs Google's Pose Landmarker Full model in the browser. All video stays on the Mac.

Choose **Squat** or **Push-up** in the app. Both modes currently share the same live tracking view. Their definitions live in `src/exercises.ts`, which provides a place for independent repetition counting, joint-angle analysis, and form feedback later. Selecting a mode does not perform any of those analyses yet.

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

Open **http://127.0.0.1:5173**. The Python bridge listens on `127.0.0.1:8765` and Vite forwards `/api` requests to it. The app reports Kinect connection, pose model status, landmark count, and processed FPS. Step back so your full body is visible. The bridge automatically retries capture after a disconnect.

## Troubleshooting

- **Kinect bridge unavailable:** Start `python backend/server.py` and keep it running. Check `http://127.0.0.1:8765/api/status` for its current error.
- **`libfreenect_sync` not found:** Check `brew --prefix libfreenect`. The bridge expects Homebrew under `/opt/homebrew` or `/usr/local`.
- **Capture failed:** Check Kinect power and USB, close `freenect-glview`, and reconnect the device. On macOS, grant any requested USB or accessory access.
- **Pose model failed to load:** Run `npm run prepare:assets` again, then reload the page.
- **No body detected:** Show your full body in the RGB image, use even lighting, and avoid heavy occlusion.

Only RGB is read for this milestone. Depth, repetition counts, joint angles, and form feedback are future work.
