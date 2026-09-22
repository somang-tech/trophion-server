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

// query: 콜백으로 돌아온 req.query 전체 (openid.* 키들을 담고 있음)
// 반환값: 검증 성공 시 SteamID64 문자열, 실패 시 null
export async function verifyCallback(query) {
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
  if (!isValid) return null;

  return match[1]; // SteamID64
}
