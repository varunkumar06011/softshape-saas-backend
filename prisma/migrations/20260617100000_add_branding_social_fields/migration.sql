-- Add branding and social media fields to Owner table

-- Branding & Marketing fields
ALTER TABLE "Owner" ADD COLUMN "tagline" TEXT;
ALTER TABLE "Owner" ADD COLUMN "primaryColor" TEXT DEFAULT '#E53935';
ALTER TABLE "Owner" ADD COLUMN "websiteUrl" TEXT;
ALTER TABLE "Owner" ADD COLUMN "fssaiLicense" TEXT;
ALTER TABLE "Owner" ADD COLUMN "businessHoursOpen" TEXT;
ALTER TABLE "Owner" ADD COLUMN "businessHoursClose" TEXT;

-- Social Media fields
ALTER TABLE "Owner" ADD COLUMN "facebookPageUrl" TEXT;
ALTER TABLE "Owner" ADD COLUMN "instagramHandle" TEXT;
ALTER TABLE "Owner" ADD COLUMN "xHandle" TEXT;
ALTER TABLE "Owner" ADD COLUMN "linkedinUrl" TEXT;
