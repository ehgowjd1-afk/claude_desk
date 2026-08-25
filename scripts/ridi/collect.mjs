// 리디 회차별 댓글 수집 - 2단계: 실제 수집
//
//   node collect.mjs
//
// probe.mjs 로 확인한 값을 config.json 에 채운 뒤 실행합니다.
// 로그인 세션은 .ridi-profile 에 저장된 것을 재사용합니다.

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)); // 윈도우 경로(C:\...) 대응
const cfg = JSON.parse(fs.readFileSync(path.join(HERE, 'config.json'), 'utf8'));
const targets = JSON.parse(fs.readFileSync(path.join(HERE, 'targets.json'), 'utf8')).targets;

const OUT = path.join(HERE, 'out');
fs.mkdirSync(OUT, { recursive: true });
const csvPath = path.join(HERE, cfg.outputCsv);
fs.mkdirSync(path.dirname(csvPath), { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// "data.comment.total_count", "list.0.count", "items#length" 형태 지원
function pick(obj, dotted) {
  if (!dotted) return null;
  const lengthOf = dotted.endsWith('#length');
  const parts = (lengthOf ? dotted.slice(0, -7) : dotted).split('.').filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return null;
    cur = cur[p];
  }
  if (lengthOf) return Array.isArray(cur) ? cur.length : null;
  return cur ?? null;
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const ctx = await chromium.launchPersistentContext(path.join(HERE, cfg.profileDir), {
  headless: process.env.RIDI_HEADLESS === '1', // 기본은 창을 띄웁니다(로그인/성인인증 갱신 대비)
  viewport: null,
  locale: 'ko-KR',
});
const page = ctx.pages()[0] ?? (await ctx.newPage());

// 회차 목록 수집 --------------------------------------------------------------
async function listEpisodes(t) {
  if (t.episodes?.length > 1) return t.episodes;

  await page.goto(t.bookUrl, { waitUntil: 'domcontentloaded' });
  await sleep(cfg.delayMs);

  const { linkSelector, hrefPattern, titleSelector } = cfg.episodeList;
  const found = await page.evaluate(
    ({ linkSelector, hrefPattern, titleSelector }) => {
      const re = new RegExp(hrefPattern);
      const seen = new Set();
      const out = [];
      for (const a of document.querySelectorAll(linkSelector)) {
        if (!re.test(a.href) || seen.has(a.href)) continue;
        seen.add(a.href);
        const titleEl = titleSelector ? a.querySelector(titleSelector) : null;
        out.push({ url: a.href, title: (titleEl ?? a).innerText.trim().replace(/\s+/g, ' ').slice(0, 80) });
      }
      return out;
    },
    { linkSelector, hrefPattern, titleSelector }
  );

  if (!found.length) {
    throw new Error(
      `[${t.title}] 회차 링크를 못 찾았습니다. config.json 의 episodeList.hrefPattern 을 확인하세요.`
    );
  }
  return found;
}

// 회차 1건의 댓글 수 ----------------------------------------------------------
async function commentCount(url) {
  const mode = cfg.commentCount.mode;

  if (mode === 'api') {
    const re = new RegExp(cfg.commentCount.api.urlPattern);
    const waiter = page
      .waitForResponse((r) => re.test(r.url()) && r.status() < 400, { timeout: 20000 })
      .catch(() => null);

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    // 댓글 영역이 지연 로딩되는 경우가 많아 바닥까지 내립니다
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    const res = await waiter;
    if (!res) return { count: null, note: '댓글 API 응답 없음' };

    let json;
    try {
      json = await res.json();
    } catch {
      return { count: null, note: 'JSON 파싱 실패' };
    }
    const count = pick(json, cfg.commentCount.api.countPath);
    return { count, note: count == null ? 'countPath 불일치' : '' };
  }

  // mode === 'dom'
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
  const { selector, attribute } = cfg.commentCount.dom;
  const el = await page.waitForSelector(selector, { timeout: 20000 }).catch(() => null);
  if (!el) return { count: null, note: '선택자 매칭 실패' };
  const raw = attribute ? await el.getAttribute(attribute) : await el.innerText();
  const num = (raw ?? '').replace(/[^\d]/g, '');
  return { count: num ? Number(num) : null, note: num ? '' : `숫자 추출 실패: ${raw}` };
}

// 실행 ------------------------------------------------------------------------
const rows = [['작품', '회차번호', '회차제목', '댓글수', '회차URL', '수집시각', '비고']];
let ok = 0;
let fail = 0;

try {
  for (const t of targets) {
    if (!t.bookUrl) {
      console.log(`[건너뜀] ${t.title}: targets.json 에 bookUrl 이 없습니다. probe.mjs 를 먼저 돌리세요.`);
      continue;
    }

    const episodes = await listEpisodes(t);
    console.log(`\n===== ${t.title} : 회차 ${episodes.length}건 =====`);

    for (const [i, ep] of episodes.entries()) {
      const url = typeof ep === 'string' ? ep : ep.url;
      const title = typeof ep === 'string' ? '' : ep.title;
      let r;
      try {
        r = await commentCount(url);
      } catch (e) {
        r = { count: null, note: e.message.slice(0, 80) };
      }
      r.count == null ? fail++ : ok++;
      rows.push([t.title, i + 1, title, r.count ?? '', url, new Date().toISOString(), r.note]);
      console.log(`  ${String(i + 1).padStart(3)}화  댓글 ${String(r.count ?? '-').padStart(5)}  ${r.note}`);

      // 저장은 매 회차마다 (중간에 끊겨도 결과 보존)
      // 윈도우 엑셀 기준: BOM + CRLF
      fs.writeFileSync(csvPath, '﻿' + rows.map((row) => row.map(csvEscape).join(',')).join('\r\n'));
      await sleep(cfg.delayMs);
    }
  }
} finally {
  await ctx.close();
}

console.log(`\n완료: 성공 ${ok}건 / 실패 ${fail}건`);
console.log(`CSV: ${csvPath}`);
