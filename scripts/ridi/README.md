# 리디 회차별 댓글 수 수집

리디는 회차 댓글이 **로그인 + 성인 인증 + 소장/대여 상태**에서만 열리고, Cloudflare가
서버(데이터센터 IP)에서의 접근을 차단합니다. 따라서 **사장님 PC의 실제 크롬 창**에서
돌리는 방식입니다. 로그인은 사장님이 직접 1회만 하고, 세션은 `.ridi-profile/` 에
저장되어 이후 실행부터 재사용됩니다. (계정 정보를 파일이나 코드에 적을 일은 없습니다)

## 준비

```bash
cd scripts/ridi
npm init -y
npm i playwright
npx playwright install chromium
```

## 1단계 — 구조 파악 (probe)

```bash
node probe.mjs
```

진행 순서(터미널 안내대로 Enter만 눌러주시면 됩니다):

1. 크롬 창이 뜨면 **리디 로그인 + 성인 인증**
2. 작품별로 검색 결과에서 **작품 상세 페이지**로 이동
3. **회차 하나를 열고 댓글까지 스크롤**

결과는 `out/` 에 저장됩니다.

- `probe-*.json` — 오간 네트워크 요청 (댓글 후보는 응답 본문까지)
- `*-anchors.json` — 작품 페이지의 회차 링크 후보
- `*-book.html`, `*-episode.html` — 페이지 원본

## 2단계 — config.json 채우기

`probe-*-episode.json` 에서 "댓글 후보"로 찍힌 요청을 찾아 아래를 채웁니다.

| 항목 | 의미 |
|---|---|
| `episodeList.hrefPattern` | 회차 링크 URL 정규식 (anchors.json 참고) |
| `commentCount.mode` | 댓글 수가 API 응답에 있으면 `api`, 화면 텍스트에만 있으면 `dom` |
| `commentCount.api.urlPattern` | 댓글 API URL 정규식 |
| `commentCount.api.countPath` | 응답 JSON에서 총 댓글 수 경로 (예: `data.comment.total_count`) |
| `commentCount.dom.selector` | 댓글 수가 표시되는 CSS 선택자 |

`countPath` 는 점 표기법이고, 배열 길이를 세려면 `items#length` 처럼 씁니다.

## 3단계 — 수집 (collect)

```bash
node collect.mjs
```

`out/ridi_episode_comments.csv` 로 저장됩니다 (회차마다 즉시 저장하므로 중간에 끊겨도 결과는 남습니다).

| 작품 | 회차번호 | 회차제목 | 댓글수 | 회차URL | 수집시각 | 비고 |
|---|---|---|---|---|---|---|

요청 간격은 `config.json` 의 `delayMs` (기본 1.5초)로 조절합니다. 차단 방지를 위해 너무 줄이지 마세요.

## 대상 작품

수집할 작품은 `targets.json` 에 지정합니다. 현재 지정된 작품:

- 엘프의 짝짓기
- 내게 빌어봐

작품을 추가/교체하려면 `targets` 배열에 `{ "title": "작품명", "bookUrl": null, "episodes": [] }`
를 넣으면 됩니다. `bookUrl` 을 미리 적어두면 probe 단계에서 검색 없이 바로 이동하고,
probe 를 돌리면 확인된 `bookUrl` 이 자동으로 기록됩니다.

결과는 `out/` 아래 CSV 로만 남습니다.

## 참고

- `RIDI_HEADLESS=1 node collect.mjs` 로 창 없이 돌릴 수 있습니다. 다만 로그인/성인 인증이
  만료되면 창이 있어야 다시 통과할 수 있으니, 평소에는 그냥 `node collect.mjs` 를 권합니다.
- CSV 는 BOM 을 붙여 저장하므로 엑셀에서 바로 열어도 한글이 깨지지 않습니다.
- 회차 댓글은 소장/대여한 회차에서만 열릴 수 있습니다. `비고` 열에 `댓글 API 응답 없음` 이
  반복되면 해당 회차 접근 권한 문제일 가능성이 큽니다.
- 다만 **작품 상세 페이지의 회차 목록 자체에 회차별 댓글 수가 실려 있으면 소장 여부와
  무관하게 전 회차를 긁을 수 있습니다.** probe.mjs 가 작품 페이지 요청도 같이 기록하므로
  (`probe-*-book.json`), 여기에 댓글 수가 들어 있는지부터 확인하는 게 가장 좋습니다.
