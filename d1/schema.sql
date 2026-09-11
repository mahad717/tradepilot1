-- CreateTable
CREATE TABLE "SavedSignal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "email" TEXT,
    "symbol" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "entry" REAL NOT NULL,
    "stopLoss" REAL NOT NULL,
    "targets" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "grade" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "outcomeR" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "BacktestRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "email" TEXT,
    "symbol" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "bars" INTEGER NOT NULL,
    "fromAt" DATETIME,
    "toAt" DATETIME,
    "params" TEXT NOT NULL,
    "metrics" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "SavedSignal_userId_createdAt_idx" ON "SavedSignal"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "BacktestRun_userId_createdAt_idx" ON "BacktestRun"("userId", "createdAt");

