import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { requireOwnerAuth } from '../middleware/auth';

const router = Router();

// GET /api/social/status — check which platforms are connected
router.get('/status', requireOwnerAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { ownerId } = (req as any).owner;
    const owner = await prisma.owner.findUnique({
      where: { id: ownerId },
      select: {
        metaAccessToken: true, metaPageId: true, metaIgAccountId: true,
        xAccessToken: true, linkedinToken: true,
        facebookPageUrl: true, instagramHandle: true, xHandle: true, linkedinUrl: true,
      },
    });
    if (!owner) { res.status(404).json({ error: 'Owner not found' }); return; }

    res.json({
      facebook: { connected: !!owner.metaAccessToken && !!owner.metaPageId, pageUrl: owner.facebookPageUrl },
      instagram: { connected: !!owner.metaAccessToken && !!owner.metaIgAccountId, handle: owner.instagramHandle },
      x: { connected: !!owner.xAccessToken, handle: owner.xHandle },
      linkedin: { connected: !!owner.linkedinToken, url: owner.linkedinUrl },
    });
  } catch (err: any) {
    console.error('[social/status]', err);
    res.status(500).json({ error: err.message || 'Failed to load status' });
  }
});

// PATCH /api/social/connect/:platform — save access token / page ID manually
router.patch('/connect/:platform', requireOwnerAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { ownerId } = (req as any).owner;
    const { platform } = req.params;
    const { metaAccessToken, metaPageId, metaIgAccountId, xAccessToken, xRefreshToken, linkedinToken } = req.body;

    const data: any = {};
    if (platform === 'facebook' || platform === 'instagram') {
      if (metaAccessToken) data.metaAccessToken = metaAccessToken;
      if (metaPageId) data.metaPageId = metaPageId;
      if (metaIgAccountId) data.metaIgAccountId = metaIgAccountId;
    } else if (platform === 'x') {
      if (xAccessToken) data.xAccessToken = xAccessToken;
      if (xRefreshToken) data.xRefreshToken = xRefreshToken;
    } else if (platform === 'linkedin') {
      if (linkedinToken) data.linkedinToken = linkedinToken;
    } else {
      res.status(400).json({ error: 'Unsupported platform' }); return;
    }

    await prisma.owner.update({ where: { id: ownerId }, data });
    res.json({ message: `${platform} connected` });
  } catch (err: any) {
    console.error('[social/connect]', err);
    res.status(500).json({ error: err.message || 'Failed to connect' });
  }
});

// POST /api/social/post — post image + caption to selected platforms
router.post('/post', requireOwnerAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { ownerId } = (req as any).owner;
    const { imageBase64, caption, platforms } = req.body;
    if (!imageBase64 || !caption || !Array.isArray(platforms) || platforms.length === 0) {
      res.status(400).json({ error: 'imageBase64, caption and platforms[] required' }); return;
    }

    const owner = await prisma.owner.findUnique({
      where: { id: ownerId },
      select: {
        restaurantName: true,
        metaAccessToken: true, metaPageId: true, metaIgAccountId: true,
        xAccessToken: true, linkedinToken: true,
      },
    });
    if (!owner) { res.status(404).json({ error: 'Owner not found' }); return; }

    const results: Record<string, any> = {};

    for (const platform of platforms) {
      try {
        if (platform === 'facebook') {
          results.facebook = await postToFacebook(owner.metaAccessToken!, owner.metaPageId!, caption, imageBase64);
        } else if (platform === 'instagram') {
          results.instagram = await postToInstagram(owner.metaAccessToken!, owner.metaIgAccountId!, caption, imageBase64);
        } else if (platform === 'x') {
          results.x = await postToX(owner.xAccessToken!, caption, imageBase64);
        } else if (platform === 'linkedin') {
          results.linkedin = await postToLinkedIn(owner.linkedinToken!, owner.restaurantName, caption, imageBase64);
        }
      } catch (err: any) {
        results[platform] = { success: false, error: err.message };
      }
    }

    res.json({ results });
  } catch (err: any) {
    console.error('[social/post]', err);
    res.status(500).json({ error: err.message || 'Post failed' });
  }
});

async function postToFacebook(accessToken: string, pageId: string, caption: string, imageBase64: string) {
  const imageBuffer = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
  const blob = new Blob([imageBuffer]);
  const formData = new FormData();
  formData.append('message', caption);
  formData.append('source', new File([blob], 'poster.png', { type: 'image/png' }));
  formData.append('access_token', accessToken);

  const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/photos`, {
    method: 'POST', body: formData,
  });
  const json: any = await res.json();
  if (!res.ok || json.error) throw new Error(json.error?.message || 'Facebook post failed');
  return { success: true, postId: json.id };
}

async function postToInstagram(accessToken: string, igUserId: string, caption: string, imageBase64: string) {
  // Step 1: Upload image to container
  const imageBuffer = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
  const blob = new Blob([imageBuffer]);
  const formData = new FormData();
  formData.append('image', new File([blob], 'poster.png', { type: 'image/png' }));
  formData.append('caption', caption);
  formData.append('access_token', accessToken);

  const uploadRes = await fetch(`https://graph.facebook.com/v19.0/${igUserId}/media`, {
    method: 'POST', body: formData,
  });
  const uploadJson: any = await uploadRes.json();
  if (!uploadRes.ok || uploadJson.error) throw new Error(uploadJson.error?.message || 'Instagram media upload failed');

  const creationId = uploadJson.id;

  // Step 2: Publish container
  const publishRes = await fetch(`https://graph.facebook.com/v19.0/${igUserId}/media_publish?creation_id=${creationId}&access_token=${accessToken}`, {
    method: 'POST',
  });
  const publishJson: any = await publishRes.json();
  if (!publishRes.ok || publishJson.error) throw new Error(publishJson.error?.message || 'Instagram publish failed');
  return { success: true, mediaId: publishJson.id };
}

async function postToX(accessToken: string, caption: string, imageBase64: string) {
  // X API v2 media upload (simplified — requires media upload endpoint)
  const imageBuffer = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');

  // 1. INIT upload
  const initRes = await fetch('https://upload.twitter.com/1.1/media/upload.json', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ command: 'INIT', total_bytes: String(imageBuffer.length), media_type: 'image/png' }),
  });
  const initJson: any = await initRes.json();
  if (!initRes.ok || initJson.error) throw new Error(initJson.error || 'X media init failed');

  const mediaId = initJson.media_id_string;

  // 2. APPEND
  const appendForm = new FormData();
  appendForm.append('command', 'APPEND');
  appendForm.append('media_id', mediaId);
  appendForm.append('segment_index', '0');
  appendForm.append('media_data', imageBuffer.toString('base64'));
  await fetch('https://upload.twitter.com/1.1/media/upload.json', {
    method: 'POST', headers: { 'Authorization': `Bearer ${accessToken}` }, body: appendForm,
  });

  // 3. FINALIZE
  await fetch('https://upload.twitter.com/1.1/media/upload.json', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ command: 'FINALIZE', media_id: mediaId }),
  });

  // 4. Tweet
  const tweetRes = await fetch('https://api.twitter.com/2/tweets', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: caption, media: { media_ids: [mediaId] } }),
  });
  const tweetJson: any = await tweetRes.json();
  if (!tweetRes.ok || tweetJson.errors) throw new Error(tweetJson.errors?.[0]?.message || 'X tweet failed');
  return { success: true, tweetId: tweetJson.data?.id };
}

async function postToLinkedIn(accessToken: string, authorName: string, caption: string, imageBase64: string) {
  const imageBuffer = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');

  // Step 1: Register upload
  const registerRes = await fetch('https://api.linkedin.com/v2/assets?action=registerUpload', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify({
      registerUploadRequest: {
        recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
        owner: 'urn:li:person:me',
        serviceRelationships: [{ relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' }],
      },
    }),
  });
  const registerJson: any = await registerRes.json();
  if (!registerRes.ok) throw new Error('LinkedIn upload registration failed');

  const uploadUrl = registerJson.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl;
  const asset = registerJson.value?.asset;

  if (!uploadUrl || !asset) throw new Error('LinkedIn upload URL missing');

  // Step 2: Upload image
  await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}` },
    body: imageBuffer,
  });

  // Step 3: Create share
  const shareRes = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify({
      author: 'urn:li:person:me',
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: caption },
          shareMediaCategory: 'IMAGE',
          media: [{ status: 'READY', media: asset }],
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    }),
  });
  if (!shareRes.ok) throw new Error('LinkedIn share failed');
  return { success: true };
}

export default router;
