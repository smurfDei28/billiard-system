# Camera-assisted scoring

## Integrated groupmate tracker GUI

The `tracker_core` and `tracker_gui` packages contain the groupmate's
YOLO + C-BIoU implementation. Confirmed convergence-based pot events now pass
through `tracker_core/ibhms.py`, which maps its pocket names to the IBHMS API,
creates deterministic event IDs, sends events without blocking inference, and
retries safely. Cancelled, unresolved, unknown-pocket, and unknown-class events
remain local and are not submitted.

The supplied `yolo26l@960.pt` checkpoint is installed locally at
`vision/models/yolo26l@960.pt`. Model files are intentionally Git-ignored, so
each vision computer must receive the checkpoint separately. The supplied
`pockets.groupmate.json` calibration is versioned, but it is valid only for the
same 1920x1080 camera position used to create it. Recalibrate the six polygons
after moving or resizing the camera.

Install and open the GUI from the `vision` directory. On the presentation
laptop, copy the tested `yolo26l@960.pt` into `vision/models/`; model files are
not stored in Git:

```powershell
uv venv --python 3.12
uv pip install -r requirements.txt --torch-backend=auto
uv run python -m tracker_gui.app
```

Integration procedure (the detector configuration in Gradio remains unchanged):

1. Set Railway `ENABLED_GROUPS` to include `VISION_SCORING` (or use `ALL`).
2. On the camera computer, set `IBHMS_BRIDGE_ENABLED`, `IBHMS_API_URL`,
   `SENSOR_API_KEY`, and `CAMERA_TABLE_ID` in PowerShell before starting the
   GUI. Use `bridge.env.example` as the value reference; never commit the real
   sensor key.
3. In the Staff app, open **Vision**, select that configured table, enter both
   player names, and choose **Start Camera Game**.
4. Start the GPU GUI. The bridge uses its sensor key to discover and bind the
   Staff-created active session automatically.
5. Start the feed, inspect the overlay, and press **Lock In** only when the rack
   and pocket calibration are ready. Confirmed pots will appear in the Staff
   Vision screen and in the backend's live game record.

Example PowerShell launch (values apply only to the current terminal):

```powershell
$env:IBHMS_BRIDGE_ENABLED = "true"
$env:IBHMS_API_URL = "https://billiard-system-production.up.railway.app"
$env:SENSOR_API_KEY = "the same SENSOR_API_KEY configured in Railway"
$env:CAMERA_TABLE_ID = "the table UUID selected for this camera"
python -m tracker_gui.app
```

The bridge binds the active session when **Start** is clicked. Start the game
from the Staff app first. If no active session exists, the GUI refuses to start
and logs a clear error instead of recording an unassigned event.

The detector identifies ball category and pocket. It does not know player
turns, fouls, or which player was assigned solids/stripes, so player scores and
the final winner remain staff-controlled. Do not claim fully automatic 8-ball
refereeing from camera detections alone.

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
