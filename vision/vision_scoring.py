"""Temporal, model-agnostic billiard-ball event detection.

The detector model is deliberately kept outside this module.  YOLO, RF-DETR,
or recorded test detections can all produce ``Detection`` objects.  This layer
tracks physical balls across frames, tolerates class-label flicker, and only
reports a pocket event after a ball disappears beside a configured pocket.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from hashlib import sha256
from math import hypot
from typing import Dict, Iterable, List, Mapping, Optional, Sequence, Tuple


BALL_LABELS = ("solid", "stripe", "eight", "cue")
LABEL_ALIASES = {
    "solid": "solid", "solids": "solid", "plain": "solid",
    "stripe": "stripe", "stripes": "stripe", "striped": "stripe",
    "eight": "eight", "8": "eight", "8ball": "eight", "eightball": "eight",
    "cue": "cue", "cueball": "cue", "white": "cue",
}


def normalize_label(label: str) -> Optional[str]:
    key = "".join(character for character in str(label).lower() if character.isalnum())
    return LABEL_ALIASES.get(key)


@dataclass(frozen=True)
class Detection:
    label: str
    confidence: float
    # Normalized x1, y1, x2, y2 coordinates (0..1).
    box: Tuple[float, float, float, float]

    @property
    def center(self) -> Tuple[float, float]:
        x1, y1, x2, y2 = self.box
        return ((x1 + x2) / 2.0, (y1 + y2) / 2.0)


@dataclass
class Track:
    track_id: int
    center: Tuple[float, float]
    label_votes: Dict[str, float] = field(default_factory=dict)
    label_observations: Dict[str, int] = field(default_factory=dict)
    confidence_total: float = 0.0
    observations: int = 0
    missing_frames: int = 0
    emitted: bool = False

    def observe(self, detection: Detection) -> None:
        self.center = detection.center
        self.label_votes[detection.label] = self.label_votes.get(detection.label, 0.0) + detection.confidence
        self.label_observations[detection.label] = self.label_observations.get(detection.label, 0) + 1
        self.confidence_total += detection.confidence
        self.observations += 1
        self.missing_frames = 0

    @property
    def label(self) -> str:
        return max(self.label_votes, key=self.label_votes.get)

    @property
    def confidence(self) -> float:
        return self.confidence_total / max(1, self.observations)

    @property
    def label_confidence(self) -> float:
        label = self.label
        return self.label_votes[label] / max(1, self.label_observations[label])

    @property
    def label_vote_share(self) -> float:
        return self.label_votes[self.label] / max(0.000001, sum(self.label_votes.values()))


DEFAULT_POCKETS: Mapping[str, Tuple[float, float]] = {
    # MIDDLE_LEFT/MIDDLE_RIGHT are the side pockets. In this overhead camera
    # orientation they appear at top-centre and bottom-centre respectively.
    "TOP_LEFT": (0.04, 0.08),
    "MIDDLE_LEFT": (0.50, 0.08),
    "TOP_RIGHT": (0.96, 0.08),
    "BOTTOM_LEFT": (0.04, 0.92),
    "MIDDLE_RIGHT": (0.50, 0.92),
    "BOTTOM_RIGHT": (0.96, 0.92),
}


@dataclass
class PocketState:
    armed: bool = False
    empty_frames: int = 0
    occupied_frames: int = 0
    label_votes: Dict[str, float] = field(default_factory=dict)
    label_observations: Dict[str, int] = field(default_factory=dict)
    last_event_frame: int = -1_000_000


class PocketOccupancyScorer:
    """Emit one event when an armed pocket changes from empty to occupied."""

    def __init__(self, pockets=DEFAULT_POCKETS, *, min_confidence=0.45,
                 auto_confidence=0.72, pocket_radius=0.07,
                 arm_empty_frames=5, occupied_frames=3, cooldown_frames=300,
                 track_match_radius=0.09, track_stale_frames=15,
                 minimum_label_vote_share=0.70):
        self.pockets = dict(pockets)
        self.min_confidence = min_confidence
        self.auto_confidence = auto_confidence
        self.pocket_radius = pocket_radius
        self.arm_empty_frames = arm_empty_frames
        self.required_occupied_frames = occupied_frames
        self.cooldown_frames = cooldown_frames
        self.track_match_radius = track_match_radius
        self.track_stale_frames = track_stale_frames
        self.minimum_label_vote_share = minimum_label_vote_share
        self.frame_number = 0
        self.states = {name: PocketState() for name in self.pockets}
        self.tracks: Dict[int, Track] = {}
        self.next_track_id = 1

    def process(self, detections: Iterable[Detection]) -> List[dict]:
        self.frame_number += 1
        usable: List[Detection] = []
        for detection in detections:
            label = normalize_label(detection.label)
            if not label or detection.confidence < self.min_confidence:
                continue
            usable.append(Detection(label, float(detection.confidence), detection.box))

        detection_tracks = self._update_tracks(usable)
        inside: Dict[str, List[Tuple[Detection, int]]] = {name: [] for name in self.pockets}
        for detection_index, detection in enumerate(usable):
            pocket = min(self.pockets, key=lambda name: hypot(
                detection.center[0] - self.pockets[name][0],
                detection.center[1] - self.pockets[name][1]))
            if hypot(detection.center[0] - self.pockets[pocket][0],
                     detection.center[1] - self.pockets[pocket][1]) <= self.pocket_radius:
                inside[pocket].append((detection, detection_tracks[detection_index]))

        events: List[dict] = []
        for pocket, state in self.states.items():
            occupants = inside[pocket]
            if not occupants:
                state.empty_frames += 1
                state.occupied_frames = 0
                state.label_votes.clear()
                state.label_observations.clear()
                if (state.empty_frames >= self.arm_empty_frames and
                        self.frame_number - state.last_event_frame >= self.cooldown_frames):
                    state.armed = True
                continue

            state.empty_frames = 0
            state.occupied_frames += 1
            for detection, _ in occupants:
                state.label_votes[detection.label] = state.label_votes.get(detection.label, 0.0) + detection.confidence
                state.label_observations[detection.label] = state.label_observations.get(detection.label, 0) + 1
            if not state.armed or state.occupied_frames < self.required_occupied_frames:
                continue

            # Prefer the physical track's full approach history. Fast-moving
            # stripes can look solid only after blur/occlusion at the pocket.
            occupant_track_ids = {track_id for _, track_id in occupants}
            track = max(
                (self.tracks[track_id] for track_id in occupant_track_ids),
                key=lambda candidate: candidate.observations,
            )
            if track.observations >= self.required_occupied_frames:
                label = track.label
                confidence = track.label_confidence
                ambiguous_label = track.label_vote_share < self.minimum_label_vote_share
            else:
                label = max(state.label_votes, key=state.label_votes.get)
                confidence = state.label_votes[label] / state.label_observations[label]
                ambiguous_label = False
            event_id = sha256(f"{pocket}:{self.frame_number}:{label}".encode()).hexdigest()[:24]
            events.append({"eventId": event_id, "pocket": pocket,
                           "ballColor": label, "confidence": round(confidence, 4),
                           "source": "CAMERA_VISION",
                           "requiresConfirmation": label in {"cue", "eight"} or confidence < self.auto_confidence or ambiguous_label,
                           "frameNumber": self.frame_number})
            state.armed = False
            state.last_event_frame = self.frame_number
        return events

    def _update_tracks(self, detections: Sequence[Detection]) -> Dict[int, int]:
        unmatched_tracks = set(self.tracks)
        unmatched_detections = set(range(len(detections)))
        pairs: List[Tuple[float, int, int]] = []
        for track_id, track in self.tracks.items():
            for detection_index, detection in enumerate(detections):
                distance = hypot(track.center[0] - detection.center[0], track.center[1] - detection.center[1])
                if distance <= self.track_match_radius:
                    pairs.append((distance, track_id, detection_index))

        matched: Dict[int, int] = {}
        for _, track_id, detection_index in sorted(pairs):
            if track_id not in unmatched_tracks or detection_index not in unmatched_detections:
                continue
            self.tracks[track_id].observe(detections[detection_index])
            matched[detection_index] = track_id
            unmatched_tracks.remove(track_id)
            unmatched_detections.remove(detection_index)

        for track_id in unmatched_tracks:
            self.tracks[track_id].missing_frames += 1
        for detection_index in unmatched_detections:
            detection = detections[detection_index]
            track = Track(self.next_track_id, detection.center)
            track.observe(detection)
            self.tracks[track.track_id] = track
            matched[detection_index] = track.track_id
            self.next_track_id += 1

        self.tracks = {
            track_id: track for track_id, track in self.tracks.items()
            if track.missing_frames <= self.track_stale_frames
        }
        return matched


class TemporalPocketScorer:
    """Track detections and emit conservative, idempotent pocket candidates."""

    def __init__(
        self,
        pockets: Mapping[str, Tuple[float, float]] = DEFAULT_POCKETS,
        *,
        min_confidence: float = 0.45,
        auto_confidence: float = 0.72,
        match_radius: float = 0.09,
        pocket_radius: float = 0.12,
        missing_frames: int = 4,
        minimum_observations: int = 3,
    ) -> None:
        self.pockets = dict(pockets)
        self.min_confidence = min_confidence
        self.auto_confidence = auto_confidence
        self.match_radius = match_radius
        self.pocket_radius = pocket_radius
        self.required_missing_frames = missing_frames
        self.minimum_observations = minimum_observations
        self.tracks: Dict[int, Track] = {}
        self.next_track_id = 1
        self.frame_number = 0

    def process(self, detections: Iterable[Detection]) -> List[dict]:
        self.frame_number += 1
        usable: List[Detection] = []
        for detection in detections:
            label = normalize_label(detection.label)
            if label and detection.confidence >= self.min_confidence:
                usable.append(Detection(label, float(detection.confidence), detection.box))

        unmatched_tracks = set(self.tracks)
        unmatched_detections = set(range(len(usable)))
        pairs: List[Tuple[float, int, int]] = []
        for track_id, track in self.tracks.items():
            if track.emitted:
                continue
            for detection_index, detection in enumerate(usable):
                distance = hypot(track.center[0] - detection.center[0], track.center[1] - detection.center[1])
                if distance <= self.match_radius:
                    pairs.append((distance, track_id, detection_index))

        # Greedy spatial association intentionally ignores the predicted class.
        # A stripe briefly classified as solid must remain the same physical ball.
        for _, track_id, detection_index in sorted(pairs):
            if track_id not in unmatched_tracks or detection_index not in unmatched_detections:
                continue
            self.tracks[track_id].observe(usable[detection_index])
            unmatched_tracks.remove(track_id)
            unmatched_detections.remove(detection_index)

        for detection_index in unmatched_detections:
            detection = usable[detection_index]
            track = Track(self.next_track_id, detection.center)
            track.observe(detection)
            self.tracks[track.track_id] = track
            self.next_track_id += 1

        events: List[dict] = []
        for track_id in unmatched_tracks:
            track = self.tracks[track_id]
            if track.emitted:
                continue
            track.missing_frames += 1
            pocket = self._nearest_pocket(track.center)
            if (
                pocket
                and track.missing_frames == self.required_missing_frames
                and track.observations >= self.minimum_observations
            ):
                event_id = sha256(
                    f"{track.track_id}:{self.frame_number}:{pocket}:{track.label}".encode("utf-8")
                ).hexdigest()[:24]
                needs_confirmation = track.label in {"cue", "eight"} or track.confidence < self.auto_confidence
                events.append({
                    "eventId": event_id,
                    "pocket": pocket,
                    "ballColor": track.label,
                    "confidence": round(track.confidence, 4),
                    "source": "CAMERA_VISION",
                    "requiresConfirmation": needs_confirmation,
                    "frameNumber": self.frame_number,
                })
                track.emitted = True

        # Retain recent missing tracks briefly in case a ball was only occluded.
        stale_after = self.required_missing_frames * 3
        self.tracks = {
            track_id: track for track_id, track in self.tracks.items()
            if track.missing_frames <= stale_after
        }
        return events

    def _nearest_pocket(self, center: Sequence[float]) -> Optional[str]:
        distances = {
            name: hypot(center[0] - point[0], center[1] - point[1])
            for name, point in self.pockets.items()
        }
        pocket = min(distances, key=distances.get)
        return pocket if distances[pocket] <= self.pocket_radius else None
