"""Process watchdog tests; no Kinect hardware is needed."""

from __future__ import annotations

import json
import multiprocessing
import sys
import time
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from server import FrameStore, make_handler  # noqa: E402


def frozen_worker(sender, attempt_counter):
    with attempt_counter.get_lock():
        attempt_counter.value += 1
    sender.send(("frame", b"first-frame"))
    while True:
        time.sleep(60)


def never_returns_worker(sender, attempt_counter):
    with attempt_counter.get_lock():
        attempt_counter.value += 1
    while True:
        time.sleep(60)


def freeze_then_recover_worker(sender, attempt_counter):
    with attempt_counter.get_lock():
        attempt_counter.value += 1
        attempt = attempt_counter.value
    sender.send(("frame", b"first-frame" if attempt == 1 else b"recovered-frame"))
    if attempt == 1:
        while True:
            time.sleep(60)
    while True:
        sender.send(("frame", b"recovered-frame"))
        time.sleep(0.03)


def wait_until(predicate, timeout=5):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.02)
    raise AssertionError("Timed out waiting for capture state")


class CaptureRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.counter = multiprocessing.get_context("spawn").Value("i", 0)
        self.store = None

    def tearDown(self):
        if self.store is not None:
            self.store.stop()

    def test_frozen_capture_is_restarted_and_status_reports_recovery(self):
        self.store = FrameStore(
            worker_target=frozen_worker,
            worker_args=(self.counter,),
            freeze_timeout=0.3,
            retry_delay=0.35,
            poll_interval=0.02,
            terminate_timeout=0.2,
        )
        self.store.start()
        wait_until(lambda: self.store.status()["connected"])
        first_pid = self.store.worker_pid
        wait_until(lambda: self.store.status()["state"] == "recovering")
        status = self.store.status()
        self.assertFalse(status["connected"])
        self.assertIn("Restarting", status["error"])
        self.assertIsNone(self.store.snapshot()[0])
        wait_until(lambda: self.store.status()["restartCount"] >= 1 and self.store.worker_pid != first_pid)
        wait_until(lambda: self.counter.value >= 2)
        self.assertGreaterEqual(self.counter.value, 2)

    def test_capture_that_never_produces_a_first_frame_is_restarted(self):
        self.store = FrameStore(
            worker_target=never_returns_worker,
            worker_args=(self.counter,),
            freeze_timeout=0.3,
            retry_delay=0.05,
            poll_interval=0.02,
            terminate_timeout=0.2,
        )
        self.store.start()
        wait_until(lambda: self.counter.value >= 2)
        self.assertGreaterEqual(self.store.status()["restartCount"], 1)
        self.assertFalse(self.store.status()["connected"])

    def test_new_worker_restores_frames_and_clears_error(self):
        self.store = FrameStore(
            worker_target=freeze_then_recover_worker,
            worker_args=(self.counter,),
            freeze_timeout=0.3,
            retry_delay=0.05,
            poll_interval=0.02,
            terminate_timeout=0.2,
        )
        self.store.start()
        wait_until(lambda: self.store.status()["restartCount"] >= 1)
        wait_until(lambda: self.store.snapshot()[0] == b"recovered-frame")
        status = self.store.status()
        self.assertEqual(status["state"], "connected")
        self.assertIsNone(status["error"])
        self.assertGreaterEqual(status["sequence"], 2)
        self.assertGreaterEqual(self.counter.value, 2)

    def test_stop_reaps_a_blocked_worker(self):
        self.store = FrameStore(
            worker_target=frozen_worker,
            worker_args=(self.counter,),
            freeze_timeout=5,
            poll_interval=0.02,
            terminate_timeout=0.2,
        )
        self.store.start()
        wait_until(lambda: self.store.status()["connected"])
        worker_pid = self.store.worker_pid
        self.assertIsNotNone(worker_pid)
        self.store.stop()
        self.assertFalse(self.store.thread.is_alive())
        self.assertIsNone(self.store.worker_pid)
        self.assertFalse(any(child.pid == worker_pid for child in multiprocessing.active_children()))
        self.store = None

    def test_http_status_and_frame_remain_compatible(self):
        self.store = FrameStore(
            worker_target=freeze_then_recover_worker,
            worker_args=(self.counter,),
            freeze_timeout=0.3,
            retry_delay=0.05,
            poll_interval=0.02,
            terminate_timeout=0.2,
        )
        server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.store))
        thread = Thread(target=server.serve_forever, daemon=True)
        self.store.start()
        thread.start()
        try:
            wait_until(lambda: self.store.snapshot()[0] == b"recovered-frame")
            connection = HTTPConnection("127.0.0.1", server.server_port)
            connection.request("GET", "/api/status")
            response = connection.getresponse()
            status = json.loads(response.read())
            self.assertEqual(response.status, 200)
            self.assertTrue(status["connected"])
            self.assertEqual(status["state"], "connected")
            self.assertGreaterEqual(status["restartCount"], 1)
            connection.request("GET", "/api/frame")
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertEqual(response.read(), b"recovered-frame")
            self.assertIsNotNone(response.getheader("X-Frame-Sequence"))
            connection.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
