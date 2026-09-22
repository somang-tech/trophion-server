// 공개 프로필/디스코드 링크 미리보기 + "이미지 다운로드" 버튼에 쓰이는 PNG 카드 렌더러.
// public/index.html의 트로피 템플릿과 최대한 같은 재료(같은 로고 패스, 같은 폰트 느낌,
// 같은 색)로 서버 사이드에서 다시 그린다. 화면 미리보기는 와이드(OG 비율) 그대로 두고,
// 다운로드 이미지만 인스타/페이스북 표준 정사각형(1080x1080)으로 렌더링한다.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import { steamCoverUrlCandidates } from './steamApi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const W = 1080, H = 1080; // Instagram/Facebook 정사각형 표준

// Railway 같은 최소 컨테이너에는 시스템 폰트가 아예 없을 수 있다 — 그러면 @napi-rs/canvas가
// 도형(패스/그라디언트)은 정상적으로 그리면서도 ctx.fillText만 조용히 아무것도 안 그린다
// (에러도 안 남). 그래서 폰트를 리포에 직접 번들하고 등록해서 어떤 환경에서도 텍스트가
// 확실히 나오게 한다.
//   - Trophion Sans / Trophion Sans Bold: 본문/라벨용 (DejaVu Sans)
//   - Trophion Display: "TROPHION" 워드마크 전용 — 사이트 헤더가 쓰는 구글폰트 Bebas Neue는
//     이 샌드박스에서 네트워크가 막혀 있어 받아올 수 없었다. 대신 같은 계열의 콘덴스드
//     디스플레이 서체(Big Shoulders Bold)를 번들해서 최대한 비슷한 느낌으로 맞췄다 —
//     나중에 실제 Bebas Neue .ttf를 fonts/에 추가하고 FONT_DISPLAY 등록 경로만 바꾸면 된다.
const FONT_REGULAR = 'Trophion Sans';
const FONT_BOLD = 'Trophion Sans Bold';
const FONT_DISPLAY = 'Trophion Display';
try {
  GlobalFonts.registerFromPath(path.join(__dirname, '..', 'fonts', 'DejaVuSans.ttf'), FONT_REGULAR);
  GlobalFonts.registerFromPath(path.join(__dirname, '..', 'fonts', 'DejaVuSans-Bold.ttf'), FONT_BOLD);
  GlobalFonts.registerFromPath(path.join(__dirname, '..', 'fonts', 'BigShoulders-Bold.ttf'), FONT_DISPLAY);
} catch (err) {
  console.error('[shareCard] 폰트 등록 실패 — 텍스트가 안 보일 수 있습니다:', err);
}
const font = (px, bold) => `${px}px "${bold ? FONT_BOLD : FONT_REGULAR}"`;

const SLOT_STYLE = {
  gold:   { main: '#e8b84b', dim: '#7a6530', light: '#fff3cf' },
  silver: { main: '#c3c9d6', dim: '#5f6472', light: '#ffffff' },
  bronze: { main: '#cd7f4c', dim: '#6b4a34', light: '#ffe1c7' }
};

// 사이트 헤더의 TROPHION 로고(.brand-mark)와 정확히 같은 패스 데이터를 그대로 확대해서 쓴다.
// 원본 SVG(public/index.html): 볼 M8 6H24V13C24 18.5 20.5 22 16 22C11.5 22 8 18.5 8 13V6Z,
// 손잡이 2개, 기둥, 받침대 — viewBox 0 0 32 32. 로고 자체는 선 아이콘이라 볼 안쪽은
// 그라디언트로 채우고 가운데 작은 별 하나만 포인트로 더했다 (public/index.html의
// bigTrophySvg와 동일한 로직).
function drawLogoTrophy(ctx, x, y, size, style) {
  const s = size / 32;
  const grad = ctx.createLinearGradient(x + 4 * s, y + 6 * s, x + 28 * s, y + 28 * s);
  grad.addColorStop(0, style.light);
  grad.addColorStop(0.5, style.main);
  grad.addColorStop(1, style.dim);

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);

  // 볼
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(8, 6);
  ctx.lineTo(24, 6);
  ctx.lineTo(24, 13);
  ctx.bezierCurveTo(24, 18.5, 20.5, 22, 16, 22);
  ctx.bezierCurveTo(11.5, 22, 8, 18.5, 8, 13);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = style.dim;
  ctx.stroke();

  // 손잡이
  ctx.strokeStyle = grad;
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(8, 8); ctx.lineTo(4, 8); ctx.lineTo(4, 11);
  ctx.bezierCurveTo(4, 14, 6, 16, 9, 16);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(24, 8); ctx.lineTo(28, 8); ctx.lineTo(28, 11);
  ctx.bezierCurveTo(28, 14, 26, 16, 23, 16);
  ctx.stroke();

  // 기둥 + 받침대
  ctx.beginPath(); ctx.moveTo(16, 22); ctx.lineTo(16, 26); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(11, 28); ctx.lineTo(21, 28); ctx.stroke();

  // 별 포인트
  ctx.fillStyle = style.light;
  ctx.beginPath();
  ctx.moveTo(16, 8.8);
  ctx.lineTo(17, 11.3); ctx.lineTo(19.7, 11.5); ctx.lineTo(17.6, 13.1);
  ctx.lineTo(18.3, 15.7); ctx.lineTo(16, 14.2); ctx.lineTo(13.7, 15.7);
  ctx.lineTo(14.4, 13.1); ctx.lineTo(12.3, 11.5); ctx.lineTo(15, 11.3);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

// TROPHION 브랜드 마크 (헤더 아이콘과 동일한 패스, 선 아이콘 그대로 — 작게 쓰이므로 채우지 않음).
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

// 사이트 헤더의 .brand-name과 같은 느낌: 콘덴스드 디스플레이 서체 + 글자 간격 + 흰색→골드
// 그라디언트 텍스트. ctx.letterSpacing을 못 믿을 수 있는 환경도 있어 글자를 하나씩 그려서
// 직접 자간을 준다.
function drawWordmark(ctx, text, x, y, px, spacing) {
  ctx.save();
  ctx.font = `${px}px "${FONT_DISPLAY}"`;
  ctx.textBaseline = 'alphabetic';
  let widths = [];
  let total = 0;
  for (const ch of text) {
    const w = ctx.measureText(ch).width;
    widths.push(w);
    total += w + spacing;
  }
  total -= spacing;
  const grad = ctx.createLinearGradient(x, 0, x + total, 0);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.65, '#e8b84b');
  ctx.fillStyle = grad;
  let cx = x;
  [...text].forEach((ch, i) => {
    ctx.fillText(ch, cx, y);
    cx += widths[i] + spacing;
  });
  ctx.restore();
  return total;
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

function drawSlot(ctx, { cx, top, size, style, label, pick, nameFont, rarityFont }) {
  drawLogoTrophy(ctx, cx - size / 2, top, size, style);

  const textCx = cx;
  let ty = top + size + Math.round(size * 0.14);

  ctx.textAlign = 'center';
  ctx.fillStyle = style.main;
  ctx.font = font(Math.round(size * 0.075), true);
  ctx.fillText(label, textCx, ty);
  ty += Math.round(size * 0.02);

  ty += nameFont + 6;
  ctx.fillStyle = pick ? '#eae7de' : '#5c6175';
  ctx.font = font(nameFont, true);
  ctx.fillText(pick ? pick.name : 'Empty', textCx, ty);

  if (pick) {
    ty += rarityFont + 10;
    ctx.fillStyle = style.main;
    ctx.font = font(rarityFont, false);
    ctx.fillText(`Only ${pick.rarityPct.toFixed(1)}% worldwide`, textCx, ty);
  }
  ctx.textAlign = 'left';
}

export async function renderTrophyCardPNG({ appId, gameName, picks }) {
  // picks: [{ slot: 'gold'|'silver'|'bronze', name, rarityPct }] (없는 슬롯은 생략 가능)
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // 배경 베이스
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#1c2030');
  bg.addColorStop(1, '#0a0b10');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // 게임 커버 이미지를 배경에 은은하게 오버랩 (화면 대시보드와 동일한 연출)
  const cover = await loadBackgroundCover(appId);
  if (cover) {
    ctx.save();
    ctx.globalAlpha = 0.3;
    const scale = Math.max(W / cover.width, H / cover.height);
    const dw = cover.width * scale, dh = cover.height * scale;
    ctx.drawImage(cover, (W - dw) / 2, (H - dh) / 2, dw, dh);
    ctx.restore();
    const shade = ctx.createRadialGradient(W / 2, H * 0.08, H * 0.18, W / 2, H * 0.5, H * 0.98);
    shade.addColorStop(0, 'rgba(28,32,48,.3)');
    shade.addColorStop(0.55, 'rgba(10,11,16,.8)');
    shade.addColorStop(1, 'rgba(8,9,13,.95)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, W, H);
  }

  // 헤더: 좌측 게임명, 우측 TROPHION 브랜드
  ctx.textAlign = 'left';
  ctx.fillStyle = '#9498a8';
  ctx.font = font(26, true);
  ctx.fillText(gameName.toUpperCase(), 54, 66);

  const wmSize = 24;
  const wmText = 'TROPHION';
  ctx.font = `${wmSize}px "${FONT_DISPLAY}"`;
  let wmWidth = 0;
  for (const ch of wmText) wmWidth += ctx.measureText(ch).width + 2;
  wmWidth -= 2;
  const wmX = W - 54 - wmWidth - 38;
  drawBrandMark(ctx, wmX, 42, 28);
  drawWordmark(ctx, wmText, wmX + 38, 62, wmSize, 2);

  const byslot = Object.fromEntries(picks.map((p) => [p.slot, p]));

  // 골드 (위쪽 중앙, 크게)
  drawSlot(ctx, {
    cx: W / 2, top: 104, size: 400,
    style: byslot.gold ? SLOT_STYLE.gold : { main: '#3a3f4e', dim: '#262a37', light: '#5c6175' },
    label: '1ST · GOLD', pick: byslot.gold, nameFont: 40, rarityFont: 24
  });

  // 실버 (좌하단, 중간)
  drawSlot(ctx, {
    cx: W * 0.278, top: 670, size: 250,
    style: byslot.silver ? SLOT_STYLE.silver : { main: '#3a3f4e', dim: '#262a37', light: '#5c6175' },
    label: '2ND · SILVER', pick: byslot.silver, nameFont: 26, rarityFont: 18
  });

  // 브론즈 (우하단, 조금 더 작게)
  drawSlot(ctx, {
    cx: W * 0.74, top: 670, size: 214,
    style: byslot.bronze ? SLOT_STYLE.bronze : { main: '#3a3f4e', dim: '#262a37', light: '#5c6175' },
    label: '3RD · BRONZE', pick: byslot.bronze, nameFont: 23, rarityFont: 16
  });

  return canvas.toBuffer('image/png');
}
