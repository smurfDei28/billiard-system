from __future__ import annotations

import hashlib
import json
import logging
import os
import queue
import threading
import time
from dataclasses import dataclass
from urllib import error, request
from urllib.parse import quote

from .events import PotEvent, ScoringEventSink

logger = logging.getLogger("tracker_core.ibhms")

POCKET_NAME_MAP = {
    "TOP_LEFT": "TOP_LEFT",
    "TOP_MIDDLE": "MIDDLE_LEFT",
    "TOP_RIGHT": "TOP_RIGHT",
    "BOTTOM_LEFT": "BOTTOM_LEFT",
    "BOTTOM_MIDDLE": "MIDDLE_RIGHT",
    "BOTTOM_RIGHT": "BOTTOM_RIGHT",
}
BALL_CLASSES = frozenset({"solid", "stripe", "eight", "cue"})
_STOP = object()


@dataclass(frozen=True)
class IBHMSConfig:
    api_url: str
    sensor_key: str
    table_id: str
    session_id: str | None = None
    timeout_seconds: float = 5.0
    max_attempts: int = 3

    def validate(self) -> None:
        missing = [
            name
            for name, value in (
                ("API URL", self.api_url),
                ("sensor key", self.sensor_key),
                ("table ID", self.table_id),
            )
            if not str(value).strip()
        ]
        if missing:
            raise ValueError(f"IBHMS integration requires: {', '.join(missing)}")


def fetch_active_session(config: IBHMSConfig) -> str:
    """Resolve the current Staff-started session without changing the GUI."""
    req = request.Request(
        f"{config.api_url.rstrip('/')}/api/sensor/bridge/table/{quote(config.table_id, safe='')}/active",
        headers={"x-sensor-key": config.sensor_key},
        method="GET",
    )
    with request.urlopen(req, timeout=config.timeout_seconds) as response:
        body = json.loads(response.read().decode("utf-8"))
    session_id = str(body.get("sessionId") or "").strip()
    if not session_id:
        raise RuntimeError("IBHMS did not return an active camera session ID")
    logger.info(
        "IBHMS bridge bound table %s to active session %s (%s vs %s)",
        config.table_id,
        session_id,
        body.get("player1Name", "Player 1"),
        body.get("player2Name", "Player 2"),
    )
    return session_id


def event_to_payload(
    event: PotEvent,
    config: IBHMSConfig,
    session_id: str | None = None,
) -> dict | None:
    """Translate one confirmed tracker event into the backend camera contract."""
    if event.outcome != "confirmed":
        return None

    ball_class = (event.locked_class or event.class_at_confirmation or "").strip().lower()
    pocket = POCKET_NAME_MAP.get(event.pocket_label.strip().upper())
    if ball_class not in BALL_CLASSES or pocket is None:
        return None

    resolved_session_id = str(session_id or config.session_id or "").strip()
    if not resolved_session_id:
        return None

    identity = ":".join((
        resolved_session_id,
        str(event.frame),
        str(event.track_id),
        pocket,
        ball_class,
    ))
    event_id = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24]
    return {
        "eventId": event_id,
        "tableId": config.table_id,
        "sessionId": resolved_session_id,
        "pocket": pocket,
        "ballColor": ball_class,
        "source": "CAMERA_VISION",
        "requiresConfirmation": False,
    }


class IBHMSEventSink(ScoringEventSink):
    """Non-blocking, retry-safe bridge from the tracker to the IBHMS API."""

    def __init__(self, config: IBHMSConfig) -> None:
        config.validate()
        self.config = config
        self.session_id = (
            str(config.session_id).strip()
            if config.session_id and str(config.session_id).strip()
            else fetch_active_session(config)
        )
        self._queue: queue.Queue[dict | object] = queue.Queue(maxsize=128)
        self._closed = False
        self.sent_count = 0
        self.failed_count = 0
        self.skipped_count = 0
        self._worker = threading.Thread(target=self._run, daemon=True, name="IBHMSEventSink")
        self._worker.start()

    def on_pot_resolved(self, event: PotEvent) -> None:
        payload = event_to_payload(event, self.config, self.session_id)
        if payload is None:
            self.skipped_count += 1
            logger.info(
                "IBHMS skipped event outcome=%s pocket=%s class=%s",
                event.outcome,
                event.pocket_label,
                event.locked_class or event.class_at_confirmation,
            )
            return
        try:
            self._queue.put_nowait(payload)
        except queue.Full:
            self.failed_count += 1
            logger.error("IBHMS event queue is full; event %s was not sent", payload["eventId"])

    def _post(self, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        req = request.Request(
            f"{self.config.api_url.rstrip('/')}/api/sensor/pocket",
            data=body,
            headers={
                "Content-Type": "application/json",
                "x-sensor-key": self.config.sensor_key,
            },
            method="POST",
        )
        with request.urlopen(req, timeout=self.config.timeout_seconds) as response:
            if response.status < 200 or response.status >= 300:
                raise RuntimeError(f"IBHMS returned HTTP {response.status}")

    def _run(self) -> None:
        while True:
            payload = self._queue.get()
            if payload is _STOP:
                return
            for attempt in range(1, self.config.max_attempts + 1):
                try:
                    self._post(payload)
                    self.sent_count += 1
                    logger.info(
                        "IBHMS accepted pot event %s (%s at %s)",
                        payload["eventId"],
                        payload["ballColor"],
                        payload["pocket"],
                    )
                    break
                except (error.HTTPError, error.URLError, TimeoutError, RuntimeError) as exc:
                    if attempt >= self.config.max_attempts:
                        self.failed_count += 1
                        logger.error(
                            "IBHMS rejected event %s after %d attempt(s): %s",
                            payload["eventId"],
                            attempt,
                            exc,
                        )
                    else:
                        logger.warning(
                            "IBHMS send attempt %d/%d failed for %s: %s",
                            attempt,
                            self.config.max_attempts,
                            payload["eventId"],
                            exc,
                        )
                        time.sleep(0.25 * attempt)

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._queue.put(_STOP)
        self._worker.join(timeout=max(5.0, self.config.timeout_seconds + 1.0))
        logger.info(
            "IBHMS sink closed (sent=%d failed=%d skipped=%d queued=%d)",
            self.sent_count,
            self.failed_count,
            self.skipped_count,
            self._queue.qsize(),
        )


def build_ibhms_sink_from_env() -> IBHMSEventSink | None:
    enabled = os.getenv("IBHMS_BRIDGE_ENABLED", "").strip().lower()
    if enabled not in {"1", "true", "yes", "on"}:
        logger.info("IBHMS bridge disabled (set IBHMS_BRIDGE_ENABLED=true to enable)")
        return None
    config = IBHMSConfig(
        api_url=os.getenv("IBHMS_API_URL", os.getenv("API_BASE_URL", "")).strip(),
        sensor_key=os.getenv("SENSOR_API_KEY", "").strip(),
        table_id=os.getenv("CAMERA_TABLE_ID", os.getenv("TABLE_ID", "")).strip(),
        session_id=os.getenv("IBHMS_SESSION_ID", "").strip() or None,
    )
    return IBHMSEventSink(config)
