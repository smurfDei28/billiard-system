import unittest
import time
from unittest.mock import patch

from tracker_core.events import PotEvent
from tracker_core.ibhms import IBHMSConfig, IBHMSEventSink, event_to_payload, fetch_active_session


class IBHMSSinkContractTests(unittest.TestCase):
    def setUp(self):
        self.config = IBHMSConfig(
            api_url="https://example.test",
            sensor_key="secret",
            table_id="table-1",
            session_id="session-1",
        )

    def event(self, **overrides):
        values = {
            "frame": 120,
            "track_id": 7,
            "outcome": "confirmed",
            "pocket_label": "TOP_MIDDLE",
            "locked_class": "stripe",
            "class_at_confirmation": "stripe",
            "class_history": "stripe|stripe|stripe",
        }
        values.update(overrides)
        return PotEvent(**values)

    def test_maps_middle_pocket_to_backend_enum(self):
        payload = event_to_payload(self.event(), self.config)
        self.assertEqual(payload["pocket"], "MIDDLE_LEFT")
        self.assertEqual(payload["ballColor"], "stripe")
        self.assertEqual(payload["source"], "CAMERA_VISION")

    def test_event_id_is_deterministic_for_retry_idempotency(self):
        first = event_to_payload(self.event(), self.config)
        second = event_to_payload(self.event(), self.config)
        self.assertEqual(first["eventId"], second["eventId"])
        self.assertEqual(len(first["eventId"]), 24)

    def test_cancelled_and_unresolved_events_are_not_sent(self):
        self.assertIsNone(event_to_payload(self.event(outcome="cancelled"), self.config))
        self.assertIsNone(event_to_payload(self.event(outcome="unresolved"), self.config))

    def test_unknown_class_or_pocket_is_not_sent(self):
        self.assertIsNone(event_to_payload(self.event(locked_class="ball"), self.config))
        self.assertIsNone(event_to_payload(self.event(pocket_label="UNKNOWN"), self.config))

    def test_missing_session_is_not_serialized(self):
        config = IBHMSConfig(
            api_url="https://example.test", sensor_key="secret", table_id="table-1",
        )
        self.assertIsNone(event_to_payload(self.event(), config))

    def test_active_session_is_discovered_with_sensor_auth(self):
        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return b'{"sessionId":"game-42","player1Name":"A","player2Name":"B"}'

        config = IBHMSConfig(
            api_url="https://example.test", sensor_key="secret", table_id="table/1",
        )
        with patch("tracker_core.ibhms.request.urlopen", return_value=Response()) as urlopen:
            self.assertEqual(fetch_active_session(config), "game-42")
        req = urlopen.call_args.args[0]
        self.assertTrue(req.full_url.endswith("/api/sensor/bridge/table/table%2F1/active"))
        self.assertEqual(req.headers["X-sensor-key"], "secret")

    def test_worker_binds_discovered_session_and_delivers_confirmed_event(self):
        delivered = []

        class RecordingSink(IBHMSEventSink):
            def _post(self, payload):
                delivered.append(payload)

        config = IBHMSConfig(
            api_url="https://example.test", sensor_key="secret", table_id="table-1",
        )
        with patch("tracker_core.ibhms.fetch_active_session", return_value="game-42"):
            sink = RecordingSink(config)
        try:
            sink.on_pot_resolved(self.event())
            deadline = time.monotonic() + 1.0
            while not delivered and time.monotonic() < deadline:
                time.sleep(0.01)
        finally:
            sink.close()

        self.assertEqual(len(delivered), 1)
        self.assertEqual(delivered[0]["sessionId"], "game-42")
        self.assertEqual(delivered[0]["tableId"], "table-1")


if __name__ == "__main__":
    unittest.main()
