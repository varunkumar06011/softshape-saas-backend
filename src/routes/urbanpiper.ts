import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { requireOwnerAuth } from '../middleware/auth';

const router = Router();

// POST /api/urbanpiper/webhook — receives UrbanPiper webhook events
router.post('/webhook', async (req: Request, res: Response): Promise<void> => {
  // Always respond 200 immediately
  res.status(200).json({ received: true });

  try {
    const secret = process.env.URBANPIPER_WEBHOOK_SECRET;
    if (secret) {
      const signature = req.headers['x-up-signature'] as string;
      // HMAC verification would go here if signature format is known
      // For now, accept all if no secret or skip verification
    }

    const eventType = req.body.event_type || req.body.event;
    const payload = req.body.payload || req.body;

    if (eventType === 'order.placed' || eventType === 'order_placed') {
      const storeId = payload.store_id || payload.outlet_id;
      const platformOrderId = payload.order_id || payload.id;
      const items = payload.items || [];
      const subtotal = Number(payload.subtotal) || 0;
      const taxes = Number(payload.taxes) || 0;
      const total = Number(payload.total) || subtotal + taxes;

      // Find owner by store ID
      const owner = await prisma.owner.findFirst({
        where: {
          OR: [
            { swiggyStoreId: String(storeId) },
            { zomatoOutletId: String(storeId) },
          ],
        },
      });

      if (!owner) {
        console.warn('[urbanpiper] No owner found for storeId:', storeId);
        return;
      }

      const restaurantId = owner.restaurantId || owner.slug;
      const platform = payload.platform?.toLowerCase() || 'swiggy';

      // Save online order
      const onlineOrder = await prisma.onlineOrder.create({
        data: {
          ownerId: owner.id,
          restaurantId,
          platform,
          platformOrderId: String(platformOrderId),
          customerName: payload.customer?.name || 'Unknown',
          customerPhone: payload.customer?.phone || null,
          items: items as any,
          subtotal,
          taxes,
          total,
          status: 'NEW',
        },
      });

      // Fire-and-forget auto-accept after 5 seconds
      setTimeout(async () => {
        try {
          const username = process.env.URBANPIPER_USERNAME;
          const apiKey = process.env.URBANPIPER_API_KEY;

          if (username && apiKey) {
            await fetch(`https://api.urbanpiper.com/external/api/v1/orders/${platformOrderId}/acknowledge/`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: 'Basic ' + Buffer.from(`${username}:${apiKey}`).toString('base64'),
              },
              body: JSON.stringify({ status: 'Acknowledged' }),
            });
          }

          await prisma.onlineOrder.update({
            where: { id: onlineOrder.id },
            data: { status: 'ACCEPTED', autoAccepted: true, acceptedAt: new Date() },
          });
        } catch (err) {
          console.error('[urbanpiper] Auto-accept failed:', err);
        }
      }, 5000);
    }

    if (eventType === 'order.cancelled' || eventType === 'order_cancelled') {
      const platformOrderId = payload.order_id || payload.id;
      await prisma.onlineOrder.updateMany({
        where: { platformOrderId: String(platformOrderId) },
        data: { status: 'CANCELLED' },
      });
    }
  } catch (err) {
    console.error('[urbanpiper/webhook]', err);
  }
});

// GET /api/urbanpiper/orders/:restaurantId — last 50 online orders
router.get('/orders/:restaurantId', requireOwnerAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { restaurantId } = req.params;
    const orders = await prisma.onlineOrder.findMany({
      where: { restaurantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(orders);
  } catch (err: any) {
    console.error('[urbanpiper/orders]', err);
    res.status(500).json({ error: 'Failed to fetch online orders' });
  }
});

export default router;
