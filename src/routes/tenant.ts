import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma';
import { signTenantToken } from '../lib/jwt';

const router = Router();

// GET /api/tenant/:slug — public info for portal landing page
router.get('/:slug', async (req: Request, res: Response): Promise<void> => {
  try {
    const { slug } = req.params;
    const owner = await prisma.owner.findUnique({
      where: { slug },
      include: { stations: { select: { id: true, stationName: true, stationType: true, menuFilter: true } } },
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
      res.json({ token, session: { restaurantId, slug, role: 'admin', menuUploaded, restaurantName: owner.restaurantName } });
      return;
    }

    if (role === 'cashier') {
      if (!stationId) { res.status(400).json({ error: 'stationId required for cashier login' }); return; }
      const station = await prisma.cashierStation.findFirst({ where: { id: stationId, restaurantId } });
      if (!station) { res.status(401).json({ error: 'Station not found' }); return; }
      const valid = await bcrypt.compare(password, station.passwordHash);
      if (!valid || station.username !== username) { res.status(401).json({ error: 'Invalid credentials' }); return; }

      const token = signTenantToken({ restaurantId, slug, role: 'cashier', stationId: station.id, menuFilter: station.menuFilter, menuUploaded });
      res.json({ token, session: { restaurantId, slug, role: 'cashier', stationId: station.id, stationName: station.stationName, menuFilter: station.menuFilter, menuUploaded, restaurantName: owner.restaurantName } });
      return;
    }

    if (role === 'captain') {
      const captain = await prisma.captainLogin.findFirst({ where: { restaurantId, captainName: username } });
      if (!captain) { res.status(401).json({ error: 'Captain not found' }); return; }
      if (captain.pin !== String(password)) { res.status(401).json({ error: 'Invalid PIN' }); return; }

      const token = signTenantToken({ restaurantId, slug, role: 'captain', captainId: captain.id, menuUploaded });
      res.json({ token, session: { restaurantId, slug, role: 'captain', captainId: captain.id, captainName: captain.captainName, menuUploaded, restaurantName: owner.restaurantName } });
      return;
    }

    res.status(400).json({ error: 'Invalid role. Must be admin, cashier, or captain' });
  } catch (err: any) {
    console.error('[tenant/login]', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

export default router;
