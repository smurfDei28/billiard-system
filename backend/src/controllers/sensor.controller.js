const prisma = require('../config/prisma');
const { updatePlayerRank } = require('../utils/gamification');
const { normalizePocketEvent, findDuplicateEvent } = require('../utils/sensorEvents');

// Raspberry Pi posts to this endpoint when a pocket sensor is triggered
const pocketDetected = async (req, res) => {
  const normalized = normalizePocketEvent(req.body);
  if (normalized.error) {
    return res.status(normalized.requiresConfirmation ? 422 : 400).json(normalized);
  }
  const { tableId, pocket, ballColor, rawSignal, confidence, sessionId, eventId, source } = normalized.event;

  try {
    // Camera retries are common on weak venue Wi-Fi.  Prevent one physical pot
    // from being appended twice when the client retries the same event ID.
    let gameScore = null;
    if (sessionId) {
      if (eventId) {
        const existingReading = await prisma.sensorReading.findUnique({ where: { eventId } });
        if (existingReading) {
          gameScore = await prisma.gameScore.findUnique({ where: { sessionId } });
          return res.json({ success: true, duplicate: true, reading: existingReading, gameScore });
        }
      }
      gameScore = await prisma.gameScore.findUnique({ where: { sessionId } });
      const duplicate = findDuplicateEvent(gameScore?.ballsPotted, eventId);
      if (duplicate) return res.json({ success: true, duplicate: true, gameScore, event: duplicate });
    }

    // Record sensor reading
    const reading = await prisma.sensorReading.create({
      data: {
        eventId,
        source,
        tableId,
        sessionId: sessionId || null,
        pocket,
        ballColor: ballColor || null,
        rawSignal,
        confidence,
      },
    });

    // Update game score if there's an active game session
    if (sessionId) {
      if (gameScore && gameScore.status === 'IN_PROGRESS') {
        // Update ballsPotted array
        const ballsPotted = Array.isArray(gameScore.ballsPotted) ? gameScore.ballsPotted : [];
        ballsPotted.push({
          pocket,
          ballColor: ballColor || 'unknown',
          timestamp: new Date().toISOString(),
          readingId: reading.id,
          eventId,
          source,
        });

        gameScore = await prisma.gameScore.update({
          where: { sessionId },
          data: { ballsPotted },
        });
      }
    }

    // Broadcast to all connected clients (TV display, app) via Socket.IO
    const io = req.app.get('io');
    const payload = {
      tableId,
      pocket,
      ballColor,
      confidence,
      eventId,
      source,
      timestamp: reading.triggeredAt,
      gameScore,
    };

    io.to(`table:${tableId}`).emit('sensor:pocket', payload);
    io.to('tv-display').emit('sensor:pocket', payload);
    io.to('staff-tablet').emit('sensor:pocket', payload);

    res.json({ success: true, reading, gameScore });
  } catch (err) {
    // A concurrent retry can pass the read check but will still be rejected by
    // the database's unique eventId constraint.
    if (err.code === 'P2002' && eventId) {
      const reading = await prisma.sensorReading.findUnique({ where: { eventId } });
      const gameScore = sessionId ? await prisma.gameScore.findUnique({ where: { sessionId } }) : null;
      return res.json({ success: true, duplicate: true, reading, gameScore });
    }
    console.error('[Sensor Error]', err);
    res.status(500).json({ error: 'Failed to record sensor reading' });
  }
};

// Start a new scored game session
const startGame = async (req, res) => {
  const { tableId, player1Name, player2Name, gameType, sessionId } = req.body;

  if (!tableId || !player1Name || !player2Name) {
    return res.status(400).json({ error: 'tableId, player1Name, player2Name required' });
  }

  try {
    // End any existing active game on this table
    await prisma.gameScore.updateMany({
      where: { tableId, status: 'IN_PROGRESS' },
      data: { status: 'ABANDONED', endedAt: new Date() },
    });

    const game = await prisma.gameScore.create({
      data: {
        sessionId: sessionId || `game_${tableId}_${Date.now()}`,
        tableId,
        player1Name,
        player2Name,
        gameType: gameType || '8-BALL',
        ballsPotted: [],
        status: 'IN_PROGRESS',
      },
    });

    const io = req.app.get('io');
    io.to(`table:${tableId}`).emit('game:started', game);
    io.to('tv-display').emit('game:started', game);

    res.json(game);
  } catch (err) {
    console.error('[Start Game Error]', err);
    res.status(500).json({ error: 'Failed to start game' });
  }
};

// Update player score manually (staff override)
const updateScore = async (req, res) => {
  const { sessionId } = req.params;
  const { player1Score, player2Score } = req.body;

  try {
    const game = await prisma.gameScore.update({
      where: { sessionId },
      data: {
        player1Score: player1Score ?? undefined,
        player2Score: player2Score ?? undefined,
      },
    });

    const io = req.app.get('io');
    io.to(`table:${game.tableId}`).emit('score:updated', game);
    io.to('tv-display').emit('score:updated', game);

    res.json(game);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update score' });
  }
};

// End game and declare winner
const endGame = async (req, res) => {
  const { sessionId } = req.params;
  const { winnerId, winnerName } = req.body;

  try {
    const game = await prisma.gameScore.update({
      where: { sessionId },
      data: { status: 'COMPLETED', winnerId, endedAt: new Date() },
    });

    // Update gamified profile stats if winner is a member
    if (winnerId) {
      const winner = await prisma.user.findUnique({ where: { id: winnerId } });
      if (winner) {
        await prisma.gamifiedProfile.update({
          where: { userId: winnerId },
          data: {
            totalWins: { increment: 1 },
            totalGames: { increment: 1 },
            winStreak: { increment: 1 },
          },
        });
        // Update rank based on wins
        await updatePlayerRank(prisma, winnerId);
      }
    }

    const io = req.app.get('io');
    io.to(`table:${game.tableId}`).emit('game:ended', game);
    io.to('tv-display').emit('game:ended', game);

    res.json(game);
  } catch (err) {
    res.status(500).json({ error: 'Failed to end game' });
  }
};

// Get live sensor readings for a table
const getLiveData = async (req, res) => {
  const { tableId } = req.params;
  try {
    const readings = await prisma.sensorReading.findMany({
      where: {
        tableId,
        triggeredAt: { gte: new Date(Date.now() - 3 * 60 * 60 * 1000) },
      },
      orderBy: { triggeredAt: 'desc' },
      take: 100,
    });

    const activeGame = await prisma.gameScore.findFirst({
      where: { tableId, status: 'IN_PROGRESS' },
    });

    res.json({ readings, activeGame });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get sensor data' });
  }
};

module.exports = { pocketDetected, startGame, updateScore, endGame, getLiveData };
