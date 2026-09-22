import { Router } from 'express';
import { prisma } from '../db.js';
import { buildLoginUrl, verifyCallback } from '../steamAuth.js';
import { getPlayerSummary } from '../steamApi.js';
import { localeFromCountry } from '../locale.js';

export const authRouter = Router();

authRouter.get('/steam', (req, res) => {
  const url = buildLoginUrl({ appBaseUrl: process.env.APP_BASE_URL });
  res.redirect(url);
});

authRouter.get('/steam/callback', async (req, res) => {
  try {
    // req.query가 아니라 원본 쿼리스트링을 그대로 넘긴다 — 이유는 steamAuth.js의
    // parseRawOpenIdQuery 주석 참고 ("+"가 스페이스로 뭉개지는 문제 방지).
    const qIndex = req.url.indexOf('?');
    const rawQueryString = qIndex >= 0 ? req.url.slice(qIndex + 1) : '';
    const steamId64 = await verifyCallback(rawQueryString);
    if (!steamId64) {
      return res.status(401).send('Steam 로그인 검증에 실패했습니다. 다시 시도해주세요.');
    }

    const apiKey = process.env.STEAM_API_KEY;
    let displayName = `player_${steamId64.slice(-6)}`;
    let avatarUrl = null;
    let profileUrl = null;
    let locCountryCode = null;

    if (apiKey) {
      const summary = await getPlayerSummary(steamId64, apiKey);
      if (summary) {
        displayName = summary.personaname || displayName;
        avatarUrl = summary.avatarfull || null;
        profileUrl = summary.profileurl || null;
        // Steam이 클라이언트 언어를 직접 주진 않아서, 대신 등록된 국가로 언어를 추정한다.
        locCountryCode = summary.loccountrycode || null;
      }
    }

    const user = await prisma.user.upsert({
      where: { steamId64 },
      update: { displayName, avatarUrl, profileUrl, locCountryCode },
      create: { steamId64, displayName, avatarUrl, profileUrl, locCountryCode }
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
      lastSyncAt: user.lastSyncAt,
      locale: localeFromCountry(user.locCountryCode) // 'ko' | 'ja' | 'en'
    }
  });
});
