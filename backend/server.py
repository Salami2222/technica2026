"""Local HTTP bridge: latest Kinect RGB frame as JPEG plus capture status."""

from __future__ import annotations

import argparse
import json
import logging
import multiprocessing
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from multiprocessing.connection import Connection
from urllib.parse import urlparse

from capture import capture_worker

LOG = logging.getLogger("technica.bridge")


class FrameStore:
    def __init__(
        self,
        worker_target=capture_worker,
        worker_args: tuple = (),
        freeze_timeout: float = 5.0,
        retry_delay: float = 2.0,
        poll_interval: float = 0.1,
        terminate_timeout: float = 1.0,
    ):
        self.context = multiprocessing.get_context("spawn")
        self.worker_target = worker_target
        self.worker_args = worker_args
        self.freeze_timeout = freeze_timeout
        self.retry_delay = retry_delay
        self.poll_interval = poll_interval
        self.terminate_timeout = terminate_timeout
        self.condition = threading.Condition()
        self.jpeg: bytes | None = None
        self.sequence = 0
        self.captured_at = 0.0
        self.state = "starting"
        self.error: str | None = "Starting Kinect capture."
        self.restart_count = 0
        self.worker_pid: int | None = None
        self.stopped = threading.Event()
        self.thread = threading.Thread(target=self._supervise, name="kinect-supervisor", daemon=True)

    def start(self) -> None:
        self.thread.start()

    def stop(self) -> None:
        self.stopped.set()
        if self.thread.is_alive():
            self.thread.join(timeout=2 * self.terminate_timeout + self.poll_interval + 1)
        if self.thread.is_alive():
            raise RuntimeError("Kinect capture supervisor did not stop")

    def _set_state(self, state: str, error: str | None) -> None:
        with self.condition:
            self.state = state
            self.error = error
            if state != "connected":
                self.jpeg = None
            self.condition.notify_all()

    def _stop_worker(self, process: multiprocessing.Process, receiver: Connection) -> None:
        if process.is_alive():
            process.terminate()
        process.join(timeout=self.terminate_timeout)
        if process.is_alive():
            process.kill()
            process.join(timeout=self.terminate_timeout)
        receiver.close()
        with self.condition:
            self.worker_pid = None
        if process.is_alive():
            raise RuntimeError(f"Kinect worker {process.pid} could not be stopped")
        process.close()

    def _supervise(self) -> None:
        while not self.stopped.is_set():
            receiver, sender = self.context.Pipe(duplex=False)
            process = self.context.Process(
                target=self.worker_target,
                args=(sender, *self.worker_args),
                name="kinect-capture",
                daemon=True,
            )
            try:
                self._set_state(
                    "starting" if self.restart_count == 0 else "recovering",
                    "Starting Kinect capture." if self.restart_count == 0 else f"Restarting Kinect capture (attempt {self.restart_count}).",
                )
                process.start()
                sender.close()
                with self.condition:
                    self.worker_pid = process.pid
                deadline = time.monotonic() + self.freeze_timeout
                while not self.stopped.is_set():
                    if receiver.poll(self.poll_interval):
                        try:
                            kind, payload = receiver.recv()
                        except EOFError:
                            self._set_state("recovering", "Kinect capture worker exited. Restarting.")
                            break
                        if kind == "error":
                            LOG.warning("Capture unavailable: %s", payload)
                            self._set_state("recovering", f"Kinect capture error: {str(payload).rstrip('.')}. Retrying.")
                            break
                        if kind == "frame":
                            with self.condition:
                                self.jpeg = payload
                                self.sequence += 1
                                self.captured_at = time.monotonic()
                                self.state = "connected"
                                self.error = None
                                self.condition.notify_all()
                            deadline = time.monotonic() + self.freeze_timeout
                    if time.monotonic() > deadline:
                        LOG.warning("No Kinect frame for %.1f seconds; restarting worker", self.freeze_timeout)
                        self._set_state("recovering", "Kinect frames stopped arriving. Restarting capture.")
                        break
                    if not process.is_alive():
                        self._set_state("recovering", "Kinect capture worker exited. Restarting.")
                        break
            except (OSError, RuntimeError) as exc:
                LOG.warning("Could not start or monitor Kinect worker: %s", exc)
                self._set_state("recovering", f"Kinect worker error: {exc}. Retrying.")
            finally:
                sender.close()
                if process.pid is not None:
                    self._stop_worker(process, receiver)
                else:
                    receiver.close()
            if not self.stopped.is_set():
                with self.condition:
                    self.restart_count += 1
                self.stopped.wait(self.retry_delay)
        self._set_state("stopped", "Kinect capture stopped.")

    def snapshot(self) -> tuple[bytes | None, int, str | None, float]:
        with self.condition:
            age = time.monotonic() - self.captured_at if self.captured_at else 0.0
            frame = self.jpeg if self.state == "connected" and age <= self.freeze_timeout else None
            error = "Kinect frames stopped arriving. Restarting capture." if self.state == "connected" and frame is None else self.error
            return frame, self.sequence, error, age

    def status(self) -> dict:
        with self.condition:
            age = time.monotonic() - self.captured_at if self.captured_at else 0.0
            connected = self.jpeg is not None and self.state == "connected" and age <= self.freeze_timeout
            state = self.state if connected or self.state != "connected" else "recovering"
            error = "Kinect frames stopped arriving. Restarting capture." if self.state == "connected" and not connected else self.error
            return {
                "connected": connected,
                "state": state,
                "sequence": self.sequence,
                "ageSeconds": round(age, 2),
                "error": error,
                "restartCount": self.restart_count,
            }


def make_handler(store: FrameStore):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            path = urlparse(self.path).path
            if path == "/api/status":
                self._respond(200, "application/json", json.dumps(store.status()).encode())
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
            LOG.debug("%s %s", self.address_string(), format % args)

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(description="Kinect V1 RGB bridge for Technica2026")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    store = FrameStore()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(store))
    store.start()
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
