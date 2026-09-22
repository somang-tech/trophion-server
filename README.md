# Trophion Server

트로피온(Trophion) 데모 페이지(`trophion.html`)를 실제 서비스로 만들기 위한 백엔드 뼈대.
Steam OpenID 로그인 → Steam Web API로 게임/업적 동기화 → DB 캐시 → 트로피케이스(금/은/동) 저장 →
디스코드/트위터에 붙여넣으면 바로 카드가 보이는 공유용 PNG까지 한 번에 구현되어 있다.

## 왜 이런 구조인가

- **Steam은 OAuth2가 아니라 OpenID 2.0을 쓴다.** `src/steamAuth.js`에 외부 라이브러리 없이
  표준 `fetch`만으로 로그인 URL 생성 + 콜백 서명 검증을 구현해뒀다. 흐름이 짧아서 굳이
  `passport-steam` 같은 의존성을 더할 필요가 없었다.
- **Steam Web API를 매 요청마다 부르지 않는다.** 느리고 요청 제한도 있어서, `/api/games/sync`를
  로그인 직후나 "새로고침" 버튼에서만 호출하고 결과를 DB(`GameCache`, `AchievementCache`)에
  캐시해둔다. 대시보드는 항상 이 캐시를 읽는다.
- **레어도(희귀도) 등급은 우리가 계산한다.** Steam은 업적별 "전세계 달성률"만 줄 뿐 등급을
  안 매겨주므로, `tierFromGlobalPct()`가 이 퍼센트를 common/rare/epic/legendary로 변환한다.
  기준은 `src/steamApi.js`에서 조정 가능.
- **공유 카드는 스크린샷이 아니라 서버 렌더링이다.** `/u/:steamId64/:appId.png`가 요청 시점의
  DB 데이터로 카드를 새로 그린다(`src/shareCard.js`, `@napi-rs/canvas`). 그래서 프로필 링크를
  디스코드에 붙여넣으면 OG 이미지로 항상 최신 트로피케이스가 뜬다.

## 준비물

1. **Steam Web API 키** — https://steamcommunity.com/dev/apikey (Steam 계정만 있으면 즉시 발급)
2. Node.js 18 이상
3. (운영 배포 시) Postgres 등 실제 DB. 로컬 개발은 SQLite로 바로 된다.

## 시작하기

```bash
cd trophion-server
npm install
cp .env.example .env
# .env 열어서 STEAM_API_KEY, SESSION_SECRET 채우기

npx prisma migrate dev --name init   # SQLite 파일(dev.db) + 테이블 생성
npm run dev                          # http://localhost:3000
```

`http://localhost:3000`을 열면 `public/index.html`이 뜬다 — 이게 실제로 이 API에 연결된
프론트엔드다. "Steam으로 로그인" → 동기화 → 왼쪽에서 게임 클릭 → ★로 금/은/동 픽까지
전부 실데이터로 동작한다. (Claude 아티팩트로 따로 공유한 트로피온 데모 페이지는 브라우저
샌드박스 정책상 외부 API를 fetch할 수 없어서, 그쪽은 계속 가짜 데이터로 남아있다 — 그래서
이 저장소 안에 별도로 "진짜 붙는" 프론트를 뒀다.)

> 이 세션(샌드박스)은 npm 레지스트리 접근이 막혀 있어서 `npm install`까지는 실행해보지
> 못했다. 모든 소스는 `node --check`로 문법 검증만 통과시켜뒀으니, 로컬/개발 환경에서
> `npm install` 후 위 순서대로 실행하면 된다. 의존성은 `express`, `cookie-session`,
> `@prisma/client`(+`prisma`), `@napi-rs/canvas`, `dotenv` — 전부 흔한 패키지들이라
> 설치 이슈가 생기면 대부분 Node 버전 문제일 가능성이 크다(18+ 권장).

## 로그인 → 동기화 → 트로피 등록 흐름

```
1) GET  /auth/steam                → Steam 로그인 페이지로 리다이렉트
2) GET  /auth/steam/callback       → 로그인 성공 시 세션 쿠키 발급, User row 생성/갱신
3) POST /api/games/sync            → (로그인 필요) Steam에서 보유 게임 + 업적 + 전세계 달성률을
                                       끌어와 GameCache/AchievementCache에 저장
4) GET  /api/games                 → 완료율 높은 순으로 정렬된 내 게임 목록 (왼쪽 사이드바용)
5) GET  /api/games/:appId/achievements → 게임 하나의 업적 전체 (오른쪽 대시보드용)
6) POST /api/trophies { appId, slot, achievementApiName } → ★ 클릭 = 이 호출.
                                       슬롯이 차 있으면 새 업적으로 교체.
7) GET  /u/:steamId64/:appId       → 공개 공유 페이지 (OG 태그 포함)
   GET  /u/:steamId64/:appId.png   → 실제 카드 이미지
```

## public/index.html — 실제로 연결된 프론트엔드

가짜 `GAMES` 배열이 없다. 시작하자마자 `GET /auth/me`로 로그인 여부를 확인하고:

- 로그인 안 됨 → "Steam으로 로그인" 게이트 화면(비공개 프로필 안내 포함)
- 로그인 됨 → `GET /api/games` + `GET /api/games/stats`로 상단 통계·히어로를 채우고, 게임
  클릭 시 `GET /api/games/:appId/achievements` + `GET /api/trophies?appId=`를 같이 불러
  대시보드를 그림
- ★ 클릭 → `POST /api/trophies`, 픽 제거 → `DELETE /api/trophies?appId=&slot=`
- 게임 커버는 `game.coverUrl`(Steam CDN)을 `<img>`로 렌더링 — Claude 아티팩트 데모와 달리
  여긴 일반 웹페이지라 외부 이미지 로드에 제약이 없다.

**아티팩트 데모와 시각적으로 완전히 동일하게** 맞췄다: 로고(브랜드 마크 SVG + Bebas Neue
그라데이션), 헤더의 Games/Trophies/Rarity Score 통계, 사이드바 "내 게임 랭킹 · 달성도순" +
개수, 금/은/동 트로피 템플릿(비스듬한 메달), "획득한 업적 메달" 랙까지 전부 포함되어 있다.
CSS는 데모(`trophion.html`)의 CSS를 그대로 가져오고 데이터 소스만 실제 API로 바꾼 것이라,
둘을 비교하면서 디자인을 더 맞춰나가기도 쉽다.
`GET /api/games/stats`(신규 엔드포인트)가 "완벽 클리어/총 업적 수/평균 희귀도"를 서버에서
집계해서 준다 — 클라이언트에서 게임마다 업적을 다 훑지 않아도 되게 하기 위함.

## 비공개 프로필 처리

`POST /api/games/sync`가 시작할 때 `GetPlayerSummaries`로 `communityvisibilitystate`를 먼저
확인한다. 3(Public)이 아니면 게임/업적을 아예 시도하지 않고 바로 409 + 안내 메시지를 준다.
개별 게임만 업적 통계가 비공개인 경우(전체 프로필은 공개인데 특정 게임만 그런 경우)는
`GetPlayerAchievements`가 빈 배열을 주므로 그 게임만 조용히 건너뛰고, 응답의
`skippedPrivateStats` 배열에 건너뛴 게임 이름을 모아 돌려준다 — 프론트에서 "이 게임들은
업적 정보가 비공개라 제외됐어요" 같은 안내에 쓰면 된다.

## 다음으로 손볼만한 것들

- **레이트리밋 & 재시도**: Steam Web API가 가끔 429/timeout을 준다. `sync` 라우트에 재시도·
  큐잉을 추가하면 좋다.
- **다중 게임 요약 카드**: 지금 공유 카드는 게임 하나 기준(`/u/:steamId64/:appId.png`)이다.
  "이 유저의 전체 라이브러리에서 가장 자랑스러운 3개"를 보여주는 글로벌 카드도 원하면
  `TrophyPick`에 `appId: null`인 별도 슬롯 세트를 추가하는 식으로 확장하면 된다.
- **public/index.html 다듬기**: 지금은 기능 검증용으로 최소한의 스타일만 입혔다. 아티팩트
  데모(`trophion.html`)의 비스듬한 메달 진열장·트로피 템플릿 비주얼을 그대로 옮기면 실제
  서비스도 같은 룩앤필이 된다.
