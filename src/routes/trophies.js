import { Router } from 'express';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware.js';

export const trophiesRouter = Router();
const SLOTS = ['gold', 'silver', 'bronze'];

// 특정 게임에 대해 유저가 골라둔 금/은/동 업적.
trophiesRouter.get('/', requireAuth, async (req, res) => {
  const appId = Number(req.query.appId);
  if (!appId) return res.status(400).json({ error: 'appId가 필요합니다.' });
  const picks = await prisma.trophyPick.findMany({
    where: { userId: req.session.userId, appId }
  });
  res.json({ picks });
});

// 프론트의 ★ 클릭 = 이 엔드포인트. 슬롯이 이미 차 있으면 그 슬롯을 새 업적으로 교체한다.
trophiesRouter.post('/', requireAuth, async (req, res) => {
  const { appId, slot, achievementApiName } = req.body || {};
  if (!appId || !SLOTS.includes(slot) || !achievementApiName) {
    return res.status(400).json({ error: 'appId, slot(gold|silver|bronze), achievementApiName이 필요합니다.' });
  }
  const pick = await prisma.trophyPick.upsert({
    where: { userId_appId_slot: { userId: req.session.userId, appId, slot } },
    update: { achievementApiName, pickedAt: new Date() },
    create: { userId: req.session.userId, appId, slot, achievementApiName }
  });
  res.json({ pick });
});

trophiesRouter.delete('/', requireAuth, async (req, res) => {
  const appId = Number(req.query.appId);
  const slot = req.query.slot;
  if (!appId || !SLOTS.includes(slot)) {
    return res.status(400).json({ error: 'appId, slot(gold|silver|bronze)이 필요합니다.' });
  }
  await prisma.trophyPick
    .delete({ where: { userId_appId_slot: { userId: req.session.userId, appId, slot } } })
    .catch(() => null); // 이미 없으면 조용히 무시
  res.json({ ok: true });
});
