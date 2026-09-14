from __future__ import annotations

import csv
from pathlib import Path

from .config import DEFAULT_OUTPUT_DIR
from .events import PotEvent

FIELDNAMES = [
    "frame", "track_id", "outcome", "pocket_label", "locked_class",
    "class_at_confirmation", "class_history",
]


def write_pot_events_csv(
    events: list[PotEvent],
    counters: dict[str, int],
    total_pocketed: int,
    outdir: Path | None = None,
) -> Path:
    outdir = outdir or DEFAULT_OUTPUT_DIR
    outdir.mkdir(parents=True, exist_ok=True)

    events_path = outdir / "pot_events.csv"
    with open(events_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        for e in events:
            writer.writerow(e.as_dict())
        writer.writerow({
            "frame": "SUMMARY", "track_id": "", "outcome": "",
            "pocket_label": "", "locked_class": "",
            "class_at_confirmation": "",
            "class_history": f"counters={counters} total={total_pocketed}",
        })
    return events_path
