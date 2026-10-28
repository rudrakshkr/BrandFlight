-- Add simple, consistent tags for organizing creator campaigns.
ALTER TABLE "Submission"
ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
