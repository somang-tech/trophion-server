import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieSession from 'cookie-session';
import geoip from 'geoip-lite';
import { authRouter } from './routes/auth.js';
import { gamesRouter } from './routes/games.js';
import { trophiesRouter } from './routes/trophies.js';
import { shareRouter } from './routes/share.js';
import { localeFromCountry } from './locale.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(
  cookieSession({
    name: 'trophion_session',
    secret: process.env.SESSION_SECRET || 'dev-only-secret',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30일
    httpOnly: true,
    sameSite: 'lax'
  })
);

app.use('/auth', authRouter);
app.use('/api/games', gamesRouter);
app.use('/api/trophies', trophiesRouter);
app.use('/u', shareRouter); // 공개 프로필 + 공유용 PNG

// 로그인 전(게이트 화면)에는 Steam 국가 정보가 없으니, 접속 IP로 국가를 추정해 언어를 고른다.
// Railway/대부분의 PaaS는 프록시 뒤에 있으므로 X-Forwarded-For를 먼저 본다.
app.get('/api/locale', (req, res) => {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = (forwarded ? forwarded.split(',')[0].trim() : null) || req.socket.remoteAddress;
  const geo = ip ? geoip.lookup(ip) : null;
  res.json({ locale: localeFromCountry(geo?.country), country: geo?.country || null });
});

// public/index.html이 실제 동작하는 프론트엔드 — 로그인 게이트, 게임 목록, 업적,
// ★ 픽까지 전부 위 API를 fetch로 호출해서 그린다 (data/trophion.html의 가짜 배열이 아니라 진짜 데이터).
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api', (req, res) => {
  res.type('text/plain').send(
    [
      'GET  /auth/steam              → Steam 로그인 시작',
      'GET  /auth/me                 → 현재 로그인한 유저',
      'POST /auth/logout             → 로그아웃',
      'POST /api/games/sync          → Steam에서 게임/업적 재동기화 (로그인 필요)',
      'GET  /api/games                → 내 게임 목록 (완료율순, coverUrl 포함)',
      'GET  /api/games/:appId/achievements → 게임별 업적 목록 (iconUrl 포함)',
      'GET  /api/trophies?appId=...  → 게임별 트로피케이스(금/은/동) 조회',
      'POST /api/trophies             → 트로피케이스에 업적 등록/교체',
      'DEL  /api/trophies?appId=&slot= → 트로피케이스에서 제거',
      'GET  /u/:steamId64/:appId      → 공개 공유 페이지',
      'GET  /u/:steamId64/:appId.png  → 공유용 PNG 카드'
    ].join('\n')
  );
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`[trophion] listening on http://localhost:${port}`);
});
