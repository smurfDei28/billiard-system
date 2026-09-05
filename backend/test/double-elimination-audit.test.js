const assert = require('node:assert/strict');
const test = require('node:test');

const { auditDoubleEliminationTournament } = require('../scripts/audit-double-elimination');
const { repairLegacyDoubleEliminationBracket } = require('../src/services/repairLegacyDoubleElimination.service');

const dbFor = (tournament) => ({ tournament: { findUnique: async () => tournament } });

test('audit identifies the legacy winners-only bracket without changing it', async () => {
  const tournament = {
    id: 'legacy', name: 'Existing Tournament', format: 'DOUBLE_ELIMINATION', status: 'IN_PROGRESS', entries: Array.from({ length: 5 }, (_, index) => ({ userId: `p${index}`, status: 'APPROVED' })),
    matches: Array.from({ length: 7 }, (_, index) => ({
      id: `m${index + 1}`, round: index < 4 ? 1 : index < 6 ? 2 : 3, matchNumber: index + 1,
      player1Id: index < 3 ? `p${index}` : null, player2Id: index < 2 ? `p${index + 2}` : null,
      player1Score: 0, player2Score: 0, winnerId: null, status: 'PENDING', nextMatchId: null,
      nextWinnerMatchId: null, nextLoserMatchId: null, bracketStage: 'WINNERS', isLosers: false, isGrandFinal: false, isResetFinal: false,
    })),
  };
  const before = JSON.stringify(tournament);
  const report = await auditDoubleEliminationTournament(dbFor(tournament), tournament.id);

  assert.equal(report.legacyWinnersOnly, true);
  assert.equal(report.requiresTournamentSpecificRepair, true);
  assert.equal(report.hasLosersBracket, false);
  assert.equal(JSON.stringify(tournament), before);
});

test('audit recognizes a complete explicit Double Elimination structure', async () => {
  const tournament = {
    id: 'proper', name: 'Proper Tournament', format: 'DOUBLE_ELIMINATION', status: 'IN_PROGRESS', entries: [],
    matches: [
      { id: 'w', matchNumber: 1, status: 'COMPLETED', bracketStage: 'WINNERS', nextWinnerMatchId: 'gf', nextLoserMatchId: 'l' },
      { id: 'l', matchNumber: 2, status: 'PENDING', bracketStage: 'LOSERS', isLosers: true, nextWinnerMatchId: 'gf' },
      { id: 'gf', matchNumber: 3, status: 'PENDING', bracketStage: 'GRAND_FINAL', isGrandFinal: true },
      { id: 'rf', matchNumber: 4, status: 'PENDING', bracketStage: 'RESET_FINAL', isResetFinal: true },
    ],
  };
  const report = await auditDoubleEliminationTournament(dbFor(tournament), tournament.id);

  assert.equal(report.requiresTournamentSpecificRepair, false);
  assert.equal(report.hasLosersBracket, true);
  assert.equal(report.hasGrandFinal, true);
  assert.equal(report.hasResetFinal, true);
  assert.equal(report.hasExplicitRoutes, true);
});

test('tournament-specific repair preserves legacy results and adds only missing Double Elimination structure', async () => {
  const records = new Map([
    { id: 'm1', round: 1, matchNumber: 1, player1Id: 'p1', player2Id: 'p2', player1Score: 5, player2Score: 2, winnerId: 'p1', status: 'COMPLETED' },
    { id: 'm2', round: 1, matchNumber: 2, player1Id: 'p3', player2Id: 'p4', player1Score: 5, player2Score: 1, winnerId: 'p3', status: 'COMPLETED' },
    { id: 'm3', round: 1, matchNumber: 3, player1Id: 'p5', player2Id: null, player1Score: 0, player2Score: 0, winnerId: 'p5', status: 'BYE' },
    { id: 'm4', round: 1, matchNumber: 4, player1Id: null, player2Id: null, player1Score: 0, player2Score: 0, winnerId: null, status: 'PENDING' },
    { id: 'm5', round: 2, matchNumber: 5, player1Id: 'p1', player2Id: 'p3', player1Score: 0, player2Score: 0, winnerId: null, status: 'PENDING' },
    { id: 'm6', round: 2, matchNumber: 6, player1Id: 'p5', player2Id: null, player1Score: 0, player2Score: 0, winnerId: null, status: 'PENDING' },
    { id: 'm7', round: 3, matchNumber: 7, player1Id: null, player2Id: null, player1Score: 0, player2Score: 0, winnerId: null, status: 'PENDING' },
  ].map((match) => [match.id, { tournamentId: 'legacy-5', nextMatchId: null, nextWinnerMatchId: null, nextLoserMatchId: null, bracketStage: 'WINNERS', isLosers: false, isGrandFinal: false, isResetFinal: false, ...match }]));
  let sequence = 7;
  const tournament = { id: 'legacy-5', format: 'DOUBLE_ELIMINATION', status: 'IN_PROGRESS', entries: Array.from({ length: 5 }, (_, index) => ({ userId: `p${index + 1}` })) };
  const db = {
    tournament: { findUnique: async () => ({ ...tournament, matches: [...records.values()].sort((a, b) => a.matchNumber - b.matchNumber) }) },
    tournamentMatch: {
      create: async ({ data }) => { const match = { id: `m${++sequence}`, ...data }; records.set(match.id, match); return { ...match }; },
      update: async ({ where: { id }, data }) => { const match = { ...records.get(id), ...data }; records.set(id, match); return { ...match }; },
      findMany: async () => [...records.values()].sort((a, b) => a.matchNumber - b.matchNumber).map((match) => ({ ...match })),
    },
  };
  const originalCompleted = { ...records.get('m1') };
  const result = await repairLegacyDoubleEliminationBracket({ db, tournamentId: tournament.id });

  assert.equal(result.repaired, true);
  assert.equal(result.createdMatchCount, 8);
  assert.equal(records.size, 15);
  assert.deepEqual(
    { player1Id: records.get('m1').player1Id, player2Id: records.get('m1').player2Id, player1Score: records.get('m1').player1Score, player2Score: records.get('m1').player2Score, winnerId: records.get('m1').winnerId, status: records.get('m1').status },
    { player1Id: originalCompleted.player1Id, player2Id: originalCompleted.player2Id, player1Score: originalCompleted.player1Score, player2Score: originalCompleted.player2Score, winnerId: originalCompleted.winnerId, status: originalCompleted.status },
  );
  assert.deepEqual([records.get('m8').player1Id, records.get('m8').player2Id], ['p2', 'p4']);
  assert.equal([...records.values()].some((match) => match.bracketStage === 'LOSERS'), true);
  assert.equal([...records.values()].some((match) => match.isGrandFinal), true);
  assert.equal([...records.values()].some((match) => match.isResetFinal), true);
  assert.equal(typeof db.tournamentMatch.deleteMany, 'undefined');
});
