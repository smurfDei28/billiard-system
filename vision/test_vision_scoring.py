import unittest

from vision_scoring import Detection, PocketOccupancyScorer, TemporalPocketScorer


def ball(label="stripe", confidence=0.9, center=(0.04, 0.04)):
    x, y = center
    return Detection(label, confidence, (x - 0.01, y - 0.01, x + 0.01, y + 0.01))


class TemporalPocketScorerTests(unittest.TestCase):
    def test_class_flicker_does_not_create_false_pot(self):
        scorer = TemporalPocketScorer(missing_frames=2, minimum_observations=2)
        self.assertEqual(scorer.process([ball("stripe")]), [])
        self.assertEqual(scorer.process([ball("solid")]), [])
        self.assertEqual(scorer.process([ball("stripe")]), [])

    def test_ball_missing_near_pocket_emits_once(self):
        scorer = TemporalPocketScorer(missing_frames=2, minimum_observations=2)
        scorer.process([ball()])
        scorer.process([ball()])
        self.assertEqual(scorer.process([]), [])
        events = scorer.process([])
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["pocket"], "TOP_LEFT")
        self.assertEqual(events[0]["ballColor"], "stripe")
        self.assertFalse(events[0]["requiresConfirmation"])
        self.assertEqual(scorer.process([]), [])

    def test_disappearance_away_from_pocket_is_ignored(self):
        scorer = TemporalPocketScorer(missing_frames=2, minimum_observations=2)
        scorer.process([ball(center=(0.5, 0.5))])
        scorer.process([ball(center=(0.5, 0.5))])
        scorer.process([])
        self.assertEqual(scorer.process([]), [])

    def test_cue_and_eight_ball_require_confirmation(self):
        for label in ("cue", "eight"):
            scorer = TemporalPocketScorer(missing_frames=1, minimum_observations=1)
            scorer.process([ball(label)])
            events = scorer.process([])
            self.assertTrue(events[0]["requiresConfirmation"])


class PocketOccupancyScorerTests(unittest.TestCase):
    def setUp(self):
        self.scorer = PocketOccupancyScorer(
            pockets={"MIDDLE_LEFT": (0.5, 0.08)},
            arm_empty_frames=2,
            occupied_frames=2,
            cooldown_frames=10,
        )

    @staticmethod
    def detection(label="solid", confidence=0.95):
        return ball(label, confidence, center=(0.5, 0.08))

    def test_empty_to_occupied_emits_once_while_ball_remains(self):
        self.scorer.process([])
        self.scorer.process([])
        self.assertEqual(self.scorer.process([self.detection()]), [])
        events = self.scorer.process([self.detection()])
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["ballColor"], "solid")
        for _ in range(20):
            self.assertEqual(self.scorer.process([self.detection()]), [])

    def test_initially_occupied_pocket_does_not_score(self):
        for _ in range(5):
            self.assertEqual(self.scorer.process([self.detection()]), [])

    def test_cue_entry_requires_confirmation(self):
        self.scorer.process([])
        self.scorer.process([])
        self.scorer.process([self.detection("cue")])
        events = self.scorer.process([self.detection("cue")])
        self.assertEqual(len(events), 1)
        self.assertTrue(events[0]["requiresConfirmation"])

    def test_approach_history_outvotes_blurred_pocket_class_flicker(self):
        scorer = PocketOccupancyScorer(
            pockets={"MIDDLE_LEFT": (0.5, 0.08)},
            arm_empty_frames=2,
            occupied_frames=3,
            cooldown_frames=20,
        )
        scorer.process([])
        scorer.process([])
        for y in (0.20, 0.20, 0.20, 0.20, 0.20, 0.20, 0.18, 0.16):
            scorer.process([ball("stripe", 0.95, center=(0.5, y))])
        scorer.process([])
        scorer.process([])
        events = []
        for _ in range(3):
            events += scorer.process([ball("solid", 0.88, center=(0.5, 0.10))])

        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["ballColor"], "stripe")
        self.assertFalse(events[0]["requiresConfirmation"])

    def test_ambiguous_solid_stripe_track_requires_confirmation(self):
        scorer = PocketOccupancyScorer(
            pockets={"MIDDLE_LEFT": (0.5, 0.08)},
            arm_empty_frames=2,
            occupied_frames=3,
            cooldown_frames=20,
        )
        scorer.process([])
        scorer.process([])
        for label in ("stripe", "solid", "stripe", "solid"):
            scorer.process([ball(label, 0.90, center=(0.5, 0.16))])
        events = []
        for label in ("stripe", "solid", "stripe"):
            events += scorer.process([ball(label, 0.90, center=(0.5, 0.10))])

        self.assertEqual(len(events), 1)
        self.assertTrue(events[0]["requiresConfirmation"])


if __name__ == "__main__":
    unittest.main()
