import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { requireTenantAdminAuth } from '../middleware/auth';

const router = Router();

// GET /api/admin/transactions?restaurantId=X&from=DATE&to=DATE&status=SETTLED
router.get('/transactions', requireTenantAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { restaurantId, from, to, status } = req.query;
    const rId = String(restaurantId);

    const fromDate = from ? new Date(String(from)) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const toDate = to ? new Date(String(to)) : new Date();
    toDate.setHours(23, 59, 59, 999);

    const where: any = {
      restaurantId: rId,
      createdAt: { gte: fromDate, lte: toDate },
    };
    if (status && status !== 'ALL') where.status = String(status);

    const orders = await prisma.order.findMany({
      where,
      include: { items: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    res.json(orders);
  } catch (err: any) {
    console.error('[admin/transactions]', err);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// DELETE /api/admin/transactions/:orderId — soft delete with audit log
router.delete('/transactions/:orderId', requireTenantAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { orderId } = req.params;
    const { reason } = req.body;
    const tenant = (req as any).tenant;
    const restaurantId = tenant.restaurantId;

    const order = await prisma.order.findFirst({
      where: { id: orderId, restaurantId },
    });
    if (!order) { res.status(404).json({ error: 'Order not found' }); return; }

    // Soft delete
    await prisma.order.update({
      where: { id: orderId },
      data: { status: 'CANCELLED' },
    });

    // Create audit log
    const owner = await prisma.owner.findFirst({ where: { restaurantId } });
    const audit = await prisma.auditLog.create({
      data: {
        ownerId: owner?.id || '',
        restaurantId,
        action: 'ORDER_DELETED',
        targetId: orderId,
        targetType: 'Order',
        performedBy: 'admin',
        performedByUsername: tenant.role === 'admin' ? 'admin' : 'unknown',
        details: {
          reason: reason || 'No reason provided',
          amount: order.total,
          billNumber: order.billNumber,
          table: order.tableName,
        },
      },
    });

    res.json({ success: true, auditId: audit.id });
  } catch (err: any) {
    console.error('[admin/delete]', err);
    res.status(500).json({ error: 'Failed to delete transaction' });
  }
});

// GET /api/admin/audit-log?restaurantId=X
router.get('/audit-log', requireTenantAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { restaurantId } = req.query;
    const rId = String(restaurantId);

    const logs = await prisma.auditLog.findMany({
      where: { restaurantId: rId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    res.json(logs);
  } catch (err: any) {
    console.error('[admin/audit-log]', err);
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

// GET /api/admin/captain-stats?restaurantId=X&from=DATE&to=DATE
router.get('/captain-stats', requireTenantAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { restaurantId, from, to } = req.query;
    if (!restaurantId) { res.status(400).json({ error: 'restaurantId required' }); return; }

    const fromDate = from ? new Date(String(from)) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const toDate = to ? new Date(String(to)) : new Date();
    toDate.setHours(23, 59, 59, 999);

    const stats = await prisma.$queryRaw`
      SELECT "captainName", COUNT(*)::int as orders, SUM("total")::float as revenue
      FROM "Order"
      WHERE "restaurantId" = ${String(restaurantId)}
        AND status = 'SETTLED'
        AND "createdAt" BETWEEN ${fromDate} AND ${toDate}
      GROUP BY "captainName"
      ORDER BY revenue DESC
    `;

    res.json(stats);
  } catch (err: any) {
    console.error('[admin/captain-stats]', err);
    res.status(500).json({ error: 'Failed to fetch captain stats' });
  }
});

export default router;
