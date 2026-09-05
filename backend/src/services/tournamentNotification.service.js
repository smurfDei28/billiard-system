const formatLabel = (value) => String(value || '').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const localTime = (value) => value ? new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : null;

const notifyTournamentUsers = async ({ db, userIds, title, message, data = {} }) => {
  const uniqueUserIds = [...new Set((userIds || []).filter(Boolean))];
  if (!uniqueUserIds.length || !db.notification) return;
  await db.notification.createMany({
    data: uniqueUserIds.map((userId) => ({ userId, type: 'TOURNAMENT_MATCH', title, message, data })),
  });
};

const participantName = (entries, userId) => {
  const entry = (entries || []).find((item) => item.userId === userId);
  return entry?.user?.gamifiedProfile?.displayName || entry?.user?.firstName || 'your opponent';
};

module.exports = { formatLabel, localTime, notifyTournamentUsers, participantName };
