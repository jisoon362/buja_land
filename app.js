/* 부자부자 공부방 – 정적 사이트 (GitHub Pages) */
const $app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const store = {
  get(k, d){ try { const v = JSON.parse(localStorage.getItem('bj_' + k)); return v ?? d; } catch { return d; } },
  set(k, v){ try { localStorage.setItem('bj_' + k, JSON.stringify(v)); } catch {} }
};
const kstDay = (offset = 0) => new Date(Date.now() + 9 * 3600e3 - offset * 864e5).toISOString().slice(0, 10);

let DATA = { articles: [] };
let L = null; // 진행 중인 학습 세션

/* ---------- 진행 기록 ---------- */
function profile(){ return store.get('profile', { points: 0, streak: 0, last: '', done: {}, sentences: 0 }); }
function level(p){
  if (p >= 500) return '💎 부자 마스터';
  if (p >= 200) return '💰 금고 지기';
  if (p >= 80) return '🪙 동전 수집가';
  return '🌱 부자 새싹';
}

/* ---------- 라우팅 ---------- */
function go(view, arg){
  history.pushState({ view, arg }, '', '#' + view + (arg ? '/' + arg : ''));
  render(view, arg);
  window.scrollTo(0, 0);
}
window.addEventListener('popstate', e => {
  const s = e.state; if (s) render(s.view, s.arg); else render('home');
});
function render(view = 'home', arg){
  ({ home, news, article, lesson, concepts, quizzes, videos, rewards }[view] || home)(arg);
}

/* ---------- 공통 조각 ---------- */
function topbar(title, back = true, right = ''){
  return `<div class="top">${back ? '<button class="icon-btn" data-back>‹</button>' : ''}<h1>${esc(title)}</h1>${right}</div>`;
}
function wire(){
  $app.querySelectorAll('[data-back]').forEach(b => b.onclick = () => history.back());
  $app.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go, b.dataset.arg));
}
const getA = id => DATA.articles.find(a => a.id === id);

/* ---------- 홈 ---------- */
function home(){
  const p = profile();
  const today = kstDay();
  const doneToday = Object.values(p.done).filter(d => d === today).length;
  $app.innerHTML = `
  <div class="wrap">
    <div class="hero">
      <div class="bunny">🐰</div>
      <h2>부자부자 공부방</h2>
      <p>뉴스 한 편으로 경제 근육 키우기</p>
      <div class="stats">
        <div class="stat">🔥 연속 학습<b>${p.streak}일</b></div>
        <div class="stat">🪙 부자 포인트<b>${p.points}</b></div>
        <div class="stat">✅ 오늘 완료<b>${doneToday}편</b></div>
      </div>
    </div>
    <div class="menu">
      <button class="wide" data-go="news"><span class="em">📰</span><b>데일리 경제뉴스</b><small>오늘의 대표 경제기사 · 요약 · 학습</small></button>
      <button data-go="concepts"><span class="em">💡</span><b>오늘의 경제개념</b><small>개념 정리 + 미니퀴즈</small></button>
      <button data-go="quizzes"><span class="em">🎯</span><b>퀴즈</b><small>풀고 보상 받기</small></button>
      <button data-go="videos"><span class="em">▶️</span><b>관련 영상</b><small>유튜브로 더 알아보기</small></button>
      <button data-go="rewards"><span class="em">🏆</span><b>내 보상</b><small>${level(p.points)}</small></button>
    </div>
  </div>`;
  wire();
}

/* ---------- 뉴스 목록 ---------- */
function news(){
  const p = profile();
  const list = DATA.articles.map(a => `
    <button class="news" data-go="article" data-arg="${esc(a.id)}">
      ${p.done[a.id] ? '<span class="done-badge">✔ 학습 완료</span>' : ''}
      <span class="tag">${esc(a.sample ? '샘플' : '오늘의 이슈')}</span>
      <div class="src">${esc(a.source || '')} ${a.pubDate ? '· ' + esc(a.pubDate.slice(5, 10).replace('-', '/')) : ''}</div>
      <h3>${esc(a.title)}</h3>
      ${a.question ? `<div class="q">${esc(a.question)}</div>` : ''}
    </button>`).join('');
  $app.innerHTML = topbar('데일리 경제뉴스') + `<div class="wrap">
    <div class="date">${esc(DATA.updated ? DATA.updated.slice(0, 10) + ' 업데이트' : '')}${DATA.sampleOnly ? ' · 샘플 데이터 (자동 수집 전)' : ''}</div>
    ${list || '<div class="empty">아직 기사가 없어요</div>'}</div>`;
  wire();
  $app.querySelectorAll('.news').forEach(b => b.onclick = () => go('article', b.dataset.arg));
}

/* ---------- 기사 본문 ---------- */
function article(id){
  const a = getA(id); if (!a) return news();
  $app.innerHTML = topbar('기사 읽기') + `<div class="wrap article">
    <div class="meta">${esc(a.source || '')} ${a.pubDate ? '· ' + esc(a.pubDate.slice(0, 10)) : ''}</div>
    <h2>${esc(a.title)}</h2>
    <div class="body">${esc(a.lead || '').split('\n').map(t => `<p style="margin:0 0 10px">${t}</p>`).join('')}
      ${a.link && a.link !== '#' ? `<a class="linkbtn" style="margin-top:12px" target="_blank" rel="noopener" href="${esc(a.link)}">📄 원문 전체 보기 (${esc(a.source || '언론사')})</a>` : ''}
      <div class="note">저작권 보호를 위해 기사 도입부만 보여드리고, 전체 본문은 언론사 원문에서 확인해요.</div>
    </div>
  </div>
  <div class="bottom"><button class="cta" id="start">요약으로 학습 시작 →</button></div>`;
  wire();
  document.getElementById('start').onclick = () => startLesson(a);
}

/* ---------- 학습 세션 ---------- */
function buildSteps(a, onlyQuiz = false, onlyConcept = false){
  const s = [];
  if (!onlyQuiz && !onlyConcept && a.summary?.length) s.push({ t: 'summary', label: '1. 이슈 요약' });
  if (!onlyQuiz && a.concept) s.push({ t: 'concept', label: '2. 오늘의 개념' });
  if (!onlyConcept) (a.quiz || []).forEach((q, i) => s.push({ t: 'quiz', q, i, label: `${onlyQuiz ? '' : '3. '}확인 퀴즈` }));
  if (!onlyQuiz && !onlyConcept) s.push({ t: 'videos', label: '4. 관련 영상' });
  s.push({ t: 'done', label: '학습 완료' });
  return s;
}
function startLesson(a, mode){
  L = { a, steps: buildSteps(a, mode === 'quiz', mode === 'concept'), i: 0, correct: 0, asked: 0, t0: Date.now(), mode: mode || 'full' };
  go('lesson', a.id);
}
function lesson(){
  if (!L) return news();
  const st = L.steps[L.i];
  const total = L.steps.length;
  const head = `<div class="top"><button class="icon-btn" id="prev">‹</button><h1 style="font-size:15px">${esc(st.label)}</h1>
     <span class="pill">${L.i + 1} / ${total}</span><button class="icon-btn" id="x">✕</button></div>
     <div class="progress"><i style="width:${((L.i + 1) / total) * 100}%"></i></div>`;
  $app.innerHTML = head + `<div class="wrap" id="body"></div>`;
  document.getElementById('prev').onclick = () => { if (L.i > 0) { L.i--; lesson(); } else history.back(); };
  document.getElementById('x').onclick = () => { L = null; go('home'); };
  ({ summary: stepSummary, concept: stepConcept, quiz: stepQuiz, videos: stepVideos, done: stepDone }[st.t])(st);
}
const nextStep = () => { L.i++; lesson(); window.scrollTo(0, 0); };
const bottomBtn = (txt, fn, id = 'nx') => {
  const d = document.createElement('div'); d.className = 'bottom';
  d.innerHTML = `<button class="cta" id="${id}">${txt}</button>`; $app.appendChild(d);
  d.querySelector('button').onclick = fn; return d;
};

function stepSummary(){
  const a = L.a, body = document.getElementById('body');
  const items = a.summary;
  body.innerHTML = `<div class="chip">“${esc(a.question || '오늘 무슨 일이 있었던 걸까?')}”</div>` +
    items.map((t, i) => `<div class="sum-item ${i === items.length - 1 ? 'last' : ''}" style="animation-delay:${i * 0.45}s"><b>${i + 1}.</b>${esc(t)}</div>`).join('');
  bottomBtn('다음', nextStep);
}

function stepConcept(){
  const c = L.a.concept, body = document.getElementById('body');
  body.innerHTML = `
    <div class="concept"><h3>${esc(c.term)}</h3>${esc(c.explain)}
      ${c.example ? `<div class="ex">💬 예를 들면: ${esc(c.example)}</div>` : ''}</div>
    ${c.note?.length ? `<div class="section-h">✏️ 노트에 적어보세요</div><div class="note-card">${c.note.map((n, i) => `${'①②③④⑤'[i] || '•'} ${esc(n)}`).join('<br>')}</div>` : ''}
    ${L.a.miniQuiz ? `<div class="mini"><span class="lbl">미니 퀴즈</span><div id="mq"></div></div>` : ''}`;
  if (L.a.miniQuiz) renderQuiz(document.getElementById('mq'), L.a.miniQuiz, { count: false, inline: true });
  bottomBtn('다음', nextStep);
}

function stepQuiz(st){
  const body = document.getElementById('body');
  body.innerHTML = `<div class="qtags"><span>${st.i + 1}번</span><span>${st.q.type === 'order' ? '순서 퀴즈' : '기본 퀴즈'}</span></div><div id="qz"></div>`;
  renderQuiz(document.getElementById('qz'), st.q, { count: true });
}

/* 퀴즈 렌더러: choice(객관식) / order(순서 나열) */
function renderQuiz(el, q, opt){
  let locked = false, fb = null;
  const finish = ok => {
    if (locked) return; locked = true;
    if (opt.count) { L.asked++; if (ok) L.correct++; }
    fb = document.createElement('div');
    fb.className = 'feedback ' + (ok ? 'ok' : 'no');
    fb.innerHTML = `<h4>${ok ? '✅ 정답이에요!' : '❌ 아쉬워요, 다시 확인해요'}</h4><p>${esc(q.explain || '')}</p>
      <button class="cta">${opt.inline ? '확인' : '다음'}</button>`;
    $app.appendChild(fb);
    fb.querySelector('button').onclick = () => { fb.remove(); if (!opt.inline) nextStep(); };
  };
  if (q.type === 'order'){
    const order = []; const shuffled = q.items.map((t, i) => ({ t, i })).sort(() => Math.random() - 0.5);
    el.innerHTML = `<div class="qtext">${esc(q.q)}</div><div class="seq" id="seq"><span style="color:#6b7a99;font-size:13px">아래 보기를 순서대로 눌러주세요</span></div><div id="pool"></div>
      <button class="cta ghost" id="reset" style="margin-top:6px">다시 고르기</button><button class="cta" id="ck" style="margin-top:10px" disabled>정답 확인</button>`;
    const pool = el.querySelector('#pool'), seq = el.querySelector('#seq'), ck = el.querySelector('#ck');
    const draw = () => {
      pool.innerHTML = shuffled.map((o, k) => `<button class="choice ${order.includes(k) ? 'picked' : ''}" data-k="${k}" ${order.includes(k) ? 'disabled' : ''}><span class="n">${order.includes(k) ? order.indexOf(k) + 1 : '·'}</span>${esc(o.t)}</button>`).join('');
      seq.innerHTML = order.length ? order.map((k, n) => `<span class="chipx">${n + 1}. ${esc(shuffled[k].t.slice(0, 14))}…</span>`).join('') : '<span style="color:#6b7a99;font-size:13px">아래 보기를 순서대로 눌러주세요</span>';
      ck.disabled = order.length !== shuffled.length;
      pool.querySelectorAll('button').forEach(b => b.onclick = () => { if (locked) return; order.push(+b.dataset.k); draw(); });
    };
    el.querySelector('#reset').onclick = () => { if (!locked) { order.length = 0; draw(); } };
    ck.onclick = () => { const ok = order.every((k, n) => shuffled[k].i === n); finish(ok); };
    draw();
    return;
  }
  el.innerHTML = `<div class="qtext">${esc(q.q)}</div>` +
    q.choices.map((c, i) => `<button class="choice" data-i="${i}"><span class="n">${i + 1}</span>${esc(c)}</button>`).join('');
  el.querySelectorAll('.choice').forEach(b => b.onclick = () => {
    if (locked) return;
    const i = +b.dataset.i, ok = i === q.answer;
    el.querySelectorAll('.choice').forEach(x => { x.disabled = true; if (+x.dataset.i === q.answer) x.classList.add('right'); });
    if (!ok) b.classList.add('wrong');
    finish(ok);
  });
}

function stepVideos(){
  const a = L.a, body = document.getElementById('body');
  body.innerHTML = `<div class="chip">▶️ 이 기사와 함께 보면 좋은 영상</div>${videoHtml(a)}`;
  bottomBtn('학습 마치기', nextStep);
}
function videoHtml(a){
  const q = encodeURIComponent(a.searchQuery || a.title);
  const vids = (a.videos || []).map(v => `<div class="vid"><div class="ratio"><iframe loading="lazy" src="https://www.youtube-nocookie.com/embed/${esc(v.id)}" allowfullscreen title="${esc(v.title)}"></iframe></div>
      <p>${esc(v.title)}<small>${esc(v.channel || '')}</small></p></div>`).join('');
  return vids + `<a class="linkbtn" target="_blank" rel="noopener" href="https://www.youtube.com/results?search_query=${q}">🔎 유튜브에서 “${esc(a.searchQuery || a.title).slice(0, 24)}” 더 찾아보기</a>`;
}

function stepDone(){
  const a = L.a, p = profile(), today = kstDay();
  const secs = Math.max(1, Math.round((Date.now() - L.t0) / 1000));
  const text = [...(a.summary || []), a.concept?.explain || ''].join(' ');
  const sentences = (text.match(/[.!?요다]\s|[.!?]$/g) || []).length || (a.summary || []).length;
  const rate = L.asked ? Math.round(L.correct / L.asked * 100) : 100;
  const gain = 10 + L.correct * 10 + (L.asked && L.correct === L.asked ? 20 : 0);
  const first = !p.done[a.id];
  if (first){
    p.points += gain; p.sentences += sentences; p.done[a.id] = today;
    if (p.last !== today){ p.streak = p.last === kstDay(1) ? p.streak + 1 : 1; p.last = today; }
    store.set('profile', p);
  }
  const mm = Math.floor(secs / 60), ss = String(secs % 60).padStart(2, '0');
  const msg = rate === 100 ? 'Perfect!' : rate >= 60 ? 'Good!' : 'Nice try!';
  $app.querySelector('.progress')?.remove();
  document.getElementById('body').innerHTML = `<div class="done">
    <div class="big">🐰</div><div class="good">${msg}</div>
    <h2>학습 완료!</h2><div style="color:#6b7a99">오늘의 이슈를 완료했어요</div>
    <div class="tiles"><div class="tile">읽은 문장<b>${sentences}줄</b></div><div class="tile">학습 시간<b>${mm}:${ss}</b></div><div class="tile">정답률<b>${rate}%</b></div></div>
    <div class="reward">${first ? `🪙 부자 포인트 +${gain}` : '이미 보상을 받은 기사예요 (복습 완료 👍)'}<br><small>누적 ${p.points}P · ${level(p.points)} · 🔥 ${p.streak}일 연속</small></div>
    <button class="cta ghost" id="ag" style="margin-bottom:10px">오늘 학습한 지식 다시 보기</button>
  </div>`;
  document.getElementById('ag').onclick = () => { L.i = 0; L.steps = buildSteps(a, false, false).filter(s => s.t !== 'done'); L.steps.push({ t: 'done', label: '학습 완료' }); lesson(); };
  bottomBtn('홈으로', () => { L = null; go('home'); });
}

/* ---------- 오늘의 개념 모아보기 ---------- */
function concepts(){
  const list = DATA.articles.filter(a => a.concept).map(a => `
    <button class="news" data-arg="${esc(a.id)}"><span class="tag">💡 오늘의 개념</span><h3>${esc(a.concept.term)}</h3>
    <div class="src">${esc(a.title)}</div></button>`).join('');
  $app.innerHTML = topbar('오늘의 경제개념') + `<div class="wrap">${list || '<div class="empty">개념이 아직 없어요</div>'}</div>`;
  wire();
  $app.querySelectorAll('.news').forEach(b => b.onclick = () => startLesson(getA(b.dataset.arg), 'concept'));
}
/* ---------- 퀴즈 모아보기 ---------- */
function quizzes(){
  const list = DATA.articles.filter(a => a.quiz?.length).map(a => `
    <button class="news" data-arg="${esc(a.id)}"><span class="tag">🎯 퀴즈 ${a.quiz.length}문제</span><h3>${esc(a.title)}</h3></button>`).join('');
  $app.innerHTML = topbar('퀴즈') + `<div class="wrap">${list || '<div class="empty">퀴즈가 아직 없어요</div>'}</div>`;
  wire();
  $app.querySelectorAll('.news').forEach(b => b.onclick = () => startLesson(getA(b.dataset.arg), 'quiz'));
}
/* ---------- 관련 영상 모아보기 ---------- */
function videos(){
  $app.innerHTML = topbar('관련 영상') + `<div class="wrap">` +
    (DATA.articles.map(a => `<div class="section-h">📰 ${esc(a.title)}</div>${videoHtml(a)}`).join('') || '<div class="empty">영상이 아직 없어요</div>') + `</div>`;
  wire();
}
/* ---------- 내 보상 ---------- */
function rewards(){
  const p = profile();
  const next = [80, 200, 500].find(n => n > p.points);
  $app.innerHTML = topbar('내 보상') + `<div class="wrap"><div class="done" style="padding-top:0">
    <div class="big" style="font-size:72px">🏆</div><h2>${level(p.points)}</h2>
    <div class="tiles"><div class="tile">부자 포인트<b>${p.points}</b></div><div class="tile">연속 학습<b>${p.streak}일</b></div><div class="tile">완료한 기사<b>${Object.keys(p.done).length}편</b></div></div>
    <div class="reward">${next ? `다음 레벨까지 ${next - p.points}P 남았어요` : '최고 레벨 달성! 🎉'}</div>
    <div style="color:#6b7a99;font-size:13px;line-height:1.7">학습 완료 +10P · 정답 1개당 +10P · 전부 맞히면 +20P 보너스</div>
  </div></div>`;
  wire();
}

/* ---------- 시작 ---------- */
fetch('data/news.json?v=' + Date.now()).then(r => r.json()).catch(() => ({ articles: [] })).then(d => {
  DATA = d;
  const [v, arg] = location.hash.slice(1).split('/');
  history.replaceState({ view: 'home' }, '', location.pathname);
  render('home');
  if (v && v !== 'lesson' && v !== 'home') go(v, arg);
});
