from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass, field

import cv2
import numpy as np
import supervision as sv

from .config import Config
from .events import PotEvent, ScoringEventSink
from .geometry import (
    _is_mostly_pocketed,
    _mostly_pocketed_label,
    _nearest_pocket_signed_distance,
    _point_in_zone_label,
)

CLASS_HISTORY_LEN = 10
SCORED_CLASSES: tuple[str, ...] = ("solid", "stripe", "eight", "cue")


@dataclass
class TrackState:
    track_id: int
    candidate_class: str | None = None
    class_streak: int = 0
    locked_class: str | None = None
    class_history: deque = field(default_factory=lambda: deque(maxlen=CLASS_HISTORY_LEN))
    last_position: tuple[float, float] | None = None
    last_zone_label: str | None = None
    frames_seen: int = 0
    last_seen_frame: int | None = None
    last_confidence: float | None = None
    trail: deque = field(default_factory=deque)
    trajectory_log: deque = field(default_factory=deque)

    def observe(
        self,
        class_name: str,
        position: tuple[float, float],
        class_lock_stability_frames: int,
        frame_idx: int,
        zones: dict[str, sv.PolygonZone] | None = None,
        confidence: float | None = None,
    ) -> None:
        self.frames_seen += 1
        self.last_position = position
        self.last_seen_frame = frame_idx
        self.last_confidence = confidence
        self.class_history.append(class_name)
        self.trail.append(position)

        if zones is not None:
            label, distance = _nearest_pocket_signed_distance(position, zones)
            self.trajectory_log.append((frame_idx, label, distance))

        if class_name == self.candidate_class:
            self.class_streak += 1
        else:
            self.candidate_class = class_name
            self.class_streak = 1

        if self.locked_class is None and self.class_streak >= class_lock_stability_frames:
            self.locked_class = self.candidate_class

    def trajectory_summary_for_zone(self, zone_label: str, zones: dict[str, sv.PolygonZone]) -> str:
        if zone_label not in zones or not self.trail:
            return "trajectory=n/a"
        zone = zones[zone_label]
        dists = [round(cv2.pointPolygonTest(zone.polygon, pt, True), 1) for pt in self.trail]
        if len(dists) < 2:
            return f"trajectory_dist_to_{zone_label}={dists} (n=1, no trend)"
        deltas = [round(dists[i] - dists[i - 1], 1) for i in range(1, len(dists))]
        trend = "converging" if deltas[-1] > 0 else "diverging" if deltas[-1] < 0 else "flat"
        pts = list(self.trail)
        step_speeds = [
            math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
            for i in range(1, len(pts))
        ]
        avg_speed = sum(step_speeds) / len(step_speeds) if step_speeds else 0.0
        return (
            f"trajectory_dist_to_{zone_label}={dists} deltas={deltas} "
            f"last_trend={trend} avg_px_per_frame={avg_speed:.1f}"
        )

    CONVERGENCE_WINDOW_FRAMES = 5
    CONVERGENCE_MIN_NET_PX = 20.0
    CONVERGENCE_NOISE_TOLERANCE_PX = 1.0
    CONVERGENCE_MIN_TRAIL_FRAMES = CONVERGENCE_WINDOW_FRAMES + 1

    def is_converging_on_zone(
        self,
        zone_label: str,
        zones: dict[str, sv.PolygonZone],
        window_frames: int = CONVERGENCE_WINDOW_FRAMES,
        min_net_px: float = CONVERGENCE_MIN_NET_PX,
        noise_tolerance_px: float = CONVERGENCE_NOISE_TOLERANCE_PX,
        min_trail_frames: int = CONVERGENCE_MIN_TRAIL_FRAMES,
    ) -> tuple[bool, str]:
        if zone_label not in zones:
            return False, "unknown_zone"
        if len(self.trail) < min_trail_frames:
            return False, f"insufficient_history (trail={len(self.trail)} frames, need {min_trail_frames})"

        zone = zones[zone_label]
        pts = list(self.trail)[-window_frames:]
        dists = [cv2.pointPolygonTest(zone.polygon, pt, True) for pt in pts]
        deltas = [dists[i] - dists[i - 1] for i in range(1, len(dists))]

        for d in deltas:
            if d < -noise_tolerance_px:
                return False, f"not_monotonic (a step moved {d:.1f}px AWAY from the pocket, beyond {noise_tolerance_px}px noise tolerance)"

        net = dists[-1] - dists[0]
        if net < min_net_px:
            return False, f"insufficient_net_convergence ({net:.1f}px < required {min_net_px}px)"

        return True, f"converged (net={net:.1f}px over {len(deltas)} steps, deltas={[round(d,1) for d in deltas]})"


@dataclass
class PendingPot:
    track_id: int
    pocket_label: str
    locked_class: str | None
    class_at_disappearance: str
    class_history_at_disappearance: list[str]
    last_position: tuple[float, float]
    disappeared_frame: int
    converged_on_vanish: bool = False
    converged_reason: str = ""


class ScoringSpike:

    def __init__(
        self,
        cfg: Config,
        zones: dict[str, sv.PolygonZone],
        event_sink: ScoringEventSink | None = None,
    ) -> None:
        self.cfg = cfg
        self.zones = zones
        self.event_sink = event_sink

        self.tracks: dict[int, TrackState] = {}
        self.pending_pots: dict[int, PendingPot] = {}
        self.terminated_ids: set[int] = set()

        self.scored_classes = SCORED_CLASSES
        self.counters: dict[str, int] = dict.fromkeys(self.scored_classes, 0)
        self.total_pocketed = 0

        self.locked = False
        self.frame_idx = cfg.start_frame

        self.events: list[PotEvent] = []

    def lock_in(self) -> None:
        self.locked = True
        self.counters = dict.fromkeys(self.scored_classes, 0)
        self.total_pocketed = 0

    def _find_nearby_detection(
        self,
        position: tuple[float, float],
        detections: sv.Detections,
        exclude_track_ids: set[int],
        exclude_inside_zone: str | None = None,
    ) -> bool:
        if len(detections) == 0:
            return False
        px, py = position
        zone = self.zones.get(exclude_inside_zone) if exclude_inside_zone else None
        other_track_positions = [
            self.tracks[t].last_position
            for t in exclude_track_ids
            if t in self.tracks and self.tracks[t].last_position is not None
        ]
        for i in range(len(detections)):
            x1, y1, x2, y2 = detections.xyxy[i]
            cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
            dist = np.hypot(cx - px, cy - py)
            if dist > self.cfg.reappear_radius_px:
                continue

            matched_other_track = next(
                (
                    opos for opos in other_track_positions
                    if np.hypot(cx - opos[0], cy - opos[1]) <= self.cfg.reappear_radius_px
                ),
                None,
            )
            if matched_other_track is not None:
                continue

            if zone is not None:
                poly_test = cv2.pointPolygonTest(zone.polygon, (cx, cy), False)
                if poly_test >= 0:
                    continue
            return True
        return False

    def update(
        self,
        tracked: sv.Detections,
        class_names: dict,
        raw_detections_b: sv.Detections,
    ) -> None:
        self.frame_idx += 1
        current_ids: set[int] = set()

        for i in range(len(tracked)):
            tid = tracked.tracker_id[i]
            if tid is None or tid < 0:
                continue
            current_ids.add(int(tid))
            tid = int(tid)

            cls = class_names.get(int(tracked.class_id[i]), "?")
            x1, y1, x2, y2 = tracked.xyxy[i]
            pos = ((x1 + x2) / 2, (y1 + y2) / 2)
            conf = (
                float(tracked.confidence[i])
                if getattr(tracked, "confidence", None) is not None
                else None
            )

            is_new = tid not in self.tracks
            if is_new:
                state = TrackState(track_id=tid)
                state.trail = deque(maxlen=self.cfg.trail_draw_length or 1)
                state.trajectory_log = deque(maxlen=self.cfg.trail_draw_length or 1)
                self.tracks[tid] = state
            state = self.tracks[tid]
            state.observe(cls, pos, self.cfg.class_lock_stability_frames, self.frame_idx, self.zones, conf)
            in_zone_label = _mostly_pocketed_label(np.array([x1, y1, x2, y2]), self.zones)
            state.last_zone_label = in_zone_label

        vanished_ids = set(self.tracks.keys()) - current_ids
        for tid in vanished_ids:
            state = self.tracks.pop(tid)

            pocket_label = state.last_zone_label
            if pocket_label is None and state.last_position is not None:
                pocket_label = _point_in_zone_label(state.last_position, self.zones)

            if pocket_label is not None and tid not in self.pending_pots:
                converged, converged_reason = state.is_converging_on_zone(
                    pocket_label, self.zones,
                    window_frames=self.cfg.convergence_window_frames,
                    min_net_px=self.cfg.convergence_min_net_px,
                    noise_tolerance_px=self.cfg.convergence_noise_tolerance_px,
                    min_trail_frames=self.cfg.convergence_min_trail_frames,
                )
                self.pending_pots[tid] = PendingPot(
                    track_id=tid,
                    pocket_label=pocket_label,
                    locked_class=state.locked_class,
                    class_at_disappearance=state.candidate_class or "?",
                    class_history_at_disappearance=list(state.class_history),
                    last_position=state.last_position,
                    disappeared_frame=self.frame_idx,
                    converged_on_vanish=converged,
                    converged_reason=converged_reason,
                )

        resolved_ids = []
        for tid, pending in self.pending_pots.items():
            age = self.frame_idx - pending.disappeared_frame

            if self._find_nearby_detection(
                pending.last_position, raw_detections_b, current_ids,
                exclude_inside_zone=pending.pocket_label,
            ):
                self._resolve(pending, "cancelled")
                resolved_ids.append(tid)
                continue

            convergence_says_confirm = (
                pending.converged_on_vanish and age >= self.cfg.class_lock_stability_frames
            )

            if convergence_says_confirm:
                self._resolve(pending, "confirmed")
                resolved_ids.append(tid)
                continue

            if age >= self.cfg.unresolved_ceiling_frames:
                self._resolve(pending, "unresolved")
                resolved_ids.append(tid)

        for tid in resolved_ids:
            del self.pending_pots[tid]

    def _resolve(self, pending: PendingPot, outcome: str) -> None:
        self.terminated_ids.add(pending.track_id)

        if outcome == "confirmed":
            scoring_class = pending.locked_class or pending.class_at_disappearance
            if scoring_class in self.counters:
                self.counters[scoring_class] += 1
                self.total_pocketed += 1

        event = PotEvent(
            frame=self.frame_idx,
            track_id=pending.track_id,
            outcome=outcome,
            pocket_label=pending.pocket_label,
            locked_class=pending.locked_class,
            class_at_confirmation=pending.class_at_disappearance,
            class_history="|".join(pending.class_history_at_disappearance),
        )
        self.events.append(event)
        if self.event_sink is not None:
            self.event_sink.on_pot_resolved(event)

    def draw_overlay(
        self,
        frame: np.ndarray,
        trail_draw_enabled: bool = True,
    ) -> np.ndarray:
        from .rendering import draw_trails

        out = frame.copy()
        if trail_draw_enabled:
            out = draw_trails(out, self.tracks.values())

        for label, zone in self.zones.items():
            polygon = zone.polygon.astype(np.int32)
            cv2.polylines(out, [polygon], isClosed=True, color=(255, 0, 255), thickness=2)
            label_pos = tuple(polygon[0])
            cv2.putText(out, label, label_pos, cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 0, 255), 2)

        return out
