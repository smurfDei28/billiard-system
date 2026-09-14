from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
import supervision as sv

POCKET_OVERLAP_EXCLUDE_FRACTION = 0.5
POCKET_FALLBACK_DISTANCE_PX = 55.0


def _box_overlap_fraction_with_zone(box_xyxy: np.ndarray, zone: sv.PolygonZone) -> float:
    x1, y1, x2, y2 = box_xyxy
    box_area = max(1.0, (x2 - x1) * (y2 - y1))

    x1i, y1i = int(np.floor(x1)), int(np.floor(y1))
    x2i, y2i = int(np.ceil(x2)), int(np.ceil(y2))

    mask_h, mask_w = zone.mask.shape
    x1c, x2c = np.clip([x1i, x2i], 0, mask_w)
    y1c, y2c = np.clip([y1i, y2i], 0, mask_h)

    if x2c <= x1c or y2c <= y1c:
        return 0.0

    overlap_pixels = int(np.sum(zone.mask[y1c:y2c, x1c:x2c]))
    return overlap_pixels / box_area


def _mostly_pocketed_label(box_xyxy: np.ndarray, zones: dict[str, sv.PolygonZone]) -> str | None:
    for label, zone in zones.items():
        if _box_overlap_fraction_with_zone(box_xyxy, zone) >= POCKET_OVERLAP_EXCLUDE_FRACTION:
            return label
    return None


def _is_mostly_pocketed(box_xyxy: np.ndarray, zones: dict[str, sv.PolygonZone]) -> bool:
    return _mostly_pocketed_label(box_xyxy, zones) is not None


def _point_in_zone_label(point: tuple[float, float], zones: dict[str, sv.PolygonZone]) -> str | None:
    for label, zone in zones.items():
        distance = cv2.pointPolygonTest(zone.polygon, point, True)
        if distance >= -POCKET_FALLBACK_DISTANCE_PX:
            return label
    return None


def _nearest_pocket_signed_distance(
    point: tuple[float, float], zones: dict[str, sv.PolygonZone]
) -> tuple[str, float]:
    best_label, best_distance = None, float("-inf")
    for label, zone in zones.items():
        distance = cv2.pointPolygonTest(zone.polygon, point, True)
        if distance > best_distance:
            best_label, best_distance = label, distance
    return best_label, best_distance


def _filter_detections_excluding_pocketed(
    detections: sv.Detections, zones: dict[str, sv.PolygonZone]
) -> sv.Detections:
    if len(detections) == 0:
        return detections
    keep_mask = np.array(
        [not _is_mostly_pocketed(detections.xyxy[i], zones) for i in range(len(detections))]
    )
    return detections[keep_mask]


def _load_pockets(path: str) -> dict[str, sv.PolygonZone]:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(
            f"Pocket calibration file '{p}' not found. Point the GUI's "
            "pockets-JSON field at an existing file."
        )
    with open(p) as f:
        raw = json.load(f)
    zones: dict[str, sv.PolygonZone] = {}
    for label, points in raw.items():
        polygon = np.array(points, dtype=np.int64)
        zones[label] = sv.PolygonZone(polygon=polygon)
    return zones
