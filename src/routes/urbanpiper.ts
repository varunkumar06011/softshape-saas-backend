import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { io } from '../index';

const router = Router();

async function getOwnerId(restaurantId: string): Promise<string | null> {
  const owner = await prisma.owner.findUnique({ where: { restaurantId }, select: { id: true } });
  return owner?.id || null;
}

// POST /api/urbanpiper/webhook — receive orders from UrbanPiper / Swiggy / Zomato
router.post('/webhook', async (req: Request, res: Response): Promise<void> => {
  try {
    const { restaurantId, platform, externalOrderId, customerName, items, total, status } = req.body;
    if (!restaurantId) { res.status(400).json({ error: 'restaurantId required' }); return; }

    const ownerId = await getOwnerId(restaurantId);
    if (!ownerId) { res.status(404).json({ error: 'Restaurant not found' }); return; }

    const itemList = (items || []) as any[];
    const order = await prisma.order.create({
      data: {
        ownerId,
        restaurantId,
        tableId: '',
        tableName: customerName || (platform?.toUpperCase() || 'ONLINE'),
        section: platform?.toUpperCase() || 'ONLINE',
        status: status || 'NEW',
        source: platform?.toUpperCase() || 'ONLINE',
        total: total || 0,
        items: { create: itemList.map((i: any) => ({
          menuItemId: null,
          name: i.name || 'Item',
          category: i.category || '',
          price: i.price || 0,
          qty: i.qty || 1,
          menuType: i.menuType || 'FOOD',
          isVeg: i.isVeg !== false,
          note: i.note || undefined,
        })) },
      },
      include: { items: true }
    });

    io.to(restaurantId).emit('online-order', order);
    res.json({ success: true, order });
  } catch (err: any) {
    console.error('[urbanpiper/webhook]', err);
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});

// GET /api/urbanpiper/orders/:restaurantId — list online orders
router.get('/orders/:restaurantId', async (req: Request, res: Response): Promise<void> => {
  try {
    const orders = await prisma.order.findMany({
      where: {
        restaurantId: req.params.restaurantId,
        source: { in: ['SWIGGY', 'ZOMATO', 'ONLINE'] },
      },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(orders);
  } catch (err: any) {
    console.error('[urbanpiper/orders]', err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// PATCH /api/urbanpiper/orders/:id/status — update order status
router.patch('/orders/:id/status', async (req: Request, res: Response): Promise<void> => {
  try {
    const { status } = req.body;
    const existing = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!existing) { res.status(404).json({ error: 'Order not found' }); return; }

    const updated = await prisma.order.update({
      where: { id: req.params.id },
      data: { status }
    });

    io.to(existing.restaurantId).emit('online-order-status', { id: updated.id, status: updated.status });
    res.json(updated);
  } catch (err: any) {
    console.error('[urbanpiper/status]', err);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

export default router;
