from __future__ import annotations

from .config import Config


def build_tracker(cfg: Config):
    from trackers import CBIoUTracker

    return CBIoUTracker(
        lost_track_buffer=cfg.lost_track_buffer,
        frame_rate=cfg.frame_rate,
        minimum_consecutive_frames=cfg.min_consecutive_frames,
        minimum_iou_threshold_first_assoc=cfg.cbiou_min_iou_first,
        minimum_iou_threshold_second_assoc=cfg.cbiou_min_iou_second,
        minimum_iou_threshold_unconfirmed_assoc=cfg.cbiou_min_iou_unconfirmed,
        high_conf_det_threshold=cfg.high_conf_det_threshold,
        buffer_ratio_first=cfg.cbiou_buffer_ratio_first,
        buffer_ratio_second=cfg.cbiou_buffer_ratio_second,
    )
