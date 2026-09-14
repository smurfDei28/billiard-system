from __future__ import annotations

from typing import Iterable

import cv2
import numpy as np


def draw_trails(frame: np.ndarray, track_states: Iterable) -> np.ndarray:
    out = frame
    for state in track_states:
        points = list(state.trail)
        if len(points) < 2:
            continue
        n = len(points)
        for i in range(1, n):
            brightness = int(255 * (i / n))
            color = (0, brightness, brightness)
            p1 = tuple(np.round(points[i - 1]).astype(int))
            p2 = tuple(np.round(points[i]).astype(int))
            cv2.line(out, p1, p2, color, thickness=2)
    return out
