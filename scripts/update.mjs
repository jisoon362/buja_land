// 매일 실행(전부 무료): RSS 수집 → Gemini 무료 키로 요약·개념·퀴즈 생성 → 키가 없거나 실패하면 내장 개념은행(concepts.json) 사용
// 영상은 API 없이 유튜브 검색 링크로 연결. Node 20+. 선택 환경변수: GEMINI_API_KEY
import { writeFileSync, readFileSync } from 'node:fs';
const BANK = JSON.parse(readFileSync(new URL('./concepts.json', import.meta.url), 'utf8'));
const TODAY = new Date().toISOString().slice(0, 10);
// 최근 며칠간 쓴 키워드는 피해서 매일 다른 개념이 나오게 한다 (오늘 기록은 재실행 시 새로 쓰므로 무시)
let HISTORY = {};
try { HISTORY = JSON.parse(readFileSync('data/news.json', 'utf8')).history || {}; } catch {}
for (const k of Object.keys(HISTORY)) if (HISTORY[k] >= TODAY || (Date.parse(TODAY) - Date.parse(HISTORY[k])) / 864e5 > 14) delete HISTORY[k];
const USED_TODAY = new Set();
const recentTerms = () => Object.keys(HISTORY);

const FEEDS = [
  { source: '한국경제', url: 'https://www.hankyung.com/feed/economy' },
  { source: '매일경제', url: 'https://www.mk.co.kr/rss/30100041/' },
  { source: '구글뉴스 경제', url: 'https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=ko&gl=KR&ceid=KR:ko' },
];
const COUNT = Number(process.env.ARTICLE_COUNT || 6);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const UA = { 'user-agent': 'Mozilla/5.0 (compatible; BujaBujaBot/1.0)' };

const dec = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
// 엔티티로 이스케이프된 HTML(구글뉴스 등)도 태그를 먼저 풀고 제거한다
const unesc = s => dec(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (x, t) => (x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1] || '';

async function getText(url){
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(url + ' ' + r.status);
  return r.text();
}

async function readFeed({ source, url }){
  try {
    const xml = await getText(url);
    return [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g)].slice(0, 12).map(m => {
      const it = m[0];
      return { source, title: unesc(tag(it, 'title')).replace(/\s-\s[^-]+$/, ''), link: unesc(tag(it, 'link')),
        pubDate: new Date(unesc(tag(it, 'pubDate')) || Date.now()).toISOString(), desc: url.includes('news.google.com') ? '' : unesc(tag(it, 'description')) };
    }).filter(a => a.title && a.link);
  } catch (e) { console.warn('피드 실패', source, e.message); return []; }
}

// 기사 페이지의 og:description(도입부)만 가져온다 — 본문 전체는 저장하지 않음
async function leadOf(a){
  if (a.link.includes('news.google.com')) return ''; // 구글뉴스 링크는 중간 이동 페이지라 도입부를 못 가져옴
  try {
    const html = await getText(a.link);
    const og = (html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) || [])[1];
    return unesc(og || a.desc || '');
  } catch { return a.desc || ''; }
}

const ECON = /경제|금리|환율|주가|증시|코스피|코스닥|물가|부동산|대출|수출|반도체|기업|투자|예산|세금|관세|무역|성장|은행|채권|달러|원화|상장|IPO|AI/;
// ── 경제 기사만 남기기: 경제 키워드 점수(제목 3점·도입부 1점) 2점 이상 + 비경제 키워드가 제목에 없을 것 ──
const ECON_KW = /경제|금리|환율|주가|증시|코스피|코스닥|물가|부동산|대출|수출|수입|반도체|투자|예산|세금|세제|관세|무역|성장률|은행|채권|국채|달러|원화|상장|IPO|공모|실적|영업이익|매출|시총|시가총액|GDP|인플레|한국은행|금융|펀드|ETF|연금|재정|적자|흑자|유가|원자재|증권|자산|가계부채|주택|전세|월세|분양|고용|실업|임금|내수|배당|인수|합병|구조조정|기업|산업|공급망|기준금리|삼성전자|SK하이닉스|엔비디아|테슬라|비트코인|가상자산/g;
const NOT_KW = /연예|배우|가수|아이돌|드라마|예능|건강!톡|건강톡|맛집|먹방|관광객|여행|야구|축구|골프|농구|배구|올림픽|월드컵|날씨|살인|체포|열애|결혼|이혼|운세|사건사고|다이어트|화재|교통사고|마운드|투수|타자|홈런|감독|리그|우승|득점|골키퍼|선수단/;
const econScore = t => (String(t || '').match(ECON_KW) || []).length;
const isEcon = a => !NOT_KW.test(a.title) && (econScore(a.title) * 3 + econScore(a.desc || a.lead || '')) >= 2;

async function gemini(article){
  const avoid = [...recentTerms(), ...USED_TODAY].join(', ');
  const key = process.env.GEMINI_API_KEY; if (!key) return null;
  const prompt = `당신은 사회초년생에게 경제를 가르치는 친절한 선생님입니다. 아래 한국 경제기사 정보로 학습 콘텐츠를 JSON으로만 만드세요(설명·코드블록 금지).
제목: ${article.title}
도입부: ${article.lead}

스키마:
{"question":"이 이슈를 한 줄 질문으로(예: 왜 ~했을까?)",
 "summary":["쉬운 말 '~해요'체 요약 4~5개, 마지막은 핵심 질문/시사점"],
 "concept":{"term":"오늘의 경제개념 1개(기초 용어보다 이 기사를 읽는 데 꼭 필요한 중급·심화 개념 위주)","level":2,"explain":"4~5문장, 원리와 한계까지","example":"숫자가 들어간 일상 예시 1문장","lens":"이 개념으로 뉴스를 읽는 법 1문장","note":["노트에 적을 핵심 3~4줄(공식·인과관계 포함)"]},
 "miniQuiz":{"q":"짧은 계산 또는 적용 문제","choices":["","","",""],"answer":0,"explain":""},
 "quiz":[{"q":"숫자 계산 또는 사례 적용 문제","choices":["","","",""],"answer":0,"explain":""},{"q":"원인·결과를 묻는 사례형 문제","choices":["","","",""],"answer":0,"explain":""},
         {"type":"order","q":"과정을 순서대로 나열하세요(순서가 있는 개념일 때만, 아니면 객관식으로 대체)","items":["1단계","2단계","3단계"],"explain":""}],
 "searchQuery":"유튜브에서 이 주제를 찾을 검색어"}
정답 위치는 골고루 섞고, 오답은 그럴듯하게 만드세요. 퀴즈는 단순 암기가 아니라 약간 어려운 사례·계산·인과 문제로 내세요. 최근에 쓴 개념은 피하세요: ${avoid}. 기사에 없는 사실은 지어내지 말고 개념 중심으로 쓰세요. answer는 0부터 시작하는 정답 인덱스입니다.`;
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`, {
      method: 'POST', signal: AbortSignal.timeout(90000), headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.4 } }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(JSON.stringify(j.error || j).slice(0, 200));
    const t = j.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const out = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
    if (!out.summary?.length || !out.concept || !out.quiz?.length) throw new Error('응답 형식 불량');
    USED_TODAY.add(out.concept.term); HISTORY[out.concept.term] = TODAY;
    return out;
  } catch (e) { console.warn('Gemini 실패 → 내장 개념은행 사용:', e.message); return null; }
}

// API 없이: 기사와 가장 잘 맞는 개념을 고르되, 오늘 이미 쓴 개념·최근 며칠간 쓴 개념은 피한다
function pickConcept(a){
  const text = a.title + ' ' + a.lead;
  const score = c => c.keys.reduce((n, k) => n + (a.title.includes(k) ? 3 : 0) + (text.includes(k) ? (k.length >= 3 ? 2 : 1) : 0), 0);
  const hash = [...a.title].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const rank = list => list.map((c, i) => ({ c, s: score(c), t: (hash + i * 7919) % 997 })).sort((x, y) => y.s - x.s || x.t - y.t);
  const open = BANK.filter(c => !USED_TODAY.has(c.term));
  const related = rank(open).filter(x => x.s > 0);
  // 1순위: 기사와 관련 있고 최근에 안 쓴 개념 → 2순위: 관련 있지만 최근에 쓴 것 중 가장 오래전에 쓴 개념 → 3순위: 안 쓴 개념 중 아무거나
  const relFresh = related.filter(x => !HISTORY[x.c.term]);
  const relOld = related.filter(x => HISTORY[x.c.term]).sort((x, y) => HISTORY[x.c.term].localeCompare(HISTORY[y.c.term]) || y.s - x.s);
  const anyFresh = rank(open.filter(c => !HISTORY[c.term]));
  const best = (relFresh[0] || relOld[0] || anyFresh[0] || rank(open.length ? open : BANK)[0]).c;
  USED_TODAY.add(best.term); HISTORY[best.term] = TODAY;
  return best;
}
function fromBank(a){
  const c = pickConcept(a);
  const sents = (a.lead.match(/[^.!?。]+[.!?。]?/g) || []).map(x => x.trim()).filter(x => x.length > 8).slice(0, 3);
  const lv = ['기초', '중급', '심화'][(c.level || 2) - 1];
  // 어려운 순서 문제가 있으면 우선, 나머지는 섞어 3문항
  const order = c.quiz.filter(q => q.type === 'order'), rest = c.quiz.filter(q => q.type !== 'order');
  const quiz = [...order, ...rest].slice(0, 3);
  return { question: a.title.replace(/[.?!]$/, '') + ' — 무슨 일일까?',
    summary: [...sents, `📌 오늘의 키워드는 “${c.term}” (${lv})예요.`, c.lens],
    concept: { term: c.term, level: c.level || 2, explain: c.explain, example: c.example, lens: c.lens, note: c.note },
    miniQuiz: c.miniQuiz, quiz, searchQuery: c.term + ' 쉽게 설명' };
}


// ── 네이버 뉴스 경제 섹션 (공식 RSS가 없어 페이지에서 직접 읽음, 실패하면 건너뜀) ──
const meta = (html, p) => unesc((html.match(new RegExp(`<meta[^>]+property=["']${p}["'][^>]+content=["']([^"']*)["']`, 'i')) || [])[1] || '');
async function naverEconomy(){
  try {
    const html = await getText('https://news.naver.com/section/101');
    const links = [...new Set(html.match(/https:\/\/n\.news\.naver\.com\/mnews\/article\/\d+\/\d+/g) || [])].slice(0, 8);
    const out = [];
    for (const link of links){
      try {
        const page = await getText(link);
        const title = meta(page, 'og:title'); if (!title) continue;
        out.push({ source: (meta(page, 'og:article:author') || '네이버뉴스').split('|')[0].trim(), title, link,
          pubDate: new Date(meta(page, 'article:published_time') || Date.now()).toISOString(), desc: meta(page, 'og:description') });
      } catch {}
    }
    return out;
  } catch (e) { console.warn('네이버 실패', e.message); return []; }
}

// ── 유튜브 영상: API 키 없이 검색 결과 페이지에서 영상 ID 추출 (실패하면 빈 목록 → 검색 링크만 표시) ──
const koNum = t => {  // "조회수 1.2만회" / "조회수 3,456회" → 숫자
  const m = String(t || '').replace(/,/g, '').match(/([\d.]+)\s*(억|만|천)?/); if (!m) return 0;
  return Math.round(parseFloat(m[1]) * ({ 억: 1e8, 만: 1e4, 천: 1e3 }[m[2]] || 1));
};
async function youtubeSearch(q){
  try {
    const r = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&hl=ko&gl=KR`,
      { headers: { ...UA, 'accept-language': 'ko-KR,ko;q=0.9' }, signal: AbortSignal.timeout(15000) });
    const html = await r.text(); const seenId = new Set(); const found = [];
    const starts = [...html.matchAll(/"videoRenderer":\{"videoId":"([\w-]{11})"/g)];
    starts.forEach((m, k) => {
      if (seenId.has(m[1])) return; seenId.add(m[1]);
      const seg = html.slice(m.index, starts[k + 1]?.index ?? m.index + 9000);   // 이 영상 블록만 잘라서 읽음
      const title = (seg.match(/"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/) || [])[1];
      const channel = (seg.match(/"ownerText":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/) || [])[1];
      const pt = (seg.match(/"publishedTimeText":\{"simpleText":"((?:[^"\\]|\\.)*)"/) || [])[1] || '';   // 게시일("3일 전" 형태)
      const dur = (seg.match(/"lengthText":\{.{0,500}?"simpleText":"([\d:]+)"/s) || [])[1] || '';
      const vt = (seg.match(/"viewCountText":\{"simpleText":"((?:[^"\\]|\\.)*)"/) || [])[1] || '';
      if (title) found.push({ id: m[1], title: JSON.parse(`"${title}"`), channel: channel ? JSON.parse(`"${channel}"`) : '',
        views: /시청 중/.test(vt) ? 0 : koNum(JSON.parse(`"${vt}"`)), viewsText: vt ? JSON.parse(`"${vt}"`) : '', published: pt ? JSON.parse(`"${pt}"`) : '', duration: dur });
    });
    // 관련도 상위 12개 후보를 조회수 많은 순으로 정렬해 3개 선택
    return found.slice(0, 12).sort((x, y) => y.views - x.views).slice(0, 3);
  } catch (e) { console.warn('유튜브 실패', e.message); return []; }
}

// ── 네이버 '많이 본 뉴스'(조회수 순) 경제 랭킹 — 구조가 달라 실패하면 건너뛰고 최신순으로 대체 ──
const RANK_URLS = [
  'https://news.naver.com/main/ranking/popularDay.naver?sectionId=101',
  'https://news.naver.com/main/ranking/popularDay.naver?mid=etc&sid1=111',
  'https://news.naver.com/section/101',
];
async function naverRanking(){
  for (const url of RANK_URLS){
    try {
      const html = await getText(url);
      const links = []; const seenL = new Set();
      for (const m of html.matchAll(/(?:https:\/\/n\.news\.naver\.com)?\/(?:mnews\/)?article\/(\d{3})\/(\d{6,})/g)){
        const link = `https://n.news.naver.com/article/${m[1]}/${m[2]}`;
        if (!seenL.has(link)){ seenL.add(link); links.push(link); }
      }
      if (links.length < 3) continue;
      const out = [];
      for (const link of links.slice(0, COUNT + 12)){
        try {
          const page = await getText(link);
          const title = meta(page, 'og:title'); if (!title) continue;
          out.push({ source: (meta(page, 'og:article:author') || '네이버뉴스').split('|')[0].trim(), title, link, rank: out.length + 1,
            pubDate: new Date(meta(page, 'article:published_time') || Date.now()).toISOString(), desc: meta(page, 'og:description') });
        } catch {}
      }
      if (out.length >= 3){ console.log('네이버 랭킹 사용:', url, `(후보 ${out.length}건, 경제 기사만 선별)`); return out; }
    } catch (e) { console.warn('네이버 랭킹 실패', url, e.message); }
  }
  return [];
}

const ranked = await naverRanking();
const feeds = [...(await Promise.all(FEEDS.map(readFeed))).flat(), ...(await naverEconomy())];
ranked.filter(isEcon).sort((x, y) => x.rank - y.rank).forEach((a, i) => { a.rank = i + 1; }); // 경제 기사끼리 조회수 순위를 1위부터 다시 매김
const seen = new Set(); const picks = [];
const PREF = /매일경제|한국경제|서울경제|머니투데이|이데일리|파이낸셜뉴스|아시아경제|헤럴드경제|아주경제|조선비즈/; // 대표 경제지는 먼저, 부족하면 다른 언론사 경제 기사로 채움
const isPref = x => (PREF.test(x.source) ? 0 : 1);
const isG = x => (x.link.includes('news.google.com') ? 1 : 0);
for (const a of [...ranked, ...feeds].filter(isEcon).sort((x, y) => isPref(x) - isPref(y) || (x.rank ? x.rank : 999) - (y.rank ? y.rank : 999) || isG(x) - isG(y) || (ECON.test(y.title) ? 1 : 0) - (ECON.test(x.title) ? 1 : 0) || +new Date(y.pubDate) - +new Date(x.pubDate))){
  const k = a.title.slice(0, 18); if (seen.has(k)) continue; seen.add(k); picks.push(a); if (picks.length >= COUNT) break;
}
if (!picks.length){ console.error('수집된 기사가 없어 기존 데이터를 유지합니다.'); process.exit(0); }

const articles = [];
for (const [i, a] of picks.entries()){
  const lead = await leadOf(a);
  if (process.env.GEMINI_API_KEY && i) await sleep(7000);
  const ai = (await gemini({ title: a.title, lead })) || fromBank({ title: a.title, lead });
  const base = { id: `${new Date().toISOString().slice(0, 10)}-${i + 1}`, title: a.title, source: a.source, link: a.link, pubDate: a.pubDate, lead, rank: a.rank || null,
    question: ai?.question || '', summary: ai?.summary?.length ? ai.summary : [lead || a.title],
    concept: ai?.concept || null, miniQuiz: ai?.miniQuiz || null, quiz: ai?.quiz || [], searchQuery: ai?.searchQuery || a.title };
  base.videos = await youtubeSearch(base.searchQuery);
  base.searchQueries = [base.searchQuery, a.title + ' 해설'];
  articles.push(base);
  console.log('✔', base.title);
}

// ── 증시 탭: 증권 섹션 기사를 모아 종류별로 분류 (학습·AI 호출 없이 도입부만 저장) ──
const STOCK_FEEDS = [
  { source: '한국경제', url: 'https://www.hankyung.com/feed/finance' },
  { source: '매일경제', url: 'https://www.mk.co.kr/rss/50200011/' },
];
const STOCK_KW = /증시|코스피|코스닥|주가|주식|종목|상장|공모|IPO|배당|시총|시가총액|외국인|기관|개인|순매수|순매도|공매도|ETF|증권|실적|영업이익|목표주가|리포트|나스닥|다우|S&P|뉴욕증시|환율|금리|반도체|2차전지|바이오|테마/;
const STOCK_NOT = /연예|배우|가수|아이돌|드라마|예능|맛집|야구|축구|골프|농구|배구|운세|사건사고|화재|교통사고|부고|인사|부음/;
// 기사 종류: 믿고 볼 것(시황·실적·공시) / 참고(리포트·해외·업종) / 주의(급등·테마·추천 같은 자극적 제목)
const stockKind = t =>
  /급등|급락|상한가|하한가|테마주|추천|대박|폭등|폭락|줍줍|수혜주|\d+배|올라탈|지금\s*사/.test(t) ? { k: 'warn', label: '⚠️ 주의 기사' }
  : /마감|장중|개장|출발|시황|코스피|코스닥|마켓|뉴욕증시|나스닥|다우|S&P/.test(t) ? { k: 'market', label: '📊 시황' }
  : /실적|영업이익|영업익|매출|분기|공시|잠정|흑자|적자|배당|자사주|유상증자|무상증자|상장|IPO|공모/.test(t) ? { k: 'earn', label: '🏢 실적·공시' }
  : /목표주가|목표가|리포트|투자의견|커버리지|애널리스트/.test(t) ? { k: 'report', label: '📑 리포트(참고)' }
  : { k: 'etc', label: '📰 업종·이슈' };
async function stockNaver(){
  const out = [];
  for (const url of ['https://news.naver.com/breakingnews/section/101/258', 'https://news.naver.com/section/101']){
    try {
      const html = await getText(url);
      const links = [...new Set([...html.matchAll(/https:\/\/n\.news\.naver\.com\/(?:mnews\/)?article\/(\d{3})\/(\d{6,})/g)].map(m => `https://n.news.naver.com/article/${m[1]}/${m[2]}`))].slice(0, 18);
      for (const link of links){
        try {
          const page = await getText(link); const title = meta(page, 'og:title'); if (!title) continue;
          out.push({ source: (meta(page, 'og:article:author') || '네이버뉴스').split('|')[0].trim(), title, link,
            pubDate: new Date(meta(page, 'article:published_time') || Date.now()).toISOString(), desc: meta(page, 'og:description') });
        } catch {}
      }
      if (out.length >= 5) break;
    } catch (e) { console.warn('증시 네이버 실패', url, e.message); }
  }
  return out;
}
async function collectStocks(){
  const all = [...(await Promise.all(STOCK_FEEDS.map(readFeed))).flat(), ...(await stockNaver())];
  const okTxt = a => !STOCK_NOT.test(a.title) && (STOCK_KW.test(a.title) || (STOCK_KW.test(a.desc || '') && /증시|주가|코스피|코스닥|종목|상장|공모|실적/.test(a.title + (a.desc || ''))));
  const seenS = new Set(); const pool = [];
  for (const a of all.filter(okTxt).sort((x, y) => isPref(x) - isPref(y) || +new Date(y.pubDate) - +new Date(x.pubDate))){
    const k = a.title.replace(/\s/g, '').slice(0, 16); if (seenS.has(k) || a.link.includes('news.google.com')) continue; seenS.add(k); pool.push(a);
    if (pool.length >= 14) break;
  }
  const items = [];
  for (const [i, a] of pool.entries()){
    const lead = await leadOf(a); const kind = stockKind(a.title);
    items.push({ id: `s${TODAY}-${i + 1}`, title: a.title, source: a.source, link: a.link, pubDate: a.pubDate, lead, kind: kind.k, kindLabel: kind.label });
  }
  return items;
}
let stocks = [];
try { stocks = await collectStocks(); } catch (e) { console.warn('증시 수집 실패', e.message); }
if (!stocks.length){ try { stocks = JSON.parse(readFileSync('data/news.json', 'utf8')).stocks || []; console.warn('증시 기사를 못 가져와 이전 목록을 유지합니다.'); } catch {} }
console.log(`증시 기사: ${stocks.length}건`);

writeFileSync('data/news.json', JSON.stringify({ updated: new Date().toISOString(), sortedBy: ranked.length ? 'views' : 'latest', history: HISTORY, stocks, articles }, null, 1));
console.log(`저장 완료: ${articles.length}건`);
