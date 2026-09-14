from __future__ import annotations

import logging
import queue
import threading
import time
from dataclasses import dataclass

import cv2
import numpy as np
import supervision as sv

from .config import Config
from .detectors import YoloDetector
from .geometry import _filter_detections_excluding_pocketed
from .scoring import ScoringSpike

logger = logging.getLogger("tracker_core.pipeline")

_QUEUE_SENTINEL = object()


@dataclass
class FrameItem:
    frame_idx: int
    frame_bgr: np.ndarray
    capture_time: float


@dataclass
class DetectionItem:
    frame_idx: int
    frame_bgr: np.ndarray
    detections_b: sv.Detections
    class_names_b: dict
    capture_time: float
    detection_done_time: float


class CameraThread(threading.Thread):

    def __init__(
        self,
        cap: cv2.VideoCapture,
        output_queue: "queue.Queue[FrameItem | object]",
        source_is_live: bool,
        max_frames: int | None = None,
    ) -> None:
        super().__init__(daemon=True, name="CameraThread")
        self._cap = cap
        self._output_queue = output_queue
        self._source_is_live = source_is_live
        self._max_frames = max_frames
        self._stop_event = threading.Event()
        self.frames_captured = 0
        self.frames_dropped = 0

    def stop(self) -> None:
        self._stop_event.set()

    def run(self) -> None:
        logger.info("CameraThread starting (source_is_live=%s)", self._source_is_live)
        frame_idx = 0
        try:
            while not self._stop_event.is_set():
                ok, frame_bgr = self._cap.read()
                if not ok:
                    logger.info("CameraThread: source exhausted or read failed at frame %d, stopping", frame_idx)
                    break
                frame_idx += 1
                self.frames_captured += 1
                item = FrameItem(frame_idx=frame_idx, frame_bgr=frame_bgr, capture_time=time.perf_counter())

                if self._source_is_live:
                    while not self._stop_event.is_set():
                        try:
                            self._output_queue.put_nowait(item)
                            break
                        except queue.Full:
                            try:
                                self._output_queue.get_nowait()
                                self.frames_dropped += 1
                            except queue.Empty:
                                pass
                else:
                    while not self._stop_event.is_set():
                        try:
                            self._output_queue.put(item, timeout=0.1)
                            break
                        except queue.Full:
                            continue
                if self._max_frames is not None and self.frames_captured >= self._max_frames:
                    logger.info("CameraThread reached max_frames=%d", self._max_frames)
                    break
        except Exception:
            logger.exception("CameraThread crashed after capturing %d frame(s)", self.frames_captured)
        finally:
            logger.info(
                "CameraThread exiting (captured=%d, dropped=%d)",
                self.frames_captured, self.frames_dropped,
            )
            while True:
                try:
                    self._output_queue.put_nowait(_QUEUE_SENTINEL)
                    break
                except queue.Full:
                    try:
                        self._output_queue.get_nowait()
                    except queue.Empty:
                        pass


class DetectionThread(threading.Thread):

    def __init__(
        self,
        detector_b: YoloDetector,
        input_queue: "queue.Queue[FrameItem | object]",
        output_queue: "queue.Queue[DetectionItem | object]",
        batch_size: int,
        batch_timeout_s: float,
    ) -> None:
        super().__init__(daemon=True, name="DetectionThread")
        self._detector_b = detector_b
        self._input_queue = input_queue
        self._output_queue = output_queue
        self._batch_size = max(1, batch_size)
        self._batch_timeout_s = batch_timeout_s
        self._stop_event = threading.Event()
        self.batch_sizes_seen: list[int] = []

    def stop(self) -> None:
        self._stop_event.set()
        while True:
            try:
                self._input_queue.put_nowait(_QUEUE_SENTINEL)
                return
            except queue.Full:
                try:
                    self._input_queue.get_nowait()
                except queue.Empty:
                    return

    def _collect_batch(self) -> list[FrameItem] | None:
        if self._stop_event.is_set():
            return None
        first = self._input_queue.get()
        if first is _QUEUE_SENTINEL:
            return None
        batch = [first]
        deadline = time.perf_counter() + self._batch_timeout_s
        while len(batch) < self._batch_size:
            remaining = deadline - time.perf_counter()
            if remaining <= 0:
                break
            try:
                item = self._input_queue.get(timeout=remaining)
            except queue.Empty:
                break
            if item is _QUEUE_SENTINEL:
                self._input_queue.put(_QUEUE_SENTINEL)
                break
            batch.append(item)
        return batch

    def run(self) -> None:
        logger.info("DetectionThread starting (batch_size=%d, batch_timeout_s=%.3f)", self._batch_size, self._batch_timeout_s)
        batch_num = 0
        try:
            while True:
                batch = self._collect_batch()
                if batch is None:
                    logger.info("DetectionThread: got sentinel, stopping after %d batch(es)", batch_num)
                    break
                batch_num += 1
                self.batch_sizes_seen.append(len(batch))
                if len(self.batch_sizes_seen) > 200:
                    self.batch_sizes_seen = self.batch_sizes_seen[-200:]

                frames = [item.frame_bgr for item in batch]
                infer_start = time.perf_counter()
                results_b = self._detector_b.detect_batch(frames)
                infer_s = time.perf_counter() - infer_start

                if self._stop_event.is_set():
                    logger.info("DetectionThread: stop requested during inference")
                    break

                logger.info(
                    "DetectionThread: batch #%d size=%d inference=%.3fs (%.3fs/frame)",
                    batch_num, len(batch), infer_s, infer_s / max(1, len(batch)),
                )

                done_time = time.perf_counter()
                for item, (det_b, names_b) in zip(batch, results_b):
                    self._output_queue.put(DetectionItem(
                        frame_idx=item.frame_idx,
                        frame_bgr=item.frame_bgr,
                        detections_b=det_b,
                        class_names_b=names_b,
                        capture_time=item.capture_time,
                        detection_done_time=done_time,
                    ))
        except Exception:
            logger.exception("DetectionThread crashed after %d batch(es)", batch_num)
        finally:
            logger.info("DetectionThread exiting (avg batch size=%.1f over %d batches)", self.average_batch_size(), batch_num)
            self._output_queue.put(_QUEUE_SENTINEL)

    def average_batch_size(self) -> float:
        if not self.batch_sizes_seen:
            return 0.0
        return sum(self.batch_sizes_seen) / len(self.batch_sizes_seen)


def process_frame(
    item: DetectionItem,
    tracker,
    spike: ScoringSpike,
    zones: dict,
    trail_draw_enabled: bool = True,
) -> tuple[np.ndarray, ScoringSpike]:
    frame_bgr = item.frame_bgr
    detections_b, class_names_b = item.detections_b, item.class_names_b

    filtered = _filter_detections_excluding_pocketed(detections_b, zones)
    tracked = tracker.update(filtered)

    if spike.locked:
        spike.update(tracked, class_names_b, filtered)
    else:
        spike.frame_idx += 1

    box_annotator = sv.BoxAnnotator()
    label_annotator = sv.LabelAnnotator()
    annotated = box_annotator.annotate(frame_bgr.copy(), tracked)
    labels = [f"#{tid}" if tid is not None and tid >= 0 else "?" for tid in tracked.tracker_id] if len(tracked) else []
    if labels:
        annotated = label_annotator.annotate(annotated, tracked, labels=labels)

    annotated = spike.draw_overlay(annotated, trail_draw_enabled=trail_draw_enabled)

    return annotated, spike
