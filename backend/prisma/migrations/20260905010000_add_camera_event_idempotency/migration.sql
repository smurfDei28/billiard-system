ALTER TABLE "sensor_readings"
ADD COLUMN "eventId" TEXT,
ADD COLUMN "source" TEXT NOT NULL DEFAULT 'PHYSICAL_SENSOR';

CREATE UNIQUE INDEX "sensor_readings_eventId_key" ON "sensor_readings"("eventId");

