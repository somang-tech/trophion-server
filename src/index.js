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
import { steamCoverUrlCandidates } from './steamApi.js';

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

// 게임 커버 이미지를 우리 도메인을 거쳐서 내려준다(같은 출처 = same-origin) — 두 가지 이유:
//   1) header.jpg가 없는 appid도 있어서 여러 CDN 후보를 서버가 대신 순서대로 시도해준다
//      (클라이언트가 <img onerror>로 여러 후보를 재시도하던 로직을 여기 하나로 모았다).
//   2) "이미지 다운로드" 버튼이 html2canvas로 화면(.tpl-card)을 그대로 캡처하는데, Steam
//      CDN 이미지를 크로스 오리진으로 직접 박아두면 CORS 때문에 캔버스가 "오염"되어
//      다운로드가 막힌다. 우리 서버를 거치면 같은 출처가 되어 이 문제가 사라진다.
const coverCache = new Map(); // appId -> { buf, type } 짧은 메모리 캐시 (재배포 시 초기화됨, 문제 없음)
app.get('/img/cover/:appId', async (req, res) => {
  const appId = Number(req.params.appId);
  if (!Number.isFinite(appId)) return res.status(400).end();

  const cached = coverCache.get(appId);
  if (cached) {
    res.set('Content-Type', cached.type);
    res.set('Cache-Control', 'public, max-age=86400');
    return res.send(cached.buf);
  }

  for (const url of steamCoverUrlCandidates(appId)) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      const type = r.headers.get('content-type') || 'image/jpeg';
      coverCache.set(appId, { buf, type });
      res.set('Content-Type', type);
      res.set('Cache-Control', 'public, max-age=86400');
      return res.send(buf);
    } catch {
      // 다음 후보로 넘어간다.
    }
  }
  res.status(404).end();
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
      'GET  /u/:steamId64/:appId.png  → 공유용 PNG 카드',
      'GET  /img/cover/:appId         → 게임 커버 이미지 프록시 (same-origin, CORS 회피용)'
    ].join('\n')
  );
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`[trophion] listening on http://localhost:${port}`);
});
