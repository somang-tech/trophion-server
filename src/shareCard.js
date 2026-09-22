// 공개 프로필/디스코드 링크 미리보기에 쓰이는 PNG 카드 렌더러.
// 프론트(trophion.html)의 "트로피 템플릿" 카드를 서버 사이드에서 그대로 다시 그린다 —
// 브라우저 화면 캡처가 아니라 실제 데이터로 매번 새로 렌더링하므로 항상 최신 상태다.
import { createCanvas } from '@napi-rs/canvas';

const SLOT_STYLE = {
  gold:   { main: '#e8b84b', dim: '#7a6530', light: '#fff3cf', radius: 88, labelY: -118 },
  silver: { main: '#c3c9d6', dim: '#5f6472', light: '#ffffff', radius: 58, labelY: -80 },
  bronze: { main: '#cd7f4c', dim: '#6b4a34', light: '#ffe1c7', radius: 46, labelY: -66 }
};

function drawMedal(ctx, cx, cy, style) {
  const { main, dim, light, radius } = style;

  // 리본
  ctx.fillStyle = dim;
  ctx.beginPath();
  ctx.moveTo(cx - radius * 0.28, cy - radius * 1.9);
  ctx.lineTo(cx, cy - radius * 0.35);
  ctx.lineTo(cx - radius * 0.62, cy - radius * 0.35);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + radius * 0.28, cy - radius * 1.9);
  ctx.lineTo(cx, cy - radius * 0.35);
  ctx.lineTo(cx + radius * 0.62, cy - radius * 0.35);
  ctx.closePath();
  ctx.fill();

  // 원판
  const grad = ctx.createRadialGradient(cx - radius * 0.3, cy - radius * 0.35, radius * 0.1, cx, cy, radius);
  grad.addColorStop(0, light);
  grad.addColorStop(0.5, main);
  grad.addColorStop(1, dim);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = Math.max(2, radius * 0.05);
  ctx.strokeStyle = dim;
  ctx.stroke();

  // 안쪽 별
  ctx.fillStyle = light;
  ctx.beginPath();
  const spikes = 5, outerR = radius * 0.42, innerR = radius * 0.18;
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = (Math.PI / spikes) * i - Math.PI / 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

export function renderTrophyCardPNG({ displayName, gameName, picks }) {
  // picks: [{ slot: 'gold'|'silver'|'bronze', name, rarityPct }] (없는 슬롯은 생략 가능)
  const W = 1200, H = 630; // OG 이미지 표준 비율
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // 배경
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#161a26');
  bg.addColorStop(1, '#0a0b10');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#5c6175';
  ctx.font = '600 22px sans-serif';
  ctx.fillText('TROPHION', 48, 56);
  ctx.fillStyle = '#eae7de';
  ctx.font = '700 34px sans-serif';
  ctx.fillText(`@${displayName}`, 48, H - 48);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#9498a8';
  ctx.font = '600 24px sans-serif';
  ctx.fillText(gameName, W - 48, H - 48);
  ctx.textAlign = 'left';

  const positions = { gold: W * 0.5, silver: W * 0.24, bronze: W * 0.76 };
  const centerY = { gold: H * 0.44, silver: H * 0.56, bronze: H * 0.58 };

  for (const pick of picks) {
    const style = SLOT_STYLE[pick.slot];
    if (!style) continue;
    const cx = positions[pick.slot];
    const cy = centerY[pick.slot];
    drawMedal(ctx, cx, cy, style);

    ctx.textAlign = 'center';
    ctx.fillStyle = style.main;
    ctx.font = `700 ${pick.slot === 'gold' ? 26 : 18}px sans-serif`;
    ctx.fillText(pick.name, cx, cy + style.radius + 34);
    ctx.fillStyle = '#9498a8';
    ctx.font = `600 ${pick.slot === 'gold' ? 16 : 13}px sans-serif`;
    ctx.fillText(`전세계 ${pick.rarityPct}%만 달성`, cx, cy + style.radius + 34 + (pick.slot === 'gold' ? 26 : 20));
    ctx.textAlign = 'left';
  }

  return canvas.toBuffer('image/png');
}
