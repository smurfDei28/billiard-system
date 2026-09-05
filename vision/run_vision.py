#!/usr/bin/env python3
"""Run the camera-assisted scorer with a YOLO checkpoint or JSONL fixture."""

import argparse
import json
import os
import sys
from pathlib import Path
from urllib import error, request

from vision_scoring import (
    BALL_LABELS,
    Detection,
    PocketOccupancyScorer,
    TemporalPocketScorer,
    normalize_label,
)


def post_event(api_url: str, sensor_key: str, table_id: str, session_id: str, event: dict) -> None:
    payload = dict(event, tableId=table_id, sessionId=session_id)
    body = json.dumps(payload).encode("utf-8")
    req = request.Request(
        f"{api_url.rstrip('/')}/api/sensor/pocket",
        data=body,
        headers={"Content-Type": "application/json", "x-sensor-key": sensor_key},
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=5) as response:
            print(json.dumps({"sent": event, "status": response.status}), flush=True)
    except error.URLError as exc:
        print(json.dumps({"sendError": str(exc), "event": event}), file=sys.stderr, flush=True)


def handle_events(scorer, detections, args):
    for event in scorer.process(detections):
        print(json.dumps({"candidate": event}), flush=True)
        # Safety gate: special/ambiguous balls must be confirmed in the staff UI.
        if not event["requiresConfirmation"] and not args.dry_run:
            post_event(args.api_url, args.sensor_key, args.table_id, args.session_id, event)


def run_jsonl(path: Path, scorer: TemporalPocketScorer, args) -> None:
    with path.open("r", encoding="utf-8") as fixture:
        for line in fixture:
            if not line.strip():
                continue
            frame = json.loads(line)
            detections = [Detection(item["label"], item["confidence"], tuple(item["box"])) for item in frame]
            handle_events(scorer, detections, args)


def run_yolo(model_path: str, source: str, scorer: TemporalPocketScorer, args) -> None:
    try:
        from ultralytics import YOLO
    except ImportError as exc:
        raise SystemExit("Install camera dependencies: pip install -r requirements.txt") from exc

    model = YOLO(model_path)
    normalized_names = {normalize_label(name) for name in model.names.values()}
    missing_names = set(BALL_LABELS) - normalized_names
    if missing_names:
        available = ", ".join(str(name) for name in model.names.values())
        missing = ", ".join(sorted(missing_names))
        raise SystemExit(
            f"Model is not scoring-compatible. Classes: [{available}]. "
            f"Missing required classes: [{missing}]."
        )
    parsed_source = int(source) if source.isdigit() else source
    for result in model.predict(
        source=parsed_source,
        stream=True,
        conf=args.model_confidence,
        imgsz=args.image_size,
        verbose=False,
    ):
        height, width = result.orig_shape
        detections = []
        for box in result.boxes:
            class_id = int(box.cls.item())
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            detections.append(Detection(
                str(result.names[class_id]),
                float(box.conf.item()),
                (x1 / width, y1 / height, x2 / width, y2 / height),
            ))
        handle_events(scorer, detections, args)


def run_rfdetr(model_path: str, source: str, scorer: TemporalPocketScorer, args) -> None:
    try:
        import cv2
        from rfdetr import RFDETRBase
    except ImportError as exc:
        raise SystemExit("Install RF-DETR dependencies: pip install -r requirements-rfdetr.txt") from exc

    model = RFDETRBase(pretrain_weights=model_path)
    capture = cv2.VideoCapture(int(source) if source.isdigit() else source)
    try:
        while capture.isOpened():
            success, frame = capture.read()
            if not success:
                break
            height, width = frame.shape[:2]
            result = model.predict(frame[:, :, ::-1], threshold=args.model_confidence, include_source_image=False)
            class_names = result.data.get("class_name") if getattr(result, "data", None) else None
            detections = []
            for index, (box, confidence, class_id) in enumerate(zip(result.xyxy, result.confidence, result.class_id)):
                x1, y1, x2, y2 = [float(value) for value in box]
                label = str(class_names[index]) if class_names is not None else str(model.class_names[int(class_id)])
                detections.append(Detection(
                    label, float(confidence),
                    (x1 / width, y1 / height, x2 / width, y2 / height),
                ))
            handle_events(scorer, detections, args)
    finally:
        capture.release()


def main() -> None:
    parser = argparse.ArgumentParser(description="Saturday Nights camera-assisted scoring")
    parser.add_argument("--provider", choices=("yolo", "rfdetr", "jsonl"), default="yolo")
    parser.add_argument("--model", help="YOLO or RF-DETR checkpoint")
    parser.add_argument("--source", default="0", help="Webcam index, video path, stream URL, or JSONL path")
    parser.add_argument("--model-confidence", type=float, default=0.35)
    parser.add_argument("--image-size", type=int, default=960,
                        help="YOLO inference size; use the checkpoint validation size")
    parser.add_argument("--scoring-mode", choices=("pocket-occupancy", "disappearance"),
                        default="pocket-occupancy",
                        help="Pocket occupancy is calibrated for the supplied overhead videos")
    parser.add_argument("--dry-run", action="store_true", help="Print events without sending them")
    parser.add_argument("--api-url", default=os.getenv("API_BASE_URL", "http://localhost:3000"))
    parser.add_argument("--sensor-key", default=os.getenv("SENSOR_API_KEY", ""))
    parser.add_argument("--table-id", default=os.getenv("TABLE_ID", ""))
    parser.add_argument("--session-id", default=os.getenv("SESSION_ID", ""))
    args = parser.parse_args()

    if not args.dry_run and not all((args.sensor_key, args.table_id, args.session_id)):
        parser.error("SENSOR_API_KEY, TABLE_ID, and SESSION_ID are required unless --dry-run is used")
    if args.provider in {"yolo", "rfdetr"} and not args.model:
        parser.error("--model is required for a model provider")

    scorer = PocketOccupancyScorer() if args.scoring_mode == "pocket-occupancy" else TemporalPocketScorer()
    if args.provider == "jsonl":
        run_jsonl(Path(args.source), scorer, args)
    elif args.provider == "yolo":
        run_yolo(args.model, args.source, scorer, args)
    else:
        run_rfdetr(args.model, args.source, scorer, args)


if __name__ == "__main__":
    main()
