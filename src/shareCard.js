// 공개 프로필/디스코드 링크 미리보기 + "이미지 다운로드" 버튼에 쓰이는 PNG 카드 렌더러.
// 프론트(public/index.html)의 트로피 템플릿을 서버 사이드에서 그대로 다시 그린다 —
// 브라우저 화면 캡처가 아니라 실제 데이터로 매번 새로 렌더링하므로 항상 최신 상태다.
import { createCanvas } from '@napi-rs/canvas';

const SLOT_STYLE = {
  gold:   { main: '#e8b84b', dim: '#7a6530', light: '#fff3cf', scale: 1 },
  silver: { main: '#c3c9d6', dim: '#5f6472', light: '#ffffff', scale: 0.66 },
  bronze: { main: '#cd7f4c', dim: '#6b4a34', light: '#ffe1c7', scale: 0.54 }
};

// 트로피 컵 실루엣 (볼 + 손잡이 2개 + 기둥 + 받침대). cx/cy는 볼 중심, scale로 전체 크기를 조절.
function drawTrophy(ctx, cx, cy, style) {
  const { main, dim, light, scale } = style;
  const s = scale;
  const bowlR = 60 * s;

  ctx.save();
  ctx.translate(cx, cy);

  // 손잡이
  ctx.strokeStyle = dim;
  ctx.lineWidth = 9 * s;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-bowlR * 0.55, -bowlR * 0.25);
  ctx.quadraticCurveTo(-bowlR * 1.55, -bowlR * 0.1, -bowlR * 0.62, bowlR * 0.42);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(bowlR * 0.55, -bowlR * 0.25);
  ctx.quadraticCurveTo(bowlR * 1.55, -bowlR * 0.1, bowlR * 0.62, bowlR * 0.42);
  ctx.stroke();

  // 볼 (컵 본체)
  const grad = ctx.createRadialGradient(-bowlR * 0.3, -bowlR * 0.35, bowlR * 0.1, 0, 0, bowlR);
  grad.addColorStop(0, light);
  grad.addColorStop(0.5, main);
  grad.addColorStop(1, dim);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(-bowlR * 0.62, -bowlR * 0.5);
  ctx.lineTo(bowlR * 0.62, -bowlR * 0.5);
  ctx.quadraticCurveTo(bowlR * 0.7, bowlR * 0.35, 0, bowlR * 0.62);
  ctx.quadraticCurveTo(-bowlR * 0.7, bowlR * 0.35, -bowlR * 0.62, -bowlR * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = Math.max(2, bowlR * 0.05);
  ctx.strokeStyle = dim;
  ctx.stroke();

  // 별 장식
  ctx.fillStyle = light;
  ctx.beginPath();
  const spikes = 5, outerR = bowlR * 0.28, innerR = bowlR * 0.12;
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = (Math.PI / spikes) * i - Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = -bowlR * 0.05 + Math.sin(a) * r;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();

  // 기둥 + 받침대
  ctx.fillStyle = dim;
  ctx.fillRect(-bowlR * 0.12, bowlR * 0.62, bowlR * 0.24, bowlR * 0.38);
  ctx.beginPath();
  ctx.moveTo(-bowlR * 0.4, bowlR * 1.0);
  ctx.lineTo(bowlR * 0.4, bowlR * 1.0);
  ctx.lineTo(bowlR * 0.5, bowlR * 1.22);
  ctx.lineTo(-bowlR * 0.5, bowlR * 1.22);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

export function renderTrophyCardPNG({ displayName, gameName, picks }) {
  // picks: [{ slot: 'gold'|'silver'|'bronze', name, rarityPct }] (없는 슬롯은 생략 가능)
  const W = 1200, H = 630; // OG 이미지 표준 비율
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

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
  const centerY = { gold: H * 0.42, silver: H * 0.53, bronze: H * 0.55 };
  const labelYOffset = { gold: 92, silver: 66, bronze: 58 };

  for (const pick of picks) {
    const style = SLOT_STYLE[pick.slot];
    if (!style) continue;
    const cx = positions[pick.slot];
    const cy = centerY[pick.slot];
    drawTrophy(ctx, cx, cy, style);

    ctx.textAlign = 'center';
    ctx.fillStyle = style.main;
    ctx.font = `700 ${pick.slot === 'gold' ? 26 : 18}px sans-serif`;
    ctx.fillText(pick.name, cx, cy + labelYOffset[pick.slot]);
    ctx.fillStyle = '#9498a8';
    ctx.font = `600 ${pick.slot === 'gold' ? 16 : 13}px sans-serif`;
    ctx.fillText(`전세계 ${pick.rarityPct}%만 달성`, cx, cy + labelYOffset[pick.slot] + (pick.slot === 'gold' ? 26 : 20));
    ctx.textAlign = 'left';
  }

  return canvas.toBuffer('image/png');
}
