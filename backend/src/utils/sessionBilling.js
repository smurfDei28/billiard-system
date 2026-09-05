// Credits are peso-value, not minutes. Keep every table-session calculation
// here so starts, live monitoring, and final settlement agree on one rate.
const MINIMUM_BILLABLE_MINUTES = 30;

const roundCredits = (value) => {
  const rounded = Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  return rounded === 0 ? 0 : rounded;
};
// Wallet credits settle to two decimal places. This removes floating-point
// residue (including JavaScript's negative zero) without hiding real debt.
const normalizeCreditBalance = (value) => roundCredits(value);
const normalizePersistedCreditBalance = async (db, userId, balance) => {
  const normalized = normalizeCreditBalance(balance);
  if (!Object.is(Number(balance), normalized)) {
    await db.membership.update({ where: { userId }, data: { creditBalance: normalized } });
  }
  return normalized;
};
const minimumCharge = (ratePerHour) => roundCredits((Number(ratePerHour) * MINIMUM_BILLABLE_MINUTES) / 60);
const sessionCharge = (ratePerHour, elapsedMinutes) =>
  roundCredits((Number(ratePerHour) * Math.max(MINIMUM_BILLABLE_MINUTES, Math.max(0, Number(elapsedMinutes)))) / 60);
const elapsedMinutesAt = (startTime, now = new Date()) => Math.max(0, (new Date(now).getTime() - new Date(startTime).getTime()) / 60000);

module.exports = { MINIMUM_BILLABLE_MINUTES, roundCredits, normalizeCreditBalance, normalizePersistedCreditBalance, minimumCharge, sessionCharge, elapsedMinutesAt };
