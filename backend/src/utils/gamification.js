const RANKS = Object.freeze([
  { name: 'Rookie', minXp: 0 },
  { name: 'Hustler', minXp: 200 },
  { name: 'Shark', minXp: 500 },
  { name: 'Legend', minXp: 1000 },
  { name: 'Elite', minXp: 2000 },
]);

const rankForXp = (xp = 0) => [...RANKS].reverse().find((rank) => Number(xp) >= rank.minXp)?.name || 'Rookie';
const levelForXp = (xp = 0) => RANKS.findIndex((rank) => rank.name === rankForXp(xp)) + 1;

const rankProgressForXp = (xp = 0) => {
  const currentIndex = RANKS.findIndex((rank) => rank.name === rankForXp(xp));
  const current = RANKS[currentIndex];
  const next = RANKS[currentIndex + 1] || null;
  const progress = next ? Math.min(1, Math.max(0, (Number(xp) - current.minXp) / (next.minXp - current.minXp))) : 1;
  return { current, next, progress };
};

const badgesForProfile = (profile, hasTournamentWin = false) => {
  const badges = new Set(profile?.badges || []);
  if (Number(profile?.totalWins || 0) > 0) badges.add('first_win');
  if (hasTournamentWin) badges.add('first_tournament_win');
  return [...badges];
};

const presentGamifiedProfile = (profile, hasTournamentWin = false) => profile && ({
  ...profile,
  rank: rankForXp(profile.xp),
  level: levelForXp(profile.xp),
  badges: badgesForProfile(profile, hasTournamentWin),
});

const updatePlayerRank = async (db, userId, { hasTournamentWin = false } = {}) => {
  const profile = await db.gamifiedProfile.findUnique({ where: { userId } });
  if (!profile) return null;
  return db.gamifiedProfile.update({
    where: { userId },
    data: { rank: rankForXp(profile.xp), level: levelForXp(profile.xp), badges: badgesForProfile(profile, hasTournamentWin) },
  });
};

module.exports = { RANKS, rankForXp, levelForXp, rankProgressForXp, badgesForProfile, presentGamifiedProfile, updatePlayerRank };
