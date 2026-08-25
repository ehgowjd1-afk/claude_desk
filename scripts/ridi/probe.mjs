// 리디 회차별 댓글 수집 - 1단계: 구조 파악용 탐색 스크립트
//
// 크롬 창을 띄우고, 사장님이 직접 로그인/성인인증 → 회차 뷰어를 여는 동안
// 오가는 네트워크 요청을 전부 기록해서 out/ 에 저장합니다.
// 이 결과를 보고 config.json 의 TODO 를 채운 뒤 collect.mjs 로 실제 수집을 합니다.
//
//   npm i playwright && npx playwright install chromium
//   node probe.mjs

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const cfg = JSON.parse(fs.readFileSync(path.join(HERE, 'config.json'), 'utf8'));
const targets = JSON.parse(fs.readFileSync(path.join(HERE, 'targets.json'), 'utf8')).targets;
const OUT = path.join(HERE, 'out');
fs.mkdirSync(OUT, { recursive: true });

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const wait = (msg) => rl.question(`\n>>> ${msg}\n    (준비되면 Enter) `);
const slug = (s) => s.replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40);

// 댓글 관련일 가능성이 높은 요청만 본문까지 저장
const INTERESTING = /comment|reply|feed|talk|review|episode|notion|viewer|count/i;

const netLog = [];
let marker = 0;

function attach(page) {
  page.on('response', async (res) => {
    const url = res.url();
    const ct = res.headers()['content-type'] || '';
    if (url.startsWith('data:') || /\.(png|jpe?g|webp|gif|svg|woff2?|css|ico)(\?|$)/i.test(url)) return;

    const entry = {
      seq: netLog.length,
      time: new Date().toISOString(),
      method: res.request().method(),
      status: res.status(),
      url,
      contentType: ct,
      resourceType: res.request().resourceType(),
      postData: res.request().postData()?.slice(0, 2000) ?? null,
      body: null,
    };

    if (INTERESTING.test(url) && /json|text/.test(ct)) {
      try {
        entry.body = (await res.text()).slice(0, 20000);
      } catch {
        entry.body = '(본문 읽기 실패)';
      }
    }
    netLog.push(entry);
  });
}

function dump(name) {
  const slice = netLog.slice(marker);
  marker = netLog.length;
  const file = path.join(OUT, `probe-${name}.json`);
  fs.writeFileSync(file, JSON.stringify(slice, null, 2));

  const hits = slice.filter((e) => INTERESTING.test(e.url) && e.body);
  console.log(`\n  [저장] ${path.relative(HERE, file)}  (요청 ${slice.length}건, 댓글 후보 ${hits.length}건)`);
  for (const h of hits.slice(0, 15)) {
    console.log(`    - ${h.status} ${h.method} ${h.url.slice(0, 130)}`);
  }
  return file;
}

async function anchors(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('a[href]')]
      .map((a) => ({ href: a.href, text: (a.innerText || '').trim().slice(0, 40) }))
      .filter((a) => /\/books\/\d+|\/viewer\//.test(a.href))
      .slice(0, 400)
  );
}

const ctx = await chromium.launchPersistentContext(path.join(HERE, cfg.profileDir), {
  headless: false,
  viewport: null,
  locale: 'ko-KR',
  args: ['--start-maximized'],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
attach(page);
ctx.on('page', attach); // 새 탭/팝업도 기록

try {
  await page.goto('https://ridibooks.com/', { waitUntil: 'domcontentloaded' });
  await wait('열린 크롬 창에서 리디 로그인 + 성인 인증을 마쳐주세요. (프로필이 저장되므로 다음 실행부터는 생략됩니다)');
  marker = netLog.length;

  for (const t of targets) {
    console.log(`\n===== ${t.title} =====`);

    if (t.bookUrl) {
      await page.goto(t.bookUrl, { waitUntil: 'domcontentloaded' });
    } else {
      await page.goto(`https://ridibooks.com/search?q=${encodeURIComponent(t.title)}`, {
        waitUntil: 'domcontentloaded',
      });
      await wait(`"${t.title}" 작품 상세 페이지로 직접 이동해주세요 (검색 결과에서 클릭).`);
    }

    const bookUrl = page.url();
    t.bookUrl = bookUrl;
    console.log(`  작품 URL: ${bookUrl}`);

    fs.writeFileSync(path.join(OUT, `${slug(t.title)}-book.html`), await page.content());

    const list = await anchors(page);
    fs.writeFileSync(path.join(OUT, `${slug(t.title)}-anchors.json`), JSON.stringify(list, null, 2));
    console.log(`  회차 후보 링크 ${list.length}건 → ${slug(t.title)}-anchors.json`);
    for (const a of list.slice(0, 5)) console.log(`    - ${a.text} | ${a.href.slice(0, 110)}`);

    dump(`${slug(t.title)}-book`);

    await wait('이 작품의 회차 하나를 열어서 뷰어 맨 아래 댓글까지 스크롤해주세요. (댓글이 화면에 보여야 요청이 잡힙니다)');
    fs.writeFileSync(path.join(OUT, `${slug(t.title)}-episode.html`), await page.content());
    console.log(`  회차 URL: ${page.url()}`);
    t.episodes = [page.url()];
    dump(`${slug(t.title)}-episode`);
  }

  fs.writeFileSync(
    path.join(HERE, 'targets.json'),
    JSON.stringify({ targets }, null, 2) + '\n'
  );
  fs.writeFileSync(path.join(OUT, 'probe-all.json'), JSON.stringify(netLog, null, 2));
  console.log('\n완료. out/ 폴더의 probe-*.json 을 확인해주세요.');
  console.log('가장 중요한 건 "댓글 후보"로 찍힌 요청의 URL 과 응답 JSON 입니다.');
} finally {
  rl.close();
  await ctx.close();
}
