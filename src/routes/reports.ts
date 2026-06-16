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

// GET /api/reports/top-items/:restaurantId
router.get('/top-items/:restaurantId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { restaurantId } = req.params;
    const { from, to, limit = '10' } = req.query;
    const fromDate = from ? new Date(String(from)) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const toDate = to ? new Date(String(to)) : new Date();
    toDate.setHours(23, 59, 59, 999);

    const items = await prisma.orderItem.findMany({
      where: { order: { restaurantId, status: 'SETTLED', isExcluded: false, createdAt: { gte: fromDate, lte: toDate } } },
      include: { order: true },
    });

    const grouped: Record<string, { name: string; qty: number; revenue: number }> = {};
    for (const it of items) {
      if (!grouped[it.name]) grouped[it.name] = { name: it.name, qty: 0, revenue: 0 };
      grouped[it.name].qty += it.qty;
      grouped[it.name].revenue += it.price * it.qty;
    }

    const sorted = Object.values(grouped).sort((a, b) => b.revenue - a.revenue).slice(0, parseInt(String(limit), 10));
    res.json(sorted);
  } catch (err: any) {
    console.error('[reports/top-items]', err);
    res.status(500).json({ error: 'Failed to fetch top items' });
  }
});

// GET /api/reports/item-revenue/:restaurantId
router.get('/item-revenue/:restaurantId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { restaurantId } = req.params;
    const { from, to } = req.query;
    const fromDate = from ? new Date(String(from)) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const toDate = to ? new Date(String(to)) : new Date();
    toDate.setHours(23, 59, 59, 999);

    const items = await prisma.orderItem.findMany({
      where: { order: { restaurantId, status: 'SETTLED', isExcluded: false, createdAt: { gte: fromDate, lte: toDate } } },
      include: { order: true },
    });

    const grouped: Record<string, { category: string; name: string; qtySold: number; unitPrice: number; totalRevenue: number }> = {};
    for (const it of items) {
      const key = `${it.category}-${it.name}`;
      if (!grouped[key]) grouped[key] = { category: it.category, name: it.name, qtySold: 0, unitPrice: it.price, totalRevenue: 0 };
      grouped[key].qtySold += it.qty;
      grouped[key].totalRevenue += it.price * it.qty;
    }

    res.json(Object.values(grouped));
  } catch (err: any) {
    console.error('[reports/item-revenue]', err);
    res.status(500).json({ error: 'Failed to fetch item revenue' });
  }
});

// GET /api/reports/payment-mode/:restaurantId
router.get('/payment-mode/:restaurantId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { restaurantId } = req.params;
    const { from, to } = req.query;
    const fromDate = from ? new Date(String(from)) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const toDate = to ? new Date(String(to)) : new Date();
    toDate.setHours(23, 59, 59, 999);

    const orders = await prisma.order.findMany({
      where: { restaurantId, status: 'SETTLED', isExcluded: false, createdAt: { gte: fromDate, lte: toDate } },
    });

    const result = { cash: { orders: 0, revenue: 0 }, upi: { orders: 0, revenue: 0 }, card: { orders: 0, revenue: 0 } };
    for (const o of orders) {
      const mode = (o.paymentMode || 'cash').toLowerCase();
      const key = mode === 'upi' ? 'upi' : mode === 'card' ? 'card' : 'cash';
      result[key].orders += 1;
      result[key].revenue += o.total;
    }
    res.json(result);
  } catch (err: any) {
    console.error('[reports/payment-mode]', err);
    res.status(500).json({ error: 'Failed to fetch payment mode report' });
  }
});

// GET /api/reports/cashier-performance/:restaurantId
router.get('/cashier-performance/:restaurantId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { restaurantId } = req.params;
    const { from, to } = req.query;
    const fromDate = from ? new Date(String(from)) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const toDate = to ? new Date(String(to)) : new Date();
    toDate.setHours(23, 59, 59, 999);

    const orders = await prisma.order.findMany({
      where: { restaurantId, status: 'SETTLED', isExcluded: false, createdAt: { gte: fromDate, lte: toDate } },
    });

    const grouped: Record<string, { cashierName: string; orders: number; revenue: number }> = {};
    for (const o of orders) {
      const name = o.captainName || o.deviceId || 'Unknown';
      if (!grouped[name]) grouped[name] = { cashierName: name, orders: 0, revenue: 0 };
      grouped[name].orders += 1;
      grouped[name].revenue += o.total;
    }

    const result = Object.values(grouped).map(g => ({ ...g, avgOrderValue: g.orders > 0 ? Math.round((g.revenue / g.orders) * 100) / 100 : 0 }));
    res.json(result.sort((a: any, b: any) => b.revenue - a.revenue));
  } catch (err: any) {
    console.error('[reports/cashier-performance]', err);
    res.status(500).json({ error: 'Failed to fetch cashier performance' });
  }
});

// GET /api/reports/excluded-transactions/:restaurantId
router.get('/excluded-transactions/:restaurantId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { restaurantId } = req.params;
    const { from, to } = req.query;
    const fromDate = from ? new Date(String(from)) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const toDate = to ? new Date(String(to)) : new Date();
    toDate.setHours(23, 59, 59, 999);

    const orders = await prisma.order.findMany({
      where: { restaurantId, isExcluded: true, excludedAt: { gte: fromDate, lte: toDate } },
      include: { items: true },
      orderBy: { excludedAt: 'desc' },
    });

    res.json(orders);
  } catch (err: any) {
    console.error('[reports/excluded-transactions]', err);
    res.status(500).json({ error: 'Failed to fetch excluded transactions' });
  }
});

export default router;
