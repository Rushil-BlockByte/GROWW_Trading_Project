-- CreateTable
CREATE TABLE "ReportReview" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cadence" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "selectedReportIds" JSONB NOT NULL,
    "comparison" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportReview_userId_idx" ON "ReportReview"("userId");

-- CreateIndex
CREATE INDEX "ReportReview_cadence_idx" ON "ReportReview"("cadence");

-- CreateIndex
CREATE INDEX "ReportReview_periodStart_idx" ON "ReportReview"("periodStart");

-- CreateIndex
CREATE INDEX "ReportReview_periodEnd_idx" ON "ReportReview"("periodEnd");

-- CreateIndex
CREATE INDEX "ReportReview_createdAt_idx" ON "ReportReview"("createdAt");

-- AddForeignKey
ALTER TABLE "ReportReview" ADD CONSTRAINT "ReportReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
