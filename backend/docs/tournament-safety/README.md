# Tournament generator regression safety net

## Rollback reference

The protected generator snapshot is [generateBrackets.snapshot.js](generateBrackets.snapshot.js). It was captured from `backend/src/controllers/tournament.controller.js` on Git commit `8ad011478c4e8f030569b61232557377d09337bd` while the working tree contained uncommitted Phase 2 work. It is intentionally a source snapshot, not executable production code.

To restore only the generator after a failed future extraction, replace the controller's `generateBrackets` function with this snapshot, then run the characterization test below. Do not use destructive Git commands on this dirty worktree.

## Characterization contract

The current Admin endpoint is `POST /api/tournaments/:tournamentId/brackets`, guarded by `authenticate` and `requireRole('ADMIN')` in `backend/src/routes/tournament.routes.js`.

The controller loads the tournament and only `APPROVED`/`CHECKED_IN` entries, rejects a missing tournament (404) or fewer than two entries (400), then shuffles entries using `sort(() => Math.random() - 0.5)`. It deletes all existing matches for the tournament before generating any new match.

For Single Elimination it rounds the entry count up to the next power of two, produces `log2(nextPow2)` rounds, and assigns match numbers sequentially across all rounds. Only first-round records receive players. A first-round record containing exactly one player is `BYE` with that player as `winnerId`; later records start `PENDING` and empty. Every non-final match points to `Math.floor(index / 2)` in the following round through `nextMatchId`. `nextWinnerMatchId` is not populated by this generator. First-round BYE winners are slotted into the next round immediately.

After construction it finalizes the prize pool and sets the tournament to `IN_PROGRESS` in a Prisma transaction. It then re-reads the tournament with matches ordered by `round`, then `matchNumber`, emits `tournament:bracketsGenerated` to both `tournament:<id>` and `tv-display`, and returns that full tournament as HTTP 200 JSON. It sends no notifications, creates no staff-action/analytics record, and does not mutate participant statuses. Error handling logs the error and returns HTTP 500 with `{ error: 'Failed to generate brackets' }`.

`DOUBLE_ELIMINATION` currently follows the same construction branch; this safety pass does not change it. Historical `ROUND_ROBIN` generation remains a separate branch.

## Database output examples

For `n` eligible Single Elimination participants, `p = nextPowerOfTwo(n)`, the generator creates `p - 1` `TournamentMatch` rows. Rounds are `1..log2(p)` and match numbers are `1..p-1`. Round 1 has `p / 2` matches and subsequent round counts halve. Rows are linked by `nextMatchId`; final-round `nextMatchId` is `null`. The generator does not write `nextWinnerMatchId`. First-round unmatched participants become `BYE` records; all other unplayed records are `PENDING`. The tournament becomes `IN_PROGRESS`.

## Tests

Run `node --test test/tournament-generator.characterization.test.js` from `backend`. The test does not load an HTTP server, connect to Prisma, or write a database. It preserves the original snapshot as the known-good reference, verifies the controller orchestration contract, and uses a fake Prisma-compatible client to verify the extracted helper's three-player match, BYE, and routing output. No dedicated isolated test database is configured: `.env.example` describes a Supabase PostgreSQL connection, so full database integration regression tests are intentionally unavailable.

## Extracted boundary

`backend/src/services/singleEliminationBracket.service.js` now provides `generateSingleEliminationBracket({ db, tournamentId, players })`. It owns only Single Elimination match calculation/creation, legacy `nextMatchId` links, and BYE advancement. It uses the supplied `db` throughout and does not call `$transaction`, so a future caller can pass either `prisma` or an existing transaction client (`tx`) without nested transactions.

The controller retains request parameters, participant selection/shuffle, deletion/regeneration policy, lifecycle and prize-pool transaction, HTTP status/response mapping, socket emission, and endpoint error logging. Legacy Double Elimination remains in its original controller branch.

`closeTournamentRegistration()` also uses this helper only for Single Elimination, inside its existing transaction. It keeps the tournament at `REGISTRATION_CLOSED`, does not delete existing matches, and leaves Double Elimination `bracketPending`.

The byte-for-byte snapshot assertion was replaced with behavior-level controller and fake-client helper characterization tests; the original snapshot remains unchanged.
