// Steam Web API 얇은 래퍼. 모두 STEAM_API_KEY가 필요하고, 유저의 Steam 프로필/게임 세부정보가
// "비공개"면 일부 호출이 빈 값을 준다 — 그 경우 UI에서 "Steam 프로필을 공개로 설정해주세요" 안내가 필요.

const BASE = 'https://api.steampowered.com';

// communityvisibilitystate: 1 = Private, 2 = Friends only, 3 = Public.
// 3이 아니면 GetOwnedGames/GetPlayerAchievements가 빈 값을 주므로 미리 걸러서
// "프로필을 공개로 설정해주세요" 같은 명확한 안내를 줄 수 있다.
export const PROFILE_VISIBILITY_PUBLIC = 3;

// 게임 커버 이미지. Steam 클라이언트/스토어가 실제로 쓰는 CDN 경로 패턴이라
// API 키 없이도 appid만 알면 바로 접근된다.
export function steamCoverUrl(appId) {
  return `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`;
}

// header.jpg가 없는 appid도 있다 — 베타/플레이테스트 전용 appid(정식 발매작과 다른 별도
// appid로 라이브러리에 잡히는 경우, 예: "OOO Playtest"), 최근 출시라 CDN 캐시 반영이 늦은
// 경우 등. 이럴 때도 대부분 store 페이지용 캡슐/라이브러리 이미지는 존재하므로 순서대로
// 시도할 후보 URL 목록을 준다. 프론트(index.html)가 <img> 로드 실패 시 다음 후보로 넘어간다.
export function steamCoverUrlCandidates(appId) {
  const base = `https://cdn.akamai.steamstatic.com/steam/apps/${appId}`;
  const shared = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}`;
  return [
    `${base}/header.jpg`,
    `${base}/capsule_616x353.jpg`,
    `${base}/library_header.jpg`,
    `${shared}/capsule_616x353.jpg`,
    `${base}/capsule_231x87.jpg`
  ];
}

function withKey(url, key) {
  const u = new URL(url);
  u.searchParams.set('key', key);
  u.searchParams.set('format', 'json');
  return u.toString();
}

export async function getPlayerSummary(steamId64, apiKey) {
  const url = withKey(
    `${BASE}/ISteamUser/GetPlayerSummaries/v2/?steamids=${steamId64}`,
    apiKey
  );
  const res = await fetch(url);
  const data = await res.json();
  return data?.response?.players?.[0] || null;
}

// 보유 게임 + 플레이타임. include_appinfo=1로 이름/아이콘도 함께 받는다.
export async function getOwnedGames(steamId64, apiKey) {
  const url = withKey(
    `${BASE}/IPlayerService/GetOwnedGames/v1/?steamid=${steamId64}&include_appinfo=1&include_played_free_games=1`,
    apiKey
  );
  const res = await fetch(url);
  const data = await res.json();
  return data?.response?.games || [];
}

// 특정 게임에서 이 유저가 달성한 업적 목록 (achieved 0/1 + unlocktime)
// lang: Steam 언어 문자열(koreana/english/japanese 등) — 유저의 추정 로케일로 호출측에서 넘겨준다.
export async function getPlayerAchievements(steamId64, appId, apiKey, lang = 'english') {
  const url = withKey(
    `${BASE}/ISteamUserStats/GetPlayerAchievements/v1/?steamid=${steamId64}&appid=${appId}&l=${lang}`,
    apiKey
  );
  const res = await fetch(url);
  const data = await res.json();
  // 업적을 지원하지 않는 게임이거나 프로필 비공개면 success:false로 옴
  if (!data?.playerstats?.success) return [];
  return data.playerstats.achievements || [];
}

// 이 업적을 전세계에서 몇 %가 달성했는지 — 우리가 "레어도"를 매기는 근거.
// 키가 없어도 동작하는 공개 API지만, 일관성을 위해 동일한 헬퍼를 쓴다.
export async function getGlobalAchievementPercentages(appId) {
  const url = `${BASE}/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${appId}`;
  const res = await fetch(url);
  const data = await res.json();
  const rows = data?.achievementpercentages?.achievements || [];
  const map = {};
  for (const row of rows) map[row.name] = Number(row.percent);
  return map;
}

// 게임의 업적 스키마(표시 이름, 설명, 아이콘) — GetPlayerAchievements는 이 정보를 안 주기 때문에 별도 호출.
export async function getSchemaForGame(appId, apiKey, lang = 'english') {
  const url = withKey(
    `${BASE}/ISteamUserStats/GetSchemaForGame/v2/?appid=${appId}&l=${lang}`,
    apiKey
  );
  const res = await fetch(url);
  const data = await res.json();
  return data?.game?.availableGameStats?.achievements || [];
}

// 전세계 달성률로 우리 등급(common/rare/epic/legendary)을 매긴다.
// grids.fun류 사이트와 달리, "희귀할수록 더 자랑스럽다"는 우리 컨셉의 핵심 로직.
export function tierFromGlobalPct(pct) {
  if (pct <= 2) return 'legendary';
  if (pct <= 10) return 'epic';
  if (pct <= 30) return 'rare';
  return 'common';
}
