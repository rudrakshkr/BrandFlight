-- Create an immutable, one-to-one release record for approved campaigns.
CREATE TABLE "ReleasePassport" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "passportHash" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleasePassport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReleasePassport_submissionId_key" ON "ReleasePassport"("submissionId");
CREATE UNIQUE INDEX "ReleasePassport_passportHash_key" ON "ReleasePassport"("passportHash");
CREATE INDEX "ReleasePassport_issuedAt_idx" ON "ReleasePassport"("issuedAt");

ALTER TABLE "ReleasePassport"
ADD CONSTRAINT "ReleasePassport_submissionId_fkey"
FOREIGN KEY ("submissionId") REFERENCES "Submission"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
