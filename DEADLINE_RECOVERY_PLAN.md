# September 7 delivery recovery plan

## Scope decision

Ship **camera-assisted scoring with manual verification**, not a claim of fully
autonomous refereeing. This is consistent with the manuscript, which permits
authorized manual score verification or correction and describes full
production validation as dependent on time, data, hardware, and test conditions.

Call buyer-selectable packaging the **Module Entitlement System (MES)**. The
backend environment variable `ENABLED_MODULES` is the licensed installation
manifest. The API blocks excluded modules with `MODULE_NOT_ENTITLED`, while the
mobile client removes their navigation entries.

## Architecture

```text
Fixed overhead camera -> YOLO or RF-DETR adapter -> temporal tracker
    -> confident ordinary-ball event -> cloud backend -> database + Socket.IO
    -> cue/eight/ambiguous event      -> staff review/manual correction

Mobile/Web/TV -> HTTPS + Socket.IO -> containerized Node backend -> Supabase
```

Inference stays on the venue computer connected to the camera. The backend and
database are cloud-hosted; live camera video is not uploaded to the backend.

## September 5 — integrate and calibrate

1. Put the trained YOLO checkpoint and all test videos in a local, uncommitted
   test directory.
2. Run YOLO on every clip with `--dry-run`; verify labels and pocket positions.
3. Run RF-DETR on the identical clips when its checkpoint is ready.
4. Choose one model based on potted-event precision, recall, duplicates, and
   latency. Do not switch merely because its image mAP is higher.
5. Keep cue-ball, 8-ball, and uncertain events in manual-confirmation mode.

## September 6 — deploy and acceptance-test

1. Deploy `backend/Dockerfile` to the selected container host.
2. Configure `DATABASE_URL`, JWT secrets, `BACKEND_URL`, `FRONTEND_URL`,
   `SENSOR_API_KEY`, Supabase keys, and `ENABLED_MODULES` in the host secret
   manager. Never commit `.env`.
3. Run `npx prisma migrate deploy` once against the deployment database.
4. Confirm `GET /health` and `GET /api/features` over HTTPS.
5. Put the HTTPS backend URL in `mobile/.env` as both
   `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_WS_URL`.
6. Run `eas build --profile preview --platform android` to produce the internal
   APK, install it on the staff/admin/member test devices, and smoke-test roles.
7. Start the edge vision process with the deployed API URL and a live game
   session ID.

## September 7 — freeze and demonstrate

1. Run one controlled rack under the actual lights and fixed camera mount.
2. Demonstrate: stable rack, stripe pot, solid pot, deliberate occlusion, cue
   scratch/manual correction, duplicate retry, TV/app real-time update, and a
   disabled MES module returning `MODULE_NOT_ENTITLED`.
3. Save logs, screenshots, model/version identifiers, test-video names, and the
   exact results. Report observed failures honestly.
4. Freeze code and model weights several hours before the presentation. Keep
   the prior working checkpoint and manual-score workflow as rollback.

## Camera acceptance matrix

| Scenario | Required result |
|---|---|
| Stable full rack | No pocket events for 60 seconds |
| Solid/stripe at each pocket | One candidate per physical pot; no duplicate |
| Label flicker | Same tracked ball; no fake pot |
| Hand/cue/player occlusion away from pocket | No event |
| Cue scratch | Staff confirmation required |
| 8-ball pot | Staff confirmation required |
| Backend retry | Same `eventId` stored only once |
| Network interruption | Error is logged; session remains manually operable |

Record event-level precision and recall separately for solids, stripes, cue,
and eight-ball. The go-live priority is high precision (avoid false scoring),
with manual correction covering missed events.

## Items still required from the team

- YOLO and RF-DETR checkpoints, class-name mapping, and validation metrics.
- Representative videos from the final camera angle and lighting.
- Final table ID and a game session ID from the deployed database.
- Supabase, container-host, and Expo/EAS access owned by the group.
- A fixed camera mount and the computer that will run inference at the venue.

