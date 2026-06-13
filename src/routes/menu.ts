import { Router, Request, Response } from 'express';
import { parse } from 'csv-parse/sync';
import prisma from '../lib/prisma';
import { requireOwnerAuth } from '../middleware/auth';
import multer from 'multer';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// POST /api/menu/upload-csv
router.post('/upload-csv', requireOwnerAuth, upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { ownerId } = (req as any).owner;
    if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }

    const owner = await prisma.owner.findUnique({ where: { id: ownerId } });
    if (!owner) { res.status(404).json({ error: 'Owner not found' }); return; }

    const restaurantId = owner.restaurantId || owner.slug;

    const csvText = req.file.buffer.toString('utf-8');
    const records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as any[];

    if (records.length === 0) { res.status(400).json({ error: 'CSV is empty' }); return; }

    const requiredColumns = ['item_name', 'category', 'price', 'type'];
    const firstRow = records[0];
    const missingCols = requiredColumns.filter(col => !(col in firstRow));
    if (missingCols.length > 0) {
      res.status(400).json({ error: `Missing columns: ${missingCols.join(', ')}. Required: item_name, category, price, type, is_veg, variants` });
      return;
    }

    const items = records.map((row: any) => {
      let variants = null;
      if (row.variants) {
        try {
          variants = JSON.stringify(
            row.variants.split('|').map((v: string) => {
              const [name, price] = v.split(':');
              return { name: name.trim(), price: Number(price) || 0 };
            })
          );
        } catch { variants = null; }
      }
      return {
        ownerId, restaurantId,
        itemName: row.item_name,
        category: row.category,
        price: Number(row.price) || 0,
        menuType: (row.type || 'FOOD').toUpperCase(),
        isVeg: row.is_veg === 'true' || row.is_veg === '1' || row.is_veg === 'yes',
        variants,
      };
    });

    // Replace existing items with uploaded ones
    await prisma.tenantMenuItem.deleteMany({ where: { ownerId } });
    await prisma.tenantMenuItem.createMany({ data: items });

    await prisma.owner.update({
      where: { id: ownerId },
      data: { menuUploadedAt: new Date(), onboardingStep: 'MENU_UPLOADED' },
    });

    const categories = [...new Set(items.map(i => i.category))];
    res.json({ imported: items.length, categories: categories.length, categoryList: categories });
  } catch (err: any) {
    console.error('[menu/upload-csv]', err);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

// GET /api/menu/:restaurantId — returns menu for a tenant's cashier/captain dashboards
router.get('/:restaurantId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { restaurantId } = req.params;
    const { type } = req.query;

    const where: any = { restaurantId, isActive: true };
    if (type && type !== 'BOTH') where.menuType = String(type).toUpperCase();

    const items = await prisma.tenantMenuItem.findMany({ where, orderBy: [{ category: 'asc' }, { itemName: 'asc' }] });

    // Group by category
    const grouped: Record<string, any[]> = {};
    for (const item of items) {
      if (!grouped[item.category]) grouped[item.category] = [];
      grouped[item.category].push({
        id: item.id, name: item.itemName, price: item.price,
        menuType: item.menuType, isVeg: item.isVeg,
        variants: item.variants ? JSON.parse(item.variants) : [],
      });
    }

    res.json({ categories: grouped, total: items.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch menu' });
  }
});

export default router;
