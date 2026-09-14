from __future__ import annotations

import logging

import gradio as gr

from tracker_core.config import Config
from tracker_core.ibhms import build_ibhms_sink_from_env
from tracker_core.scoring import SCORED_CLASSES
from .controls import build_config_tabs
from .score_panel import build_score_panel, render_score
from .state import lock_in, start_run, stop_run
from .video_feed import build_video_input, stream_frames

logger = logging.getLogger("tracker_gui.app")


def _collect_config(values: dict) -> Config:
    return Config(
        model_b_path=values["model_b_path"],
        pockets_path=values["pockets_path"],
        conf=values["conf"],
        iou=values["iou"],
        start_frame=int(values["start_frame"] or 0),
        capture_width=int(values["capture_width"]) if values["capture_width"] else None,
        capture_height=int(values["capture_height"]) if values["capture_height"] else None,
        max_frames=int(values["max_frames"]) if values["max_frames"] else None,
        unresolved_ceiling_frames=int(values["unresolved_ceiling_frames"]),
        reappear_radius_px=values["reappear_radius_px"],
        class_lock_stability_frames=int(values["class_lock_stability_frames"]),
        convergence_window_frames=int(values["convergence_window_frames"]),
        convergence_min_net_px=values["convergence_min_net_px"],
        convergence_noise_tolerance_px=values["convergence_noise_tolerance_px"],
        convergence_min_trail_frames=int(values["convergence_min_trail_frames"]),
        cbiou_min_iou_first=values["cbiou_min_iou_first"],
        cbiou_min_iou_second=values["cbiou_min_iou_second"],
        cbiou_min_iou_unconfirmed=values["cbiou_min_iou_unconfirmed"],
        cbiou_buffer_ratio_first=values["cbiou_buffer_ratio_first"],
        cbiou_buffer_ratio_second=values["cbiou_buffer_ratio_second"],
        min_consecutive_frames=int(values["min_consecutive_frames"]),
        batch_size=int(values["batch_size"]) if values["batch_size"] else None,
        batch_timeout_s=values["batch_timeout_s"] if values["batch_timeout_s"] else None,
        trail_draw_length=int(values["trail_draw_length"]),
        trail_draw_enabled=bool(values["trail_draw_enabled"]),
        write_pot_events_csv=bool(values["write_pot_events_csv"]),
        device=values["device"],
    )


def build_app() -> gr.Blocks:
    with gr.Blocks(title="Pool Scoring") as demo:
        run_id_state = gr.State(None)

        with gr.Row():
            with gr.Column(scale=1):
                controls = build_config_tabs()
            with gr.Column(scale=2):
                video_output = gr.Image(label="Annotated feed", streaming=True, type="filepath")
                video_input = build_video_input()
                start_btn = gr.Button("Start", variant="primary")
                score_controls = build_score_panel()

        score_controls["lock_in_btn"].interactive = False
        score_controls["stop_btn"].interactive = False

        def _on_start(video_source_path, *control_values):
            values = dict(zip(controls.keys(), control_values))
            cfg = _collect_config(values)
            source = video_source_path.strip() if video_source_path and video_source_path.strip() else "0"
            event_sink = None
            try:
                event_sink = build_ibhms_sink_from_env()
                run_id = start_run(cfg, source, event_sink=event_sink)
            except Exception as exc:
                if event_sink is not None:
                    event_sink.close()
                logger.exception("start_run failed")
                gr.Warning(f"Failed to start: {exc}")
                return None, gr.update(interactive=True), gr.update(interactive=False), gr.update(interactive=False)
            return run_id, gr.update(interactive=False), gr.update(interactive=True), gr.update(interactive=True)

        start_click = start_btn.click(
            fn=_on_start,
            inputs=[video_input, *controls.values()],
            outputs=[run_id_state, start_btn, score_controls["lock_in_btn"], score_controls["stop_btn"]],
        )

        def _drive_stream(run_id):
            if not run_id:
                return
            for annotated_rgb, spike in stream_frames(run_id):
                status, counters, total = render_score(spike)
                yield annotated_rgb, status, counters, total

        start_click.then(
            fn=_drive_stream,
            inputs=[run_id_state],
            outputs=[
                video_output,
                score_controls["lock_status"],
                score_controls["counters_display"],
                score_controls["total_display"],
            ],
            concurrency_limit=1,
            concurrency_id="vision-stream",
        )

        def _on_lock_in(run_id):
            if not run_id:
                return "NO ACTIVE RUN", {cls: 0 for cls in SCORED_CLASSES}, 0
            spike = lock_in(run_id)
            if spike is None:
                return "NO ACTIVE RUN", {cls: 0 for cls in SCORED_CLASSES}, 0
            return render_score(spike)

        score_controls["lock_in_btn"].click(
            fn=_on_lock_in,
            inputs=[run_id_state],
            outputs=[
                score_controls["lock_status"],
                score_controls["counters_display"],
                score_controls["total_display"],
            ],
            concurrency_limit=None,
            concurrency_id="vision-controls",
        )

        def _on_stop(run_id):
            if not run_id:
                return None, gr.update(interactive=True), gr.update(interactive=False), gr.update(interactive=False)
            stop_run(run_id)
            return None, gr.update(interactive=True), gr.update(interactive=False), gr.update(interactive=False)

        score_controls["stop_btn"].click(
            fn=_on_stop,
            inputs=[run_id_state],
            outputs=[run_id_state, start_btn, score_controls["lock_in_btn"], score_controls["stop_btn"]],
            concurrency_limit=None,
            concurrency_id="vision-controls",
        )

    return demo


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    logger.info("Starting pool-scoring GUI")
    demo = build_app()
    demo.launch()


if __name__ == "__main__":
    main()
