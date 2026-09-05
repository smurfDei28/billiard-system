const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const backendRoot = path.resolve(__dirname, '..');
const controllerPath = path.join(backendRoot, 'src', 'controllers', 'tournament.controller.js');
const routesPath = path.join(backendRoot, 'src', 'routes', 'tournament.routes.js');
const helperPath = path.join(backendRoot, 'src', 'services', 'singleEliminationBracket.service.js');
const snapshotPath = path.join(backendRoot, 'docs', 'tournament-safety', 'generateBrackets.snapshot.js');
const { generateSingleEliminationBracket } = require(helperPath);

const source = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

test('the protected pre-extraction snapshot remains available as the behavioral reference', () => {
  const snapshot = source(snapshotPath);
  assert.match(snapshot, /const generateBrackets = async \(req, res\) =>/);
  assert.match(snapshot, /const players = \[\.\.\.tournament\.entries\]\.sort\(\(\) => Math\.random\(\) - 0\.5\)/);
  assert.match(snapshot, /status = 'BYE';\s*winnerId = player1Id/);
  assert.match(snapshot, /data: \{ nextMatchId: nextMatch\.id \}/);
  assert.match(snapshot, /data: \{ status: 'IN_PROGRESS' \}/);
  assert.match(snapshot, /emit\('tournament:bracketsGenerated', fullTournament\)/);
});

test('controller preserves the Admin endpoint orchestration contract after extraction', () => {
  const routes = source(routesPath);
  const controller = source(controllerPath);

  assert.match(routes, /router\.post\('\/:tournamentId\/brackets', authenticate, requireRole\('ADMIN'\), generateBrackets\)/);
  assert.match(controller, /entries:\s*\{\s*where:\s*\{ status:\s*\{ in:\s*\['APPROVED', 'CHECKED_IN'\]/);
  assert.match(controller, /const players = \[\.\.\.tournament\.entries\]\.sort\(\(\) => Math\.random\(\) - 0\.5\)/);
  assert.match(controller, /await prisma\.tournamentMatch\.deleteMany\(\{ where: \{ tournamentId \} \}\)/);
  assert.match(controller, /if \(tournament\.format === 'SINGLE_ELIMINATION'\) \{\s*await generateSingleEliminationBracket\(\{ db: prisma, tournamentId, players \}\)/);
  assert.match(controller, /else if \(tournament\.format === 'DOUBLE_ELIMINATION'\)/);
  assert.match(controller, /await finalisePrizePool\(tx, tournamentId\)/);
  assert.match(controller, /data: \{ status: 'IN_PROGRESS' \}/);
  assert.match(controller, /emit\('tournament:bracketsGenerated', fullTournament\)/);
  assert.match(controller, /res\.json\(fullTournament\)/);
});

test('extracted helper gives a 3-player BYE its deterministic second-feeder slot', async () => {
  const records = new Map();
  let sequence = 0;
  const db = {
    tournamentMatch: {
      create: async ({ data }) => {
        const record = { id: `match-${++sequence}`, ...data };
        records.set(record.id, record);
        return { ...record };
      },
      findUnique: async ({ where: { id } }) => ({ ...records.get(id) }),
      update: async ({ where: { id }, data }) => {
        const updated = { ...records.get(id), ...data };
        records.set(id, updated);
        return { ...updated };
      },
    },
  };

  const createdRounds = await generateSingleEliminationBracket({
    db,
    tournamentId: 'tournament-1',
    players: [{ userId: 'player-a' }, { userId: 'player-b' }, { userId: 'player-c' }],
  });
  const matches = [...records.values()].sort((a, b) => a.matchNumber - b.matchNumber);

  assert.equal(createdRounds.length, 2);
  assert.equal(matches.length, 3);
  assert.deepEqual(matches.map(({ round, matchNumber, player1Id, player2Id, status, winnerId, nextMatchId }) => ({ round, matchNumber, player1Id, player2Id, status, winnerId, nextMatchId })), [
    { round: 1, matchNumber: 1, player1Id: 'player-a', player2Id: 'player-b', status: 'PENDING', winnerId: null, nextMatchId: 'match-3' },
    { round: 1, matchNumber: 2, player1Id: 'player-c', player2Id: null, status: 'BYE', winnerId: 'player-c', nextMatchId: 'match-3' },
    { round: 2, matchNumber: 3, player1Id: null, player2Id: 'player-c', status: 'PENDING', winnerId: null, nextMatchId: null },
  ]);
});

test('extracted helper uses only the supplied Prisma-compatible client and opens no transaction', () => {
  const helper = source(helperPath);
  assert.doesNotMatch(helper, /\$transaction/);
  assert.doesNotMatch(helper, /require\(['"]\.\.\/config\/prisma/);
  assert.match(helper, /db\.tournamentMatch\.create/);
  assert.match(helper, /db\.tournamentMatch\.update/);
});
