"""Local HTTP bridge: latest Kinect RGB frame as JPEG plus capture status."""

from __future__ import annotations

import argparse
import io
import json
import logging
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from PIL import Image

from kinect import HEIGHT, WIDTH, KinectError, KinectRGB

LOG = logging.getLogger("technica.bridge")


class FrameStore:
    def __init__(self, camera_factory=KinectRGB):
        self.camera_factory = camera_factory
        self.condition = threading.Condition()
        self.jpeg: bytes | None = None
        self.sequence = 0
        self.captured_at = 0.0
        self.error: str | None = None
        self.stopped = threading.Event()
        self.thread = threading.Thread(target=self._capture_loop, daemon=True)

    def start(self) -> None:
        self.thread.start()

    def stop(self) -> None:
        self.stopped.set()
        self.thread.join(timeout=2)

    def _capture_loop(self) -> None:
        while not self.stopped.is_set():
            camera = None
            try:
                camera = self.camera_factory()
                with self.condition:
                    self.error = None
                while not self.stopped.is_set():
                    rgb = camera.read_rgb()
                    image = Image.frombytes("RGB", (WIDTH, HEIGHT), rgb)
                    output = io.BytesIO()
                    image.save(output, format="JPEG", quality=78)
                    with self.condition:
                        self.jpeg = output.getvalue()
                        self.sequence += 1
                        self.captured_at = time.monotonic()
                        self.condition.notify_all()
            except (KinectError, OSError, ValueError) as exc:
                LOG.warning("Capture unavailable: %s", exc)
                with self.condition:
                    self.jpeg = None
                    self.error = str(exc)
                    self.condition.notify_all()
                self.stopped.wait(2)
            finally:
                if camera is not None:
                    try:
                        camera.close()
                    except OSError as exc:
                        LOG.warning("Could not stop Kinect capture cleanly: %s", exc)

    def snapshot(self) -> tuple[bytes | None, int, str | None, float]:
        with self.condition:
            age = time.monotonic() - self.captured_at if self.captured_at else 0
            if self.jpeg is not None and age > 3:
                return None, self.sequence, "Kinect frames stopped arriving. Check the connection.", age
            return self.jpeg, self.sequence, self.error, age


def make_handler(store: FrameStore):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            path = urlparse(self.path).path
            if path == "/api/status":
                frame, sequence, error, age = store.snapshot()
                self._respond(200, "application/json", json.dumps({
                    "connected": frame is not None,
                    "sequence": sequence,
                    "ageSeconds": round(age, 2),
                    "error": error,
                }).encode())
            elif path == "/api/frame":
                frame, sequence, error, _ = store.snapshot()
                if frame is None:
                    self._respond(503, "application/json", json.dumps({
                        "error": error or "Waiting for Kinect RGB frames."
                    }).encode())
                else:
                    self._respond(200, "image/jpeg", frame, {"X-Frame-Sequence": str(sequence)})
            else:
                self._respond(404, "application/json", b'{"error":"Not found"}')

        def _respond(self, status: int, content_type: str, body: bytes, headers: dict[str, str] | None = None) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Origin", "http://localhost:5173")
            for key, value in (headers or {}).items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format: str, *args: object) -> None:
            LOG.info("%s %s", self.address_string(), format % args)

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(description="Kinect V1 RGB bridge for Technica2026")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    store = FrameStore()
    store.start()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(store))
    LOG.info("Bridge listening on http://127.0.0.1:%s", args.port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        store.stop()


if __name__ == "__main__":
    main()
