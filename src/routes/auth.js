import { Router } from 'express';
import { prisma } from '../db.js';
import { buildLoginUrl, verifyCallback } from '../steamAuth.js';
import { getPlayerSummary } from '../steamApi.js';

export const authRouter = Router();

authRouter.get('/steam', (req, res) => {
  const url = buildLoginUrl({ appBaseUrl: process.env.APP_BASE_URL });
  res.redirect(url);
});

authRouter.get('/steam/callback', async (req, res) => {
  try {
    const steamId64 = await verifyCallback(req.query);
    if (!steamId64) {
      return res.status(401).send('Steam 로그인 검증에 실패했습니다. 다시 시도해주세요.');
    }

    const apiKey = process.env.STEAM_API_KEY;
    let displayName = `player_${steamId64.slice(-6)}`;
    let avatarUrl = null;
    let profileUrl = null;

    if (apiKey) {
      const summary = await getPlayerSummary(steamId64, apiKey);
      if (summary) {
        displayName = summary.personaname || displayName;
        avatarUrl = summary.avatarfull || null;
        profileUrl = summary.profileurl || null;
      }
    }

    const user = await prisma.user.upsert({
      where: { steamId64 },
      update: { displayName, avatarUrl, profileUrl },
      create: { steamId64, displayName, avatarUrl, profileUrl }
    });

    req.session.userId = user.id;
    // 실제 배포에서는 프론트 라우트(예: /dashboard)로 리다이렉트하면 된다.
    res.redirect('/');
  } catch (err) {
    console.error('[auth] callback failed', err);
    res.status(500).send('로그인 처리 중 오류가 발생했습니다.');
  }
});

authRouter.post('/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

authRouter.get('/me', async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ user: null });
  const user = await prisma.user.findUnique({ where: { id: req.session.userId } });
  if (!user) return res.status(401).json({ user: null });
  res.json({
    user: {
      id: user.id,
      steamId64: user.steamId64,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      profileUrl: user.profileUrl,
      lastSyncAt: user.lastSyncAt
    }
  });
});
