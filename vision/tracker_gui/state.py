from __future__ import annotations

import logging
import queue
import threading
import uuid
from dataclasses import dataclass, field

import cv2

from tracker_core.config import Config, resolve_batch_params
from tracker_core.detectors import YoloDetector
from tracker_core.events import ScoringEventSink
from tracker_core.geometry import _load_pockets
from tracker_core.pipeline import CameraThread, DetectionThread
from tracker_core.scoring import ScoringSpike
from tracker_core.trackers import build_tracker

logger = logging.getLogger("tracker_gui.state")


@dataclass
class RunState:
    run_id: str
    cfg: Config | None = None
    zones: dict | None = None
    tracker: object | None = None
    spike: ScoringSpike | None = None
    detector_b: YoloDetector | None = None
    cap: "cv2.VideoCapture | None" = None
    camera_thread: CameraThread | None = None
    detection_thread: DetectionThread | None = None
    frame_queue: "queue.Queue | None" = None
    detection_queue: "queue.Queue | None" = None
    event_sink: ScoringEventSink | None = None
    running: bool = False
    error: str | None = None

_RUNS: dict[str, RunState] = {}
_RUNS_LOCK = threading.Lock()


def get_run(run_id: str | None) -> RunState | None:
    if not run_id:
        return None
    with _RUNS_LOCK:
        return _RUNS.get(run_id)


def start_run(
    cfg: Config,
    source: str,
    event_sink: ScoringEventSink | None = None,
) -> str:
    run_id = uuid.uuid4().hex[:12]
    logger.info("[run %s] starting: source=%r device=%s model=%s", run_id, source, cfg.device, cfg.model_b_path)

    zones = _load_pockets(cfg.pockets_path)
    logger.info("[run %s] loaded %d pocket zone(s): %s", run_id, len(zones), list(zones.keys()))

    detector_b = YoloDetector(cfg.model_b_path, cfg.conf, cfg.iou, device=cfg.device)
    logger.info("[run %s] detector backend resolved: %s", run_id, detector_b.backend)

    tracker = build_tracker(cfg)
    spike = ScoringSpike(cfg, zones, event_sink=event_sink)

    is_device_index = source.isdigit()
    resolved = int(source) if is_device_index else source
    cap = cv2.VideoCapture(resolved)
    if not cap.isOpened():
        logger.error("[run %s] failed to open video source: %r", run_id, source)
        raise RuntimeError(f"Failed to open video source: {source!r}.")
    if cfg.capture_width is not None and cfg.capture_height is not None:
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, cfg.capture_width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, cfg.capture_height)
    if cfg.start_frame > 0 and not is_device_index:
        cap.set(cv2.CAP_PROP_POS_FRAMES, cfg.start_frame)

    source_is_live = is_device_index
    batch_size, batch_timeout_s = resolve_batch_params(cfg.batch_size, cfg.batch_timeout_s, source_is_live)
    logger.info(
        "[run %s] source_is_live=%s batch_size=%d batch_timeout_s=%.3f",
        run_id, source_is_live, batch_size, batch_timeout_s,
    )

    frame_queue: "queue.Queue" = queue.Queue(maxsize=max(batch_size * 2, 4))
    detection_queue: "queue.Queue" = queue.Queue(maxsize=128)

    camera_thread = CameraThread(cap, frame_queue, source_is_live, max_frames=cfg.max_frames)
    detection_thread = DetectionThread(detector_b, frame_queue, detection_queue, batch_size, batch_timeout_s)
    camera_thread.start()
    detection_thread.start()
    logger.info("[run %s] camera + detection threads started", run_id)

    run_state = RunState(
        run_id=run_id,
        cfg=cfg,
        zones=zones,
        tracker=tracker,
        spike=spike,
        detector_b=detector_b,
        cap=cap,
        camera_thread=camera_thread,
        detection_thread=detection_thread,
        frame_queue=frame_queue,
        detection_queue=detection_queue,
        event_sink=event_sink,
        running=True,
    )
    with _RUNS_LOCK:
        _RUNS[run_id] = run_state
    return run_id


def lock_in(run_id: str) -> ScoringSpike | None:
    run_state = get_run(run_id)
    if run_state is None:
        logger.warning("lock_in called with unknown run_id=%r", run_id)
        return None
    if run_state.spike is not None and not run_state.spike.locked:
        run_state.spike.lock_in()
        logger.info("[run %s] locked in -- counters reset, scoring active", run_id)
    else:
        logger.info("[run %s] lock_in called but already locked or no spike", run_id)
    return run_state.spike


def stop_run(run_id: str) -> None:
    run_state = get_run(run_id)
    if run_state is None:
        logger.warning("stop_run called with unknown run_id=%r", run_id)
        return

    logger.info("[run %s] stopping...", run_id)
    run_state.running = False

    if run_state.detection_thread is not None:
        run_state.detection_thread.stop()
    if run_state.camera_thread is not None:
        run_state.camera_thread.stop()
        run_state.camera_thread.join(timeout=5.0)
        if run_state.camera_thread.is_alive():
            logger.warning("[run %s] camera thread did not stop within timeout", run_id)
        else:
            logger.info(
                "[run %s] camera thread stopped (captured=%d dropped=%d)",
                run_id, run_state.camera_thread.frames_captured, run_state.camera_thread.frames_dropped,
            )

    if run_state.detection_thread is not None and run_state.detection_queue is not None:
        def _drain() -> None:
            while True:
                try:
                    run_state.detection_queue.get(timeout=1.0)
                except queue.Empty:
                    continue
                except Exception:
                    return

        drainer = threading.Thread(target=_drain, daemon=True)
        drainer.start()
        detector_timeout = 45.0 if run_state.cfg and run_state.cfg.device == "cpu" else 10.0
        run_state.detection_thread.join(timeout=detector_timeout)
        if run_state.detection_thread.is_alive():
            logger.warning("[run %s] detection thread did not stop within timeout", run_id)
        else:
            logger.info("[run %s] detection thread stopped (avg batch size=%.1f)", run_id, run_state.detection_thread.average_batch_size())

    if run_state.cap is not None:
        run_state.cap.release()

    close_sink = getattr(run_state.event_sink, "close", None)
    if callable(close_sink):
        close_sink()

    if run_state.spike is not None and run_state.cfg is not None and run_state.cfg.write_pot_events_csv:
        from tracker_core.outputs import write_pot_events_csv as _write_csv
        path = _write_csv(run_state.spike.events, run_state.spike.counters, run_state.spike.total_pocketed)
        logger.info("[run %s] wrote %s", run_id, path)

    logger.info(
        "[run %s] stopped. final counters=%s total=%d",
        run_id, run_state.spike.counters if run_state.spike else {}, run_state.spike.total_pocketed if run_state.spike else 0,
    )

    with _RUNS_LOCK:
        _RUNS.pop(run_id, None)
