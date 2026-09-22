// 공개 프로필/디스코드 링크 미리보기 + "이미지 다운로드" 버튼에 쓰이는 PNG 카드 렌더러.
// 프론트(public/index.html)의 트로피 템플릿을 서버 사이드에서 그대로 다시 그린다 —
// 브라우저 화면 캡처가 아니라 실제 데이터로 매번 새로 렌더링하므로 항상 최신 상태다.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import { steamCoverUrlCandidates } from './steamApi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Railway 같은 최소 컨테이너에는 시스템 폰트가 아예 없을 수 있다 — 그러면 @napi-rs/canvas가
// 도형(패스/그라디언트)은 정상적으로 그리면서도 ctx.fillText만 조용히 아무것도 안 그린다
// (에러도 안 남). 그래서 폰트를 리포에 직접 번들하고 등록해서 어떤 환경에서도 텍스트가
// 확실히 나오게 한다.
const FONT_REGULAR = 'Trophion Sans';
const FONT_BOLD = 'Trophion Sans Bold';
try {
  GlobalFonts.registerFromPath(path.join(__dirname, '..', 'fonts', 'DejaVuSans.ttf'), FONT_REGULAR);
  GlobalFonts.registerFromPath(path.join(__dirname, '..', 'fonts', 'DejaVuSans-Bold.ttf'), FONT_BOLD);
} catch (err) {
  console.error('[shareCard] 폰트 등록 실패 — 텍스트가 안 보일 수 있습니다:', err);
}
const font = (px, bold) => `${px}px "${bold ? FONT_BOLD : FONT_REGULAR}"`;

// @napi-rs/canvas 버전에 따라 ctx.roundRect가 없을 수 있어 직접 구현해서 쓴다.
function roundedRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

const SLOT_STYLE = {
  gold:   { main: '#e8b84b', dim: '#7a6530', light: '#fff3cf', scale: 1 },
  silver: { main: '#c3c9d6', dim: '#5f6472', light: '#ffffff', scale: 0.68 },
  bronze: { main: '#cd7f4c', dim: '#6b4a34', light: '#ffe1c7', scale: 0.55 }
};

// 화면(public/index.html의 bigTrophySvg)과 동일한 실루엣/장식 문법으로 맞춘 트로피 컵.
// cx/cy는 볼(몸통) 중심, scale로 전체 크기를 조절.
function drawTrophy(ctx, cx, cy, style) {
  const { main, dim, light, scale } = style;
  const s = scale;
  const R = 46 * s; // 볼 반경 기준 단위

  ctx.save();
  ctx.translate(cx, cy);

  // 손잡이 (두껍게, 바깥으로 크게 휘어지는 형태)
  ctx.lineCap = 'round';
  ctx.strokeStyle = dim;
  ctx.lineWidth = 7.5 * s;
  ctx.beginPath();
  ctx.moveTo(-R * 0.5, -R * 0.5);
  ctx.bezierCurveTo(-R * 1.9, -R * 0.3, -R * 1.95, R * 0.55, -R * 0.65, R * 0.85);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(R * 0.5, -R * 0.5);
  ctx.bezierCurveTo(R * 1.9, -R * 0.3, R * 1.95, R * 0.55, R * 0.65, R * 0.85);
  ctx.stroke();
  ctx.strokeStyle = main;
  ctx.lineWidth = 2.6 * s;
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.moveTo(-R * 0.5, -R * 0.5);
  ctx.bezierCurveTo(-R * 1.9, -R * 0.3, -R * 1.95, R * 0.55, -R * 0.65, R * 0.85);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(R * 0.5, -R * 0.5);
  ctx.bezierCurveTo(R * 1.9, -R * 0.3, R * 1.95, R * 0.55, R * 0.65, R * 0.85);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // 볼 (넓고 둥근 벌브형)
  const bowlGrad = ctx.createLinearGradient(0, -R, 0, R * 0.9);
  bowlGrad.addColorStop(0, light);
  bowlGrad.addColorStop(0.4, main);
  bowlGrad.addColorStop(1, dim);
  ctx.fillStyle = bowlGrad;
  ctx.beginPath();
  ctx.moveTo(-R * 0.78, -R * 0.72);
  ctx.bezierCurveTo(-R * 1.5, -R * 0.72, -R * 1.75, R * 0.1, -R * 1.05, R * 0.5);
  ctx.bezierCurveTo(-R * 0.68, R * 0.85, -R * 0.18, R, 0, R);
  ctx.bezierCurveTo(R * 0.18, R, R * 0.68, R * 0.85, R * 1.05, R * 0.5);
  ctx.bezierCurveTo(R * 1.75, R * 0.1, R * 1.5, -R * 0.72, R * 0.78, -R * 0.72);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = Math.max(2, R * 0.05);
  ctx.strokeStyle = dim;
  ctx.stroke();

  // 상단 림 밴드
  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.ellipse(0, -R * 0.72, R * 0.82, R * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = Math.max(1.2, R * 0.03);
  ctx.strokeStyle = dim;
  ctx.stroke();

  // 메달리온 링 + 별
  ctx.strokeStyle = dim;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = Math.max(1.4, R * 0.035);
  ctx.beginPath();
  ctx.arc(0, -R * 0.05, R * 0.42, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;

  const medGrad = ctx.createRadialGradient(0, -R * 0.05, R * 0.05, 0, -R * 0.05, R * 0.33);
  medGrad.addColorStop(0, light);
  medGrad.addColorStop(1, main);
  ctx.fillStyle = medGrad;
  ctx.beginPath();
  ctx.arc(0, -R * 0.05, R * 0.33, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = light;
  ctx.beginPath();
  const spikes = 5, outerR = R * 0.24, innerR = R * 0.1;
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = (Math.PI / spikes) * i - Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = -R * 0.05 + Math.sin(a) * r;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();

  // 어깨 반짝이
  function sparkle(sx, sy, r) {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const rr = i % 2 === 0 ? r : r * 0.4;
      const a = (Math.PI / 4) * i;
      const x = sx + Math.cos(a) * rr;
      const y = sy + Math.sin(a) * rr;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = light;
  ctx.globalAlpha = 0.8;
  sparkle(-R * 0.9, -R * 0.35, R * 0.12);
  sparkle(R * 0.9, -R * 0.35, R * 0.12);
  ctx.globalAlpha = 1;

  // 목/기둥
  ctx.fillStyle = dim;
  ctx.fillRect(-R * 0.14, R * 1.0, R * 0.28, R * 0.42);

  // 2단 받침대
  ctx.beginPath();
  ctx.moveTo(-R * 0.42, R * 1.42);
  ctx.lineTo(R * 0.42, R * 1.42);
  ctx.lineTo(R * 0.56, R * 1.68);
  ctx.lineTo(-R * 0.56, R * 1.68);
  ctx.closePath();
  ctx.fill();

  const baseGrad = ctx.createLinearGradient(0, R * 1.68, 0, R * 1.95);
  baseGrad.addColorStop(0, light);
  baseGrad.addColorStop(1, dim);
  ctx.fillStyle = baseGrad;
  roundedRectPath(ctx, -R * 0.66, R * 1.68, R * 1.32, R * 0.27, Math.max(1, R * 0.05));
  ctx.fill();
  ctx.strokeStyle = dim;
  ctx.lineWidth = Math.max(1.4, R * 0.035);
  ctx.stroke();

  ctx.restore();
}

// appId의 배경용 커버 이미지를 여러 CDN 후보 URL 중 처음 성공하는 걸로 불러온다.
async function loadBackgroundCover(appId) {
  if (!appId) return null;
  const candidates = steamCoverUrlCandidates(appId);
  for (const url of candidates) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      return await loadImage(buf);
    } catch {
      // 다음 후보로 넘어간다.
    }
  }
  return null;
}

// TROPHION 브랜드 마크 — 프론트 헤더/템플릿의 트로피 로고와 동일한 실루엣.
function drawBrandMark(ctx, x, y, size) {
  const s = size / 32;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  const grad = ctx.createLinearGradient(4, 6, 28, 28);
  grad.addColorStop(0, '#e8b84b');
  grad.addColorStop(1, '#cd7f4c');
  ctx.strokeStyle = grad;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(8, 6); ctx.lineTo(24, 6); ctx.lineTo(24, 13);
  ctx.bezierCurveTo(24, 18.5, 20.5, 22, 16, 22);
  ctx.bezierCurveTo(11.5, 22, 8, 18.5, 8, 13);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath(); ctx.moveTo(8, 8); ctx.lineTo(4, 8); ctx.lineTo(4, 11);
  ctx.bezierCurveTo(4, 14, 6, 16, 9, 16); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(24, 8); ctx.lineTo(28, 8); ctx.lineTo(28, 11);
  ctx.bezierCurveTo(28, 14, 26, 16, 23, 16); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(16, 22); ctx.lineTo(16, 26); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(11, 28); ctx.lineTo(21, 28); ctx.stroke();
  ctx.restore();
}

export async function renderTrophyCardPNG({ appId, gameName, picks }) {
  // picks: [{ slot: 'gold'|'silver'|'bronze', name, rarityPct }] (없는 슬롯은 생략 가능)
  const W = 1200, H = 630; // OG 이미지 표준 비율
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // 배경 베이스
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#161a26');
  bg.addColorStop(1, '#0a0b10');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // 게임 커버 이미지를 배경에 은은하게 오버랩 (화면 대시보드와 동일한 연출)
  const cover = await loadBackgroundCover(appId);
  if (cover) {
    ctx.save();
    ctx.globalAlpha = 0.28;
    const scale = Math.max(W / cover.width, H / cover.height);
    const dw = cover.width * scale, dh = cover.height * scale;
    ctx.drawImage(cover, (W - dw) / 2, (H - dh) / 2, dw, dh);
    ctx.restore();
    const shade = ctx.createRadialGradient(W / 2, -H * 0.1, H * 0.2, W / 2, H * 0.45, H * 0.95);
    shade.addColorStop(0, 'rgba(28,32,48,.35)');
    shade.addColorStop(0.55, 'rgba(10,11,16,.82)');
    shade.addColorStop(1, 'rgba(8,9,13,.95)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, W, H);
  }

  // 우측 상단 TROPHION 브랜드
  drawBrandMark(ctx, W - 176, 40, 26);
  ctx.fillStyle = '#eae7de';
  ctx.font = font(19, true);
  ctx.textAlign = 'left';
  ctx.fillText('TROPHION', W - 138, 59);

  // 게임 이름
  ctx.fillStyle = '#9498a8';
  ctx.font = font(22, true);
  ctx.textAlign = 'left';
  ctx.fillText(gameName, 44, 54);

  const positions = { gold: W * 0.5, silver: W * 0.25, bronze: W * 0.75 };
  const centerY = { gold: H * 0.4, silver: H * 0.53, bronze: H * 0.55 };
  const labelYOffset = { gold: 104, silver: 76, bronze: 66 };

  for (const slotKey of ['silver', 'bronze', 'gold']) {
    // gold를 마지막에 그려서 다른 두 트로피 위로 살짝 겹치게(그림자) — 화면과 동일한 위계감.
    const pick = picks.find((p) => p.slot === slotKey);
    const base = SLOT_STYLE[slotKey];
    const style = pick ? base : { main: '#3a3f4e', dim: '#262a37', light: '#5c6175', scale: base.scale };
    const cx = positions[slotKey];
    const cy = centerY[slotKey];

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.55)';
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 14;
    drawTrophy(ctx, cx, cy, style);
    ctx.restore();

    if (!pick) continue;

    ctx.textAlign = 'center';
    ctx.fillStyle = style.main;
    ctx.font = font(slotKey === 'gold' ? 27 : 18, true);
    ctx.fillText(pick.name, cx, cy + labelYOffset[slotKey]);
    ctx.fillStyle = '#9498a8';
    ctx.font = font(slotKey === 'gold' ? 16 : 13, false);
    ctx.fillText(`Only ${pick.rarityPct.toFixed(1)}% worldwide`, cx, cy + labelYOffset[slotKey] + (slotKey === 'gold' ? 26 : 20));
  }
  ctx.textAlign = 'left';

  return canvas.toBuffer('image/png');
}
