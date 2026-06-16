import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { requireTenantAdminAuth } from '../middleware/auth';
import { io } from '../index';

const router = Router();

// GET /api/inventory — list items for restaurant
router.get('/', requireTenantAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { restaurantId } = req.query;
    if (!restaurantId) { res.status(400).json({ error: 'restaurantId required' }); return; }
    const items = await prisma.inventoryItem.findMany({
      where: { restaurantId: String(restaurantId) },
      orderBy: { name: 'asc' },
    });
    res.json(items);
  } catch (err: any) {
    console.error('[inventory/list]', err);
    res.status(500).json({ error: 'Failed to fetch inventory' });
  }
});

// POST /api/inventory — create item
router.post('/', requireTenantAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { restaurantId, ownerId, name, unit, currentStock, lowStockAlert, menuItemId } = req.body;
    if (!restaurantId || !ownerId || !name) {
      res.status(400).json({ error: 'restaurantId, ownerId, and name are required' });
      return;
    }
    const item = await prisma.inventoryItem.create({
      data: {
        restaurantId: String(restaurantId),
        ownerId: String(ownerId),
        name: String(name),
        unit: unit ? String(unit) : 'pcs',
        currentStock: currentStock !== undefined ? Number(currentStock) : 0,
        lowStockAlert: lowStockAlert !== undefined ? Number(lowStockAlert) : 10,
        menuItemId: menuItemId ? String(menuItemId) : null,
      },
    });
    res.status(201).json(item);
  } catch (err: any) {
    console.error('[inventory/create]', err);
    res.status(500).json({ error: 'Failed to create inventory item' });
  }
});

// PATCH /api/inventory/:id — update stock
router.patch('/:id', requireTenantAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { currentStock, lowStockAlert } = req.body;
    const data: any = {};
    if (currentStock !== undefined) data.currentStock = Number(currentStock);
    if (lowStockAlert !== undefined) data.lowStockAlert = Number(lowStockAlert);

    const item = await prisma.inventoryItem.update({
      where: { id },
      data,
    });

    io.to(item.restaurantId).emit('STOCK_UPDATE', { itemId: item.id, currentStock: item.currentStock });
    res.json(item);
  } catch (err: any) {
    console.error('[inventory/update]', err);
    res.status(500).json({ error: 'Failed to update inventory item' });
  }
});

// DELETE /api/inventory/:id — soft delete
router.delete('/:id', requireTenantAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    await prisma.inventoryItem.delete({ where: { id } });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[inventory/delete]', err);
    res.status(500).json({ error: 'Failed to delete inventory item' });
  }
});

export default router;
