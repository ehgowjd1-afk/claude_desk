/* 리디 회차 댓글 수집 - 1단계: 구조 파악
 *
 * 사용법
 *  1) 크롬에서 리디 로그인 상태로, 수집할 작품의 "회차 하나"를 엽니다.
 *  2) F12 → Console 탭.
 *  3) 붙여넣기가 막히면 콘솔에 allow pasting 을 먼저 입력하고 Enter.
 *  4) 이 파일 내용을 통째로 붙여넣고 Enter.
 *  5) 안내가 뜨면 30초 동안 페이지를 아래로 쭉 스크롤해서 댓글이 화면에 보이게 합니다.
 *  6) 끝나면 ridi-probe.json 파일이 자동으로 다운로드됩니다. 그 파일을 저에게 주세요.
 */
(() => {
  const 관찰시간 = 30000;
  const 관심 = /comment|reply|feed|talk|review|episode|count|notion/i;
  const 결과 = {
    주소: location.href,
    제목: document.title,
    시각: new Date().toISOString(),
    링크: [],
    댓글후보텍스트: [],
    네트워크: [],
  };

  // --- 1. 네트워크 후킹 -------------------------------------------------
  const 원래fetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await 원래fetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
      if (url && 관심.test(url)) {
        const 사본 = res.clone();
        사본.text().then((t) => {
          결과.네트워크.push({ 방식: 'fetch', url, 상태: res.status, 본문: t.slice(0, 8000) });
        }).catch(() => {});
      }
    } catch {}
    return res;
  };

  const 원래open = XMLHttpRequest.prototype.open;
  const 원래send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u, ...r) {
    this.__url = u;
    return 원래open.call(this, m, u, ...r);
  };
  XMLHttpRequest.prototype.send = function (...a) {
    this.addEventListener('load', () => {
      try {
        if (this.__url && 관심.test(this.__url)) {
          결과.네트워크.push({
            방식: 'xhr',
            url: this.__url,
            상태: this.status,
            본문: String(this.responseText || '').slice(0, 8000),
          });
        }
      } catch {}
    });
    return 원래send.apply(this, a);
  };

  // 이미 끝난 요청도 성능 기록에서 회수 (본문은 없지만 URL 패턴 파악용)
  try {
    performance.getEntriesByType('resource').forEach((e) => {
      if (관심.test(e.name)) 결과.네트워크.push({ 방식: '기록', url: e.name, 상태: null, 본문: null });
    });
  } catch {}

  // --- 2. 페이지 안의 회차 링크 -----------------------------------------
  const 본다 = () => {
    const 봄 = new Set();
    결과.링크 = [...document.querySelectorAll('a[href]')]
      .map((a) => ({ href: a.href, 글: (a.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40) }))
      .filter((a) => /\/books\/\d+|\/viewer|episode/i.test(a.href) && !봄.has(a.href) && 봄.add(a.href))
      .slice(0, 500);

    // '댓글' 이라는 글자 주변의 숫자 = 화면에 이미 댓글 수가 있는지 확인
    결과.댓글후보텍스트 = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = (n.nodeValue || '').trim();
      if (!t || t.length > 60) continue;
      if (/댓글|덧글|코멘트|comment/i.test(t)) {
        const el = n.parentElement;
        결과.댓글후보텍스트.push({
          글: t.slice(0, 60),
          부모글: (el?.parentElement?.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 120),
          선택자: el ? (el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).trim().split(/\s+/).join('.') : '')).slice(0, 120) : null,
        });
      }
      if (결과.댓글후보텍스트.length >= 40) break;
    }
  };

  // --- 3. 마무리 ---------------------------------------------------------
  const 마무리 = () => {
    본다();
    window.fetch = 원래fetch;
    XMLHttpRequest.prototype.open = 원래open;
    XMLHttpRequest.prototype.send = 원래send;

    const json = JSON.stringify(결과, null, 2);
    console.log('%c[리디 탐색] 수집 완료', 'font-size:14px;font-weight:bold;color:#0b5');
    console.log(`  회차 링크 ${결과.링크.length}건 / 댓글 후보 텍스트 ${결과.댓글후보텍스트.length}건 / 네트워크 ${결과.네트워크.length}건`);
    console.table(결과.네트워크.map((n) => ({ 방식: n.방식, 상태: n.상태, url: String(n.url).slice(0, 120) })));
    window.리디탐색결과 = 결과;

    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      a.download = 'ridi-probe.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      console.log('  → ridi-probe.json 다운로드됨. 이 파일을 그대로 주시면 됩니다.');
    } catch (e) {
      console.log('  → 자동 다운로드 실패. 아래 copy(...) 를 실행해 클립보드로 복사하세요:');
      console.log('     copy(JSON.stringify(리디탐색결과))');
    }
    return 결과;
  };

  본다();
  console.log('%c[리디 탐색] 지금부터 30초간 기록합니다.', 'font-size:14px;font-weight:bold;color:#07c');
  console.log('  → 페이지를 아래로 쭉 스크롤해서 "댓글"이 화면에 보이게 해주세요.');
  let 남음 = 관찰시간 / 1000;
  const 타이머 = setInterval(() => {
    남음 -= 5;
    if (남음 > 0) console.log(`  ...${남음}초 남음`);
  }, 5000);
  setTimeout(() => {
    clearInterval(타이머);
    마무리();
  }, 관찰시간);

  window.리디탐색끝내기 = () => {
    clearInterval(타이머);
    return 마무리();
  };
  console.log('  (기다리기 싫으면 리디탐색끝내기() 를 입력하면 즉시 마무리됩니다)');
})();
