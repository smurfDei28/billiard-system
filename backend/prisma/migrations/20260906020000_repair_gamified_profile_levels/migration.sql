-- Repair derived gamification fields without changing XP, statistics, badges,
-- users, transactions, or any gameplay history.
UPDATE "gamified_profiles"
SET
  "level" = CASE
    WHEN "xp" >= 2000 THEN 5
    WHEN "xp" >= 1000 THEN 4
    WHEN "xp" >= 500 THEN 3
    WHEN "xp" >= 200 THEN 2
    ELSE 1
  END,
  "rank" = CASE
    WHEN "xp" >= 2000 THEN 'Elite'
    WHEN "xp" >= 1000 THEN 'Legend'
    WHEN "xp" >= 500 THEN 'Shark'
    WHEN "xp" >= 200 THEN 'Hustler'
    ELSE 'Rookie'
  END;
