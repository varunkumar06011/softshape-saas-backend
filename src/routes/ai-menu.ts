import { Router, Request, Response } from 'express';
import { parse } from 'csv-parse/sync';
import { requireOwnerAuth } from '../middleware/auth';
import multer from 'multer';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

function buildPrompt(items: string[]) {
  return `You are a restaurant menu expert specializing in Indian restaurants.

For each item name below, suggest the following fields. Return ONLY valid JSON array, no explanation.

Items: ${JSON.stringify(items)}

Return format (JSON array):
[
  {
    "itemName": "exact name as given",
    "category": "Main Course|Starters|Rice|Breads|Desserts|Beverages|Soups|Spirits|Beer|Wine|Cocktails|Mocktails|Snacks",
    "suggestedPrice": 280,
    "isVeg": true,
    "menuType": "FOOD|LIQUOR",
    "station": "KITCHEN|BAR",
    "description": "one line description max 10 words"
  }
]

Rules:
- Any alcohol (rum, whisky, beer, wine, vodka, gin, cocktail, mocktail) → menuType: LIQUOR, station: BAR, isVeg: false
- "mocktail" or "fresh juice" or "lassi" or "milkshake" → menuType: FOOD, station: BAR
- All food items → menuType: FOOD, station: KITCHEN
- Veg items: paneer, dal, veg, aloo, palak, gobi, chana, mushroom, tofu, idli, dosa, puri, bread, naan, roti, rice (when not biryani), gulab, kheer, halwa
- Non-veg items: chicken, mutton, fish, prawn, egg, crab, lamb, beef, pork, seafood
- Price ranges for India (in ₹): starters 120-350, main course 180-450, rice dishes 180-380, breads 40-120, spirits per 30ml 150-400, beer 120-250, desserts 80-200
- Biryani with meat → isVeg: false, station: KITCHEN
- Bar snacks like "peanuts masala", "veg platter" → menuType: FOOD, station: KITCHEN`;
}

async function callClaude(items: string[]) {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: buildPrompt(items) }],
    }),
  });

  const json: any = await res.json();
  if (!res.ok) throw new Error(json.error?.message || 'Claude API error');

  const content = json.content?.[0]?.text || '';
  const match = content.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('Invalid response format from Claude');

  return JSON.parse(match[0]);
}

// POST /api/ai-menu/suggest
router.post('/suggest', requireOwnerAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'items array required' });
      return;
    }
    const suggestions = await callClaude(items);
    res.json({ suggestions });
  } catch (err: any) {
    console.error('[ai-menu/suggest]', err);
    res.status(500).json({ error: err.message || 'AI suggestion failed' });
  }
});

// POST /api/ai-menu/suggest-from-csv
router.post('/suggest-from-csv', requireOwnerAuth, upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }

    const csvText = req.file.buffer.toString('utf-8');
    const records = parse(csvText, { columns: true, skip_empty_lines: true, trim: true }) as any[];

    if (records.length === 0) { res.status(400).json({ error: 'CSV is empty' }); return; }

    // Check if it matches the standard format
    const hasStandardCols = records[0].item_name && records[0].category && records[0].price;
    if (hasStandardCols) {
      const items = records.map((row: any) => ({
        itemName: row.item_name,
        category: row.category,
        price: Number(row.price) || 0,
        menuType: (row.type || 'FOOD').toUpperCase(),
        isVeg: row.is_veg === 'true' || row.is_veg === '1' || row.is_veg === 'yes',
        station: (row.station || 'KITCHEN').toUpperCase(),
      }));
      res.json({ suggestions: null, items });
      return;
    }

    // Single column — treat as item names
    const firstKey = Object.keys(records[0])[0];
    const itemNames = records.map((row: any) => row[firstKey]).filter(Boolean);
    const suggestions = await callClaude(itemNames);
    res.json({ suggestions });
  } catch (err: any) {
    console.error('[ai-menu/suggest-from-csv]', err);
    res.status(500).json({ error: err.message || 'AI CSV suggestion failed' });
  }
});

export default router;
