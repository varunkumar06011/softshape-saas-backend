import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { io } from '../index';

const router = Router();

// POST /api/orders — create a new order
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { restaurantId, tableId, items, clientId, deviceId } = req.body;
    if (!restaurantId || !tableId) {
      res.status(400).json({ error: 'restaurantId and tableId required' });
      return;
    }

    // Idempotent: if clientId exists, return existing order
    if (clientId) {
      const existing = await prisma.order.findUnique({ where: { clientId } });
      if (existing) { res.json(existing); return; }
    }

    const order = await prisma.order.create({
      data: {
        restaurantId,
        tableId,
        items: JSON.stringify(items || []),
        status: 'RUNNING',
        source: 'DINE_IN',
        clientId: clientId || undefined,
        deviceId: deviceId || undefined,
      }
    });

    io.to(restaurantId).emit('order-updated', order);
    res.json(order);
  } catch (err: any) {
    console.error('[orders/create]', err);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// POST /api/orders/:id/items — add items to order
router.post('/:id/items', async (req: Request, res: Response): Promise<void> => {
  try {
    const order = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!order) { res.status(404).json({ error: 'Order not found' }); return; }

    const existingItems = JSON.parse((order.items as string) || '[]');
    const newItems = req.body.items || [];
    const updatedItems = [...existingItems, ...newItems];

    const updated = await prisma.order.update({
      where: { id: req.params.id },
      data: { items: JSON.stringify(updatedItems) }
    });

    io.to(order.restaurantId).emit('order-updated', updated);
    res.json(updated);
  } catch (err: any) {
    console.error('[orders/add-items]', err);
    res.status(500).json({ error: 'Failed to add items' });
  }
});

// POST /api/orders/:id/kot — mark items as KOT sent
router.post('/:id/kot', async (req: Request, res: Response): Promise<void> => {
  try {
    const order = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!order) { res.status(404).json({ error: 'Order not found' }); return; }

    const updated = await prisma.order.update({
      where: { id: req.params.id },
      data: { status: 'KOT_SENT' }
    });

    io.to(order.restaurantId).emit('kot-sent', { orderId: order.id, items: updated.items });
    io.to(order.restaurantId).emit('order-updated', updated);
    res.json(updated);
  } catch (err: any) {
    console.error('[orders/kot]', err);
    res.status(500).json({ error: 'Failed to send KOT' });
  }
});

// POST /api/orders/:id/print-bill — update to BILLED status
router.post('/:id/print-bill', async (req: Request, res: Response): Promise<void> => {
  try {
    const order = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!order) { res.status(404).json({ error: 'Order not found' }); return; }

    const updated = await prisma.order.update({
      where: { id: req.params.id },
      data: { status: 'BILLED' }
    });

    io.to(order.restaurantId).emit('order-updated', updated);
    res.json(updated);
  } catch (err: any) {
    console.error('[orders/print-bill]', err);
    res.status(500).json({ error: 'Failed to print bill' });
  }
});

// POST /api/orders/:id/settle — settle the order
router.post('/:id/settle', async (req: Request, res: Response): Promise<void> => {
  try {
    const { paymentMode } = req.body;
    const order = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!order) { res.status(404).json({ error: 'Order not found' }); return; }

    const updated = await prisma.order.update({
      where: { id: req.params.id },
      data: { status: 'SETTLED', paymentMode, paidAt: new Date() }
    });

    io.to(order.restaurantId).emit('order-settled', { orderId: order.id, tableId: order.tableId });
    res.json(updated);
  } catch (err: any) {
    console.error('[orders/settle]', err);
    res.status(500).json({ error: 'Failed to settle order' });
  }
});

// POST /api/orders/:id/merge — merge with target order
router.post('/:id/merge', async (req: Request, res: Response): Promise<void> => {
  try {
    const { targetOrderId } = req.body;
    const order = await prisma.order.findUnique({ where: { id: req.params.id } });
    const target = await prisma.order.findUnique({ where: { id: targetOrderId } });
    if (!order || !target) { res.status(404).json({ error: 'Order not found' }); return; }

    const mergedItems = [
      ...JSON.parse((order.items as string) || '[]'),
      ...JSON.parse((target.items as string) || '[]')
    ];

    await prisma.order.delete({ where: { id: targetOrderId } });
    const mergedOrder = await prisma.order.update({
      where: { id: req.params.id },
      data: { items: JSON.stringify(mergedItems) }
    });

    io.to(order.restaurantId).emit('order-updated', mergedOrder);
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
          if (m.payload.clientId) {
            const existing = await prisma.order.findUnique({ where: { clientId: m.payload.clientId } });
            if (existing) {
              results.push({ id: m.id, status: 'duplicate' });
              continue;
            }
          }
          const order = await prisma.order.create({
            data: {
              restaurantId: m.payload.restaurantId,
              tableId: m.payload.tableId,
              items: JSON.stringify(m.payload.items || []),
              status: 'RUNNING',
              source: 'DINE_IN',
              clientId: m.payload.clientId || undefined,
              deviceId: m.payload.deviceId || undefined,
            }
          });
          io.to(m.payload.restaurantId).emit('order-updated', order);
          results.push({ id: m.id, status: 'ok' });
        }
        else if (m.type === 'ADD_ITEMS') {
          const order = await prisma.order.findUnique({ where: { id: m.payload.orderId } });
          if (!order) { results.push({ id: m.id, status: 'error', message: 'Order not found' }); continue; }
          const existingItems = JSON.parse((order.items as string) || '[]');
          const updated = await prisma.order.update({
            where: { id: m.payload.orderId },
            data: { items: JSON.stringify([...existingItems, ...(m.payload.items || [])]) }
          });
          io.to(order.restaurantId).emit('order-updated', updated);
          results.push({ id: m.id, status: 'ok' });
        }
        else if (m.type === 'SEND_KOT') {
          const order = await prisma.order.findUnique({ where: { id: m.payload.orderId } });
          if (!order) { results.push({ id: m.id, status: 'error', message: 'Order not found' }); continue; }
          const updated = await prisma.order.update({
            where: { id: m.payload.orderId },
            data: { status: 'KOT_SENT' }
          });
          io.to(order.restaurantId).emit('order-updated', updated);
          results.push({ id: m.id, status: 'ok' });
        }
        else if (m.type === 'SETTLE') {
          const order = await prisma.order.findUnique({ where: { id: m.payload.orderId } });
          if (!order) { results.push({ id: m.id, status: 'error', message: 'Order not found' }); continue; }
          const updated = await prisma.order.update({
            where: { id: m.payload.orderId },
            data: { status: 'SETTLED', paymentMode: m.payload.paymentMode, paidAt: new Date() }
          });
          io.to(order.restaurantId).emit('order-settled', { orderId: order.id, tableId: order.tableId });
          results.push({ id: m.id, status: 'ok' });
        }
        else if (m.type === 'PRINT_BILL') {
          const order = await prisma.order.findUnique({ where: { id: m.payload.orderId } });
          if (!order) { results.push({ id: m.id, status: 'error', message: 'Order not found' }); continue; }
          const updated = await prisma.order.update({
            where: { id: m.payload.orderId },
            data: { status: 'BILLED' }
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
