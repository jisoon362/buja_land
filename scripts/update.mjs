// 매일 실행(전부 무료): RSS 수집 → Gemini 무료 키로 요약·개념·퀴즈 생성 → 키가 없거나 실패하면 내장 개념은행(concepts.json) 사용
// 영상은 API 없이 유튜브 검색 링크로 연결. Node 20+. 선택 환경변수: GEMINI_API_KEY
import { writeFileSync, readFileSync } from 'node:fs';
const BANK = JSON.parse(readFileSync(new URL('./concepts.json', import.meta.url), 'utf8'));

const FEEDS = [
  { source: '한국경제', url: 'https://www.hankyung.com/feed/economy' },
  { source: '매일경제', url: 'https://www.mk.co.kr/rss/30100041/' },
  { source: '구글뉴스 경제', url: 'https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=ko&gl=KR&ceid=KR:ko' },
];
const COUNT = Number(process.env.ARTICLE_COUNT || 5);
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const UA = { 'user-agent': 'Mozilla/5.0 (compatible; BujaBujaBot/1.0)' };

const unesc = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim();
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
        pubDate: new Date(unesc(tag(it, 'pubDate')) || Date.now()).toISOString(), desc: unesc(tag(it, 'description')) };
    }).filter(a => a.title && a.link);
  } catch (e) { console.warn('피드 실패', source, e.message); return []; }
}

// 기사 페이지의 og:description(도입부)만 가져온다 — 본문 전체는 저장하지 않음
async function leadOf(a){
  try {
    const html = await getText(a.link);
    const og = (html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) || [])[1];
    return unesc(og || a.desc || '');
  } catch { return a.desc || ''; }
}

const ECON = /경제|금리|환율|주가|증시|코스피|코스닥|물가|부동산|대출|수출|반도체|기업|투자|예산|세금|관세|무역|성장|은행|채권|달러|원화|상장|IPO|AI/;

async function gemini(article){
  const key = process.env.GEMINI_API_KEY; if (!key) return null;
  const prompt = `당신은 사회초년생에게 경제를 가르치는 친절한 선생님입니다. 아래 한국 경제기사 정보로 학습 콘텐츠를 JSON으로만 만드세요(설명·코드블록 금지).
제목: ${article.title}
도입부: ${article.lead}

스키마:
{"question":"이 이슈를 한 줄 질문으로(예: 왜 ~했을까?)",
 "summary":["쉬운 말 '~해요'체 요약 4~5개, 마지막은 핵심 질문/시사점"],
 "concept":{"term":"오늘의 경제개념 1개","explain":"2~3문장","example":"일상 예시 1문장","note":["노트에 적을 핵심 2~4줄"]},
 "miniQuiz":{"q":"","choices":["","",""],"answer":0,"explain":""},
 "quiz":[{"q":"","choices":["","",""],"answer":0,"explain":""},{"q":"","choices":["","",""],"answer":0,"explain":""},
         {"type":"order","q":"과정을 순서대로 나열하세요(순서가 있는 개념일 때만, 아니면 객관식으로 대체)","items":["1단계","2단계","3단계"],"explain":""}],
 "searchQuery":"유튜브에서 이 주제를 찾을 검색어"}
기사에 없는 사실은 지어내지 말고 개념 중심으로 쓰세요. answer는 0부터 시작하는 정답 인덱스입니다.`;
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
    return out;
  } catch (e) { console.warn('Gemini 실패 → 내장 개념은행 사용:', e.message); return null; }
}

// API 없이: 기사 키워드와 맞는 개념을 고르고, 없으면 날짜로 순환
function fromBank(a, i){
  const hit = BANK.find(c => c.keys.some(k => (a.title + ' ' + a.lead).includes(k)));
  const c = hit || BANK[(Math.floor(Date.now() / 864e5) + i) % BANK.length];
  const sents = (a.lead.match(/[^.!?。]+[.!?。]?/g) || []).map(x => x.trim()).filter(x => x.length > 8).slice(0, 3);
  return { question: a.title.replace(/[.?!]$/, '') + ' — 무슨 일일까?',
    summary: [...sents, `오늘의 키워드는 “${c.term}”예요. 아래 개념으로 이 뉴스를 이해해 봐요.`],
    concept: { term: c.term, explain: c.explain, example: c.example, note: c.note },
    miniQuiz: c.miniQuiz, quiz: c.quiz, searchQuery: c.term + ' 쉽게 설명' };
}

const feeds = (await Promise.all(FEEDS.map(readFeed))).flat();
const seen = new Set(); const picks = [];
for (const a of feeds.sort((x, y) => (ECON.test(y.title) ? 1 : 0) - (ECON.test(x.title) ? 1 : 0) || +new Date(y.pubDate) - +new Date(x.pubDate))){
  const k = a.title.slice(0, 18); if (seen.has(k)) continue; seen.add(k); picks.push(a); if (picks.length >= COUNT) break;
}
if (!picks.length){ console.error('수집된 기사가 없어 기존 데이터를 유지합니다.'); process.exit(0); }

const articles = [];
for (const [i, a] of picks.entries()){
  const lead = await leadOf(a);
  const ai = (await gemini({ title: a.title, lead })) || fromBank({ title: a.title, lead }, i);
  const base = { id: `${new Date().toISOString().slice(0, 10)}-${i + 1}`, title: a.title, source: a.source, link: a.link, pubDate: a.pubDate, lead,
    question: ai?.question || '', summary: ai?.summary?.length ? ai.summary : [lead || a.title],
    concept: ai?.concept || null, miniQuiz: ai?.miniQuiz || null, quiz: ai?.quiz || [], searchQuery: ai?.searchQuery || a.title };
  base.videos = [];
  base.searchQueries = [base.searchQuery, a.title + ' 해설'];
  articles.push(base);
  console.log('✔', base.title);
}
writeFileSync('data/news.json', JSON.stringify({ updated: new Date().toISOString(), articles }, null, 1));
console.log(`저장 완료: ${articles.length}건`);
