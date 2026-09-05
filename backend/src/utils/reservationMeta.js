const PAYMENT_TAG_REGEX = /^\[PAYMENT:(CASH|CREDITS)\]\s*/;

const encodeReservationNotes = (notes = '', paymentMethod = 'CREDITS') => {
  const safeMethod = paymentMethod === 'CASH' ? 'CASH' : 'CREDITS';
  const cleanNotes = String(notes || '').trim();
  return `[PAYMENT:${safeMethod}]${cleanNotes ? `\n${cleanNotes}` : ''}`;
};

const parseReservationPaymentMethod = (notes = '') => {
  const match = String(notes || '').match(PAYMENT_TAG_REGEX);
  return match?.[1] || 'CREDITS';
};

const stripReservationNotesMeta = (notes = '') => {
  return String(notes || '').replace(PAYMENT_TAG_REGEX, '').trim();
};

const mapReservationResponse = (reservation) => ({
  ...reservation,
  paymentMethod: parseReservationPaymentMethod(reservation.notes),
  notes: stripReservationNotesMeta(reservation.notes),
});

module.exports = {
  encodeReservationNotes,
  parseReservationPaymentMethod,
  stripReservationNotesMeta,
  mapReservationResponse,
};
