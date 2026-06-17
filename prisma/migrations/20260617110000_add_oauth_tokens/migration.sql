-- Add OAuth access token fields to Owner table for social media auto-posting

ALTER TABLE "Owner" ADD COLUMN "metaAccessToken" TEXT;
ALTER TABLE "Owner" ADD COLUMN "metaPageId" TEXT;
ALTER TABLE "Owner" ADD COLUMN "metaIgAccountId" TEXT;
ALTER TABLE "Owner" ADD COLUMN "xAccessToken" TEXT;
ALTER TABLE "Owner" ADD COLUMN "xRefreshToken" TEXT;
ALTER TABLE "Owner" ADD COLUMN "linkedinToken" TEXT;
