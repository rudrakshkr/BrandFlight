-- Persist manager-approved reference assets (initially the primary brand logo).
CREATE TABLE "BrandAsset" (
    "id" TEXT NOT NULL,
    "assetType" TEXT NOT NULL DEFAULT 'PRIMARY_LOGO',
    "name" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "secureUrl" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "expectedWordmark" TEXT,
    "description" TEXT,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "brandProfileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BrandAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BrandAsset_brandProfileId_assetType_key"
    ON "BrandAsset"("brandProfileId", "assetType");
CREATE INDEX "BrandAsset_brandProfileId_idx"
    ON "BrandAsset"("brandProfileId");

ALTER TABLE "BrandAsset"
    ADD CONSTRAINT "BrandAsset_brandProfileId_fkey"
    FOREIGN KEY ("brandProfileId") REFERENCES "BrandProfile"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
