from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

DEFAULT_CLASS_LOCK_STABILITY_FRAMES = 8
DEFAULT_UNRESOLVED_CEILING_FRAMES = 90
DEFAULT_REAPPEAR_RADIUS_PX = 60.0
DEFAULT_CONVERGENCE_WINDOW_FRAMES = 5
DEFAULT_CONVERGENCE_MIN_NET_PX = 20.0
DEFAULT_CONVERGENCE_NOISE_TOLERANCE_PX = 1.0
DEFAULT_CONVERGENCE_MIN_TRAIL_FRAMES = DEFAULT_CONVERGENCE_WINDOW_FRAMES + 1
TRAIL_LENGTH = 30
DEFAULT_CBIOU_MIN_IOU_FIRST = 0.01
DEFAULT_CBIOU_MIN_IOU_SECOND = 0.5
DEFAULT_CBIOU_MIN_IOU_UNCONFIRMED = 0.3
DEFAULT_CBIOU_BUFFER_RATIO_FIRST = 0.3
DEFAULT_CBIOU_BUFFER_RATIO_SECOND = 0.4
DEFAULT_LOST_TRACK_BUFFER = 30
DEFAULT_FRAME_RATE = 30.0
DEFAULT_MIN_CONSECUTIVE_FRAMES = 3
DEFAULT_HIGH_CONF_DET_THRESHOLD = 0.6
DEFAULT_LIVE_BATCH_SIZE = 4
DEFAULT_LIVE_BATCH_TIMEOUT_S = 0.05
DEFAULT_FILE_BATCH_SIZE = 4
DEFAULT_FILE_BATCH_TIMEOUT_S = 1.0
DEFAULT_OUTPUT_DIR = Path("./pool_scoring_out")
MODEL_B_PATH = "models/yolo26l@960.pt"
POCKETS_PATH = "pockets.groupmate.json"


@dataclass
class Config:
    # --- Core ---
    model_b_path: str = MODEL_B_PATH
    pockets_path: str = POCKETS_PATH
    conf: float = 0.45
    iou: float = 0.45
    start_frame: int = 0
    capture_width: int | None = None
    capture_height: int | None = None
    max_frames: int | None = None

    # --- Scoring ---
    unresolved_ceiling_frames: int = DEFAULT_UNRESOLVED_CEILING_FRAMES
    reappear_radius_px: float = DEFAULT_REAPPEAR_RADIUS_PX
    class_lock_stability_frames: int = DEFAULT_CLASS_LOCK_STABILITY_FRAMES

    # --- Convergence ---
    convergence_window_frames: int = DEFAULT_CONVERGENCE_WINDOW_FRAMES
    convergence_min_net_px: float = DEFAULT_CONVERGENCE_MIN_NET_PX
    convergence_noise_tolerance_px: float = DEFAULT_CONVERGENCE_NOISE_TOLERANCE_PX
    convergence_min_trail_frames: int = DEFAULT_CONVERGENCE_MIN_TRAIL_FRAMES

    # --- Tracker (C-BIoU only) ---
    cbiou_min_iou_first: float = DEFAULT_CBIOU_MIN_IOU_FIRST
    cbiou_min_iou_second: float = DEFAULT_CBIOU_MIN_IOU_SECOND
    cbiou_min_iou_unconfirmed: float = DEFAULT_CBIOU_MIN_IOU_UNCONFIRMED
    cbiou_buffer_ratio_first: float = DEFAULT_CBIOU_BUFFER_RATIO_FIRST
    cbiou_buffer_ratio_second: float = DEFAULT_CBIOU_BUFFER_RATIO_SECOND
    min_consecutive_frames: int = DEFAULT_MIN_CONSECUTIVE_FRAMES
    lost_track_buffer: int = DEFAULT_LOST_TRACK_BUFFER
    frame_rate: float = DEFAULT_FRAME_RATE
    high_conf_det_threshold: float = DEFAULT_HIGH_CONF_DET_THRESHOLD

    # --- Performance ---
    batch_size: int | None = None
    batch_timeout_s: float | None = None
    trail_draw_length: int = TRAIL_LENGTH
    trail_draw_enabled: bool = True
    write_pot_events_csv: bool = False

    # --- Device --
    device: str = "gpu"


def resolve_batch_params(
    batch_size: int | None, batch_timeout_s: float | None, source_is_live: bool
) -> tuple[int, float]:
    if batch_size is None:
        batch_size = DEFAULT_LIVE_BATCH_SIZE if source_is_live else DEFAULT_FILE_BATCH_SIZE
    if batch_timeout_s is None:
        batch_timeout_s = DEFAULT_LIVE_BATCH_TIMEOUT_S if source_is_live else DEFAULT_FILE_BATCH_TIMEOUT_S
    return batch_size, batch_timeout_s
