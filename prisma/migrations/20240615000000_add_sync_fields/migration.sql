-- Add sync columns to existing Order table (if not already present)
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "clientId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deviceId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "syncedAt" TIMESTAMP(3);

-- Add unique constraint on clientId if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'Order_clientId_key'
  ) THEN
    CREATE UNIQUE INDEX "Order_clientId_key" ON "Order"("clientId");
  END IF;
END
$$;

-- Add indexes if not exist
CREATE INDEX IF NOT EXISTS "idx_order_syncedAt" ON "Order"("syncedAt");

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
