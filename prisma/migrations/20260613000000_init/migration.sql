-- CreateTable
CREATE TABLE "Owner" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "restaurantName" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'STARTER',
    "planPaidAt" TIMESTAMP(3),
    "planExpiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "menuUploadedAt" TIMESTAMP(3),
    "onboardingStep" TEXT NOT NULL DEFAULT 'REGISTERED',
    "razorpayCustomerId" TEXT,
    "logoUrl" TEXT,
    "gstin" TEXT,
    "address" TEXT,
    "cuisineType" TEXT,
    "seatingCapacity" INTEGER,
    "restaurantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Owner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantSection" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tableCount" INTEGER NOT NULL DEFAULT 4,
    "tableCapacity" INTEGER NOT NULL DEFAULT 4,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashierStation" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "stationName" TEXT NOT NULL,
    "stationType" TEXT NOT NULL DEFAULT 'DINING',
    "menuFilter" TEXT NOT NULL DEFAULT 'FOOD',
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashierStation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptainLogin" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "captainName" TEXT NOT NULL,
    "pin" TEXT NOT NULL,
    "initials" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaptainLogin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminCredential" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "razorpayOrderId" TEXT NOT NULL,
    "razorpayPaymentId" TEXT,
    "razorpaySignature" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantMenuItem" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "menuType" TEXT NOT NULL DEFAULT 'FOOD',
    "isVeg" BOOLEAN NOT NULL DEFAULT true,
    "variants" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantMenuItem_pkey" PRIMARY KEY ("id")
);

-- CreateUniqueIndex
CREATE UNIQUE INDEX "Owner_email_key" ON "Owner"("email");
CREATE UNIQUE INDEX "Owner_slug_key" ON "Owner"("slug");
CREATE UNIQUE INDEX "Owner_restaurantId_key" ON "Owner"("restaurantId");
CREATE UNIQUE INDEX "CashierStation_restaurantId_username_key" ON "CashierStation"("restaurantId", "username");
CREATE UNIQUE INDEX "AdminCredential_ownerId_key" ON "AdminCredential"("ownerId");
CREATE UNIQUE INDEX "AdminCredential_restaurantId_key" ON "AdminCredential"("restaurantId");
CREATE UNIQUE INDEX "Payment_razorpayOrderId_key" ON "Payment"("razorpayOrderId");

-- CreateIndex
CREATE INDEX "Owner_slug_idx" ON "Owner"("slug");
CREATE INDEX "Owner_email_idx" ON "Owner"("email");
CREATE INDEX "TenantSection_ownerId_idx" ON "TenantSection"("ownerId");
CREATE INDEX "CashierStation_restaurantId_idx" ON "CashierStation"("restaurantId");
CREATE INDEX "CaptainLogin_restaurantId_idx" ON "CaptainLogin"("restaurantId");
CREATE INDEX "Payment_ownerId_idx" ON "Payment"("ownerId");
CREATE INDEX "TenantMenuItem_restaurantId_idx" ON "TenantMenuItem"("restaurantId");
CREATE INDEX "TenantMenuItem_ownerId_idx" ON "TenantMenuItem"("ownerId");

-- AddForeignKey
ALTER TABLE "TenantSection" ADD CONSTRAINT "TenantSection_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashierStation" ADD CONSTRAINT "CashierStation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CaptainLogin" ADD CONSTRAINT "CaptainLogin_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdminCredential" ADD CONSTRAINT "AdminCredential_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenantMenuItem" ADD CONSTRAINT "TenantMenuItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
