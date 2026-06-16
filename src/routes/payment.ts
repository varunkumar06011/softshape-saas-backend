import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import prisma from '../lib/prisma';
import { requireOwnerAuth } from '../middleware/auth';
import { getPlanConfig } from '../utils/plans';

const router = Router();
router.use(requireOwnerAuth);

// POST /api/payment/create-order
router.post('/create-order', async (req: Request, res: Response): Promise<void> => {
  try {
    const { ownerId } = (req as any).owner;
    const { planId } = req.body;
    if (!planId) { res.status(400).json({ error: 'planId required' }); return; }

    const plan = getPlanConfig(planId);

    const authString = Buffer.from(
      `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
    ).toString('base64');

    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${authString}` },
      body: JSON.stringify({
        amount: plan.price * 100,
        currency: 'INR',
        receipt: `order_${ownerId}_${Date.now()}`,
        notes: { ownerId, plan: plan.id },
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      res.status(502).json({ error: 'Razorpay order creation failed', details: err });
      return;
    }

    const razorpayOrder: any = await response.json();

    // Save pending payment record
    await prisma.payment.create({
      data: {
        ownerId,
        plan: plan.id as any,
        amount: plan.price,
        razorpayOrderId: razorpayOrder.id,
        status: 'PENDING',
      },
    });

    await prisma.owner.update({
      where: { id: ownerId },
      data: { plan: plan.id as any, onboardingStep: 'PAYMENT_PENDING' },
    });

    res.json({
      razorpayOrderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      key: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err: any) {
    console.error('[payment/create-order]', err);
    res.status(500).json({ error: 'Failed to create payment order' });
  }
});

// POST /api/payment/verify — called after Razorpay payment success
router.post('/verify', async (req: Request, res: Response): Promise<void> => {
  try {
    const { ownerId } = (req as any).owner;
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      res.status(400).json({ error: 'Missing payment verification fields' });
      return;
    }

    // Verify HMAC signature
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      res.status(400).json({ error: 'Payment signature verification failed' });
      return;
    }

    const payment = await prisma.payment.findUnique({ where: { razorpayOrderId: razorpay_order_id } });
    if (!payment) { res.status(404).json({ error: 'Payment record not found' }); return; }

    const plan = getPlanConfig(payment.plan);
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    // Mark payment success + activate owner
    await prisma.payment.update({
      where: { razorpayOrderId: razorpay_order_id },
      data: { status: 'SUCCESS', razorpayPaymentId: razorpay_payment_id, razorpaySignature: razorpay_signature, paidAt: now },
    });

    const owner = await prisma.owner.update({
      where: { id: ownerId },
      data: {
        isActive: true,
        planPaidAt: now,
        planExpiresAt: expiresAt,
        onboardingStep: 'PAYMENT_DONE',
      },
    });

    res.json({
      success: true,
      slug: owner.slug,
      restaurantId: owner.restaurantId,
      plan: owner.plan,
      planExpiresAt: owner.planExpiresAt,
    });
  } catch (err: any) {
    console.error('[payment/verify]', err);
    res.status(500).json({ error: 'Payment verification failed' });
  }
});

// POST /api/payment/activate — demo mode activation (no Razorpay required)
router.post('/activate', async (req: Request, res: Response): Promise<void> => {
  try {
    const { ownerId } = (req as any).owner;
    const { planId } = req.body;
    const plan = getPlanConfig(planId || 'pro');
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    await prisma.owner.update({
      where: { id: ownerId },
      data: {
        isActive: true,
        plan: plan.id as any,
        planPaidAt: now,
        planExpiresAt: expiresAt,
        onboardingStep: 'PAYMENT_DONE',
      },
    });

    res.json({ success: true, message: 'Account activated' });
  } catch (err: any) {
    console.error('[payment/activate]', err);
    res.status(500).json({ error: 'Activation failed' });
  }
});

// POST /api/payment/webhook — Razorpay webhook (configure in Razorpay dashboard)
// Webhook URL: https://your-saas-backend.com/api/payment/webhook
router.post('/webhook', async (req: Request, res: Response): Promise<void> => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (webhookSecret) {
      const signature = req.headers['x-razorpay-signature'] as string;
      const body = JSON.stringify(req.body);
      const expected = crypto.createHmac('sha256', webhookSecret).update(body).digest('hex');
      if (signature !== expected) { res.status(400).json({ error: 'Invalid webhook signature' }); return; }
    }

    const event = req.body;
    if (event.event === 'payment.captured') {
      const orderId = event.payload?.payment?.entity?.order_id;
      if (orderId) {
        await prisma.payment.updateMany({
          where: { razorpayOrderId: orderId, status: 'PENDING' },
          data: { status: 'SUCCESS', paidAt: new Date() },
        });
      }
    }

    res.json({ received: true });
  } catch (err) {
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;
