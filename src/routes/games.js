import { Router } from 'express';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware.js';
import {
  getOwnedGames,
  getPlayerAchievements,
  getGlobalAchievementPercentages,
  getSchemaForGame,
  getPlayerSummary,
  tierFromGlobalPct,
  steamCoverUrl,
  PROFILE_VISIBILITY_PUBLIC
} from '../steamApi.js';

export const gamesRouter = Router();

// 업적을 지원하는 게임만 캐시하면 되므로, 보유 게임이 너무 많을 때를 대비해
// 플레이타임 상위 N개만 동기화한다 (Steam API 요청량을 줄이기 위한 실용적 한도).
const SYNC_GAME_LIMIT = 25;

// 로그인 직후 혹은 사용자가 "새로고침" 눌렀을 때 호출 — Steam에서 최신 데이터를 끌어와 캐시에 반영.
gamesRouter.post('/sync', requireAuth, async (req, res) => {
  const apiKey = process.env.STEAM_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'STEAM_API_KEY가 설정되어 있지 않습니다.' });

  const user = await prisma.user.findUnique({ where: { id: req.session.userId } });

  // 비공개 프로필이면 GetOwnedGames/GetPlayerAchievements가 전부 빈 값으로 와서
  // "게임이 하나도 없다"처럼 보이는 게 제일 흔한 오해 지점 — 미리 걸러서 명확히 안내한다.
  const summary = await getPlayerSummary(user.steamId64, apiKey);
  if (!summary || summary.communityvisibilitystate !== PROFILE_VISIBILITY_PUBLIC) {
    return res.status(409).json({
      error: 'PRIVATE_PROFILE',
      message:
        'Steam 프로필이 비공개(또는 친구공개)로 설정되어 있어 게임/업적을 불러올 수 없습니다. ' +
        'Steam → 프로필 편집 → 개인정보 설정에서 "게임 세부 정보"를 공개로 바꾼 뒤 다시 시도해주세요.'
    });
  }

  const owned = await getOwnedGames(user.steamId64, apiKey);
  if (owned.length === 0) {
    return res.status(409).json({
      error: 'NO_GAMES_OR_PRIVATE_DETAILS',
      message:
        '보유 게임을 하나도 못 받아왔습니다. 프로필은 공개여도 "게임 세부 정보"만 따로 비공개인 ' +
        '경우 이렇게 됩니다 — Steam 개인정보 설정을 확인해주세요.'
    });
  }

  const candidates = owned
    .sort((a, b) => (b.playtime_forever || 0) - (a.playtime_forever || 0))
    .slice(0, SYNC_GAME_LIMIT);

  const synced = [];
  const skippedPrivateStats = [];
  for (const g of candidates) {
    const playerAch = await getPlayerAchievements(user.steamId64, g.appid, apiKey);
    if (playerAch.length === 0) {
      // 이 게임만 업적 통계가 비공개이거나, 애초에 업적을 지원하지 않는 게임이다.
      skippedPrivateStats.push(g.name);
      continue;
    }

    const [schema, globalPct] = await Promise.all([
      getSchemaForGame(g.appid, apiKey),
      getGlobalAchievementPercentages(g.appid)
    ]);
    const schemaByName = Object.fromEntries(schema.map((s) => [s.name, s]));

    const done = playerAch.filter((a) => a.achieved === 1).length;
    const total = playerAch.length;

    const game = await prisma.gameCache.upsert({
      where: { userId_appId: { userId: user.id, appId: g.appid } },
      update: {
        name: g.name,
        playtimeMin: g.playtime_forever || 0,
        achDone: done,
        achTotal: total,
        completionPct: total ? Math.round((done / total) * 100) : 0,
        syncedAt: new Date()
      },
      create: {
        userId: user.id,
        appId: g.appid,
        name: g.name,
        playtimeMin: g.playtime_forever || 0,
        achDone: done,
        achTotal: total,
        completionPct: total ? Math.round((done / total) * 100) : 0
      }
    });

    let rarityScore = 0;
    const weight = { common: 1, rare: 3, epic: 8, legendary: 25 };

    for (const a of playerAch) {
      const pct = globalPct[a.apiname] ?? 100;
      const tier = tierFromGlobalPct(pct);
      const meta = schemaByName[a.apiname] || {};
      if (a.achieved === 1) rarityScore += weight[tier];

      await prisma.achievementCache.upsert({
        where: { gameId_apiName: { gameId: game.id, apiName: a.apiname } },
        update: {
          displayName: meta.displayName || a.apiname,
          description: meta.description || '',
          tier,
          unlocked: a.achieved === 1,
          unlockedAt: a.achieved === 1 && a.unlocktime ? new Date(a.unlocktime * 1000) : null,
          globalPct: pct,
          iconUrl: a.achieved === 1 ? meta.icon : meta.icongray
        },
        create: {
          gameId: game.id,
          apiName: a.apiname,
          displayName: meta.displayName || a.apiname,
          description: meta.description || '',
          tier,
          unlocked: a.achieved === 1,
          unlockedAt: a.achieved === 1 && a.unlocktime ? new Date(a.unlocktime * 1000) : null,
          globalPct: pct,
          iconUrl: a.achieved === 1 ? meta.icon : meta.icongray
        }
      });
    }

    await prisma.gameCache.update({ where: { id: game.id }, data: { rarityScore } });
    synced.push(g.appid);
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastSyncAt: new Date() } });
  res.json({ ok: true, syncedGames: synced.length, skippedPrivateStats });
});

// 왼쪽 게임 목록 — 완료율(달성도) 높은 순으로 정렬해서 반환. coverUrl은 저장하지 않고
// appId로부터 그때그때 계산한다 (Steam 커버 이미지 CDN 경로가 appId만으로 결정되기 때문).
gamesRouter.get('/', requireAuth, async (req, res) => {
  const games = await prisma.gameCache.findMany({
    where: { userId: req.session.userId },
    orderBy: [{ completionPct: 'desc' }, { rarityScore: 'desc' }]
  });
  res.json({ games: games.map((g) => ({ ...g, coverUrl: steamCoverUrl(g.appId) })) });
});

// 특정 게임의 업적 목록 — 오른쪽 대시보드가 게임 클릭 시 이 엔드포인트를 부른다.
gamesRouter.get('/:appId/achievements', requireAuth, async (req, res) => {
  const appId = Number(req.params.appId);
  const game = await prisma.gameCache.findUnique({
    where: { userId_appId: { userId: req.session.userId, appId } },
    include: { achievements: true }
  });
  if (!game) return res.status(404).json({ error: '캐시된 게임이 없습니다. 먼저 동기화하세요.' });
  res.json({ game: { ...game, coverUrl: steamCoverUrl(game.appId) } });
});
