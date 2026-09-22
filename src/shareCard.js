// 트로피 카드 PNG 렌더러. 두 곳에서 쓰인다:
//   1) GET /u/:steamId64/:appId.png — 디스코드/트위터 링크 미리보기(OG 이미지). JS를 실행할
//      수 없는 상황이라 항상 서버 렌더링이 필요하고, 크기는 OG 표준 비율(1200x630)로 고정.
//   2) GET /api/games/:appId/card.png — "이미지 다운로드" 버튼. html2canvas로 화면을 그대로
//      캡처하는 방식을 시도했었지만, background-clip:text(그라디언트 워드마크)를 깨진
//      픽셀 블록으로 그리고 object-fit:cover를 무시해서 배경 사진이 찌그러지는 등
//      html2canvas 자체의 한계에 계속 부딪혀서 다시 서버 렌더링으로 돌아왔다. 대신 이번엔
//      캔버스 크기를 해당 게임 커버 이미지의 실제 가로세로 비율에 맞춰서 만들기 때문에
//      크롭도, 찌그러짐도 없다.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import { steamCoverUrlCandidates } from './steamApi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? `${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)}` : '255,255,255';
}

// 아주 은은한 후광 — public/index.html의 bigTrophySvg()와 같은 5단 그라디언트로,
// 경계가 뚝 끊기지 않고 배경에 자연스럽게 녹아들도록 반경을 넓고 opacity를 낮게 잡았다.
function drawGlow(ctx, cx, cy, r, color, peakOpacity) {
  const rgb = hexToRgb(color);
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  grad.addColorStop(0, `rgba(${rgb},${peakOpacity.toFixed(2)})`);
  grad.addColorStop(0.3, `rgba(${rgb},${(peakOpacity * 0.72).toFixed(2)})`);
  grad.addColorStop(0.55, `rgba(${rgb},${(peakOpacity * 0.4).toFixed(2)})`);
  grad.addColorStop(0.78, `rgba(${rgb},${(peakOpacity * 0.14).toFixed(2)})`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  ctx.save();
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// 사이트 헤더의 TROPHION 로고(.brand-mark)와 정확히 같은 패스 데이터를 그대로 확대해서 쓴다
// (볼 M8 6H24V13C…, 손잡이 2개, 기둥, 받침대 — viewBox 0 0 32 32). 로고는 얇은 "선" 아이콘이라
// 볼 안쪽을 진하게 채우면 두 커브가 바닥 한 점(16,22)에서 뾰족하게 만나는 부분이 도드라져서
// 트로피가 아니라 이상한 두 쪽짜리 덩어리처럼 보인다 — 그래서 채우지 않고 로고와 동일하게
// "선" 위주로 그리고, 뒤에 아주 은은한 후광만 더한다(반짝이는 뺐다 — 너무 산만하다는 피드백).
function drawLogoTrophy(ctx, x, y, size, style) {
  const s = size / 32;
  const cx = x + 16 * s, cy = y + 15 * s;

  drawGlow(ctx, cx, cy, size * 0.7, style.main, 0.3);

  const grad = ctx.createLinearGradient(x + 4 * s, y + 6 * s, x + 28 * s, y + 28 * s);
  grad.addColorStop(0, style.light);
  grad.addColorStop(0.5, style.main);
  grad.addColorStop(1, style.dim);

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.lineJoin = 'round';

  // 볼 — 아주 옅은 채움(유리질 느낌)만 주고 윤곽선으로 형태를 낸다
  ctx.beginPath();
  ctx.moveTo(8, 6);
  ctx.lineTo(24, 6);
  ctx.lineTo(24, 13);
  ctx.bezierCurveTo(24, 18.5, 20.5, 22, 16, 22);
  ctx.bezierCurveTo(11.5, 22, 8, 18.5, 8, 13);
  ctx.closePath();
  ctx.fillStyle = style.main;
  ctx.globalAlpha = 0.1;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1.7;
  ctx.strokeStyle = grad;
  ctx.stroke();

  // 손잡이
  ctx.strokeStyle = grad;
  ctx.lineWidth = 2;
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
  const widths = [];
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

// 카드 본체를 그린다 — OG용/다운로드용 둘 다 이 함수를 공유하고, W/H와 cover만 다르게 넘긴다.
// cover 그리기는 항상 object-fit:cover 방식(비율 유지 + 필요한 만큼만 중앙 크롭)으로 처리한다.
// renderDownloadCardPNG는 애초에 W:H를 cover의 실제 비율에 맞춰서 넘기기 때문에 이 경우
// 크롭이 전혀 발생하지 않고(스케일=1), renderTrophyCardPNG(고정 1200x630 OG 이미지)처럼
// cover 비율이 캔버스 비율과 다른 경우에도 절대 찌그러지지(늘어나지) 않는다 — 예전엔
// drawImage(cover,0,0,W,H)로 강제로 늘려 그려서 OG 이미지에서 배경이 찌부러지는 문제가
// 있었다.
function paintCard(ctx, W, H, { gameName, picks, cover }) {
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#1c2030');
  bg.addColorStop(1, '#0a0b10');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  if (cover) {
    const scale = Math.max(W / cover.width, H / cover.height);
    const dw = cover.width * scale;
    const dh = cover.height * scale;
    const dx = (W - dw) / 2;
    const dy = (H - dh) / 2;
    ctx.save();
    ctx.globalAlpha = 0.32;
    ctx.drawImage(cover, dx, dy, dw, dh);
    ctx.restore();
    const shade = ctx.createRadialGradient(W / 2, H * 0.08, H * 0.18, W / 2, H * 0.5, H * 0.98);
    shade.addColorStop(0, 'rgba(28,32,48,.3)');
    shade.addColorStop(0.55, 'rgba(10,11,16,.8)');
    shade.addColorStop(1, 'rgba(8,9,13,.95)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, W, H);
  }

  // 헤더: 좌측 게임명, 우측 TROPHION 브랜드 — 캔버스 폭에 비례해서 크기를 잡는다.
  ctx.textAlign = 'left';
  ctx.fillStyle = '#9498a8';
  const headerFont = Math.round(W * 0.0217);
  ctx.font = font(headerFont, true);
  ctx.fillText(gameName.toUpperCase(), W * 0.045, H * 0.105);

  const wmSize = Math.round(W * 0.02);
  const wmText = 'TROPHION';
  ctx.font = `${wmSize}px "${FONT_DISPLAY}"`;
  let wmWidth = 0;
  for (const ch of wmText) wmWidth += ctx.measureText(ch).width + 0.5;
  wmWidth -= 0.5;
  const brandSize = Math.round(W * 0.0233);
  const wmX = W - W * 0.045 - wmWidth - (brandSize + 10);
  drawBrandMark(ctx, wmX, H * 0.067, brandSize);
  drawWordmark(ctx, wmText, wmX + brandSize + 10, H * 0.098, wmSize, 0.5);

  const byslot = Object.fromEntries(picks.map((p) => [p.slot, p]));
  const EMPTY_STYLE = { main: '#3a3f4e', dim: '#262a37', light: '#5c6175' };

  // 골드 (위쪽 중앙, 크게) / 실버(좌하단) / 브론즈(우하단) — 비율 기반 배치라 W/H가
  // 바뀌어도(=게임 커버 비율이 달라져도) 항상 비슷한 구도를 유지한다.
  drawSlot(ctx, {
    cx: W / 2, top: H * 0.111, size: W * 0.175,
    style: byslot.gold ? SLOT_STYLE.gold : EMPTY_STYLE,
    label: '1ST · GOLD', pick: byslot.gold, nameFont: Math.round(W * 0.0217), rarityFont: Math.round(W * 0.0133)
  });
  drawSlot(ctx, {
    cx: W * 0.235, top: H * 0.492, size: W * 0.11,
    style: byslot.silver ? SLOT_STYLE.silver : EMPTY_STYLE,
    label: '2ND · SILVER', pick: byslot.silver, nameFont: Math.round(W * 0.0142), rarityFont: Math.round(W * 0.01)
  });
  drawSlot(ctx, {
    cx: W * 0.765, top: H * 0.511, size: W * 0.093,
    style: byslot.bronze ? SLOT_STYLE.bronze : EMPTY_STYLE,
    label: '3RD · BRONZE', pick: byslot.bronze, nameFont: Math.round(W * 0.0125), rarityFont: Math.round(W * 0.0092)
  });
}

// 1) 디스코드/트위터 OG 이미지 — 고정 1200x630.
export async function renderTrophyCardPNG({ appId, gameName, picks }) {
  const W = 1200, H = 630;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const cover = await loadBackgroundCover(appId);
  paintCard(ctx, W, H, { gameName, picks, cover });
  return canvas.toBuffer('image/png');
}

// 2) "이미지 다운로드" 버튼 — 게임 커버 이미지의 실제 가로세로 비율에 캔버스를 맞춘다
// (요청: "배경 사진 사이즈에 맞춰서" — 크롭도 찌그러짐도 없게). 커버를 못 찾으면 OG와
// 같은 1200x630 비율로 대체한다.
export async function renderDownloadCardPNG({ appId, gameName, picks }) {
  const cover = await loadBackgroundCover(appId);
  const aspect = cover ? cover.width / cover.height : 1200 / 630;
  const TARGET_W = 1400;
  const W = TARGET_W;
  const H = Math.round(TARGET_W / aspect);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  paintCard(ctx, W, H, { gameName, picks, cover });
  return canvas.toBuffer('image/png');
}
