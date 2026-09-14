from __future__ import annotations

import logging
import queue
import tempfile
import time
from pathlib import Path

import cv2

from tracker_core.pipeline import _QUEUE_SENTINEL, process_frame
from .state import get_run

logger = logging.getLogger("tracker_gui.video_feed")

STALL_WARNING_S = 3.0
JPEG_QUALITY = 85
_FRAME_TMP_DIR = Path(tempfile.mkdtemp(prefix="tracker_gui_frames_"))
_FRAME_CYCLE_SIZE = 4


def build_video_input() -> "gr.components.Component":
    import gradio as gr

    return gr.Textbox(
        label="Video source",
        placeholder="Device index (e.g. 0) or a path to a video file",
        value="test.mp4",
    )


def _write_jpeg(frame_bgr, frame_counter: int, quality: int = JPEG_QUALITY) -> str:
    path = _FRAME_TMP_DIR / f"frame_{frame_counter % _FRAME_CYCLE_SIZE}.jpg"
    ok = cv2.imwrite(str(path), frame_bgr, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise RuntimeError(f"cv2.imwrite failed to write {path}")
    return str(path)


def stream_frames(run_id: str):
    run_state = get_run(run_id)
    if run_state is None:
        logger.error("stream_frames: unknown run_id=%r -- nothing to stream", run_id)
        return
    if run_state.detection_queue is None or run_state.spike is None:
        logger.error("[run %s] stream_frames: run has no detection_queue/spike -- did start_run fail?", run_id)
        return

    logger.info("[run %s] stream_frames starting (jpeg quality=%d)", run_id, JPEG_QUALITY)
    frames_yielded = 0
    last_frame_time = time.monotonic()
    encode_time_total = 0.0

    while run_state.running:
        try:
            item = run_state.detection_queue.get(timeout=1.0)
        except queue.Empty:
            waited = time.monotonic() - last_frame_time
            if waited >= STALL_WARNING_S:
                cam_alive = run_state.camera_thread.is_alive() if run_state.camera_thread else None
                det_alive = run_state.detection_thread.is_alive() if run_state.detection_thread else None
                logger.warning(
                    "[run %s] no frame for %.1fs (camera_thread alive=%s, detection_thread alive=%s, "
                    "frame_queue size=%s, detection_queue size=%s)",
                    run_id, waited, cam_alive, det_alive,
                    run_state.frame_queue.qsize() if run_state.frame_queue else "?",
                    run_state.detection_queue.qsize() if run_state.detection_queue else "?",
                )
                last_frame_time = time.monotonic()
            continue
        if item is _QUEUE_SENTINEL:
            logger.info("[run %s] stream_frames: got sentinel (video source exhausted), ending stream", run_id)
            break

        last_frame_time = time.monotonic()
        try:
            annotated, spike = process_frame(
                item,
                run_state.tracker,
                run_state.spike,
                run_state.zones,
                trail_draw_enabled=run_state.cfg.trail_draw_enabled,
            )
        except Exception:
            logger.exception("[run %s] process_frame raised on frame_idx=%s -- stopping stream", run_id, item.frame_idx)
            return

        encode_start = time.perf_counter()
        frame_path = _write_jpeg(annotated, frames_yielded)
        encode_s = time.perf_counter() - encode_start
        encode_time_total += encode_s

        frames_yielded += 1
        if frames_yielded == 1 or frames_yielded % 100 == 0:
            logger.info(
                "[run %s] yielded frame #%d (frame_idx=%s), jpeg encode+write=%.1fms (avg=%.1fms over stream so far)",
                run_id, frames_yielded, item.frame_idx, encode_s * 1000, (encode_time_total / frames_yielded) * 1000,
            )
        yield frame_path, spike

    logger.info("[run %s] stream_frames exiting (running=%s), total yielded=%d", run_id, run_state.running, frames_yielded)
