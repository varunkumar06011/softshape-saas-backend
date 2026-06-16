import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma';
import { signOwnerToken } from '../lib/jwt';
import { generateSlug } from '../utils/slug';

const router = Router();

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, phone, password, restaurantName, city, restaurantType, outletCount } = req.body;

    if (!name || !email || !phone || !password || !restaurantName || !city || !restaurantType || !outletCount) {
      res.status(400).json({ error: 'All fields are required' });
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'Invalid email address' });
      return;
    }

    if (!/^\d{10}$/.test(phone)) {
      res.status(400).json({ error: 'Phone must be 10 digits' });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters' });
      return;
    }

    const existing = await prisma.owner.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const slug = generateSlug(restaurantName);

    const owner = await prisma.owner.create({
      data: { name, email, phone, passwordHash, restaurantName, city, slug, restaurantType, outletCount },
    });

    const token = signOwnerToken({ ownerId: owner.id, restaurantId: owner.restaurantId || '', slug: owner.slug, role: 'owner' });

    res.status(201).json({
      message: 'Registered successfully',
      token,
      owner: { id: owner.id, name: owner.name, email: owner.email, slug: owner.slug, onboardingStep: owner.onboardingStep },
    });
  } catch (err: any) {
    console.error('[auth/register] ERROR:', err.message, err.stack);
    if (err.code === 'P1001') {
      res.status(503).json({ error: 'Database is temporarily unavailable. Please try again in 30 seconds.' });
      return;
    }
    if (err.code === 'P2002') {
      res.status(409).json({ error: 'An account with this email or slug already exists' });
      return;
    }
    res.status(500).json({ error: err.message || 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password required' });
      return;
    }

    const owner = await prisma.owner.findUnique({ where: { email } });
    if (!owner) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const valid = await bcrypt.compare(password, owner.passwordHash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const token = signOwnerToken({ ownerId: owner.id, restaurantId: owner.restaurantId || '', slug: owner.slug, role: 'owner' });

    res.json({
      token,
      owner: {
        id: owner.id, name: owner.name, email: owner.email, phone: owner.phone,
        slug: owner.slug, plan: owner.plan, isActive: owner.isActive,
        restaurantId: owner.restaurantId, onboardingStep: owner.onboardingStep,
        restaurantName: owner.restaurantName,
      },
    });
  } catch (err: any) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

export default router;
