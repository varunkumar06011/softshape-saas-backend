import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';

import prisma from './lib/prisma';
import authRouter from './routes/auth';
import onboardingRouter from './routes/onboarding';
import paymentRouter from './routes/payment';
import menuRouter from './routes/menu';
import tenantRouter from './routes/tenant';
import ordersRouter from './routes/orders';
import reportsRouter from './routes/reports';
import adminRouter from './routes/admin';
import urbanpiperRouter from './routes/urbanpiper';
import aiMenuRouter from './routes/ai-menu';
import marketingRouter from './routes/marketing';
import inventoryRouter from './routes/inventory';

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, { cors: { origin: '*' } });
io.on('connection', (socket: any) => {
  socket.on('join-restaurant', (restaurantId: string) => {
    socket.join(restaurantId);
  });
});
export { io };

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:4173',
  'http://localhost:3000',
  ...(process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.vercel.app')) {
      cb(null, true);
    } else {
      cb(new Error(`CORS blocked: ${origin}`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'softshape-saas-backend', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRouter);
app.use('/api/onboarding', onboardingRouter);
app.use('/api/payment', paymentRouter);
app.use('/api/menu', menuRouter);
app.use('/api/tenant', tenantRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/urbanpiper', urbanpiperRouter);
app.use('/api/ai-menu', aiMenuRouter);
app.use('/api/marketing', marketingRouter);
app.use('/api/inventory', inventoryRouter);

// 404
app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Error]', err.message);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

const PORT = Number(process.env.PORT) || 4000;

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[SaaS Backend] Running on port ${PORT}`);
  console.log(`[SaaS Backend] Health: http://localhost:${PORT}/health`);
  console.log(`[SaaS Backend] DATABASE_URL set: ${Boolean(process.env.DATABASE_URL)}`);
  console.log(`[SaaS Backend] Razorpay Key set: ${Boolean(process.env.RAZORPAY_KEY_ID)}`);
});

// Refresh materialized view every 5 minutes
setInterval(async () => {
  try {
    await prisma.$executeRaw`REFRESH MATERIALIZED VIEW CONCURRENTLY daily_revenue_mv`;
  } catch (e: any) {
    console.warn('MV refresh failed:', e.message);
  }
}, 5 * 60 * 1000);

export default app;
