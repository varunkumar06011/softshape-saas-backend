import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma';
import { signTenantToken } from '../lib/jwt';
import { requireOwnerAuth, requireTenantAdminAuth } from '../middleware/auth';

const router = Router();

// GET /api/tenant/sections/:restaurantId — public, no auth required
router.get('/sections/:restaurantId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { restaurantId } = req.params;
    const owner = await prisma.owner.findUnique({ where: { restaurantId } });
    if (!owner) { res.status(404).json({ error: 'Restaurant not found' }); return; }

    const sections = await prisma.tenantSection.findMany({ where: { ownerId: owner.id } });
    const tables: Array<{ id: string; label: string; section: string; sectionId: string; status: string }> = [];

    for (const section of sections) {
      for (let i = 1; i <= section.tableCount; i++) {
        const short = section.name.replace(/\s+/g, '-');
        tables.push({
          id: `${short}-${i}`,
          label: `${short}-${i}`,
          section: section.name,
          sectionId: section.id,
          status: 'free',
        });
      }
    }

    res.json({ sections, tables });
  } catch (err) {
    console.error('[tenant/sections]', err);
    res.status(500).json({ error: 'Failed to load sections' });
  }
});

// POST /api/tenant/sections/:restaurantId — create new section (admin auth)
router.post('/sections/:restaurantId', requireTenantAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { restaurantId } = req.params;
    const { name, tableCount = 0, tableCapacity = 4 } = req.body;
    if (!name || typeof name !== 'string') { res.status(400).json({ error: 'Section name is required' }); return; }

    const owner = await prisma.owner.findUnique({ where: { restaurantId } });
    if (!owner) { res.status(404).json({ error: 'Restaurant not found' }); return; }

    const section = await prisma.tenantSection.create({
      data: { ownerId: owner.id, name, tableCount: Number(tableCount) || 0, tableCapacity: Number(tableCapacity) || 4 },
    });
    res.json({ message: 'Section created', section });
  } catch (err: any) {
    console.error('[tenant/sections POST]', err);
    res.status(500).json({ error: err.message || 'Failed to create section' });
  }
});

// PATCH /api/tenant/sections/:sectionId — update section (admin auth)
router.patch('/sections/:sectionId', requireTenantAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { sectionId } = req.params;
    const { name, tableCount, tableCapacity } = req.body;

    const data: any = {};
    if (name !== undefined) data.name = name;
    if (tableCount !== undefined) data.tableCount = Number(tableCount);
    if (tableCapacity !== undefined) data.tableCapacity = Number(tableCapacity);

    const section = await prisma.tenantSection.update({ where: { id: sectionId }, data });
    res.json({ message: 'Section updated', section });
  } catch (err: any) {
    console.error('[tenant/sections PATCH]', err);
    res.status(500).json({ error: err.message || 'Failed to update section' });
  }
});

// DELETE /api/tenant/sections/:sectionId — delete section (admin auth)
router.delete('/sections/:sectionId', requireTenantAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { sectionId } = req.params;
    await prisma.tenantSection.delete({ where: { id: sectionId } });
    res.json({ message: 'Section deleted' });
  } catch (err: any) {
    console.error('[tenant/sections DELETE]', err);
    res.status(500).json({ error: err.message || 'Failed to delete section' });
  }
});

// GET /api/tenant/:slug — public info for portal landing page
router.get('/:slug', async (req: Request, res: Response): Promise<void> => {
  try {
    const { slug } = req.params;
    const owner = await prisma.owner.findUnique({
      where: { slug },
      include: { stations: { select: { id: true, stationName: true, stationType: true, menuFilter: true, allowedSections: true, handleOnlineOrders: true } } },
    });
    if (!owner) { res.status(404).json({ error: 'Restaurant not found' }); return; }
    if (!owner.isActive) { res.status(403).json({ error: 'This account is not yet active. Please complete payment.' }); return; }

    res.json({
      restaurantName: owner.restaurantName,
      city: owner.city,
      logoUrl: owner.logoUrl,
      plan: owner.plan,
      restaurantId: owner.restaurantId || owner.slug,
      stations: owner.stations,
      menuUploaded: !!owner.menuUploadedAt,
    });
  } catch (err) { res.status(500).json({ error: 'Failed to load tenant' }); }
});

// POST /api/tenant/:slug/login
router.post('/:slug/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { slug } = req.params;
    const { role, username, password, stationId } = req.body;

    const owner = await prisma.owner.findUnique({ where: { slug } });
    if (!owner) { res.status(404).json({ error: 'Restaurant not found' }); return; }
    if (!owner.isActive) { res.status(403).json({ error: 'Account inactive' }); return; }

    const restaurantId = owner.restaurantId || owner.slug;
    const menuUploaded = !!owner.menuUploadedAt;

    if (role === 'admin') {
      const cred = await prisma.adminCredential.findUnique({ where: { restaurantId } });
      if (!cred) { res.status(401).json({ error: 'Admin not configured yet' }); return; }
      const valid = await bcrypt.compare(password, cred.passwordHash);
      if (!valid || cred.username !== username) { res.status(401).json({ error: 'Invalid credentials' }); return; }

      const token = signTenantToken({ restaurantId, slug, role: 'admin', menuUploaded });
      res.json({ token, session: { restaurantId, slug, role: 'admin', menuUploaded, restaurantName: owner.restaurantName, billTemplate: owner.billTemplate } });
      return;
    }

    if (role === 'cashier') {
      if (!stationId) { res.status(400).json({ error: 'stationId required for cashier login' }); return; }
      const station = await prisma.cashierStation.findFirst({ where: { id: stationId, restaurantId } });
      if (!station) { res.status(401).json({ error: 'Station not found' }); return; }
      const valid = await bcrypt.compare(password, station.passwordHash);
      if (!valid || station.username !== username) { res.status(401).json({ error: 'Invalid credentials' }); return; }

      const token = signTenantToken({ restaurantId, slug, role: 'cashier', stationId: station.id, menuFilter: station.menuFilter, menuUploaded, allowedSections: station.allowedSections || '[]', handleOnlineOrders: station.handleOnlineOrders });
      res.json({ token, session: { restaurantId, slug, role: 'cashier', stationId: station.id, stationName: station.stationName, menuFilter: station.menuFilter, menuUploaded, allowedSections: station.allowedSections || '[]', handleOnlineOrders: station.handleOnlineOrders, restaurantName: owner.restaurantName, billTemplate: owner.billTemplate, canReopen: station.canReopen, canExclude: station.canExclude, canDiscount: station.canDiscount, canRefund: station.canRefund } });
      return;
    }

    if (role === 'captain') {
      const captain = await prisma.captainLogin.findFirst({ where: { restaurantId, captainName: username } });
      if (!captain) { res.status(401).json({ error: 'Captain not found' }); return; }
      if (captain.pin !== String(password)) { res.status(401).json({ error: 'Invalid PIN' }); return; }

      const token = signTenantToken({ restaurantId, slug, role: 'captain', captainId: captain.id, menuUploaded });
      res.json({ token, session: { restaurantId, slug, role: 'captain', captainId: captain.id, captainName: captain.captainName, menuUploaded, restaurantName: owner.restaurantName, billTemplate: owner.billTemplate } });
      return;
    }

    res.status(400).json({ error: 'Invalid role. Must be admin, cashier, or captain' });
  } catch (err: any) {
    console.error('[tenant/login]', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

export default router;
