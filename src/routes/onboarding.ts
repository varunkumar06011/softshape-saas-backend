import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { requireOwnerAuth } from '../middleware/auth';

const router = Router();
router.use(requireOwnerAuth);

// GET /api/onboarding/status — resume wizard from last completed step
router.get('/status', async (req: Request, res: Response): Promise<void> => {
  try {
    const { ownerId } = (req as any).owner;
    const owner = await prisma.owner.findUnique({
      where: { id: ownerId },
      include: { sections: true, stations: true, captains: true, adminCred: true },
    });
    if (!owner) { res.status(404).json({ error: 'Owner not found' }); return; }
    res.json({ owner, sections: owner.sections, stations: owner.stations, captains: owner.captains });
  } catch (err) { res.status(500).json({ error: 'Failed to load status' }); }
});

// POST /api/onboarding/step1 — Restaurant details
router.post('/step1', async (req: Request, res: Response): Promise<void> => {
  try {
    const { ownerId } = (req as any).owner;
    const { restaurantName, address, gstin, cuisineType, seatingCapacity, logoUrl, swiggyStoreId, zomatoOutletId } = req.body;
    if (!restaurantName || !address) { res.status(400).json({ error: 'Restaurant name and address required' }); return; }

    const owner = await prisma.owner.update({
      where: { id: ownerId },
      data: { restaurantName, address, gstin: gstin || null, cuisineType, seatingCapacity: seatingCapacity ? Number(seatingCapacity) : null, logoUrl: logoUrl || null, swiggyStoreId: swiggyStoreId || null, zomatoOutletId: zomatoOutletId || null, onboardingStep: 'DETAILS_SAVED' },
    });
    res.json({ message: 'Step 1 saved', owner: { id: owner.id, onboardingStep: owner.onboardingStep } });
  } catch (err) { res.status(500).json({ error: 'Failed to save details' }); }
});

// POST /api/onboarding/step2 — Floor plan (sections + tables)
router.post('/step2', async (req: Request, res: Response): Promise<void> => {
  try {
    const { ownerId } = (req as any).owner;
    const { sections } = req.body;
    if (!Array.isArray(sections) || sections.length === 0) { res.status(400).json({ error: 'At least one section required' }); return; }

    // Delete existing sections (idempotent — owner can go back and redo)
    await prisma.tenantSection.deleteMany({ where: { ownerId } });

    await prisma.tenantSection.createMany({
      data: sections.map((s: any) => ({
        ownerId,
        name: s.name,
        tableCount: Number(s.tableCount) || 4,
        tableCapacity: Number(s.tableCapacity) || 4,
      })),
    });

    await prisma.owner.update({ where: { id: ownerId }, data: { onboardingStep: 'FLOOR_SAVED' } });
    res.json({ message: 'Step 2 saved', count: sections.length });
  } catch (err) { res.status(500).json({ error: 'Failed to save floor plan' }); }
});

// POST /api/onboarding/step3 — Menu items (manual add, pre-upload)
router.post('/step3', async (req: Request, res: Response): Promise<void> => {
  try {
    const { ownerId } = (req as any).owner;
    const owner = await prisma.owner.findUnique({ where: { id: ownerId } });
    if (!owner) { res.status(404).json({ error: 'Not found' }); return; }

    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      // Step 3 is optional during wizard (CSV upload comes after payment)
      await prisma.owner.update({ where: { id: ownerId }, data: { onboardingStep: 'MENU_SAVED' } });
      res.json({ message: 'Step 3 skipped (menu upload after payment)' });
      return;
    }

    const restaurantId = owner.restaurantId || owner.slug;

    await prisma.tenantMenuItem.deleteMany({ where: { ownerId } });
    await prisma.tenantMenuItem.createMany({
      data: items.map((item: any) => ({
        ownerId, restaurantId,
        itemName: item.itemName, category: item.category,
        price: Number(item.price), menuType: item.menuType || 'FOOD',
        isVeg: item.isVeg === true || item.isVeg === 'true',
        variants: item.variants ? JSON.stringify(item.variants) : null,
      })),
    });

    await prisma.owner.update({ where: { id: ownerId }, data: { onboardingStep: 'MENU_SAVED' } });
    res.json({ message: 'Step 3 saved', count: items.length });
  } catch (err) { res.status(500).json({ error: 'Failed to save menu items' }); }
});

// POST /api/onboarding/step4 — Stations + Captains + Admin credentials
router.post('/step4', async (req: Request, res: Response): Promise<void> => {
  try {
    const { ownerId } = (req as any).owner;
    const { stations, captains, adminUsername, adminPassword } = req.body;
    const owner = await prisma.owner.findUnique({ where: { id: ownerId } });
    if (!owner) { res.status(404).json({ error: 'Not found' }); return; }

    const restaurantId = owner.restaurantId || owner.slug;

    const bcrypt = await import('bcryptjs');

    // Save stations
    if (Array.isArray(stations) && stations.length > 0) {
      await prisma.cashierStation.deleteMany({ where: { ownerId } });
      await prisma.cashierStation.createMany({
        data: await Promise.all(stations.map(async (s: any) => ({
          ownerId, restaurantId,
          stationName: s.stationName,
          stationType: s.stationType || 'DINING',
          menuFilter: s.menuFilter || 'FOOD',
          username: s.username,
          passwordHash: await bcrypt.default.hash(s.password, 10),
        }))),
      });
    }

    // Save captains
    if (Array.isArray(captains) && captains.length > 0) {
      await prisma.captainLogin.deleteMany({ where: { ownerId } });
      const { nameToInitials } = await import('../utils/slug');
      await prisma.captainLogin.createMany({
        data: captains.map((c: any) => ({
          ownerId, restaurantId,
          captainName: c.name,
          pin: String(c.pin),
          initials: nameToInitials(c.name),
        })),
      });
    }

    // Save admin credentials
    if (adminUsername && adminPassword) {
      const passwordHash = await bcrypt.default.hash(adminPassword, 10);
      await prisma.adminCredential.upsert({
        where: { ownerId },
        update: { username: adminUsername, passwordHash },
        create: { ownerId, restaurantId, username: adminUsername, passwordHash },
      });
    }

    await prisma.owner.update({ where: { id: ownerId }, data: { onboardingStep: 'STATIONS_SAVED' } });
    res.json({ message: 'Step 4 saved' });
  } catch (err: any) {
    console.error('[onboarding/step4]', err);
    res.status(500).json({ error: 'Failed to save stations/captains' });
  }
});

// PATCH /api/onboarding/bill-template
router.patch('/bill-template', async (req: Request, res: Response): Promise<void> => {
  try {
    const { ownerId } = (req as any).owner;
    const { billTemplate } = req.body;
    if (!billTemplate || !['CLASSIC', 'MINIMAL', 'HOTEL'].includes(billTemplate)) {
      res.status(400).json({ error: 'Invalid bill template. Must be CLASSIC, MINIMAL, or HOTEL' });
      return;
    }
    const owner = await prisma.owner.update({
      where: { id: ownerId },
      data: { billTemplate },
    });
    res.json({ message: 'Bill template updated', billTemplate: owner.billTemplate });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update bill template' });
  }
});

export default router;
