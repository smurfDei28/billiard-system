const amount = (value) => Number(value || 0);
const dateKey = (value) => new Date(value).toISOString().split('T')[0];
const isAcquireMockSandboxTopup = (transaction) => String(transaction.referenceNo || '').startsWith('ACQUIREMOCK-');

const isCreditPaidOrder = (order) => Boolean(order.paidWithCredits) || order.paymentMethod === 'LOYALTY_CREDIT';

// Cash Revenue means money collected externally. Wallet spending is reported as
// usage/sales value, never added to cash collections a second time.
const summarizeRevenue = ({ orders = [], topups = [], tournamentPayments = [], sessions = [], walletTournamentFees = [] }) => {
  const posSalesValue = orders.reduce((sum, order) => sum + amount(order.total), 0);
  const cashPosSales = orders.filter((order) => !isCreditPaidOrder(order)).reduce((sum, order) => sum + amount(order.total), 0);
  const creditPosSales = posSalesValue - cashPosSales;
  const creditTopups = topups.filter((transaction) => !isAcquireMockSandboxTopup(transaction)).reduce((sum, transaction) => sum + amount(transaction.amount), 0);
  const tournamentCashCollections = tournamentPayments.reduce((sum, payment) => sum + amount(payment.amount), 0);
  const tableUsageValue = sessions.reduce((sum, session) => sum + amount(session.creditsUsed), 0);
  const walletTournamentFeeValue = walletTournamentFees.reduce((sum, transaction) => sum + amount(transaction.amount), 0);

  return {
    cashRevenue: cashPosSales + creditTopups + tournamentCashCollections,
    posSalesValue,
    cashPosSales,
    creditPosSales,
    creditTopups,
    tournamentCashCollections,
    tableUsageValue,
    walletTournamentFeeValue,
  };
};

const buildDailyRevenue = ({ orders = [], topups = [], tournamentPayments = [], sessions = [], walletTournamentFees = [] }) => {
  const days = new Map();
  const getDay = (value) => {
    const key = dateKey(value);
    if (!days.has(key)) days.set(key, {
      date: key, cashRevenue: 0, orders: 0, posSalesValue: 0, cashPosSales: 0,
      creditPosSales: 0, creditTopups: 0, tournamentCashCollections: 0,
      tableUsageValue: 0, walletTournamentFeeValue: 0,
    });
    return days.get(key);
  };

  orders.forEach((order) => {
    const day = getDay(order.createdAt);
    const value = amount(order.total);
    day.orders += 1;
    day.posSalesValue += value;
    if (isCreditPaidOrder(order)) day.creditPosSales += value;
    else { day.cashPosSales += value; day.cashRevenue += value; }
  });
  topups.filter((transaction) => !isAcquireMockSandboxTopup(transaction)).forEach((transaction) => {
    const day = getDay(transaction.createdAt);
    const value = amount(transaction.amount);
    day.creditTopups += value;
    day.cashRevenue += value;
  });
  tournamentPayments.forEach((payment) => {
    const day = getDay(payment.reviewedAt || payment.createdAt);
    const value = amount(payment.amount);
    day.tournamentCashCollections += value;
    day.cashRevenue += value;
  });
  sessions.forEach((session) => { getDay(session.createdAt).tableUsageValue += amount(session.creditsUsed); });
  walletTournamentFees.forEach((transaction) => { getDay(transaction.createdAt).walletTournamentFeeValue += amount(transaction.amount); });
  return [...days.values()].sort((left, right) => left.date.localeCompare(right.date));
};

module.exports = { isCreditPaidOrder, isAcquireMockSandboxTopup, summarizeRevenue, buildDailyRevenue };
