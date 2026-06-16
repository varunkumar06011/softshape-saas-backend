import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';

const router = Router();

// GET /api/reports/summary/:restaurantId
router.get('/summary/:restaurantId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { restaurantId } = req.params;
    const { from, to } = req.query;

    const rows: any = await prisma.$queryRaw`
      SELECT * FROM daily_revenue_mv
      WHERE "restaurantId" = ${restaurantId}
      AND sale_date BETWEEN ${from}::date AND ${to}::date
      ORDER BY sale_date DESC
    `;

    const summary = {
      totalRevenue: rows.reduce((s: number, r: any) => s + Number(r.revenue || 0), 0),
      totalOrders: rows.reduce((s: number, r: any) => s + Number(r.order_count || 0), 0),
      dineInOrders: rows.reduce((s: number, r: any) => s + Number(r.dine_orders || 0), 0),
      swiggyOrders: rows.reduce((s: number, r: any) => s + Number(r.swiggy_orders || 0), 0),
      zomatoOrders: rows.reduce((s: number, r: any) => s + Number(r.zomato_orders || 0), 0),
      totalCGST: rows.reduce((s: number, r: any) => s + Number(r.total_cgst || 0), 0),
      totalSGST: rows.reduce((s: number, r: any) => s + Number(r.total_sgst || 0), 0),
      daily: rows.map((r: any) => ({
        date: r.sale_date,
        revenue: Number(r.revenue || 0),
        orders: Number(r.order_count || 0),
        dineIn: Number(r.dine_orders || 0),
        swiggy: Number(r.swiggy_orders || 0),
        zomato: Number(r.zomato_orders || 0),
      }))
    };

    res.json(summary);
  } catch (err: any) {
    console.error('[reports/summary]', err);
    res.status(500).json({ error: 'Failed to load reports' });
  }
});

// GET /api/reports/channel-breakdown/:restaurantId
router.get('/channel-breakdown/:restaurantId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { restaurantId } = req.params;
    const { from, to } = req.query;

    const rows: any = await prisma.$queryRaw`
      SELECT * FROM daily_revenue_mv
      WHERE "restaurantId" = ${restaurantId}
      AND sale_date BETWEEN ${from}::date AND ${to}::date
    `;

    const dineIn = { channel: 'Dine-In', orders: 0, revenue: 0 };
    const swiggy = { channel: 'Swiggy', orders: 0, revenue: 0 };
    const zomato = { channel: 'Zomato', orders: 0, revenue: 0 };

    for (const r of rows) {
      dineIn.orders += Number(r.dine_orders || 0);
      dineIn.revenue += Number(r.dine_orders || 0) > 0 ? Number(r.revenue || 0) * (Number(r.dine_orders || 0) / Math.max(Number(r.order_count || 0), 1)) : 0;
      swiggy.orders += Number(r.swiggy_orders || 0);
      zomato.orders += Number(r.zomato_orders || 0);
    }

    // Approximate revenue split by order count proportion
    const totalRev = rows.reduce((s: number, r: any) => s + Number(r.revenue || 0), 0);
    const totalOrders = rows.reduce((s: number, r: any) => s + Number(r.order_count || 0), 0);
    if (totalOrders > 0) {
      dineIn.revenue = Math.round(totalRev * (dineIn.orders / totalOrders));
      swiggy.revenue = Math.round(totalRev * (swiggy.orders / totalOrders));
      zomato.revenue = Math.round(totalRev * (zomato.orders / totalOrders));
    }

    const breakdown = [
      dineIn,
      swiggy,
      zomato,
    ];

    res.json(breakdown);
  } catch (err: any) {
    console.error('[reports/channel]', err);
    res.status(500).json({ error: 'Failed to load channel breakdown' });
  }
});

export default router;
