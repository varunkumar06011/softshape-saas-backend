import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { io } from '../index';

const router = Router();

async function getOwnerId(restaurantId: string): Promise<string | null> {
  const owner = await prisma.owner.findUnique({ where: { restaurantId }, select: { id: true } });
  return owner?.id || null;
}

function calcTotals(items: Array<{ price: number; qty: number }>) {
  const subtotal = items.reduce((s, i) => s + (i.price * (i.qty || 1)), 0);
  const cgst = Math.round(subtotal * 0.025 * 100) / 100;
  const sgst = Math.round(subtotal * 0.025 * 100) / 100;
  const total = Math.round((subtotal + cgst + sgst) * 100) / 100;
  return { subtotal, cgst, sgst, total };
}

// POST /api/orders — create a new order
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { restaurantId, tableId, tableName, section, items, captainId, captainName, source, clientId, deviceId } = req.body;
    if (!restaurantId || !tableId) {
      res.status(400).json({ error: 'restaurantId and tableId required' });
      return;
    }

    const ownerId = await getOwnerId(restaurantId);
    if (!ownerId) { res.status(404).json({ error: 'Restaurant not found' }); return; }

    // Idempotent: if clientId exists, return existing order
    if (clientId) {
      const existing = await prisma.order.findUnique({ where: { clientId } });
      if (existing) { res.json(existing); return; }
    }

    const itemList = (items || []) as any[];
    const totals = calcTotals(itemList);

    const order = await prisma.order.create({
      data: {
        ownerId,
        restaurantId,
        tableId,
        tableName: tableName || tableId,
        section: section || '',
        captainId: captainId || undefined,
        captainName: captainName || undefined,
        status: 'OPEN',
        source: source || 'DINE_IN',
        subtotal: totals.subtotal,
        cgst: totals.cgst,
        sgst: totals.sgst,
        total: totals.total,
        clientId: clientId || undefined,
        deviceId: deviceId || undefined,
        items: { create: itemList.map(i => ({
          menuItemId: i.menuItemId || null,
          name: i.name,
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

    io.to(restaurantId).emit('order-updated', order);
    res.json(order);
  } catch (err: any) {
    console.error('[orders/create]', err);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// GET /api/orders/:restaurantId/active — active orders
router.get('/:restaurantId/active', async (req: Request, res: Response): Promise<void> => {
  try {
    const { restaurantId } = req.params;
    const orders = await prisma.order.findMany({
      where: { restaurantId, status: { notIn: ['SETTLED', 'CANCELLED'] } },
      include: { items: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json(orders);
  } catch (err: any) {
    console.error('[orders/active]', err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// POST /api/orders/:id/add-items
router.post('/:id/add-items', async (req: Request, res: Response): Promise<void> => {
  try {
    const order = await prisma.order.findUnique({ where: { id: req.params.id }, include: { items: true } });
    if (!order) { res.status(404).json({ error: 'Order not found' }); return; }

    const newItems = (req.body.items || []) as any[];
    await prisma.orderItem.createMany({
      data: newItems.map(i => ({
        orderId: req.params.id,
        menuItemId: i.menuItemId || null,
        name: i.name,
        category: i.category || '',
        price: i.price || 0,
        qty: i.qty || 1,
        menuType: i.menuType || 'FOOD',
        isVeg: i.isVeg !== false,
        note: i.note || null,
      }))
    });

    const allItems = await prisma.orderItem.findMany({ where: { orderId: req.params.id } });
    const totals = calcTotals(allItems);
    const updated = await prisma.order.update({
      where: { id: req.params.id },
      data: { subtotal: totals.subtotal, cgst: totals.cgst, sgst: totals.sgst, total: totals.total },
      include: { items: true }
    });

    io.to(order.restaurantId).emit('order-updated', updated);
    res.json(updated);
  } catch (err: any) {
    console.error('[orders/add-items]', err);
    res.status(500).json({ error: 'Failed to add items' });
  }
});

// POST /api/orders/:id/send-kot
router.post('/:id/send-kot', async (req: Request, res: Response): Promise<void> => {
  try {
    const { itemIds } = req.body;
    const order = await prisma.order.findUnique({ where: { id: req.params.id }, include: { items: true } });
    if (!order) { res.status(404).json({ error: 'Order not found' }); return; }

    if (itemIds && itemIds.length > 0) {
      await prisma.orderItem.updateMany({
        where: { id: { in: itemIds } },
        data: { kotSent: true, kotSentAt: new Date() }
      });
    }

    const updated = await prisma.order.findUnique({ where: { id: req.params.id }, include: { items: true } });
    io.to(order.restaurantId).emit('kot-sent', { orderId: order.id, items: updated?.items });
    io.to(order.restaurantId).emit('order-updated', updated);
    res.json(updated);
  } catch (err: any) {
    console.error('[orders/send-kot]', err);
    res.status(500).json({ error: 'Failed to send KOT' });
  }
});

// POST /api/orders/:id/print-bill
router.post('/:id/print-bill', async (req: Request, res: Response): Promise<void> => {
  try {
    const order = await prisma.order.findUnique({ where: { id: req.params.id }, include: { items: true } });
    if (!order) { res.status(404).json({ error: 'Order not found' }); return; }

    const billNumber = `BILL-${Date.now().toString().slice(-6)}`;
    const updated = await prisma.order.update({
      where: { id: req.params.id },
      data: { status: 'BILLED', billNumber, billPrintedAt: new Date() },
      include: { items: true }
    });

    io.to(order.restaurantId).emit('order-updated', updated);
    res.json(updated);
  } catch (err: any) {
    console.error('[orders/print-bill]', err);
    res.status(500).json({ error: 'Failed to print bill' });
  }
});

// POST /api/orders/:id/duplicate
router.post('/:id/duplicate', async (req: Request, res: Response): Promise<void> => {
  try {
    const order = await prisma.order.findUnique({ where: { id: req.params.id }, include: { items: true } });
    if (!order) { res.status(404).json({ error: 'Order not found' }); return; }

    const duplicated = await prisma.order.create({
      data: {
        ownerId: order.ownerId,
        restaurantId: order.restaurantId,
        tableId: order.tableId,
        tableName: order.tableName,
        section: order.section,
        status: 'OPEN',
        source: order.source,
        subtotal: order.subtotal,
        cgst: order.cgst,
        sgst: order.sgst,
        total: order.total,
        items: { create: order.items.map(i => ({
          menuItemId: i.menuItemId,
          name: i.name,
          category: i.category,
          price: i.price,
          qty: i.qty,
          menuType: i.menuType,
          isVeg: i.isVeg,
          note: i.note,
        })) }
      },
      include: { items: true }
    });

    io.to(order.restaurantId).emit('order-updated', duplicated);
    res.json(duplicated);
  } catch (err: any) {
    console.error('[orders/duplicate]', err);
    res.status(500).json({ error: 'Failed to duplicate order' });
  }
});

// POST /api/orders/:id/settle
router.post('/:id/settle', async (req: Request, res: Response): Promise<void> => {
  try {
    const { paymentMode } = req.body;
    const order = await prisma.order.findUnique({ where: { id: req.params.id }, include: { items: true } });
    if (!order) { res.status(404).json({ error: 'Order not found' }); return; }

    const updated = await prisma.order.update({
      where: { id: req.params.id },
      data: { status: 'SETTLED', paymentMode, paidAt: new Date() },
      include: { items: true }
    });

    io.to(order.restaurantId).emit('order-settled', { orderId: order.id, tableId: order.tableId });
    res.json(updated);
  } catch (err: any) {
    console.error('[orders/settle]', err);
    res.status(500).json({ error: 'Failed to settle order' });
  }
});

// POST /api/orders/:id/swap-table
router.post('/:id/swap-table', async (req: Request, res: Response): Promise<void> => {
  try {
    const { newTableId, newTableName, newSection } = req.body;
    const order = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!order) { res.status(404).json({ error: 'Order not found' }); return; }

    const updated = await prisma.order.update({
      where: { id: req.params.id },
      data: { tableId: newTableId, tableName: newTableName, section: newSection || order.section },
      include: { items: true }
    });

    io.to(order.restaurantId).emit('order-updated', updated);
    res.json(updated);
  } catch (err: any) {
    console.error('[orders/swap-table]', err);
    res.status(500).json({ error: 'Failed to swap table' });
  }
});

// POST /api/orders/:id/swap-items
router.post('/:id/swap-items', async (req: Request, res: Response): Promise<void> => {
  try {
    const { targetOrderId, itemIds } = req.body;
    await prisma.orderItem.updateMany({
      where: { id: { in: itemIds || [] } },
      data: { orderId: targetOrderId }
    });
    const order = await prisma.order.findUnique({ where: { id: req.params.id }, include: { items: true } });
    if (order) io.to(order.restaurantId).emit('order-updated', order);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[orders/swap-items]', err);
    res.status(500).json({ error: 'Failed to move items' });
  }
});

// POST /api/orders/merge
router.post('/merge', async (req: Request, res: Response): Promise<void> => {
  try {
    const { sourceOrderId, targetOrderId } = req.body;
    const source = await prisma.order.findUnique({ where: { id: sourceOrderId }, include: { items: true } });
    const target = await prisma.order.findUnique({ where: { id: targetOrderId }, include: { items: true } });
    if (!source || !target) { res.status(404).json({ error: 'Order not found' }); return; }

    await prisma.orderItem.updateMany({
      where: { orderId: sourceOrderId },
      data: { orderId: targetOrderId }
    });

    const allItems = await prisma.orderItem.findMany({ where: { orderId: targetOrderId } });
    const totals = calcTotals(allItems);
    const mergedOrder = await prisma.order.update({
      where: { id: targetOrderId },
      data: {
        subtotal: totals.subtotal,
        cgst: totals.cgst,
        sgst: totals.sgst,
        total: totals.total,
      },
      include: { items: true }
    });

    await prisma.order.delete({ where: { id: sourceOrderId } });
    io.to(source.restaurantId).emit('order-updated', mergedOrder);
    res.json(mergedOrder);
  } catch (err: any) {
    console.error('[orders/merge]', err);
    res.status(500).json({ error: 'Failed to merge orders' });
  }
});

// POST /api/orders/sync-batch — batch sync offline mutations
router.post('/sync-batch', async (req: Request, res: Response): Promise<void> => {
  try {
    const { mutations } = req.body;
    const results: Array<{ id: string; status: string; message?: string }> = [];

    for (const m of mutations || []) {
      try {
        if (m.type === 'CREATE_ORDER') {
          const p = m.payload;
          if (p.clientId) {
            const existing = await prisma.order.findUnique({ where: { clientId: p.clientId } });
            if (existing) { results.push({ id: m.id, status: 'duplicate' }); continue; }
          }
          const ownerId = await getOwnerId(p.restaurantId);
          if (!ownerId) { results.push({ id: m.id, status: 'error', message: 'Restaurant not found' }); continue; }
          const itemList = (p.items || []) as any[];
          const totals = calcTotals(itemList);
          const order = await prisma.order.create({
            data: {
              ownerId,
              restaurantId: p.restaurantId,
              tableId: p.tableId,
              tableName: p.tableName || p.tableId,
              section: p.section || '',
              status: 'OPEN',
              source: p.source || 'DINE_IN',
              subtotal: totals.subtotal,
              cgst: totals.cgst,
              sgst: totals.sgst,
              total: totals.total,
              clientId: p.clientId || undefined,
              deviceId: p.deviceId || undefined,
              items: { create: itemList.map(i => ({
                menuItemId: i.menuItemId || null,
                name: i.name,
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
          io.to(p.restaurantId).emit('order-updated', order);
          results.push({ id: m.id, status: 'ok' });
        }
        else if (m.type === 'ADD_ITEMS') {
          const p = m.payload;
          const order = await prisma.order.findUnique({ where: { id: p.orderId }, include: { items: true } });
          if (!order) { results.push({ id: m.id, status: 'error', message: 'Order not found' }); continue; }
          const newItems = (p.items || []) as any[];
          await prisma.orderItem.createMany({
            data: newItems.map(i => ({
              orderId: p.orderId,
              menuItemId: i.menuItemId || null,
              name: i.name,
              category: i.category || '',
              price: i.price || 0,
              qty: i.qty || 1,
              menuType: i.menuType || 'FOOD',
              isVeg: i.isVeg !== false,
              note: i.note || null,
            }))
          });
          const allItems = await prisma.orderItem.findMany({ where: { orderId: p.orderId } });
          const totals = calcTotals(allItems);
          const updated = await prisma.order.update({
            where: { id: p.orderId },
            data: { subtotal: totals.subtotal, cgst: totals.cgst, sgst: totals.sgst, total: totals.total },
            include: { items: true }
          });
          io.to(order.restaurantId).emit('order-updated', updated);
          results.push({ id: m.id, status: 'ok' });
        }
        else if (m.type === 'SEND_KOT') {
          const p = m.payload;
          const order = await prisma.order.findUnique({ where: { id: p.orderId }, include: { items: true } });
          if (!order) { results.push({ id: m.id, status: 'error', message: 'Order not found' }); continue; }
          if (p.itemIds && p.itemIds.length > 0) {
            await prisma.orderItem.updateMany({ where: { id: { in: p.itemIds } }, data: { kotSent: true, kotSentAt: new Date() } });
          }
          const updated = await prisma.order.findUnique({ where: { id: p.orderId }, include: { items: true } });
          io.to(order.restaurantId).emit('order-updated', updated);
          results.push({ id: m.id, status: 'ok' });
        }
        else if (m.type === 'SETTLE') {
          const p = m.payload;
          const order = await prisma.order.findUnique({ where: { id: p.orderId } });
          if (!order) { results.push({ id: m.id, status: 'error', message: 'Order not found' }); continue; }
          const updated = await prisma.order.update({
            where: { id: p.orderId },
            data: { status: 'SETTLED', paymentMode: p.paymentMode, paidAt: new Date() },
            include: { items: true }
          });
          io.to(order.restaurantId).emit('order-settled', { orderId: order.id, tableId: order.tableId });
          results.push({ id: m.id, status: 'ok' });
        }
        else if (m.type === 'PRINT_BILL') {
          const p = m.payload;
          const order = await prisma.order.findUnique({ where: { id: p.orderId } });
          if (!order) { results.push({ id: m.id, status: 'error', message: 'Order not found' }); continue; }
          const billNumber = `BILL-${Date.now().toString().slice(-6)}`;
          const updated = await prisma.order.update({
            where: { id: p.orderId },
            data: { status: 'BILLED', billNumber, billPrintedAt: new Date() },
            include: { items: true }
          });
          io.to(order.restaurantId).emit('order-updated', updated);
          results.push({ id: m.id, status: 'ok' });
        }
        else {
          results.push({ id: m.id, status: 'error', message: 'Unknown mutation type' });
        }
      } catch (e: any) {
        results.push({ id: m.id, status: 'error', message: e.message });
      }
    }

    res.json({ results });
  } catch (err: any) {
    console.error('[orders/sync-batch]', err);
    res.status(500).json({ error: 'Batch sync failed' });
  }
});

export default router;
