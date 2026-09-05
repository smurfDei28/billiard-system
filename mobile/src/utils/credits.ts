export const normalizeCreditBalance = (value: unknown) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const rounded = Math.round((numeric + Number.EPSILON) * 100) / 100;
  return rounded === 0 ? 0 : rounded;
};

export const formatCredits = (value: unknown, maximumFractionDigits = 0) =>
  normalizeCreditBalance(value).toLocaleString('en-PH', { maximumFractionDigits });
