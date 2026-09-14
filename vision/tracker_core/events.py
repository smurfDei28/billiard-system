from __future__ import annotations

import abc
from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class PotEvent:
    frame: int
    track_id: int
    outcome: str
    pocket_label: str
    locked_class: str | None
    class_at_confirmation: str
    class_history: str

    def as_dict(self) -> dict:
        return asdict(self)


class ScoringEventSink(abc.ABC):

    @abc.abstractmethod
    def on_pot_resolved(self, event: PotEvent) -> None:
        raise NotImplementedError
