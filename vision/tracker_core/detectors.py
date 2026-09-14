from __future__ import annotations

import numpy as np
import supervision as sv


class YoloDetector:

    def __init__(self, model_path: str, conf: float, iou: float, device: str = "cpu") -> None:
        self._conf = conf
        self._iou = iou
        self._device = device

        from ultralytics import YOLO

        self._model = YOLO(model_path)
        if device == "gpu":
            import torch
            if not torch.cuda.is_available():
                raise RuntimeError("GPU was selected, but CUDA is not available. Select CPU instead.")
            self._model.to("cuda")
        else:
            self._model.to("cpu")
        self._backend = "pt"

    @property
    def backend(self) -> str:
        return self._backend

    def detect(self, frame_bgr: np.ndarray) -> tuple[sv.Detections, dict]:
        results = self._model.predict(frame_bgr, conf=self._conf, iou=self._iou, verbose=False)
        result = results[0]
        return sv.Detections.from_ultralytics(result), self._model.names

    def detect_batch(self, frames_bgr: list[np.ndarray]) -> list[tuple[sv.Detections, dict]]:
        if not frames_bgr:
            return []
        results = self._model.predict(frames_bgr, conf=self._conf, iou=self._iou, verbose=False)
        return [(sv.Detections.from_ultralytics(r), self._model.names) for r in results]
