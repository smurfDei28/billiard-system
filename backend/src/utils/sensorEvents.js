const VALID_POCKETS = Object.freeze([
  'TOP_LEFT', 'TOP_RIGHT', 'MIDDLE_LEFT',
  'MIDDLE_RIGHT', 'BOTTOM_LEFT', 'BOTTOM_RIGHT',
]);
const VISION_BALL_LABELS = Object.freeze(['solid', 'stripe', 'eight', 'cue']);

const normalizePocketEvent = (body = {}) => {
  const event = {
    tableId: typeof body.tableId === 'string' ? body.tableId.trim() : '',
    sessionId: typeof body.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : null,
    eventId: typeof body.eventId === 'string' && body.eventId.trim() ? body.eventId.trim() : null,
    pocket: typeof body.pocket === 'string' ? body.pocket.trim().toUpperCase() : '',
    ballColor: typeof body.ballColor === 'string' && body.ballColor.trim() ? body.ballColor.trim().toLowerCase() : null,
    source: body.source === 'CAMERA_VISION' ? 'CAMERA_VISION' : 'PHYSICAL_SENSOR',
    confidence: body.confidence === undefined || body.confidence === null ? null : Number(body.confidence),
    rawSignal: body.rawSignal === undefined || body.rawSignal === null ? null : Number(body.rawSignal),
    requiresConfirmation: body.requiresConfirmation === true,
  };

  if (!event.tableId || !event.pocket) return { error: 'tableId and pocket are required' };
  if (!VALID_POCKETS.includes(event.pocket)) {
    return { error: `Invalid pocket. Must be one of: ${VALID_POCKETS.join(', ')}` };
  }
  if (event.confidence !== null && (!Number.isFinite(event.confidence) || event.confidence < 0 || event.confidence > 1)) {
    return { error: 'confidence must be a number from 0 to 1' };
  }
  if (event.rawSignal !== null && !Number.isFinite(event.rawSignal)) return { error: 'rawSignal must be numeric' };

  if (event.source === 'CAMERA_VISION') {
    if (!event.sessionId || !event.eventId) return { error: 'Camera events require sessionId and eventId' };
    if (!VISION_BALL_LABELS.includes(event.ballColor)) {
      return { error: `Camera ballColor must be one of: ${VISION_BALL_LABELS.join(', ')}` };
    }
    if (event.requiresConfirmation) {
      return { error: 'This camera event requires staff confirmation', requiresConfirmation: true };
    }
  }

  return { event };
};

const findDuplicateEvent = (ballsPotted, eventId) => {
  if (!eventId || !Array.isArray(ballsPotted)) return null;
  return ballsPotted.find((item) => item && item.eventId === eventId) || null;
};

module.exports = {
  VALID_POCKETS,
  VISION_BALL_LABELS,
  normalizePocketEvent,
  findDuplicateEvent,
};

