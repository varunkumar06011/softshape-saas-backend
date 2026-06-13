import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { requireOwnerAuth, requireTenantAuth } from '../middleware/auth';

const router = Router();

// Helper: generate bill number
function generateBillNumber(): string {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const seq = Math.floor(Math.random() * 9000) + 1000;
  return `BILL-${dateStr}-${seq}`;
}

// POST /api/orders — create new order (tenant auth)
router.post('/', requireTenantAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const tenant = (req as any).tenant;
    const {
      restaurantId, tableId, tableName, section,
      captainId, captainName, items, source, note
    } = req.body;

    if (!restaurantId || !tableId || !tableName || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'restaurantId, tableId, tableName, and items are required' });
      return;
    }

    const owner = await prisma.owner.findFirst({ where: { restaurantId } });
    if (!owner) { res.status(404).json({ error: 'Restaurant not found' }); return; }

    const subtotal = items.reduce((s: number, i: { price: number; qty: number }) => s + (i.price * i.qty), 0);
    const cgst = Math.round(subtotal * 0.025 * 100) / 100;
    const sgst = Math.round(subtotal * 0.025 * 100) / 100;

    const order = await prisma.order.create({
      data: {
        ownerId: owner.id,
        restaurantId,
        tableId,
        tableName,
        section: section || '',
        captainId: captainId || null,
        captainName: captainName || null,
        source: source || 'DINE_IN',
        note: note || null,
        subtotal,
        cgst,
        sgst,
        total: subtotal + cgst + sgst,
        items: {
          create: items.map((item: any) => ({
            menuItemId: item.menuItemId || null,
            name: item.name,
            category: item.category || '',
            price: item.price,
            qty: item.qty,
            menuType: item.menuType || 'FOOD',
            isVeg: item.isVeg !== false,
            note: item.note || null,
          })),
        },
      },
      include: { items: true },
    });

    res.status(201).json(order);
  } catch (err: any) {
    console.error('[orders/create]', err);
    res.status(500).json({ error: err.message || 'Failed to create order' });
  }
});

// GET /api/orders/:restaurantId/active — active orders (OPEN or BILLED)
router.get('/:restaurantId/active', requireTenantAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { restaurantId } = req.params;
    const orders = await prisma.order.findMany({
      where: {
        restaurantId,
        status: { in: ['OPEN', 'BILLED'] },
      },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(orders);
  } catch (err: any) {
    console.error('[orders/active]', err);
    res.status(500).json({ error: 'Failed to fetch active orders' });
  }
});

// GET /api/orders/:orderId — single order
router.get('/:orderId', requireTenantAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { orderId } = req.params;
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) { res.status(404).json({ error: 'Order not found' }); return; }
    res.json(order);
  } catch (err: any) {
    console.error('[orders/get]', err);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

// POST /api/orders/:orderId/add-items — add items to existing order
router.post('/:orderId/add-items', requireTenantAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { orderId } = req.params;
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'items array required' });
      return;
    }

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) { res.status(404).json({ error: 'Order not found' }); return; }
    if (!['OPEN', 'BILLED'].includes(order.status)) {
      res.status(400).json({ error: `Cannot add items to order with status ${order.status}` });
      return;
    }

    await prisma.orderItem.createMany({
      data: items.map((item: any) => ({
        orderId,
        menuItemId: item.menuItemId || null,
        name: item.name,
        category: item.category || '',
        price: item.price,
        qty: item.qty,
        menuType: item.menuType || 'FOOD',
        isVeg: item.isVeg !== false,
        note: item.note || null,
        kotSent: false,
      })),
    });

    // Recalculate totals
    const allItems = await prisma.orderItem.findMany({ where: { orderId } });
    const subtotal = allItems.reduce((s: number, i: { price: number; qty: number }) => s + (i.price * i.qty), 0);
    const cgst = Math.round(subtotal * 0.025 * 100) / 100;
    const sgst = Math.round(subtotal * 0.025 * 100) / 100;

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: { subtotal, cgst, sgst, total: subtotal + cgst + sgst },
      include: { items: true },
    });

    res.json(updated);
  } catch (err: any) {
    console.error('[orders/add-items]', err);
    res.status(500).json({ error: err.message || 'Failed to add items' });
  }
});

// POST /api/orders/:orderId/send-kot — mark items as KOT sent
router.post('/:orderId/send-kot', requireTenantAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { orderId } = req.params;
    const { itemIds } = req.body;

    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      res.status(400).json({ error: 'itemIds array required' });
      return;
    }

    await prisma.orderItem.updateMany({
      where: { id: { in: itemIds }, orderId },
      data: { kotSent: true, kotSentAt: new Date() },
    });

    const updated = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    res.json(updated);
  } catch (err: any) {
    console.error('[orders/send-kot]', err);
    res.status(500).json({ error: 'Failed to send KOT' });
  }
});

// POST /api/orders/:orderId/print-bill — generate bill (does NOT settle)
router.post('/:orderId/print-bill', requireTenantAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { orderId } = req.params;
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) { res.status(404).json({ error: 'Order not found' }); return; }

    const subtotal = order.items.reduce((s: number, i: { price: number; qty: number }) => s + (i.price * i.qty), 0);
    const cgst = Math.round(subtotal * 0.025 * 100) / 100;
    const sgst = Math.round(subtotal * 0.025 * 100) / 100;
    const total = subtotal + cgst + sgst;

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'BILLED',
        billPrintedAt: new Date(),
        billNumber: order.billNumber || generateBillNumber(),
        subtotal,
        cgst,
        sgst,
        total,
      },
      include: { items: true },
    });

    res.json(updated);
  } catch (err: any) {
    console.error('[orders/print-bill]', err);
    res.status(500).json({ error: 'Failed to print bill' });
  }
});

// POST /api/orders/:orderId/duplicate — create continuation order after bill
router.post('/:orderId/duplicate', requireTenantAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { orderId } = req.params;
    const original = await prisma.order.findUnique({ where: { id: orderId } });
    if (!original) { res.status(404).json({ error: 'Order not found' }); return; }
    if (original.status !== 'BILLED') {
      res.status(400).json({ error: 'Can only duplicate BILLED orders' });
      return;
    }

    const newOrder = await prisma.order.create({
      data: {
        ownerId: original.ownerId,
        restaurantId: original.restaurantId,
        tableId: original.tableId,
        tableName: original.tableName,
        section: original.section,
        captainId: original.captainId,
        captainName: original.captainName,
        status: 'OPEN',
        source: original.source,
        parentOrderId: orderId,
        note: original.note,
      },
      include: { items: true },
    });

    res.status(201).json(newOrder);
  } catch (err: any) {
    console.error('[orders/duplicate]', err);
    res.status(500).json({ error: 'Failed to duplicate order' });
  }
});

// POST /api/orders/:orderId/settle — mark order as paid
router.post('/:orderId/settle', requireTenantAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { orderId } = req.params;
    const { paymentMode } = req.body;

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) { res.status(404).json({ error: 'Order not found' }); return; }

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'SETTLED',
        paidAt: new Date(),
        paymentMode: paymentMode || 'CASH',
      },
      include: { items: true },
    });

    // If order has a parent, settle the parent too
    if (order.parentOrderId) {
      await prisma.order.update({
        where: { id: order.parentOrderId },
        data: {
          status: 'SETTLED',
          paidAt: new Date(),
          paymentMode: paymentMode || 'CASH',
        },
      });
    }

    res.json(updated);
  } catch (err: any) {
    console.error('[orders/settle]', err);
    res.status(500).json({ error: 'Failed to settle order' });
  }
});

// DELETE /api/orders/:orderId — soft delete (cancel)
router.delete('/:orderId', requireTenantAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { orderId } = req.params;
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) { res.status(404).json({ error: 'Order not found' }); return; }

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: { status: 'CANCELLED' },
      include: { items: true },
    });

    res.json(updated);
  } catch (err: any) {
    console.error('[orders/delete]', err);
    res.status(500).json({ error: 'Failed to cancel order' });
  }
});

// POST /api/orders/:orderId/swap-table
router.post('/:orderId/swap-table', requireOwnerAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { orderId } = req.params;
    const { newTableId, newTableName, newSection } = req.body;
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) { res.status(404).json({ error: 'Order not found' }); return; }

    const existing = await prisma.order.findFirst({
      where: { restaurantId: order.restaurantId, tableId: newTableId, status: { in: ['OPEN', 'BILLED'] } },
    });
    if (existing) { res.status(409).json({ error: 'Target table already has a running order' }); return; }

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: { tableId: newTableId, tableName: newTableName, section: newSection || '' },
      include: { items: true },
    });

    res.json(updated);
  } catch (err: any) {
    console.error('[orders/swap-table]', err);
    res.status(500).json({ error: 'Failed to swap table' });
  }
});

// POST /api/orders/:orderId/swap-items
router.post('/:orderId/swap-items', requireTenantAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { orderId } = req.params;
    const { targetOrderId, itemIds } = req.body;
    if (!targetOrderId || !Array.isArray(itemIds) || itemIds.length === 0) {
      res.status(400).json({ error: 'targetOrderId and itemIds required' });
      return;
    }

    await prisma.orderItem.updateMany({
      where: { id: { in: itemIds }, orderId },
      data: { orderId: targetOrderId },
    });

    const [sourceOrder, targetOrder] = await Promise.all([
      prisma.order.findUnique({ where: { id: orderId }, include: { items: true } }),
      prisma.order.findUnique({ where: { id: targetOrderId }, include: { items: true } }),
    ]);

    if (!sourceOrder || !targetOrder) { res.status(404).json({ error: 'Order not found' }); return; }

    const recalc = (order: any) => {
      const subtotal = order.items.reduce((s: number, i: { price: number; qty: number }) => s + (i.price * i.qty), 0);
      const cgst = Math.round(subtotal * 0.025 * 100) / 100;
      const sgst = Math.round(subtotal * 0.025 * 100) / 100;
      const total = subtotal + cgst + sgst;
      return { subtotal, cgst, sgst, total };
    };

    const sCalc = recalc(sourceOrder);
    const tCalc = recalc(targetOrder);

    const [updatedSource, updatedTarget] = await Promise.all([
      prisma.order.update({ where: { id: orderId }, data: sCalc, include: { items: true } }),
      prisma.order.update({ where: { id: targetOrderId }, data: tCalc, include: { items: true } }),
    ]);

    res.json({ sourceOrder: updatedSource, targetOrder: updatedTarget });
  } catch (err: any) {
    console.error('[orders/swap-items]', err);
    res.status(500).json({ error: 'Failed to swap items' });
  }
});

// POST /api/orders/merge
router.post('/merge', requireTenantAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { sourceOrderId, targetOrderId } = req.body;
    if (!sourceOrderId || !targetOrderId) { res.status(400).json({ error: 'sourceOrderId and targetOrderId required' }); return; }

    const [source, target] = await Promise.all([
      prisma.order.findUnique({ where: { id: sourceOrderId }, include: { items: true } }),
      prisma.order.findUnique({ where: { id: targetOrderId }, include: { items: true } }),
    ]);

    if (!source || !target) { res.status(404).json({ error: 'Order not found' }); return; }
    if (source.restaurantId !== target.restaurantId) { res.status(400).json({ error: 'Orders must belong to same restaurant' }); return; }

    await prisma.orderItem.updateMany(
      { where: { orderId: sourceOrderId }, data: { orderId: targetOrderId } }
    );

    await prisma.order.update({
      where: { id: sourceOrderId },
      data: { status: 'CANCELLED', note: `Merged into #${targetOrderId}` },
    });

    const allItems = await prisma.orderItem.findMany({ where: { orderId: targetOrderId } });
    const subtotal = allItems.reduce((s: number, i: { price: number; qty: number }) => s + (i.price * i.qty), 0);
    const cgst = Math.round(subtotal * 0.025 * 100) / 100;
    const sgst = Math.round(subtotal * 0.025 * 100) / 100;
    const total = subtotal + cgst + sgst;

    const updatedTarget = await prisma.order.update({
      where: { id: targetOrderId },
      data: { subtotal, cgst, sgst, total },
      include: { items: true },
    });

    res.json({ mergedOrder: updatedTarget });
  } catch (err: any) {
    console.error('[orders/merge]', err);
    res.status(500).json({ error: 'Failed to merge orders' });
  }
});

export default router;
