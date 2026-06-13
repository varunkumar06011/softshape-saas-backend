import { Router, Request, Response } from 'express';
import { requireOwnerAuth } from '../middleware/auth';
import multer from 'multer';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// POST /api/marketing/analyze-image
router.post('/analyze-image', requireOwnerAuth, upload.single('image'), async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) { res.status(400).json({ error: 'No image uploaded' }); return; }

    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(req.file.mimetype)) {
      res.status(400).json({ error: 'Only JPEG, PNG, WebP allowed' });
      return;
    }

    if (!ANTHROPIC_API_KEY) { res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' }); return; }

    const imageBase64 = req.file.buffer.toString('base64');
    const mediaType = req.file.mimetype;

    const response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: `You are a food marketing expert for Indian restaurants. Analyze this food photo and return ONLY valid JSON, no explanation:\n{\n  "dishName": "detected dish name",\n  "cuisine": "Indian|Chinese|Continental|etc",\n  "isVeg": true,\n  "keyIngredients": ["paneer", "tomato", "cream"],\n  "mood": "festive|comfort|premium|healthy|spicy|refreshing",\n  "colorPalette": {\n    "primary": "#E53935",\n    "secondary": "#FF8F00",\n    "accent": "#FFF8E1",\n    "text": "#1A1A1A"\n  },\n  "taglines": [\n    "Rich, Creamy & Irresistible",\n    "A Taste of Tradition",\n    "Your Favourite, Reimagined",\n    "Made Fresh, Served Hot"\n  ],\n  "captions": {\n    "instagram": "caption under 150 chars with 5 relevant hashtags",\n    "facebook": "caption under 200 chars",\n    "whatsapp": "short 2-line promotional message"\n  },\n  "posterThemes": [\n    { "name": "Classic Red", "bg": "#E53935", "cardBg": "#C62828", "textColor": "#FFFFFF", "accentColor": "#FFD600" },\n    { "name": "Golden Luxury", "bg": "#FF8F00", "cardBg": "#E65100", "textColor": "#FFFFFF", "accentColor": "#FFF8E1" },\n    { "name": "Midnight Dark", "bg": "#1A1A2E", "cardBg": "#16213E", "textColor": "#E8D5B7", "accentColor": "#E53935" },\n    { "name": "Fresh Green", "bg": "#1B5E20", "cardBg": "#2E7D32", "textColor": "#FFFFFF", "accentColor": "#FFEB3B" },\n    { "name": "Soft Cream", "bg": "#FFF8E1", "cardBg": "#FFFFFF", "textColor": "#3E2723", "accentColor": "#BF360C" },\n    { "name": "Ocean Blue", "bg": "#0D47A1", "cardBg": "#1565C0", "textColor": "#E3F2FD", "accentColor": "#FF6F00" }\n  ]\n}` }
          ]
        }]
      }),
    });

    const json: any = await response.json();
    if (!response.ok) throw new Error(json.error?.message || 'Claude API error');

    const content = json.content?.[0]?.text || '';
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Invalid response format from Claude');

    const parsed = JSON.parse(match[0]);

    res.json({
      ...parsed,
      imageDataUrl: `data:${mediaType};base64,${imageBase64}`,
    });
  } catch (err: any) {
    console.error('[marketing/analyze-image]', err);
    res.status(500).json({ error: err.message || 'Image analysis failed' });
  }
});

export default router;
