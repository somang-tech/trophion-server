import { Router } from 'express';
import { prisma } from '../db.js';
import { renderTrophyCardPNG } from '../shareCard.js';

export const shareRouter = Router();

// 이 엔드포인트는 로그인 불필요 — 디스코드/트위터가 링크를 미리보기할 때 여기로 접근한다.
async function loadCardData(steamId64, appId) {
  const user = await prisma.user.findUnique({ where: { steamId64 } });
  if (!user) return null;
  const game = await prisma.gameCache.findUnique({
    where: { userId_appId: { userId: user.id, appId } }
  });
  if (!game) return null;
  const picks = await prisma.trophyPick.findMany({ where: { userId: user.id, appId } });
  const achByName = Object.fromEntries(
    (await prisma.achievementCache.findMany({ where: { gameId: game.id } })).map((a) => [a.apiName, a])
  );
  const picksResolved = picks
    .map((p) => {
      const a = achByName[p.achievementApiName];
      if (!a) return null;
      return { slot: p.slot, name: a.displayName, rarityPct: a.globalPct };
    })
    .filter(Boolean);
  return { user, game, picks: picksResolved };
}

// 공개 이미지 — <meta property="og:image">가 이 URL을 가리키면 됨.
shareRouter.get('/:steamId64/:appId.png', async (req, res) => {
  const data = await loadCardData(req.params.steamId64, Number(req.params.appId));
  if (!data) return res.status(404).send('Not found');
  const png = renderTrophyCardPNG({
    displayName: data.user.displayName,
    gameName: data.game.name,
    picks: data.picks
  });
  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'public, max-age=300'); // 5분 캐시 — 픽 바꾸면 곧 반영되지만 매 요청 재렌더는 피함
  res.send(png);
});

// 공개 프로필 페이지 — OG 태그로 위 PNG를 가리켜서 링크 붙여넣기만으로 카드가 보이게 한다.
shareRouter.get('/:steamId64/:appId', async (req, res) => {
  const { steamId64, appId } = req.params;
  const data = await loadCardData(steamId64, Number(appId));
  if (!data) return res.status(404).send('찾을 수 없는 프로필입니다.');
  const imageUrl = `${process.env.APP_BASE_URL}/u/${steamId64}/${appId}.png`;
  const pageUrl = `${process.env.APP_BASE_URL}/u/${steamId64}/${appId}`;
  res.set('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8">
<title>${data.user.displayName}의 ${data.game.name} 트로피케이스 — Trophion</title>
<meta property="og:title" content="${data.user.displayName}의 ${data.game.name} 트로피케이스">
<meta property="og:description" content="Trophion에서 가장 자랑스러운 업적 3개를 확인해보세요.">
<meta property="og:image" content="${imageUrl}">
<meta property="og:url" content="${pageUrl}">
<meta name="twitter:card" content="summary_large_image">
</head><body style="margin:0;background:#0a0b10;display:flex;align-items:center;justify-content:center;min-height:100vh;">
<img src="${imageUrl}" alt="트로피케이스" style="max-width:100%;height:auto;">
</body></html>`);
});
