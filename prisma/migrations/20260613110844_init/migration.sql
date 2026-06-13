-- CreateTable
CREATE TABLE "Owner" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "restaurantName" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'STARTER',
    "planPaidAt" DATETIME,
    "planExpiresAt" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "menuUploadedAt" DATETIME,
    "onboardingStep" TEXT NOT NULL DEFAULT 'REGISTERED',
    "razorpayCustomerId" TEXT,
    "logoUrl" TEXT,
    "gstin" TEXT,
    "address" TEXT,
    "cuisineType" TEXT,
    "seatingCapacity" INTEGER,
    "restaurantId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TenantSection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tableCount" INTEGER NOT NULL DEFAULT 4,
    "tableCapacity" INTEGER NOT NULL DEFAULT 4,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TenantSection_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CashierStation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "stationName" TEXT NOT NULL,
    "stationType" TEXT NOT NULL DEFAULT 'DINING',
    "menuFilter" TEXT NOT NULL DEFAULT 'FOOD',
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CashierStation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CaptainLogin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "captainName" TEXT NOT NULL,
    "pin" TEXT NOT NULL,
    "initials" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CaptainLogin_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AdminCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminCredential_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "razorpayOrderId" TEXT NOT NULL,
    "razorpayPaymentId" TEXT,
    "razorpaySignature" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" DATETIME,
    CONSTRAINT "Payment_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TenantMenuItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "menuType" TEXT NOT NULL DEFAULT 'FOOD',
    "isVeg" BOOLEAN NOT NULL DEFAULT true,
    "variants" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TenantMenuItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Owner_email_key" ON "Owner"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Owner_slug_key" ON "Owner"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Owner_restaurantId_key" ON "Owner"("restaurantId");

-- CreateIndex
CREATE INDEX "Owner_slug_idx" ON "Owner"("slug");

-- CreateIndex
CREATE INDEX "Owner_email_idx" ON "Owner"("email");

-- CreateIndex
CREATE INDEX "TenantSection_ownerId_idx" ON "TenantSection"("ownerId");

-- CreateIndex
CREATE INDEX "CashierStation_restaurantId_idx" ON "CashierStation"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "CashierStation_restaurantId_username_key" ON "CashierStation"("restaurantId", "username");

-- CreateIndex
CREATE INDEX "CaptainLogin_restaurantId_idx" ON "CaptainLogin"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminCredential_ownerId_key" ON "AdminCredential"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminCredential_restaurantId_key" ON "AdminCredential"("restaurantId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_razorpayOrderId_key" ON "Payment"("razorpayOrderId");

-- CreateIndex
CREATE INDEX "Payment_ownerId_idx" ON "Payment"("ownerId");

-- CreateIndex
CREATE INDEX "TenantMenuItem_restaurantId_idx" ON "TenantMenuItem"("restaurantId");

-- CreateIndex
CREATE INDEX "TenantMenuItem_ownerId_idx" ON "TenantMenuItem"("ownerId");
