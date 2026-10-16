"""Offline side-view dataset extraction. Raw videos and results stay outside Git.

The CSV contains file IDs displayed by Mendeley Data v2. Samples match the
FormSample input used by the live TypeScript scorer; the scorer itself is run
by scripts/evaluate-form-dataset.mjs to avoid two rule implementations.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import subprocess
from pathlib import Path

DATASET = "https://data.mendeley.com/public-files/datasets/kgbb3yn47p/files/{}/file_downloaded"
JOINTS = {"left": (11, 13, 15, 23, 25, 27), "right": (12, 14, 16, 24, 26, 28)}
MIN_VISIBILITY = 0.40  # src/analysis/config.ts


def manifest_rows(path: Path):
    with path.open(newline="") as handle:
        rows = list(csv.DictReader(handle))
    keys = set()
    for row in rows:
        assert row["exercise"] in ("squat", "push_up") and row["label"] in ("good", "bad")
        assert len(row["file_id"]) == 36
        key = (row["subject"], row["exercise"], row["label"])
        assert key not in keys, f"duplicate recording: {key}"
        keys.add(key)
    return rows


def filename(row):
    return f"subject_{row['subject']}_{row['exercise']}_{row['label']}_side.mp4"


def file_hash(path: Path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def download(rows, directory: Path):
    directory.mkdir(parents=True, exist_ok=True)
    for row in rows:
        target = directory / filename(row)
        if target.exists() and target.stat().st_size > 100_000:
            continue
        temporary = target.with_suffix(".part")
        url = DATASET.format(row["file_id"])
        # macOS curl uses the system certificate store even when a Python.org
        # interpreter has not run its optional certificate-install script.
        subprocess.run(["curl", "--fail", "--location", "--silent", "--show-error",
                        "--max-time", "120", "--output", str(temporary), url], check=True)
        if temporary.stat().st_size < 100_000:
            temporary.unlink()
            raise ValueError(f"incomplete download: {url}")
        temporary.replace(target)
        print(f"downloaded {target.name}: {target.stat().st_size} bytes", flush=True)


def reliable(point):
    return point is not None and all(math.isfinite(getattr(point, axis)) for axis in ("x", "y", "z")) and \
        (point.visibility or 0) >= MIN_VISIBILITY and (getattr(point, "presence", 1) or 0) >= MIN_VISIBILITY


def angle(a, center, b):
    u = (a.x - center.x, a.y - center.y, a.z - center.z)
    v = (b.x - center.x, b.y - center.y, b.z - center.z)
    magnitude = math.sqrt(sum(x * x for x in u)) * math.sqrt(sum(x * x for x in v))
    return math.degrees(math.acos(max(-1, min(1, sum(x * y for x, y in zip(u, v)) / magnitude)))) if magnitude > 1e-6 else None


def sample(result, exercise, at):
    if not result.pose_landmarks or not result.pose_world_landmarks:
        return None
    image, world = result.pose_landmarks[0], result.pose_world_landmarks[0]
    candidates = []
    for side, indexes in JOINTS.items():
        chain = (indexes[3], indexes[4], indexes[5]) if exercise == "squat" else indexes[:3]
        quality = min((min(image[i].visibility or 0, world[i].visibility or 0) for i in chain), default=0)
        if all(reliable(image[i]) and reliable(world[i]) for i in chain):
            candidates.append((quality, side, indexes))
    if not candidates:
        return None
    _, side, indexes = max(candidates)
    shoulder_i, elbow_i, wrist_i, hip_i, knee_i, ankle_i = indexes
    chain = (hip_i, knee_i, ankle_i) if exercise == "squat" else (shoulder_i, elbow_i, wrist_i)
    measured_angle = angle(*(world[i] for i in chain))
    if measured_angle is None:
        return None

    def pixel(index):
        return (image[index].x * 640, image[index].y * 480) if reliable(image[index]) else None

    shoulder, hip, ankle, wrist = map(pixel, (shoulder_i, hip_i, ankle_i, wrist_i))
    torso_scale = math.dist(shoulder, hip) if shoulder and hip else None
    body_scale = math.dist(shoulder, ankle) if shoulder and ankle else None
    torso_lean = math.degrees(math.atan2(abs(shoulder[0] - hip[0]), abs(shoulder[1] - hip[1]))) if shoulder and hip else None
    body_offset = None
    if shoulder and hip and ankle and body_scale and body_scale > 20 and abs(ankle[0] - shoulder[0]) > 30:
        line_y = shoulder[1] + (ankle[1] - shoulder[1]) * (hip[0] - shoulder[0]) / (ankle[0] - shoulder[0])
        body_offset = (hip[1] - line_y) / body_scale
    return {"at": at, "side": side, "angle": measured_angle,
            "torsoLean": torso_lean if exercise == "squat" else None,
            "hipX": hip[0] if exercise == "squat" and hip else None,
            "torsoScale": torso_scale if exercise == "squat" and torso_scale and torso_scale > 15 else None,
            "bodyOffset": body_offset if exercise == "push_up" else None,
            "wristX": wrist[0] if exercise == "push_up" and wrist else None,
            "wristY": wrist[1] if exercise == "push_up" and wrist else None,
            "bodyScale": body_scale if exercise == "push_up" and body_scale and body_scale > 30 else None}


def segment(samples, exercise):
    """Find observed high-low-high cycles. Unclosed motion is explicitly uncertain."""
    high = 145 if exercise == "squat" else 140
    minimum_excursion = 25
    cycles, current, trough = [], [], float("inf")
    uncertain = 0
    for observation in samples:
        if observation is None:
            if current:
                uncertain += 1
            current, trough = [], float("inf")
            continue
        if current and (observation["side"] != current[-1]["side"] or observation["at"] - current[-1]["at"] > 450):
            uncertain += 1
            current, trough = [], float("inf")
        if not current:
            if observation["angle"] >= high:
                current = [observation]
            continue
        current.append(observation)
        trough = min(trough, observation["angle"])
        if trough < current[0]["angle"] - minimum_excursion and observation["angle"] >= max(high, current[0]["angle"] - 15):
            if len(current) >= 6 and 500 <= current[-1]["at"] - current[0]["at"] <= 10_000:
                cycles.append(current)
            else:
                uncertain += 1
            current, trough = [observation], float("inf")
        elif trough == float("inf") and len(current) > 3:
            current = current[-3:]
    if current and trough < current[0]["angle"] - minimum_excursion:
        uncertain += 1
    return cycles, uncertain


def extract(rows, directory: Path, model: Path, output: Path, sample_fps: float):
    import cv2
    import mediapipe as mp

    options = mp.tasks.vision.PoseLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(model)),
        running_mode=mp.tasks.vision.RunningMode.VIDEO,
        num_poses=1, min_pose_detection_confidence=0.5,
        min_pose_presence_confidence=0.5, min_tracking_confidence=0.5,
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w") as stream:
        for row in rows:
            path = directory / filename(row)
            if not path.exists():
                raise FileNotFoundError(f"{path}; run --download first")
            capture = cv2.VideoCapture(str(path))
            if not capture.isOpened():
                raise ValueError(f"unable to decode {path}")
            fps = capture.get(cv2.CAP_PROP_FPS)
            if not fps or fps <= 0:
                raise ValueError(f"missing video frame rate: {path}")
            step = max(1, round(fps / sample_fps))
            observations, frame_index = [], 0
            # VIDEO-mode tracking state must not carry across participants.
            landmarker = mp.tasks.vision.PoseLandmarker.create_from_options(options)
            while True:
                ok, frame = capture.read()
                if not ok:
                    break
                if frame_index % step == 0:
                    height, width = frame.shape[:2]
                    scale = min(640 / width, 480 / height)
                    resized = cv2.resize(frame, (round(width * scale), round(height * scale)))
                    padded = cv2.copyMakeBorder(resized, (480 - resized.shape[0]) // 2,
                        480 - resized.shape[0] - (480 - resized.shape[0]) // 2,
                        (640 - resized.shape[1]) // 2,
                        640 - resized.shape[1] - (640 - resized.shape[1]) // 2,
                        cv2.BORDER_CONSTANT, value=(0, 0, 0))
                    image = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(padded, cv2.COLOR_BGR2RGB))
                    at = round(frame_index * 1000 / fps)
                    observations.append(sample(landmarker.detect_for_video(image, at), row["exercise"], at))
                frame_index += 1
            capture.release()
            landmarker.close()
            cycles, uncertain = segment(observations, row["exercise"])
            record = {"filename": path.name, "sha256": file_hash(path), "subject": row["subject"], "exercise": "push-up" if row["exercise"] == "push_up" else "squat",
                      "label": row["label"], "view": "side", "sampledFrames": len(observations),
                      "trackedFrames": sum(item is not None for item in observations),
                      "uncertainCycles": uncertain, "repetitions": cycles}
            stream.write(json.dumps(record, separators=(",", ":")) + "\n")
            stream.flush()
            print(f"{path.name}: {len(cycles)} complete, {uncertain} uncertain, {record['trackedFrames']}/{len(observations)} tracked", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=Path(__file__).with_name("mendeley-side-manifest.csv"))
    parser.add_argument("--video-dir", type=Path, default=Path("work/form-dataset/videos"))
    parser.add_argument("--model", type=Path, default=Path("public/models/pose_landmarker_full.task"))
    parser.add_argument("--output", type=Path, default=Path("work/form-dataset/measurements.jsonl"))
    parser.add_argument("--sample-fps", type=float, default=10)
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--extract", action="store_true")
    parser.add_argument("--subjects", nargs="*", help="Optional participant IDs, e.g. 001 002")
    args = parser.parse_args()
    rows = manifest_rows(args.manifest)
    if args.subjects:
        rows = [row for row in rows if row["subject"] in args.subjects]
    if args.download:
        download(rows, args.video_dir)
    if args.extract:
        extract(rows, args.video_dir, args.model, args.output, args.sample_fps)
    if not args.download and not args.extract:
        parser.error("choose --download, --extract, or both")


if __name__ == "__main__":
    os.environ.setdefault("MPLCONFIGDIR", str(Path("work/matplotlib-cache").resolve()))
    main()
