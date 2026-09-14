import queue
import unittest

import numpy as np

from tracker_core.pipeline import CameraThread


class FakeCapture:
    def read(self):
        return True, np.zeros((4, 4, 3), dtype=np.uint8)


class CameraThreadTests(unittest.TestCase):
    def test_file_capture_can_stop_when_output_queue_is_full(self):
        output = queue.Queue(maxsize=1)
        output.put(object())
        camera = CameraThread(FakeCapture(), output, source_is_live=False)

        camera.start()
        camera.stop()
        camera.join(timeout=1.0)

        self.assertFalse(camera.is_alive())

    def test_file_capture_honors_max_frames(self):
        output = queue.Queue(maxsize=8)
        camera = CameraThread(FakeCapture(), output, source_is_live=False, max_frames=3)

        camera.start()
        camera.join(timeout=1.0)

        self.assertFalse(camera.is_alive())
        self.assertEqual(camera.frames_captured, 3)


if __name__ == "__main__":
    unittest.main()
