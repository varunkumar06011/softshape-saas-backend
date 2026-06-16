import { Router, Request, Response } from 'express';
import { parse } from 'csv-parse/sync';
import prisma from '../lib/prisma';
import { requireOwnerAuth } from '../middleware/auth';
import multer from 'multer';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ── Helpers ──
function parseVariants(variantsStr?: string | null) {
  if (!variantsStr) return null;
  try {
    return JSON.stringify(
      variantsStr.split('|').map((v: string) => {
        const [name, price] = v.split(':');
        return { name: name.trim(), price: Number(price) || 0 };
      })
    );
  } catch { return null; }
}

function normalizeColumn(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function findColumn(row: any, ...candidates: string[]): string | undefined {
  const keys = Object.keys(row);
  for (const cand of candidates) {
    const norm = normalizeColumn(cand);
    const found = keys.find(k => normalizeColumn(k) === norm);
    if (found) return row[found];
  }
  return undefined;
}

// POST /api/menu/upload-csv
router.post('/upload-csv', requireOwnerAuth, upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { ownerId } = (req as any).owner;
    if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }

    const owner = await prisma.owner.findUnique({ where: { id: ownerId } });
    if (!owner) { res.status(404).json({ error: 'Owner not found' }); return; }

    const restaurantId = owner.restaurantId || owner.slug;

    let csvText = req.file.buffer.toString('utf-8');
    // Strip UTF-8 BOM if present (common in Excel-exported CSVs)
    if (csvText.charCodeAt(0) === 0xFEFF) csvText = csvText.slice(1);
    const records = parse(csvText, { columns: true, skip_empty_lines: true, trim: true }) as any[];
    if (records.length === 0) { res.status(400).json({ error: 'CSV is empty' }); return; }

    const firstRow = records[0];
    const itemNameCol = findColumn(firstRow, 'item_name', 'itemname', 'name', 'item', 'dish', 'dishname', 'dish_name', 'menu_item');
    const categoryCol = findColumn(firstRow, 'category', 'cat', 'type', 'section', 'group', 'menu_category');
    const priceCol    = findColumn(firstRow, 'price', 'cost', 'mrp', 'rate', 'amount', 'value', 'price_inr');
    const typeCol     = findColumn(firstRow, 'type', 'menu_type', 'menutype', 'food_type', 'foodtype', 'item_type', 'itemtype');

    const missingCols: string[] = [];
    if (itemNameCol === undefined) missingCols.push('item_name');
    if (categoryCol === undefined) missingCols.push('category');
    if (priceCol === undefined) missingCols.push('price');
    if (typeCol === undefined) missingCols.push('type');

    if (missingCols.length > 0) {
      res.status(400).json({ error: `Missing columns: ${missingCols.join(', ')}. Your columns: ${Object.keys(firstRow).join(', ')}` });
      return;
    }

    const items = records.map((row: any) => {
      const itemName = findColumn(row, 'item_name', 'itemname', 'name', 'item', 'dish', 'dishname', 'dish_name', 'menu_item') || '';
      const category = findColumn(row, 'category', 'cat', 'type', 'section', 'group', 'menu_category') || '';
      const priceRaw = findColumn(row, 'price', 'cost', 'mrp', 'rate', 'amount', 'value', 'price_inr') || '0';
      const typeRaw  = findColumn(row, 'type', 'menu_type', 'menutype', 'food_type', 'foodtype', 'item_type', 'itemtype') || 'FOOD';
      const isVegRaw = findColumn(row, 'is_veg', 'isveg', 'veg', 'vegetarian', 'pure_veg', 'pureveg');
      const stationRaw = findColumn(row, 'station', 'prep_station', 'kitchen', 'bar', 'prepstation');
      const variantsRaw = findColumn(row, 'variants', 'variant', 'options', 'sizes', 'portion');

      return {
        ownerId, restaurantId,
        itemName,
        category,
        price: Number(priceRaw) || 0,
        menuType: String(typeRaw).toUpperCase(),
        isVeg: String(isVegRaw).toLowerCase() === 'true' || String(isVegRaw) === '1' || String(isVegRaw).toLowerCase() === 'yes' || String(isVegRaw).toLowerCase() === 'veg',
        station: (stationRaw || 'KITCHEN').toUpperCase(),
        variants: parseVariants(variantsRaw),
      };
    });

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

// GET /api/menu/:restaurantId — menu for cashier/captain dashboards
router.get('/:restaurantId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { restaurantId } = req.params;
    const { type, section } = req.query;

    const where: any = { restaurantId, isActive: true };
    if (type && type !== 'BOTH') where.menuType = String(type).toUpperCase();

    const items = await prisma.tenantMenuItem.findMany({ where, orderBy: [{ category: 'asc' }, { itemName: 'asc' }] });

    const sectionName = section ? String(section) : undefined;

    const grouped: Record<string, any[]> = {};
    for (const item of items) {
      if (!grouped[item.category]) grouped[item.category] = [];

      let effectivePrice = item.price;
      let overrides: Record<string, number> = {};
      try { overrides = item.priceOverrides ? JSON.parse(item.priceOverrides) : {}; } catch {}
      if (sectionName && overrides[sectionName]) effectivePrice = overrides[sectionName];

      grouped[item.category].push({
        id: item.id, name: item.itemName, price: effectivePrice,
        menuType: item.menuType, isVeg: item.isVeg,
        station: item.station, imageUrl: item.imageUrl,
        isSpecial: item.isSpecial, specialNote: item.specialNote,
        variants: item.variants ? JSON.parse(item.variants) : [],
        priceOverrides: item.priceOverrides,
      });
    }

    res.json({ categories: grouped, total: items.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch menu' });
  }
});

// GET /api/menu/:restaurantId/items — flat item list with section-adjusted prices
router.get('/:restaurantId/items', async (req: Request, res: Response): Promise<void> => {
  try {
    const { restaurantId } = req.params;
    const { type, section } = req.query;

    const where: any = { restaurantId, isActive: true };
    if (type && type !== 'BOTH') where.menuType = String(type).toUpperCase();

    const items = await prisma.tenantMenuItem.findMany({ where, orderBy: [{ category: 'asc' }, { itemName: 'asc' }] });

    const sectionName = section ? String(section) : undefined;

    res.json(items.map(item => {
      let effectivePrice = item.price;
      let overrides: Record<string, number> = {};
      try { overrides = item.priceOverrides ? JSON.parse(item.priceOverrides) : {}; } catch {}
      if (sectionName && overrides[sectionName]) effectivePrice = overrides[sectionName];
      return {
        id: item.id, name: item.itemName, category: item.category,
        price: effectivePrice, menuType: item.menuType, isVeg: item.isVeg,
        station: item.station, imageUrl: item.imageUrl,
        isSpecial: item.isSpecial, specialNote: item.specialNote,
        variants: item.variants ? JSON.parse(item.variants) : [],
        priceOverrides: item.priceOverrides,
      };
    }));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch items' });
  }
});

// GET /api/menu/:restaurantId/specials — today's specials (public)
router.get('/:restaurantId/specials', async (req: Request, res: Response): Promise<void> => {
  try {
    const { restaurantId } = req.params;
    const items = await prisma.tenantMenuItem.findMany({
      where: { restaurantId, isSpecial: true, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(items.map(i => ({
      id: i.id, name: i.itemName, price: i.price, category: i.category,
      isVeg: i.isVeg, imageUrl: i.imageUrl, specialNote: i.specialNote,
      menuType: i.menuType, station: i.station,
    })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch specials' });
  }
});

// POST /api/menu/item — add single item manually
router.post('/item', requireOwnerAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { ownerId } = (req as any).owner;
    const owner = await prisma.owner.findUnique({ where: { id: ownerId } });
    if (!owner) { res.status(404).json({ error: 'Owner not found' }); return; }

    const { itemName, category, price, isVeg, menuType, station, variants, imageUrl, isSpecial, specialNote, priceOverrides } = req.body;
    if (!itemName || !category || price == null) {
      res.status(400).json({ error: 'itemName, category, and price are required' });
      return;
    }

    const item = await prisma.tenantMenuItem.create({
      data: {
        ownerId,
        restaurantId: owner.restaurantId || owner.slug,
        itemName,
        category,
        price: Number(price),
        isVeg: isVeg !== false,
        menuType: (menuType || 'FOOD').toUpperCase(),
        station: (station || 'KITCHEN').toUpperCase(),
        variants: variants ? JSON.stringify(variants) : null,
        priceOverrides: priceOverrides ? JSON.stringify(priceOverrides) : null,
        imageUrl: imageUrl || null,
        isSpecial: isSpecial === true,
        specialNote: specialNote || null,
      },
    });

    res.json(item);
  } catch (err: any) {
    console.error('[menu/item]', err);
    res.status(500).json({ error: err.message || 'Failed to create item' });
  }
});

// PATCH /api/menu/item/:id — update single item
router.patch('/item/:id', requireOwnerAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { ownerId } = (req as any).owner;
    const { id } = req.params;
    const { itemName, category, price, isVeg, menuType, station, isActive, isSpecial, specialNote, imageUrl, variants, priceOverrides } = req.body;

    const data: any = {};
    if (itemName !== undefined) data.itemName = itemName;
    if (category !== undefined) data.category = category;
    if (price !== undefined) data.price = Number(price);
    if (isVeg !== undefined) data.isVeg = isVeg;
    if (menuType !== undefined) data.menuType = menuType.toUpperCase();
    if (station !== undefined) data.station = station.toUpperCase();
    if (isActive !== undefined) data.isActive = isActive;
    if (isSpecial !== undefined) data.isSpecial = isSpecial;
    if (specialNote !== undefined) data.specialNote = specialNote;
    if (imageUrl !== undefined) data.imageUrl = imageUrl;
    if (variants !== undefined) data.variants = variants ? JSON.stringify(variants) : null;
    if (priceOverrides !== undefined) data.priceOverrides = priceOverrides ? JSON.stringify(priceOverrides) : null;

    const item = await prisma.tenantMenuItem.updateMany({
      where: { id, ownerId },
      data,
    });

    if (item.count === 0) { res.status(404).json({ error: 'Item not found' }); return; }
    res.json({ updated: true });
  } catch (err: any) {
    console.error('[menu/item/patch]', err);
    res.status(500).json({ error: err.message || 'Failed to update item' });
  }
});

// DELETE /api/menu/item/:id — soft delete (set isActive false)
router.delete('/item/:id', requireOwnerAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { ownerId } = (req as any).owner;
    const { id } = req.params;

    await prisma.tenantMenuItem.updateMany({
      where: { id, ownerId },
      data: { isActive: false },
    });

    res.json({ deleted: true });
  } catch (err: any) {
    console.error('[menu/item/delete]', err);
    res.status(500).json({ error: err.message || 'Failed to delete item' });
  }
});

// POST /api/menu/upload-image — upload item photo (base64 data URL)
router.post('/upload-image', requireOwnerAuth, upload.single('image'), async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) { res.status(400).json({ error: 'No image uploaded' }); return; }

    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(req.file.mimetype)) {
      res.status(400).json({ error: 'Only JPEG, PNG, WebP allowed' });
      return;
    }

    const base64 = req.file.buffer.toString('base64');
    const imageUrl = `data:${req.file.mimetype};base64,${base64}`;

    res.json({ imageUrl });
  } catch (err: any) {
    console.error('[menu/upload-image]', err);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

export default router;
