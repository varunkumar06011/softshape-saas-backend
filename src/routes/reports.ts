import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { requireTenantAuth } from '../middleware/auth';

const router = Router();

function getDateRange(req: Request): { from: Date; to: Date } {
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

// GET /api/reports/summary?from=DATE&to=DATE
router.get('/summary', requireTenantAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const tenant = (req as any).tenant;
    const restaurantId = tenant.restaurantId;
    const { from, to } = getDateRange(req);

    const [onlineOrders, dineOrders] = await Promise.all([
      prisma.onlineOrder.findMany({
        where: { restaurantId, createdAt: { gte: from, lte: to }, status: { not: 'CANCELLED' } },
      }),
      prisma.order.findMany({
        where: { restaurantId, createdAt: { gte: from, lte: to }, status: 'SETTLED' },
        include: { items: true },
      }),
    ]);

    const deliveryRevenue = onlineOrders.reduce((s, o) => s + o.total, 0);
    const dineInRevenue = dineOrders.reduce((s, o) => s + o.total, 0);
    const totalRevenue = deliveryRevenue + dineInRevenue;
    const totalOrders = onlineOrders.length + dineOrders.length;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    // Top items from OnlineOrder.items JSON
    const itemMap: Record<string, { name: string; qty: number; revenue: number }> = {};
    for (const o of onlineOrders) {
      const items = o.items as any[];
      for (const it of items) {
        const key = it.name || 'Unknown';
        if (!itemMap[key]) itemMap[key] = { name: key, qty: 0, revenue: 0 };
        itemMap[key].qty += it.qty || 1;
        itemMap[key].revenue += (it.price || 0) * (it.qty || 1);
      }
    }
    for (const o of dineOrders) {
      for (const it of o.items) {
        const key = it.name;
        if (!itemMap[key]) itemMap[key] = { name: key, qty: 0, revenue: 0 };
        itemMap[key].qty += it.qty;
        itemMap[key].revenue += it.price * it.qty;
      }
    }

    const topItems = Object.values(itemMap)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 10);

    res.json({ totalRevenue, totalOrders, dineInRevenue, deliveryRevenue, avgOrderValue, topItems });
  } catch (err: any) {
    console.error('[reports/summary]', err);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

// GET /api/reports/daily?from=DATE&to=DATE
router.get('/daily', requireTenantAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const tenant = (req as any).tenant;
    const restaurantId = tenant.restaurantId;
    const { from, to } = getDateRange(req);

    const [onlineOrders, dineOrders] = await Promise.all([
      prisma.onlineOrder.findMany({
        where: { restaurantId, createdAt: { gte: from, lte: to }, status: { not: 'CANCELLED' } },
      }),
      prisma.order.findMany({
        where: { restaurantId, createdAt: { gte: from, lte: to }, status: 'SETTLED' },
        include: { items: true },
      }),
    ]);

    const dayMap: Record<string, { date: string; dineIn: number; delivery: number; total: number }> = {};

    for (const o of dineOrders) {
      const d = o.createdAt.toISOString().slice(0, 10);
      if (!dayMap[d]) dayMap[d] = { date: d, dineIn: 0, delivery: 0, total: 0 };
      dayMap[d].dineIn += o.total;
      dayMap[d].total += o.total;
    }
    for (const o of onlineOrders) {
      const d = o.createdAt.toISOString().slice(0, 10);
      if (!dayMap[d]) dayMap[d] = { date: d, dineIn: 0, delivery: 0, total: 0 };
      dayMap[d].delivery += o.total;
      dayMap[d].total += o.total;
    }

    const result = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));
    res.json(result);
  } catch (err: any) {
    console.error('[reports/daily]', err);
    res.status(500).json({ error: 'Failed to fetch daily report' });
  }
});

// GET /api/reports/channel-breakdown?from=DATE&to=DATE
router.get('/channel-breakdown', requireTenantAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const tenant = (req as any).tenant;
    const restaurantId = tenant.restaurantId;
    const { from, to } = getDateRange(req);

    const [onlineOrders, dineOrders] = await Promise.all([
      prisma.onlineOrder.findMany({
        where: { restaurantId, createdAt: { gte: from, lte: to }, status: { not: 'CANCELLED' } },
      }),
      prisma.order.findMany({
        where: { restaurantId, createdAt: { gte: from, lte: to }, status: 'SETTLED' },
        include: { items: true },
      }),
    ]);

    const channels: Record<string, { channel: string; orders: number; revenue: number }> = {};

    for (const o of onlineOrders) {
      const ch = o.platform === 'swiggy' ? 'Swiggy' : o.platform === 'zomato' ? 'Zomato' : 'Online';
      if (!channels[ch]) channels[ch] = { channel: ch, orders: 0, revenue: 0 };
      channels[ch].orders += 1;
      channels[ch].revenue += o.total;
    }

    for (const o of dineOrders) {
      const ch = o.source === 'DINE_IN' ? 'Dine-In' : 'Walk-In';
      if (!channels[ch]) channels[ch] = { channel: ch, orders: 0, revenue: 0 };
      channels[ch].orders += 1;
      channels[ch].revenue += o.total;
    }

    const result = Object.values(channels).map((c) => ({
      ...c,
      avgOrder: c.orders > 0 ? c.revenue / c.orders : 0,
    }));

    res.json(result);
  } catch (err: any) {
    console.error('[reports/channel]', err);
    res.status(500).json({ error: 'Failed to fetch channel breakdown' });
  }
});

// GET /api/reports/top-items?from=DATE&to=DATE&limit=10
router.get('/top-items', requireTenantAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const tenant = (req as any).tenant;
    const restaurantId = tenant.restaurantId;
    const { from, to } = getDateRange(req);
    const limit = Math.min(Number(req.query.limit) || 10, 50);

    const [onlineOrders, dineOrders] = await Promise.all([
      prisma.onlineOrder.findMany({
        where: { restaurantId, createdAt: { gte: from, lte: to }, status: { not: 'CANCELLED' } },
      }),
      prisma.order.findMany({
        where: { restaurantId, createdAt: { gte: from, lte: to }, status: 'SETTLED' },
        include: { items: true },
      }),
    ]);

    const itemMap: Record<string, { itemName: string; category: string; qty: number; revenue: number }> = {};

    for (const o of onlineOrders) {
      const items = o.items as any[];
      for (const it of items) {
        const key = it.name || 'Unknown';
        if (!itemMap[key]) itemMap[key] = { itemName: key, category: it.category || 'Other', qty: 0, revenue: 0 };
        itemMap[key].qty += it.qty || 1;
        itemMap[key].revenue += (it.price || 0) * (it.qty || 1);
      }
    }

    for (const o of dineOrders) {
      for (const it of o.items) {
        const key = it.name;
        if (!itemMap[key]) itemMap[key] = { itemName: key, category: it.category || 'Other', qty: 0, revenue: 0 };
        itemMap[key].qty += it.qty;
        itemMap[key].revenue += it.price * it.qty;
      }
    }

    const result = Object.values(itemMap)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, limit);

    res.json(result);
  } catch (err: any) {
    console.error('[reports/top-items]', err);
    res.status(500).json({ error: 'Failed to fetch top items' });
  }
});

export default router;
