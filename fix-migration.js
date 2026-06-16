// Run this locally to fix the Render database migration state
// npx dotenv -e .env -- node fix-migration.js

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fix() {
  try {
    // Mark the failed migration as rolled back
    await prisma.$executeRaw`
      UPDATE "_prisma_migrations"
      SET "finished_at" = NOW(), "rolled_back_at" = NOW(), "logs" = 'Manually resolved'
      WHERE "migration_name" = '20240615000000_add_sync_fields'
        AND "rolled_back_at" IS NULL
    `;
    console.log('Migration marked as rolled back');

    // Add columns if not exist
    const columns = [
      { name: 'clientId', type: 'TEXT' },
      { name: 'deviceId', type: 'TEXT' },
      { name: 'syncedAt', type: 'TIMESTAMP(3)' }
    ];
    for (const col of columns) {
      try {
        await prisma.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "${col.name}" ${col.type}`);
        console.log(`Column ${col.name} added or already exists`);
      } catch (e) {
        console.log(`Column ${col.name}: ${e.message}`);
      }
    }

    // Add unique index on clientId if not exists
    try {
      await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "Order_clientId_key" ON "Order"("clientId")`;
      console.log('Unique index on clientId added');
    } catch (e) {
      console.log('Index may already exist');
    }

    // Create materialized view if not exists
    try {
      await prisma.$executeRaw`
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
        GROUP BY "restaurantId", DATE("paidAt")
      `;
      await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS daily_revenue_mv_idx ON daily_revenue_mv("restaurantId", sale_date)`;
      console.log('Materialized view created');
    } catch (e) {
      console.log('MV may already exist');
    }

    // Insert migration record as applied so Prisma doesn't try to run it again
    await prisma.$executeRaw`
      INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "started_at", "applied_steps_count")
      SELECT gen_random_uuid(), 'fixed', NOW(), '20240615000000_add_sync_fields', NOW(), 1
      WHERE NOT EXISTS (
        SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = '20240615000000_add_sync_fields' AND "rolled_back_at" IS NULL
      )
    `;
    console.log('Migration record inserted');

    console.log('\nDone! Now redeploy on Render.');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

fix();
