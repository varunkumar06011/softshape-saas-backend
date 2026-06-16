-- Add Order table with sync fields
CREATE TABLE IF NOT EXISTS "Order" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "restaurantId" TEXT NOT NULL,
  "tableId" TEXT,
  items TEXT DEFAULT '[]',
  status TEXT DEFAULT 'RUNNING',
  source TEXT DEFAULT 'DINE_IN',
  "paymentMode" TEXT,
  subtotal FLOAT,
  cgst FLOAT,
  sgst FLOAT,
  total FLOAT,
  "paidAt" TIMESTAMP(3),
  "clientId" TEXT UNIQUE,
  "deviceId" TEXT,
  "syncedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_order_restaurantId" ON "Order"("restaurantId");
CREATE INDEX IF NOT EXISTS "idx_order_status" ON "Order"(status);
CREATE INDEX IF NOT EXISTS "idx_order_clientId" ON "Order"("clientId");
CREATE INDEX IF NOT EXISTS "idx_order_paidAt" ON "Order"("paidAt");

-- Materialized view for reports (Prompt 9)
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_revenue_mv AS
SELECT
  "restaurantId",
  DATE("paidAt") AS sale_date,
  COUNT(*) FILTER (WHERE status = 'SETTLED') AS order_count,
  SUM(total) FILTER (WHERE status = 'SETTLED') AS revenue,
  SUM(cgst) FILTER (WHERE status = 'SETTLED') AS total_cgst,
  SUM(sgst) FILTER (WHERE status = 'SETTLED') AS total_sgst,
  COUNT(*) FILTER (WHERE source = 'SWIGGY' AND status = 'SETTLED') AS swiggy_orders,
  COUNT(*) FILTER (WHERE source = 'ZOMATO' AND status = 'SETTLED') AS zomato_orders,
  COUNT(*) FILTER (WHERE source = 'DINE_IN' AND status = 'SETTLED') AS dine_orders
FROM "Order"
WHERE "paidAt" IS NOT NULL
GROUP BY "restaurantId", DATE("paidAt");

CREATE UNIQUE INDEX IF NOT EXISTS daily_revenue_mv_idx ON daily_revenue_mv("restaurantId", sale_date);
