from __future__ import annotations

import gradio as gr

from tracker_core.scoring import ScoringSpike, SCORED_CLASSES


def build_score_panel() -> dict[str, gr.components.Component]:
    with gr.Group():
        gr.Markdown("### Score")
        lock_status = gr.Textbox(value="NOT LOCKED", label="Status", interactive=False)
        counters_display = gr.JSON(
            value={cls: 0 for cls in SCORED_CLASSES},
            label="Per-class counters",
        )
        total_display = gr.Number(value=0, label="Total pocketed", interactive=False)
        lock_in_btn = gr.Button("Lock In", variant="primary")
        stop_btn = gr.Button("Stop", variant="stop")
    return {
        "lock_status": lock_status,
        "counters_display": counters_display,
        "total_display": total_display,
        "lock_in_btn": lock_in_btn,
        "stop_btn": stop_btn,
    }


def render_score(spike: ScoringSpike) -> tuple[str, dict, int]:
    status = "LOCKED" if spike.locked else "NOT LOCKED"
    return status, dict(spike.counters), spike.total_pocketed
