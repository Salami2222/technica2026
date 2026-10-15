"""Small ctypes adapter for Homebrew's libfreenect sync RGB API."""

from __future__ import annotations

import ctypes
import ctypes.util
from pathlib import Path

WIDTH = 640
HEIGHT = 480
RGB_BYTES = WIDTH * HEIGHT * 3
FREENECT_VIDEO_RGB = 0


class KinectError(RuntimeError):
    pass


class KinectRGB:
    def __init__(self, device_index: int = 0):
        self.device_index = device_index
        candidates = [
            ctypes.util.find_library("freenect_sync"),
            "/opt/homebrew/opt/libfreenect/lib/libfreenect_sync.dylib",
            "/usr/local/opt/libfreenect/lib/libfreenect_sync.dylib",
        ]
        self.library = None
        for candidate in candidates:
            if candidate and (not candidate.startswith("/") or Path(candidate).exists()):
                try:
                    self.library = ctypes.CDLL(candidate)
                    break
                except OSError:
                    continue
        if self.library is None:
            raise KinectError("libfreenect_sync was not found. Install libfreenect with Homebrew and check its library path.")

        self.library.freenect_sync_get_video.argtypes = [
            ctypes.POINTER(ctypes.c_void_p),
            ctypes.POINTER(ctypes.c_uint32),
            ctypes.c_int,
            ctypes.c_int,
        ]
        self.library.freenect_sync_get_video.restype = ctypes.c_int
        self.library.freenect_sync_stop.argtypes = []
        self.library.freenect_sync_stop.restype = None
        self._check_device()

    def _check_device(self) -> None:
        # The sync capture call can wait indefinitely with no camera attached.
        # Check the base library first so the UI can report this condition.
        base_name = ctypes.util.find_library("freenect")
        if not base_name:
            raise KinectError("libfreenect was not found. Check the Homebrew installation.")
        base = ctypes.CDLL(base_name)
        base.freenect_init.argtypes = [ctypes.POINTER(ctypes.c_void_p), ctypes.c_void_p]
        base.freenect_init.restype = ctypes.c_int
        base.freenect_num_devices.argtypes = [ctypes.c_void_p]
        base.freenect_num_devices.restype = ctypes.c_int
        base.freenect_shutdown.argtypes = [ctypes.c_void_p]
        base.freenect_shutdown.restype = ctypes.c_int
        context = ctypes.c_void_p()
        if base.freenect_init(ctypes.byref(context), None) != 0:
            raise KinectError("Could not initialize libfreenect. Check USB permissions and reconnect the Kinect.")
        try:
            count = base.freenect_num_devices(context)
        finally:
            base.freenect_shutdown(context)
        if count <= self.device_index:
            raise KinectError("No Xbox 360 Kinect V1 detected. Check its power supply and USB connection.")

    def read_rgb(self) -> bytes:
        frame = ctypes.c_void_p()
        timestamp = ctypes.c_uint32()
        result = self.library.freenect_sync_get_video(
            ctypes.byref(frame), ctypes.byref(timestamp), self.device_index, FREENECT_VIDEO_RGB
        )
        if result != 0 or not frame.value:
            raise KinectError(
                "Kinect RGB capture failed. Check USB and power, close freenect-glview or any other Kinect app, then retry."
            )
        # The sync library owns this buffer and may reuse it on the next call.
        return ctypes.string_at(frame, RGB_BYTES)

    def close(self) -> None:
        self.library.freenect_sync_stop()
