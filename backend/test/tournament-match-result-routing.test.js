const assert = require('node:assert/strict');
const test = require('node:test');

const { completeTournamentMatch } = require('../src/services/tournamentMatchResult.service');
const { generateDoubleEliminationBracket } = require('../src/services/doubleEliminationBracket.service');
const { generateSingleEliminationBracket } = require('../src/services/singleEliminationBracket.service');

const createFakePrisma = ({ format, matches = [], balance = 500, table = null, otherLiveMatch = null }) => {
  const records = new Map(matches.map((match) => [match.id, { ...match }]));
  const tournament = { id: 'tournament-1', format, raceTo: 5 };
  const effects = { fees: 0, profileUpdates: 0, profileData: [], creditTransactions: [], loyaltyRewards: [], liabilities: [], completions: [], champions: [], tableUpdates: 0 };
  const championTitles = new Map();
  const tx = {
    tournamentMatch: {
      count: async () => records.size,
      create: async ({ data }) => {
        const id = `match-${records.size + 1}`;
        const record = { id, ...data };
        records.set(id, record);
        return { ...record };
      },
      findUnique: async ({ where: { id }, include }) => {
        const record = records.get(id);
        return record && { ...record, ...(include && { tournament }) };
      },
      findFirst: async ({ where }) => {
        if (where.status === 'IN_PROGRESS') return otherLiveMatch;
        return [...records.values()].find((match) => match.tournamentId === where.tournamentId && (!where.isResetFinal || match.isResetFinal)) || null;
      },
      findMany: async () => [...records.values()].map((record) => ({ ...record })),
      update: async ({ where: { id }, data }) => {
        const updated = { ...records.get(id), ...data };
        records.set(id, updated);
        return { ...updated };
      },
    },
    gamifiedProfile: {
      findUnique: async () => ({ totalWins: 5 }),
      update: async ({ data }) => { effects.profileUpdates += 1; effects.profileData.push(data); return { totalWins: 5 }; },
    },
    membership: {
      findUnique: async () => ({ creditBalance: balance }),
      update: async ({ data }) => ({ creditBalance: balance - (data.creditBalance?.decrement || 0) + (data.creditBalance?.increment || 0) }),
    },
    creditTransaction: { create: async ({ data }) => { effects.creditTransactions.push(data); if (data.type === 'DEDUCTION') effects.fees += 1; } },
    loyaltyHistory: { create: async ({ data }) => { effects.loyaltyRewards.push(data); return data; } },
    tournamentFeeLiability: { create: async ({ data }) => { effects.liabilities.push(data); return { id: `liability-${effects.liabilities.length}`, ...data }; } },
    tournament: { update: async ({ data }) => { effects.completions.push(data); return { ...tournament, ...data }; } },
    championTitle: {
      findUnique: async ({ where }) => championTitles.get(`${where.userId_tournamentId.userId}:${where.userId_tournamentId.tournamentId}`) || null,
      create: async ({ data }) => { championTitles.set(`${data.userId}:${data.tournamentId}`, data); effects.champions.push(data); return data; },
    },
    ...(table && { billiardTable: { update: async ({ data }) => { effects.tableUpdates += 1; Object.assign(table, data); return { ...table }; } } }),
  };
  const prisma = {
    ...tx,
    __records: records,
    $transaction: async (callback) => {
      const before = new Map([...records].map(([id, record]) => [id, { ...record }]));
      const beforeEffects = { ...effects };
      try { return await callback(tx); }
      catch (error) {
        records.clear();
        before.forEach((record, id) => records.set(id, record));
        Object.assign(effects, beforeEffects);
        throw error;
      }
    },
  };
  return { prisma, tx, records, effects, tournament };
};

const complete = (prisma, matchId, score1 = 5, score2 = 3) => {
  const match = prisma.__records.get(matchId);
  if (match?.status === 'PENDING') {
    Object.assign(match, { status: 'IN_PROGRESS', scheduledAt: new Date('2026-08-10T10:00:00Z'), tableId: 'table-1', startedAt: new Date('2026-08-10T10:00:00Z') });
  }
  return completeTournamentMatch({ prisma, matchId, player1Score: score1, player2Score: score2 });
};

test('requires a scheduled, assigned, live match before accepting a result', async () => {
  const { prisma, records } = createFakePrisma({
    format: 'SINGLE_ELIMINATION',
    matches: [{ id: 'match-1', tournamentId: 'tournament-1', player1Id: 'a', player2Id: 'b', status: 'PENDING' }],
  });

  await assert.rejects(
    () => completeTournamentMatch({ prisma, matchId: 'match-1', player1Score: 5, player2Score: 3 }),
    /assign a schedule and table/i,
  );

  records.set('match-1', { ...records.get('match-1'), scheduledAt: new Date('2026-08-10T10:00:00Z'), tableId: 'table-1' });
  await assert.rejects(
    () => completeTournamentMatch({ prisma, matchId: 'match-1', player1Score: 5, player2Score: 3 }),
    /Start this match/i,
  );
});

test('Single Elimination advances its winner once through nextWinnerMatchId/legacy nextMatchId and rejects BYE result entry', async () => {
  const { prisma, records, effects } = createFakePrisma({
    format: 'SINGLE_ELIMINATION',
    matches: [
      { id: 'semi-1', tournamentId: 'tournament-1', player1Id: 'a', player2Id: 'b', status: 'PENDING', nextWinnerMatchId: 'final', nextMatchId: 'final' },
      { id: 'final', tournamentId: 'tournament-1', player1Id: null, player2Id: null, status: 'PENDING' },
      { id: 'bye', tournamentId: 'tournament-1', player1Id: 'c', player2Id: null, status: 'BYE', winnerId: 'c' },
    ],
  });
  const first = await complete(prisma, 'semi-1');
  const retry = await complete(prisma, 'semi-1');

  assert.equal(records.get('final').player1Id, 'a');
  assert.equal(first.alreadyCompleted, false);
  assert.equal(retry.alreadyCompleted, true);
  assert.equal(effects.fees, 1);
  await assert.rejects(() => complete(prisma, 'bye'), /BYE/);
  assert.equal(effects.fees, 1);
});

test('Single Elimination feeder slots are deterministic regardless of completion order', async () => {
  const build = async () => {
    const fixture = createFakePrisma({ format: 'SINGLE_ELIMINATION' });
    const rounds = await generateSingleEliminationBracket({
      db: fixture.tx,
      tournamentId: 'tournament-1',
      players: [{ userId: 'a' }, { userId: 'b' }, { userId: 'c' }, { userId: 'd' }],
    });
    return { fixture, first: rounds[0][0], second: rounds[0][1], final: rounds[1][0] };
  };

  const firstThenSecond = await build();
  await complete(firstThenSecond.fixture.prisma, firstThenSecond.first.id);
  await complete(firstThenSecond.fixture.prisma, firstThenSecond.second.id);
  assert.deepEqual([
    firstThenSecond.fixture.records.get(firstThenSecond.final.id).player1Id,
    firstThenSecond.fixture.records.get(firstThenSecond.final.id).player2Id,
  ], ['a', 'c']);

  const secondThenFirst = await build();
  await complete(secondThenFirst.fixture.prisma, secondThenFirst.second.id);
  await complete(secondThenFirst.fixture.prisma, secondThenFirst.first.id);
  assert.deepEqual([
    secondThenFirst.fixture.records.get(secondThenFirst.final.id).player1Id,
    secondThenFirst.fixture.records.get(secondThenFirst.final.id).player2Id,
  ], ['a', 'c']);
});

test('Single Elimination BYEs and played feeders retain their owned destination slots', async () => {
  const byeSecond = createFakePrisma({ format: 'SINGLE_ELIMINATION' });
  const rounds = await generateSingleEliminationBracket({
    db: byeSecond.tx,
    tournamentId: 'tournament-1',
    players: [{ userId: 'a' }, { userId: 'b' }, { userId: 'c' }],
  });
  const [playedFirst, automaticBye] = rounds[0];
  const final = rounds[1][0];
  assert.equal(byeSecond.records.get(final.id).player2Id, 'c');
  await complete(byeSecond.prisma, playedFirst.id);
  assert.deepEqual([byeSecond.records.get(final.id).player1Id, byeSecond.records.get(final.id).player2Id], ['a', 'c']);
  await assert.rejects(() => complete(byeSecond.prisma, automaticBye.id), /BYE/);

  const byeFirst = createFakePrisma({
    format: 'SINGLE_ELIMINATION',
    matches: [
      { id: 'bye-first', tournamentId: 'tournament-1', round: 1, matchNumber: 1, player1Id: 'a', status: 'BYE', winnerId: 'a', nextMatchId: 'final' },
      { id: 'played-second', tournamentId: 'tournament-1', round: 1, matchNumber: 2, player1Id: 'b', player2Id: 'c', status: 'PENDING', nextMatchId: 'final' },
      { id: 'final', tournamentId: 'tournament-1', round: 2, matchNumber: 3, player1Id: 'a', player2Id: null, status: 'PENDING' },
    ],
  });
  await complete(byeFirst.prisma, 'played-second');
  assert.deepEqual([byeFirst.records.get('final').player1Id, byeFirst.records.get('final').player2Id], ['a', 'b']);
});

test('Single Elimination accepts an already-correct participant in its owned slot', async () => {
  const fixture = createFakePrisma({
    format: 'SINGLE_ELIMINATION',
    matches: [
      { id: 'source', tournamentId: 'tournament-1', round: 1, matchNumber: 1, player1Id: 'a', player2Id: 'b', status: 'PENDING', nextMatchId: 'final' },
      { id: 'final', tournamentId: 'tournament-1', round: 2, matchNumber: 3, player1Id: 'a', player2Id: null, status: 'PENDING' },
    ],
  });
  await complete(fixture.prisma, 'source');
  assert.equal(fixture.records.get('final').player1Id, 'a');
});

test('Single Elimination rejects a different participant in the feeder-owned slot', async () => {
  const fixture = createFakePrisma({
    format: 'SINGLE_ELIMINATION',
    matches: [
      { id: 'source', tournamentId: 'tournament-1', round: 1, matchNumber: 1, player1Id: 'a', player2Id: 'b', status: 'PENDING', nextMatchId: 'final' },
      { id: 'final', tournamentId: 'tournament-1', round: 2, matchNumber: 3, player1Id: 'intruder', player2Id: null, status: 'PENDING' },
    ],
  });
  await assert.rejects(() => complete(fixture.prisma, 'source'), /occupied by a different participant/);
  assert.equal(fixture.records.get('source').status, 'IN_PROGRESS');
  assert.equal(fixture.records.get('final').player1Id, 'intruder');
});

test('legacy Double Elimination brackets without explicit routes retain their paired nextMatchId feeder slots', async () => {
  const fixture = createFakePrisma({
    format: 'DOUBLE_ELIMINATION',
    matches: [
      { id: 'match-1', tournamentId: 'tournament-1', round: 1, matchNumber: 1, player1Id: 'a', player2Id: 'b', status: 'PENDING', nextMatchId: 'match-5', bracketStage: 'WINNERS' },
      { id: 'match-2', tournamentId: 'tournament-1', round: 1, matchNumber: 2, player1Id: 'c', player2Id: 'd', status: 'PENDING', nextMatchId: 'match-5', bracketStage: 'WINNERS' },
      { id: 'match-3', tournamentId: 'tournament-1', round: 1, matchNumber: 3, player1Id: 'e', player2Id: 'f', status: 'PENDING', nextMatchId: 'match-6', bracketStage: 'WINNERS' },
      { id: 'match-4', tournamentId: 'tournament-1', round: 1, matchNumber: 4, player1Id: 'g', player2Id: 'h', status: 'PENDING', nextMatchId: 'match-6', bracketStage: 'WINNERS' },
      { id: 'match-5', tournamentId: 'tournament-1', round: 2, matchNumber: 5, player1Id: null, player2Id: null, status: 'PENDING', nextMatchId: 'match-7', bracketStage: 'WINNERS' },
      { id: 'match-6', tournamentId: 'tournament-1', round: 2, matchNumber: 6, player1Id: null, player2Id: null, status: 'PENDING', nextMatchId: 'match-7', bracketStage: 'WINNERS' },
      { id: 'match-7', tournamentId: 'tournament-1', round: 3, matchNumber: 7, player1Id: null, player2Id: null, status: 'PENDING', bracketStage: 'WINNERS' },
    ],
  });

  await complete(fixture.prisma, 'match-3');
  await complete(fixture.prisma, 'match-4');
  assert.deepEqual([fixture.records.get('match-6').player1Id, fixture.records.get('match-6').player2Id], ['e', 'g']);
});

test('Double Elimination winners and losers routes use their configured opposite slots', async () => {
  const fixture = createFakePrisma({ format: 'DOUBLE_ELIMINATION' });
  await generateDoubleEliminationBracket({ db: fixture.tx, tournamentId: 'tournament-1', players: [{ userId: 'a' }, { userId: 'b' }, { userId: 'c' }, { userId: 'd' }] });
  const matches = [...fixture.records.values()].sort((a, b) => a.matchNumber - b.matchNumber);

  await complete(fixture.prisma, matches[0].id, 5, 3);
  await complete(fixture.prisma, matches[1].id, 3, 5);

  assert.equal(fixture.records.get(matches[2].id).player1Id, 'a');
  assert.equal(fixture.records.get(matches[2].id).player2Id, 'd');
  assert.equal(fixture.records.get(matches[3].id).player1Id, 'b');
  assert.equal(fixture.records.get(matches[3].id).player2Id, 'c');
  assert.equal(fixture.effects.fees, 2);
});

test('Double Elimination feeder slots remain deterministic when 4- and 8-player matches finish in reverse order', async () => {
  const four = createFakePrisma({ format: 'DOUBLE_ELIMINATION' });
  await generateDoubleEliminationBracket({ db: four.tx, tournamentId: 'tournament-1', players: [{ userId: 'a' }, { userId: 'b' }, { userId: 'c' }, { userId: 'd' }] });
  const fourMatches = [...four.records.values()].sort((a, b) => a.matchNumber - b.matchNumber);
  await complete(four.prisma, fourMatches[1].id, 3, 5);
  await complete(four.prisma, fourMatches[0].id, 5, 3);
  assert.deepEqual([four.records.get(fourMatches[2].id).player1Id, four.records.get(fourMatches[2].id).player2Id], ['a', 'd']);
  assert.deepEqual([four.records.get(fourMatches[3].id).player1Id, four.records.get(fourMatches[3].id).player2Id], ['b', 'c']);

  const eight = createFakePrisma({ format: 'DOUBLE_ELIMINATION' });
  await generateDoubleEliminationBracket({ db: eight.tx, tournamentId: 'tournament-1', players: Array.from('abcdefgh', (userId) => ({ userId })) });
  const eightMatches = [...eight.records.values()].sort((a, b) => a.matchNumber - b.matchNumber);
  await complete(eight.prisma, eightMatches[1].id, 3, 5);
  await complete(eight.prisma, eightMatches[0].id, 5, 3);
  assert.deepEqual([eight.records.get(eightMatches[4].id).player1Id, eight.records.get(eightMatches[4].id).player2Id], ['a', 'd']);
  assert.deepEqual([eight.records.get(eightMatches[7].id).player1Id, eight.records.get(eightMatches[7].id).player2Id], ['b', 'c']);
});

test('Losers progression, Winners Final, and Losers Final route into their deterministic destinations', async () => {
  const fixture = createFakePrisma({ format: 'DOUBLE_ELIMINATION' });
  await generateDoubleEliminationBracket({ db: fixture.tx, tournamentId: 'tournament-1', players: [{ userId: 'a' }, { userId: 'b' }, { userId: 'c' }, { userId: 'd' }] });
  const matches = [...fixture.records.values()].sort((a, b) => a.matchNumber - b.matchNumber);
  await complete(fixture.prisma, matches[0].id, 5, 1); // a over b
  await complete(fixture.prisma, matches[1].id, 1, 5); // d over c
  await complete(fixture.prisma, matches[3].id, 5, 2); // b over c -> Losers Final p1
  await complete(fixture.prisma, matches[2].id, 5, 4); // a over d -> GF p1, d -> Losers Final p2
  await complete(fixture.prisma, matches[4].id, 5, 2); // b over d -> GF p2

  assert.equal(fixture.records.get(matches[4].id).player1Id, 'b');
  assert.equal(fixture.records.get(matches[4].id).player2Id, 'd');
  assert.equal(fixture.records.get(matches[5].id).player1Id, 'a');
  assert.equal(fixture.records.get(matches[5].id).player2Id, 'b');
});

test('a first loss routes into the Losers Bracket and a second loss does not advance again', async () => {
  const fixture = createFakePrisma({ format: 'DOUBLE_ELIMINATION' });
  await generateDoubleEliminationBracket({ db: fixture.tx, tournamentId: 'tournament-1', players: [{ userId: 'a' }, { userId: 'b' }, { userId: 'c' }, { userId: 'd' }] });
  const matches = [...fixture.records.values()].sort((a, b) => a.matchNumber - b.matchNumber);

  await complete(fixture.prisma, matches[0].id, 5, 2); // b receives first loss
  await complete(fixture.prisma, matches[1].id, 5, 2); // d receives first loss
  assert.deepEqual([fixture.records.get(matches[3].id).player1Id, fixture.records.get(matches[3].id).player2Id], ['b', 'd']);

  await complete(fixture.prisma, matches[3].id, 2, 5); // b receives second loss
  const futureForB = [...fixture.records.values()].filter((match) =>
    ['PENDING', 'IN_PROGRESS'].includes(match.status) && (match.player1Id === 'b' || match.player2Id === 'b')
  );
  assert.deepEqual(futureForB, []);
  assert.equal(fixture.records.get(matches[4].id).player1Id, 'd');
});

for (const count of [5, 6, 7]) {
  test(`${count}-player Double Elimination can progress through all structural byes to a champion`, async () => {
    const fixture = createFakePrisma({ format: 'DOUBLE_ELIMINATION' });
    await generateDoubleEliminationBracket({
      db: fixture.tx,
      tournamentId: 'tournament-1',
      players: Array.from({ length: count }, (_, index) => ({ userId: `player-${index + 1}` })),
    });

    let lastResult = null;
    for (let step = 0; step < 20 && fixture.effects.completions.length === 0; step += 1) {
      const playable = [...fixture.records.values()].find((match) => match.status === 'PENDING' && !match.isResetFinal && match.player1Id && match.player2Id);
      assert.ok(playable, `Bracket became stuck after ${step} played matches`);
      lastResult = await complete(fixture.prisma, playable.id, 5, 2);
    }

    assert.equal(lastResult?.tournamentCompleted, true);
    assert.equal(fixture.effects.completions.at(-1)?.status, 'COMPLETED');
    assert.equal(fixture.effects.champions.length, 1);
    const unresolvedImpossible = [...fixture.records.values()].filter((match) => !match.isResetFinal && match.status === 'PENDING' && !match.player1Id && !match.player2Id);
    assert.deepEqual(unresolvedImpossible, []);
  });
}

test('Grand Final resolves for Winners champion or activates exactly one Reset Final for Losers champion', async () => {
  const buildFinal = async () => {
    const fixture = createFakePrisma({ format: 'DOUBLE_ELIMINATION' });
    await generateDoubleEliminationBracket({ db: fixture.tx, tournamentId: 'tournament-1', players: [{ userId: 'a' }, { userId: 'b' }, { userId: 'c' }, { userId: 'd' }] });
    const matches = [...fixture.records.values()].sort((a, b) => a.matchNumber - b.matchNumber);
    await complete(fixture.prisma, matches[0].id, 5, 1);
    await complete(fixture.prisma, matches[1].id, 1, 5);
    await complete(fixture.prisma, matches[3].id, 5, 1);
    await complete(fixture.prisma, matches[2].id, 5, 3);
    await complete(fixture.prisma, matches[4].id, 5, 1);
    return { fixture, matches };
  };
  const winnersCase = await buildFinal();
  const winnersResult = await complete(winnersCase.fixture.prisma, winnersCase.matches[5].id, 5, 2);
  assert.equal(winnersResult.bracketResolved, true);
  assert.equal(winnersResult.tournamentCompleted, true);
  assert.equal(winnersCase.fixture.effects.champions[0].userId, 'a');
  assert.equal(winnersCase.fixture.records.get(winnersCase.matches[6].id).player1Id, null);

  const resetCase = await buildFinal();
  const resetResult = await complete(resetCase.fixture.prisma, resetCase.matches[5].id, 2, 5);
  assert.equal(resetResult.bracketResolved, false);
  assert.equal(resetResult.resetRequired, true);
  assert.equal(resetCase.fixture.effects.completions.length, 0);
  assert.deepEqual([resetCase.fixture.records.get(resetCase.matches[6].id).player1Id, resetCase.fixture.records.get(resetCase.matches[6].id).player2Id], ['a', 'b']);
  const resolved = await complete(resetCase.fixture.prisma, resetCase.matches[6].id, 5, 4);
  assert.equal(resolved.bracketResolved, true);
  assert.equal(resolved.winnerId, 'a');
  assert.equal(resolved.tournamentCompleted, true);
  assert.equal((await complete(resetCase.fixture.prisma, resetCase.matches[6].id)).alreadyCompleted, true);
});

test('destination conflicts roll back the completed result, fee, and participant routing', async () => {
  const fixture = createFakePrisma({ format: 'DOUBLE_ELIMINATION' });
  await generateDoubleEliminationBracket({ db: fixture.tx, tournamentId: 'tournament-1', players: [{ userId: 'a' }, { userId: 'b' }, { userId: 'c' }, { userId: 'd' }] });
  const matches = [...fixture.records.values()].sort((a, b) => a.matchNumber - b.matchNumber);
  fixture.records.set(matches[2].id, { ...fixture.records.get(matches[2].id), player1Id: 'intruder' });

  await assert.rejects(() => complete(fixture.prisma, matches[0].id), /occupied by a different participant/);
  assert.equal(fixture.records.get(matches[0].id).status, 'IN_PROGRESS');
  assert.equal(fixture.effects.fees, 0);
});

test('an insufficient match loser balance creates one persistent full 200-credit liability without overdraft', async () => {
  const fixture = createFakePrisma({
    format: 'SINGLE_ELIMINATION', balance: 199,
    matches: [{ id: 'match-1', tournamentId: 'tournament-1', player1Id: 'a', player2Id: 'b', status: 'PENDING' }],
  });
  await complete(fixture.prisma, 'match-1');
  const retry = await complete(fixture.prisma, 'match-1');

  assert.equal(fixture.effects.fees, 0);
  assert.equal(fixture.effects.liabilities.length, 1);
  assert.deepEqual(fixture.effects.liabilities[0], {
    userId: 'b', tournamentId: 'tournament-1', tournamentMatchId: 'match-1', feeType: 'TOURNAMENT_MATCH_LOSS', amount: 200, status: 'PENDING',
  });
  assert.equal(retry.alreadyCompleted, true);
  assert.equal(fixture.effects.liabilities.length, 1);
});

test('a true Single Elimination final persists one champion and actual completion, while a non-final does not', async () => {
  const finalFixture = createFakePrisma({ format: 'SINGLE_ELIMINATION', matches: [{ id: 'final', tournamentId: 'tournament-1', round: 2, player1Id: 'a', player2Id: 'b', status: 'PENDING' }] });
  const finalResult = await complete(finalFixture.prisma, 'final');
  assert.equal(finalResult.tournamentCompleted, true);
  assert.equal(finalFixture.effects.completions.length, 1);
  assert.equal(finalFixture.effects.completions[0].status, 'COMPLETED');
  assert.equal(finalFixture.effects.champions[0].userId, 'a');
  assert.deepEqual(finalFixture.effects.profileData[0], { totalWins: { increment: 1 }, totalGames: { increment: 1 }, xp: { increment: 75 }, winStreak: { increment: 1 } });
  assert.deepEqual(finalFixture.effects.profileData[1], { totalLosses: { increment: 1 }, totalGames: { increment: 1 }, xp: { increment: 25 }, winStreak: 0 });
  assert.ok(finalFixture.effects.profileData.some((data) => data.xp?.increment === 150));
  assert.equal(finalFixture.effects.loyaltyRewards[0].creditsAwarded, 120);
  assert.equal(finalFixture.effects.creditTransactions.find((data) => data.type === 'LOYALTY_REWARD').amount, 120);
  await complete(finalFixture.prisma, 'final');
  assert.equal(finalFixture.effects.completions.length, 1);
  assert.equal(finalFixture.effects.loyaltyRewards.length, 1);
  assert.equal(finalFixture.effects.creditTransactions.filter((data) => data.type === 'LOYALTY_REWARD').length, 1);

  const semiFixture = createFakePrisma({ format: 'SINGLE_ELIMINATION', matches: [
    { id: 'semi', tournamentId: 'tournament-1', round: 1, player1Id: 'a', player2Id: 'b', status: 'PENDING', nextMatchId: 'final' },
    { id: 'final', tournamentId: 'tournament-1', round: 2, player1Id: null, player2Id: null, status: 'PENDING' },
  ] });
  await complete(semiFixture.prisma, 'semi');
  assert.equal(semiFixture.effects.completions.length, 0);
  assert.equal(semiFixture.effects.champions.length, 0);
});

test('an unpaid live tournament result releases only its owned table without normal session billing and remains idempotent', async () => {
  const table = { id: 'table-1', status: 'OCCUPIED' };
  const fixture = createFakePrisma({
    format: 'SINGLE_ELIMINATION', balance: 50, table,
    matches: [
      { id: 'live', tournamentId: 'tournament-1', round: 1, player1Id: 'a', player2Id: 'b', tableId: 'table-1', scheduledAt: new Date('2026-08-10T10:00:00Z'), startedAt: new Date('2026-08-10T10:00:00Z'), status: 'IN_PROGRESS', nextMatchId: 'final' },
      { id: 'final', tournamentId: 'tournament-1', round: 2, player1Id: null, player2Id: null, status: 'PENDING' },
    ],
  });
  const result = await complete(fixture.prisma, 'live');
  assert.equal(fixture.records.get('live').status, 'COMPLETED');
  assert.equal(fixture.records.get('final').player1Id, 'a');
  assert.equal(fixture.effects.liabilities.length, 1);
  assert.equal(fixture.effects.liabilities[0].amount, 200);
  assert.equal(fixture.effects.fees, 0);
  assert.equal(table.status, 'AVAILABLE');
  assert.equal(fixture.effects.tableUpdates, 1);
  assert.equal(fixture.prisma.tableSession, undefined);
  assert.equal(result.releasedTableId, 'table-1');
  await complete(fixture.prisma, 'live');
  assert.equal(fixture.effects.liabilities.length, 1);
  assert.equal(fixture.effects.tableUpdates, 1);
  assert.equal(fixture.records.get('final').player1Id, 'a');
});
