/*
  Warnings:

  - A unique constraint covering the columns `[reference]` on the table `transactions` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "description" TEXT,
ADD COLUMN     "gameId" TEXT,
ADD COLUMN     "reference" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "role" TEXT NOT NULL DEFAULT 'Customer';

-- CreateTable
CREATE TABLE "game_sessions" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameType" TEXT NOT NULL,
    "stake" DOUBLE PRECISION NOT NULL,
    "luckyNumber" INTEGER,
    "winAmount" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'active',
    "result" TEXT,
    "rollHistory" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "game_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matka_slots" (
    "id" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "slotName" TEXT NOT NULL,
    "slotDate" TIMESTAMP(3) NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "result" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "matka_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matka_bets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "matkaSlotId" TEXT NOT NULL,
    "selectedNumber" INTEGER NOT NULL,
    "stakeAmount" DOUBLE PRECISION NOT NULL,
    "winAmount" DOUBLE PRECISION,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "matka_bets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "game_sessions_gameId_key" ON "game_sessions"("gameId");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_reference_key" ON "transactions"("reference");

-- AddForeignKey
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matka_bets" ADD CONSTRAINT "matka_bets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matka_bets" ADD CONSTRAINT "matka_bets_matkaSlotId_fkey" FOREIGN KEY ("matkaSlotId") REFERENCES "matka_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
