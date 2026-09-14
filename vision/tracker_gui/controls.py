from __future__ import annotations

import gradio as gr

from tracker_core import config as core_config


def build_core_tab() -> dict[str, gr.components.Component]:
    with gr.Tab("Core"):
        model_b_path = gr.Textbox(label="Model B weights path", value=core_config.MODEL_B_PATH)
        pockets_path = gr.Textbox(label="Pockets JSON path", value=core_config.POCKETS_PATH)
        conf = gr.Slider(0.0, 1.0, value=0.45, step=0.01, label="Detection confidence threshold (conf)")
        iou = gr.Slider(0.0, 1.0, value=0.45, step=0.01, label="Detection NMS IoU threshold (iou)")
        start_frame = gr.Number(value=0, precision=0, label="Start frame")
        capture_width = gr.Number(value=None, precision=0, label="Capture width (optional)")
        capture_height = gr.Number(value=None, precision=0, label="Capture height (optional)")
        max_frames = gr.Number(value=None, precision=0, label="Max frames (optional)")
        device = gr.Radio(choices=["cpu", "gpu"], value="gpu", label="Device")
    return {
        "model_b_path": model_b_path,
        "pockets_path": pockets_path,
        "conf": conf,
        "iou": iou,
        "start_frame": start_frame,
        "capture_width": capture_width,
        "capture_height": capture_height,
        "max_frames": max_frames,
        "device": device,
    }


def build_scoring_tab() -> dict[str, gr.components.Component]:
    with gr.Tab("Scoring"):
        unresolved_ceiling_frames = gr.Number(
            value=core_config.DEFAULT_UNRESOLVED_CEILING_FRAMES, precision=0,
            label="Unresolved ceiling (frames)",
        )
        reappear_radius_px = gr.Number(
            value=core_config.DEFAULT_REAPPEAR_RADIUS_PX, label="Reappear radius (px)",
        )
        class_lock_stability_frames = gr.Number(
            value=core_config.DEFAULT_CLASS_LOCK_STABILITY_FRAMES, precision=0,
            label="Class-lock stability (frames)",
        )
    return {
        "unresolved_ceiling_frames": unresolved_ceiling_frames,
        "reappear_radius_px": reappear_radius_px,
        "class_lock_stability_frames": class_lock_stability_frames,
    }


def build_convergence_tab() -> dict[str, gr.components.Component]:
    with gr.Tab("Convergence"):
        convergence_window_frames = gr.Number(
            value=core_config.DEFAULT_CONVERGENCE_WINDOW_FRAMES, precision=0,
            label="Window (frames)",
        )
        convergence_min_net_px = gr.Number(
            value=core_config.DEFAULT_CONVERGENCE_MIN_NET_PX, label="Min net convergence (px)",
        )
        convergence_noise_tolerance_px = gr.Number(
            value=core_config.DEFAULT_CONVERGENCE_NOISE_TOLERANCE_PX, label="Noise tolerance (px)",
        )
        convergence_min_trail_frames = gr.Number(
            value=core_config.DEFAULT_CONVERGENCE_MIN_TRAIL_FRAMES, precision=0,
            label="Min trail history (frames)",
        )
    return {
        "convergence_window_frames": convergence_window_frames,
        "convergence_min_net_px": convergence_min_net_px,
        "convergence_noise_tolerance_px": convergence_noise_tolerance_px,
        "convergence_min_trail_frames": convergence_min_trail_frames,
    }


def build_tracker_tab() -> dict[str, gr.components.Component]:
    with gr.Tab("Tracker"):
        gr.Markdown("C-BIoU only — no other tracker is selectable.")
        cbiou_min_iou_first = gr.Slider(0.0, 1.0, value=core_config.DEFAULT_CBIOU_MIN_IOU_FIRST, step=0.01, label="Min IoU (first assoc)")
        cbiou_min_iou_second = gr.Slider(0.0, 1.0, value=core_config.DEFAULT_CBIOU_MIN_IOU_SECOND, step=0.01, label="Min IoU (second assoc)")
        cbiou_min_iou_unconfirmed = gr.Slider(0.0, 1.0, value=core_config.DEFAULT_CBIOU_MIN_IOU_UNCONFIRMED, step=0.01, label="Min IoU (unconfirmed assoc)")
        cbiou_buffer_ratio_first = gr.Slider(0.0, 2.0, value=core_config.DEFAULT_CBIOU_BUFFER_RATIO_FIRST, step=0.05, label="Buffer ratio (first cascade)")
        cbiou_buffer_ratio_second = gr.Slider(0.0, 2.0, value=core_config.DEFAULT_CBIOU_BUFFER_RATIO_SECOND, step=0.05, label="Buffer ratio (second cascade)")
        min_consecutive_frames = gr.Number(value=core_config.DEFAULT_MIN_CONSECUTIVE_FRAMES, precision=0, label="Min consecutive frames")
    return {
        "cbiou_min_iou_first": cbiou_min_iou_first,
        "cbiou_min_iou_second": cbiou_min_iou_second,
        "cbiou_min_iou_unconfirmed": cbiou_min_iou_unconfirmed,
        "cbiou_buffer_ratio_first": cbiou_buffer_ratio_first,
        "cbiou_buffer_ratio_second": cbiou_buffer_ratio_second,
        "min_consecutive_frames": min_consecutive_frames,
    }


def build_performance_tab() -> dict[str, gr.components.Component]:
    with gr.Tab("Performance"):
        batch_size = gr.Number(value=None, precision=0, label="Batch size (blank = auto)")
        batch_timeout_s = gr.Number(value=None, label="Batch timeout, s (blank = auto)")
        trail_draw_length = gr.Number(value=core_config.TRAIL_LENGTH, precision=0, label="Trail draw length")
        trail_draw_enabled = gr.Checkbox(value=True, label="Draw tracker trail overlay")
        write_pot_events_csv = gr.Checkbox(value=False, label="Write pot_events.csv")
    return {
        "batch_size": batch_size,
        "batch_timeout_s": batch_timeout_s,
        "trail_draw_length": trail_draw_length,
        "trail_draw_enabled": trail_draw_enabled,
        "write_pot_events_csv": write_pot_events_csv,
    }


def build_config_tabs() -> dict[str, gr.components.Component]:
    controls: dict[str, gr.components.Component] = {}
    controls.update(build_core_tab())
    controls.update(build_scoring_tab())
    controls.update(build_convergence_tab())
    controls.update(build_tracker_tab())
    controls.update(build_performance_tab())
    return controls
