// Steam Web API는 "이 유저의 클라이언트 언어"를 공개적으로 주지 않는다 (GetPlayerSummaries에는
// 없다). 대신 줄 수 있는 가장 가까운 신호가 loccountrycode(국가)라서, 국가 → 언어로 추정한다.
// 로그인 전(게이트 화면)에는 그마저도 없으므로 IP 기반 국가 추정으로 한 번 더 폴백한다.
const COUNTRY_TO_LOCALE = {
  KR: 'ko',
  JP: 'ja'
  // 여기에 없는 나라는 전부 영어로 — 요청하신 "한국→한글, 일본→일본어, 미국(그 외)→영어" 그대로.
};

export function localeFromCountry(countryCode) {
  if (!countryCode) return 'en';
  return COUNTRY_TO_LOCALE[countryCode.toUpperCase()] || 'en';
}

// Steam Web API가 인식하는 언어 문자열 (GetSchemaForGame, GetPlayerAchievements의 l= 파라미터).
const LOCALE_TO_STEAM_LANG = { ko: 'koreana', ja: 'japanese', en: 'english' };

export function steamLangForLocale(locale) {
  return LOCALE_TO_STEAM_LANG[locale] || 'english';
}
