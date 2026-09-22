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
3. **PostgreSQL** — `prisma/schema.prisma`의 기본 provider가 `postgresql`이다(Railway 등 실제
   배포용). `DATABASE_URL`을 `postgresql://...` 연결 문자열로 채우면 된다. 로컬에서 Postgres
   없이 SQLite로 빠르게 돌리고 싶으면 `datasource.provider`를 `"sqlite"`로 바꾸고
   `DATABASE_URL=file:./dev.db`처럼 설정한 뒤 아래 명령을 그대로 쓰면 된다.

## 시작하기

```bash
cd trophion-server
npm install
cp .env.example .env
# .env 열어서 STEAM_API_KEY, SESSION_SECRET, DATABASE_URL(postgresql://...) 채우기

npx prisma db push        # 지금 스키마 그대로 DB에 테이블 생성/동기화 (마이그레이션 파일 없이)
npm run dev                # http://localhost:3000
```

로컬에서 마이그레이션 히스토리를 남기고 싶다면 `npx prisma migrate dev --name init`을 대신
써도 된다(이 저장소엔 아직 `prisma/migrations` 폴더가 없다 — 최초 1회는 이 명령으로 만들면 됨).

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

## 다국어(i18n) — 로그인한 Steam 유저 언어 / IP 지역 자동 감지

`public/index.html`의 모든 UI 문구는 `I18N = { ko, en, ja }` 딕셔너리 + `t(key)` 헬퍼로 통일
되어 있다. 언어 결정 순서:

1. **로그인 후** → Steam 로그인 콜백(`/auth/steam/callback`)에서 `GetPlayerSummaries`가 주는
   `loccountrycode`(예: `KR`, `JP`, `US`)를 `User.locCountryCode`에 저장 → `GET /auth/me`가
   `locale: localeFromCountry(user.locCountryCode)`를 함께 내려준다.
2. **로그인 전(게이트 화면)** → Steam 국가 정보가 아직 없으므로, 서버가 접속 IP를
   `geoip-lite`(오프라인 DB, 런타임에 외부 호출 없음)로 조회해서 `GET /api/locale`이
   `{ locale, country }`를 내려준다. Railway 같은 프록시 뒤 환경을 고려해 `X-Forwarded-For`를
   우선 본다.
3. 국가 코드 → 언어 매핑은 `src/locale.js`의 `COUNTRY_TO_LOCALE`(`KR→ko`, `JP→ja`, 그 외 `en`)
   하나로 관리되며, 같은 파일의 `steamLangForLocale()`이 Steam Web API 호출용 언어 코드
   (`koreana`/`japanese`/`english`)로도 변환해준다 — 그래서 업적 이름/설명 자체도
   `GetPlayerAchievements`/`GetSchemaForGame` 호출 시 유저 언어로 받아온다
   (`src/steamApi.js`의 `lang` 파라미터, `src/routes/games.js`의 `sync`에서 사용).

**스키마 변경**: `User.locCountryCode String?` 컬럼이 추가됐다. 이 저장소는 아직
`prisma/migrations` 폴더 없이 스키마 파일만으로 관리하고 있어서, `start` 스크립트가
`prisma db push --accept-data-loss --skip-generate && node src/index.js`로 바뀌어 있다 —
배포될 때마다 현재 `schema.prisma` 상태를 Postgres에 그대로 동기화(부족한 컬럼/테이블 추가)한
뒤 서버를 띄운다. 즉 Railway에 push만 하면 컬럼 추가가 자동 반영되고, 별도로 마이그레이션
명령을 손으로 돌릴 필요가 없다. `package.json`에 `geoip-lite` 의존성도 새로 추가됐으니 배포
시 재설치(`npm install`)가 자동으로 한 번 더 일어난다.
나중에 마이그레이션 히스토리(변경 이력 추적)가 필요해지면 `npx prisma migrate dev --name init`
으로 첫 마이그레이션을 만들고, `start` 스크립트를 `prisma migrate deploy && node src/index.js`
로 바꾸는 걸 추천한다 — `db push`는 빠르고 간단하지만 이력을 안 남긴다.

## 최근 반영된 UI 수정 (실사이트 ↔ 아티팩트 데모 최종 정합)

- Steam 안내 문구("Steam 프로필/게임 세부정보가 공개로 설정되어 있어야...")가 정확히 2줄로
  고정 렌더링되도록 마크업을 `<div>` 두 개 + `white-space:nowrap`으로 재구성.
- "이미지로 공유" 버튼 → 실제로 동작하는 **"이미지 다운로드"** 버튼으로 교체. 서버가 이미
  갖고 있던 `/u/:steamId64/:appId.png`(공유 카드 PNG 렌더러, `src/shareCard.js`)를 그대로
  재사용해서 `<a download>` 클릭을 합성하는 방식이라 별도 클라이언트 캔버스 로직이 없다.
- 트로피 템플릿 우측 상단의 "TROPHY TEMPLATE" 텍스트 → 헤더 좌측과 동일한 TROPHION
  브랜드 마크 SVG + 워드마크(`.brand-mini`)로 교체.
- 금/은/동 시상대를 원형 메달 → **트로피 컵 모양**으로 교체 (`bigTrophySvg()`, 프론트/서버
  양쪽 다 동일한 모양: `src/shareCard.js`의 `drawTrophy()`가 다운로드 PNG에서도 같은 컵을
  그린다). 획득 업적 랙(rack)의 작은 메달은 기존 원형 유지.
- 템플릿 하단의 "X/3 자리 채움" 문구 제거 — 다운로드 버튼만 남김.
- 사이드바 게임 커버 이미지가 없는 항목(삭제/미출시 게임 등 Steam CDN에 `header.jpg`가 없는
  경우)은 빈 박스 대신 게임 이름 첫 글자 + 해시 기반 그라데이션 배경의 대체 박스로 표시
  (`hashHue`/`onCoverError`/`wireCoverFallbacks`).
- 우측 상단 유저네임 버튼 클릭 시 바로 로그아웃되던 것 → "로그아웃 하시겠습니까?"
  확인 모달("예"/"아니오") 경유하도록 변경.

## 다음으로 손볼만한 것들

- **레이트리밋 & 재시도**: Steam Web API가 가끔 429/timeout을 준다. `sync` 라우트에 재시도·
  큐잉을 추가하면 좋다.
- **다중 게임 요약 카드**: 지금 공유 카드는 게임 하나 기준(`/u/:steamId64/:appId.png`)이다.
  "이 유저의 전체 라이브러리에서 가장 자랑스러운 3개"를 보여주는 글로벌 카드도 원하면
  `TrophyPick`에 `appId: null`인 별도 슬롯 세트를 추가하는 식으로 확장하면 된다.
- **업적 아이콘 실사용**: 랙/그리드는 여전히 테마별 SVG 글리프(칼/불꽃/해골 등)를 쓴다.
  `AchievementCache.iconUrl`에 이미 Steam 실제 아이콘 URL이 저장되고 있으니, 프론트에서
  `<img>`로 바로 붙이는 것도 어렵지 않다.
