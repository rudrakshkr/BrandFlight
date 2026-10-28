-- Persist image audit results with submissions and immutable revision snapshots.
ALTER TABLE "Submission"
ADD COLUMN "imageAuditData" JSONB;

ALTER TABLE "Revision"
ADD COLUMN "imageName" TEXT,
ADD COLUMN "imageAltText" TEXT,
ADD COLUMN "imageAuditData" JSONB;
