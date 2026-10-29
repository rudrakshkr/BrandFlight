-- Server-generated audit receipts bind findings to the exact audited input and active brand configuration.
CREATE TYPE "AuditReceiptKind" AS ENUM ('TEXT', 'IMAGE');

CREATE TABLE "AuditReceipt" (
    "id" TEXT NOT NULL,
    "kind" "AuditReceiptKind" NOT NULL,
    "userId" TEXT NOT NULL,
    "brandProfileId" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "configHash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditReceipt_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Submission"
    ADD COLUMN "textAuditReceiptId" TEXT,
    ADD COLUMN "imageAuditReceiptId" TEXT;

CREATE INDEX "AuditReceipt_userId_kind_createdAt_idx"
    ON "AuditReceipt"("userId", "kind", "createdAt");
CREATE INDEX "AuditReceipt_brandProfileId_kind_createdAt_idx"
    ON "AuditReceipt"("brandProfileId", "kind", "createdAt");

ALTER TABLE "AuditReceipt"
    ADD CONSTRAINT "AuditReceipt_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditReceipt"
    ADD CONSTRAINT "AuditReceipt_brandProfileId_fkey"
    FOREIGN KEY ("brandProfileId") REFERENCES "BrandProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Submission"
    ADD CONSTRAINT "Submission_textAuditReceiptId_fkey"
    FOREIGN KEY ("textAuditReceiptId") REFERENCES "AuditReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Submission"
    ADD CONSTRAINT "Submission_imageAuditReceiptId_fkey"
    FOREIGN KEY ("imageAuditReceiptId") REFERENCES "AuditReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
