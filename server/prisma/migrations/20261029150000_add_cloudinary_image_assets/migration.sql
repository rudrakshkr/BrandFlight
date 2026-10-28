-- Persist Cloudinary URLs and public IDs on submissions and revisions.
ALTER TABLE "Submission"
ADD COLUMN "imageUrl" TEXT,
ADD COLUMN "imagePublicId" TEXT;

ALTER TABLE "Revision"
ADD COLUMN "imageUrl" TEXT,
ADD COLUMN "imagePublicId" TEXT;
