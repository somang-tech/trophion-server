// Steam 로그인은 OAuth2가 아니라 "Steam OpenID 2.0"이다.
// 흐름: 1) 우리가 steamcommunity.com/openid/login 으로 유저를 보낸다
//      2) 유저가 Steam에서 로그인하면 Steam이 우리 콜백 URL로 되돌려보낸다 (openid.* 쿼리 포함)
//      3) 우리는 받은 파라미터를 그대로 Steam에 다시 보내 서명을 검증한다 (openid.mode=check_authentication)
//      4) 검증되면 openid.claimed_id 끝의 숫자가 SteamID64다.
// 외부 라이브러리(passport-steam 등) 없이 표준 fetch만으로 구현 — 흐름이 투명하게 보이는 편이 유지보수에 낫다.

const STEAM_OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login';
const CLAIMED_ID_RE = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;

export function buildLoginUrl({ appBaseUrl, returnPath = '/auth/steam/callback' }) {
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': `${appBaseUrl}${returnPath}`,
    'openid.realm': appBaseUrl,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select'
  });
  return `${STEAM_OPENID_ENDPOINT}?${params.toString()}`;
}

// Express의 req.query(내부적으로 "qs" 라이브러리 사용)는 쿼리스트링의 리터럴 "+"를
// 스페이스로 디코딩해버린다 — 이건 application/x-www-form-urlencoded 관례인데, Steam이
// 돌려주는 openid.sig / openid.assoc_handle 값은 base64라서 "+"가 실제로 들어있을 수 있다.
// req.query를 그대로 쓰면 이 "+"가 스페이스로 뭉개져서 서명 검증(check_authentication)이
// 항상 실패하는 문제가 생긴다. 그래서 raw 쿼리스트링을 직접, "+"는 절대 건드리지 않고
// %XX만 decodeURIComponent로 풀어서 파싱한다.
export function parseRawOpenIdQuery(rawQueryString) {
  const out = {};
  if (!rawQueryString) return out;
  for (const pair of rawQueryString.split('&')) {
    if (!pair) continue;
    const eqIdx = pair.indexOf('=');
    const rawKey = eqIdx === -1 ? pair : pair.slice(0, eqIdx);
    const rawVal = eqIdx === -1 ? '' : pair.slice(eqIdx + 1);
    try {
      out[decodeURIComponent(rawKey)] = decodeURIComponent(rawVal);
    } catch {
      // 손상된 percent-encoding은 조용히 건너뛴다 (아래에서 claimed_id 누락으로 자연스럽게 실패 처리됨).
    }
  }
  return out;
}

// rawQueryString: 콜백 요청의 원본 쿼리스트링 (req.url에서 "?" 뒤 부분, 아직 파싱 전).
// 반환값: 검증 성공 시 SteamID64 문자열, 실패 시 null
export async function verifyCallback(rawQueryString) {
  const query = parseRawOpenIdQuery(rawQueryString);

  const claimedId = query['openid.claimed_id'];
  if (!claimedId) return null;
  const match = CLAIMED_ID_RE.exec(claimedId);
  if (!match) return null;

  const verifyParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    verifyParams.set(key, value);
  }
  verifyParams.set('openid.mode', 'check_authentication');

  const res = await fetch(STEAM_OPENID_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: verifyParams.toString()
  });
  const text = await res.text();
  const isValid = /is_valid\s*:\s*true/.test(text);
  if (!isValid) {
    console.error('[steamAuth] check_authentication 실패, Steam 응답:', text.trim());
    return null;
  }

  return match[1]; // SteamID64
}
