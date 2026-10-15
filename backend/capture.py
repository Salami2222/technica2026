"""Kinect capture code that runs in a disposable child process."""

from __future__ import annotations

import io
from multiprocessing.connection import Connection

from PIL import Image

from kinect import HEIGHT, WIDTH, KinectRGB


def capture_worker(sender: Connection) -> None:
    camera = None
    try:
        camera = KinectRGB()
        while True:
            rgb = camera.read_rgb()
            image = Image.frombytes("RGB", (WIDTH, HEIGHT), rgb)
            output = io.BytesIO()
            image.save(output, format="JPEG", quality=78)
            sender.send(("frame", output.getvalue()))
    except (OSError, ValueError, RuntimeError) as exc:
        try:
            sender.send(("error", str(exc)))
        except (BrokenPipeError, OSError):
            pass
    finally:
        if camera is not None:
            camera.close()
        sender.close()
