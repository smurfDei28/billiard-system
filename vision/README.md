# Camera-assisted scoring

This service separates model inference from scoring logic. YOLO and RF-DETR
produce the same normalized detections. The default `PocketOccupancyScorer`
arms an empty pocket and emits one event after a ball occupies its tight
interior for several frames. This matches the supplied videos, where a potted
ball remains visible in the pocket. A cooldown prevents duplicate scores.

The older `TemporalPocketScorer` disappearance mode remains available for
installations where balls fall completely out of view.

## Required model classes

Use exactly these four class names (the common aliases `stripes`, `8ball`, and
`cueball` are also accepted):

- `solid`
- `stripe`
- `eight`
- `cue`

The expected full-table inventory is **7 solid, 7 stripe, 1 eight, and 1 cue**.
The scorer does not require all 16 detections in every frame.

## Run with the group's YOLO checkpoint

```powershell
cd vision
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python run_vision.py --provider yolo --model models\yolo26@960px_stripe_solid_cue_eight.pt --source test-videos\score.mp4 --image-size 960 --dry-run
```

Use `--source 0` for the first webcam. Remove `--dry-run` only after setting
`API_BASE_URL`, `SENSOR_API_KEY`, `TABLE_ID`, and `SESSION_ID`.

`YOLO26@640px_ball.pt` has only the generic `ball` class. It can be used for
detector experiments, but it cannot distinguish solid, stripe, eight, and cue
balls, so the scoring runner rejects it.

## Compare RF-DETR without rewriting scoring

```bash
pip install -r requirements-rfdetr.txt
python run_vision.py --provider rfdetr --model checkpoint.pth --source test-video.mp4 --dry-run
```

Compare both models on the same held-out videos. Select the model by event-level
precision/recall and duplicate-event count, not detection mAP alone.

## Safety behavior

- Confident solid/stripe events are sent automatically.
- Cue-ball, 8-ball, and low-confidence events are printed with
  `requiresConfirmation: true` and are not sent automatically.
- Backend `eventId` handling makes network retries idempotent.
- Staff can use the existing manual score correction endpoint for review.

Run deterministic tests with:

```bash
python -m unittest discover -s . -p "test_*.py" -v
```

The camera must be fixed overhead. The table should fill the camera frame; if it
does not, crop or perspective-warp the table before inference. Pocket radius,
tracking radius, missing-frame count, and confidence thresholds are constructor
parameters in `vision_scoring.py` and must be calibrated using validation clips.
