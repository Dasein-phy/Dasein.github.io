/* ===== Core path engine (R/J/E′ baseline + branch duel) ===== */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* ---------- Paths & state ---------- */
const PATHS = window.__CORE_PATHS__ || {
  cfg:  './app.core.config.json',
  base: './items.core.v1.json',
  pool: './items.branch.v1.json'
};

let CFG = null;
let CORE_ITEMS = [];
let POOLS = null;

const CORE_ANS = new Map();     // id -> 1..5
let CORE_VEC = null;            // {R,J,E}
let CORE_POST = null;           // [{macro, prob, dist}, ...]
let CORE_TOP = null;            // {top1, top2}

let BRANCH_SESSION = null;      // {pairKey, left, right, items:[..], answers:[]}

/* ---------- Utils ---------- */
const sleep = ms => new Promise(r=>setTimeout(r, ms));
function clip(x, lo=1, hi=5){ return Math.max(lo, Math.min(hi, x)); }
function seededShuffle(arr, seed){
  let h = 2166136261;
  for (let i=0;i<seed.length;i++){ h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  const out = arr.slice();
  for (let i=out.length-1; i>0; i--){
    h ^= (h<<13); h ^= (h>>>7); h ^= (h<<17);
    const j = Math.abs(h) % (i+1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
function softmax(vec, tau=1.0){
  const m = Math.max(...vec);
  const ex = vec.map(v => Math.exp((v - m) / Math.max(1e-6, tau)));
  const s = ex.reduce((a,b)=>a+b,0);
  return ex.map(v => v/s);
}
function distEuclid(a,b){
  const dR = a.R-b.R, dJ=a.J-b.J, dE=a.E-b.E;
  return Math.sqrt(dR*dR + dJ*dJ + dE*dE);
}

/* ---------- Load ---------- */
async function fetchJSON(p){ const r = await fetch(p); if(!r.ok) throw new Error(p); return r.json(); }

async function boot(){
  [CFG, CORE_ITEMS, POOLS] = await Promise.all([
    fetchJSON(PATHS.cfg),
    fetchJSON(PATHS.base),
    fetchJSON(PATHS.pool)
  ]);

  bindCoreUI();
}

/* ---------- Core survey render ---------- */
function bindCoreUI(){
  $('#startBtnCore')?.addEventListener('click', ()=>{
    $('#introCore')?.classList.add('hidden');
    $('#surveyCore')?.classList.remove('hidden');
    renderCoreSurvey();
  });

  $('#submitCore')?.addEventListener('click', ()=>{
    const read = readCoreAnswers();
    if(!read.ok){ alert('还有题未作答'); return; }
    const vec = estimate_theta(read.answers);
    CORE_VEC = vec;
    CORE_POST = classify(vec);
    CORE_TOP = {
      top1: CORE_POST[0]?.macro || null,
      top2: CORE_POST[1]?.macro || null
    };
    renderCoreReport(vec, CORE_POST);
    $('#surveyCore')?.classList.add('hidden');
    $('#reportCore')?.classList.remove('hidden');
  });

  $('#restartCore')?.addEventListener('click', ()=>location.reload());

  $('#startBranchCore')?.addEventListener('click', ()=>{
    const ok = startBranchRouting(); // decide pair & build items
    if(!ok){ alert('当前结论不在已配置的对决池中。'); return; }
    $('#reportCore')?.classList.add('hidden');
    $('#branchCore')?.classList.remove('hidden');
  });

  $('#submitBranch')?.addEventListener('click', ()=>{
    if(!BRANCH_SESSION) return;
    if (BRANCH_SESSION.answers.length < BRANCH_SESSION.items.length){
      alert('还有题未作答'); return;
    }
    // fuse & show merged
    const merged = fuseBranch(CORE_POST, BRANCH_SESSION);
    renderMergedReport(merged);
    $('#branchCore')?.classList.add('hidden');
    $('#mergedCore')?.classList.remove('hidden');
  });

  $('#restartAll')?.addEventListener('click', ()=>location.reload());
}

function renderCoreSurvey(){
  CORE_ANS.clear();
  const form = $('#coreForm');
  form.innerHTML = '';
  $('#coreProgress').textContent = `0 / ${CORE_ITEMS.length}`;

  CORE_ITEMS.forEach((it, idx)=>{
    const node = document.createElement('div');
    node.className = 'item card';
    node.innerHTML = `
      <h3 class="q-title">Q${idx+1}. ${it.text}</h3>
      <div class="likert7" data-qid="${it.id}">
        ${[1,2,3,4,5].map(v=>`
          <label class="likert-option${v===3?' is-center':''}">
            <input type="radio" name="q${it.id}" value="${v}">
            <span class="likert-dot"></span>
          </label>
        `).join('')}
        <div class="scale-hint"><span>非常不同意</span><span>非常同意</span></div>
      </div>
    `;
    form.appendChild(node);

    node.addEventListener('change', (e)=>{
      const input = e.target;
      if(input && input.name === `q${it.id}`){
        CORE_ANS.set(it.id, +input.value);
        $('#coreProgress').textContent = `${CORE_ANS.size} / ${CORE_ITEMS.length}`;
      }
    });
  });
}

function readCoreAnswers(){
  if (CORE_ANS.size < CORE_ITEMS.length) return {ok:false};
  const out = {};
  for (const it of CORE_ITEMS){
    const v = CORE_ANS.get(it.id);
    if (typeof v !== 'number') return {ok:false};
    out[it.id] = v;
  }
  return {ok:true, answers: out};
}

/* ---------- Core scoring (theta estimate & classify) ---------- */
function estimate_theta(ans){
  // 计算 R/J/E′ 三轴：items.core.v1.json 中每个条目包含 weights: {R:±1, J:±1, E1:±1} & reverse? flag
  const acc = {R:{n:0,d:0}, J:{n:0,d:0}, E1:{n:0,d:0}};
  CORE_ITEMS.forEach(it=>{
    const raw = ans[it.id];
    if(typeof raw!=='number') return;
    const v = raw; // 1..5
    const w = it.weights || {};
    const rk = it.reverse===true; // 若题项标了 reverse，则镜像
    const score = rk ? (6 - v) : v;

    ['R','J','E1'].forEach(k=>{
      const c = Number(w[k])||0;
      if(c===0) return;
      const s = c>=0 ? score : (6 - score);
      const ww = Math.abs(c);
      acc[k].n += ww * s;
      acc[k].d += ww;
    });
  });

  const m = k => acc[k].d>0 ? (acc[k].n/acc[k].d) : 3.0;
  const R = clip(m('R')), J = clip(m('J')), E_raw = clip(m('E1'));

  // E′ 去掉 R 的线性部分（简化版）
  // E' = z(E_raw) - beta * z(R) -> 还原到 1..5
  const z = (x)=> (x-3.0)/1.0;
  const beta = 0.55;
  let Ez = z(E_raw) - beta * z(R);
  const E = clip(3.0 + Ez*1.0);

  return { R:+R.toFixed(2), J:+J.toFixed(2), E:+E.toFixed(2), E_raw:+E_raw.toFixed(2) };
}

function classify(theta){
  const proto = CFG.core.classify.prototypes;
  const tau   = CFG.core.classify.softmax_tau || 1.25;

  const entries = Object.keys(proto).map(macro=>{
    const dist = distEuclid(theta, proto[macro]);
    return { macro, dist };
  }).sort((a,b)=> a.dist - b.dist);

  // 距离 -> 分数（负距离），softmax 得概率
  const logits = entries.map(e => -e.dist);
  const probs  = softmax(logits, tau);
  const ranked = entries.map((e,i)=>({
    macro: e.macro,
    dist: +e.dist.toFixed(3),
    prob: +probs[i].toFixed(4)
  })).sort((a,b)=> b.prob - a.prob);

  return ranked;
}

/* ---------- Core report ---------- */
function renderCoreReport(vec, ranked){
  const box = $('#coreReportContent');
  const [t1, t2] = [ranked[0], ranked[1]];

  const html = `
    <p><strong>核心三轴（1–5）</strong></p>
    <ul>
      <li>反身/觉察 R：${vec.R}</li>
      <li>外部正当化 J：${vec.J}</li>
      <li>去魅残差 E′：${vec.E} <span class="muted">(原始E=${vec.E_raw})</span></li>
    </ul>
    <p><strong>宏姿态候选</strong></p>
    <ol>
      ${ranked.slice(0,5).map(r=>`<li>${r.macro}（p=${r.prob}，距离 ${r.dist}）</li>`).join('')}
    </ol>
    <p class="muted">说明：支线问卷将优先对决 Top1 与其对立/邻近原型，以缩小不确定性。</p>
  `;
  box.innerHTML = html;

  // 支线按钮可用性
  const canRoute = resolveBranchPairKey(ranked)?.ok === true;
  const btn = $('#startBranchCore');
  if (btn){
    btn.disabled = !canRoute;
    btn.textContent = canRoute ? '进入支线问卷' : '进入支线问卷（无可用对决池）';
  }
}

/* ---------- Branch routing & render ---------- */
function resolveBranchPairKey(ranked){
  if (!CFG?.routing?.enabled) return {ok:false, reason:'routing off'};
  const pairs = CFG.routing.pairs || {};
  const top1  = ranked[0]?.macro;
  const top2  = ranked[1]?.macro;
  if (!top1) return {ok:false};

  const p = pairs[top1];
  if (!p || p.enabled===false) return {ok:false};

  // 如果 top2 正好是配置的对手，更佳；否则仍用对手位（便于拉开）
  const opponent = p.opponent;
  const poolKey  = p.pool;
  if (!POOLS?.pools?.[poolKey]) return {ok:false, reason:'pool missing'};

  return {ok:true, pairKey: poolKey, left: top1, right: opponent, top2};
}

function startBranchRouting(){
  const r = resolveBranchPairKey(CORE_POST || []);
  if (!r?.ok) return false;

  const all = POOLS.pools[r.pairKey] || [];
  const k   = CFG.routing.items_per_pair || 8;
  const seed = (CFG.routing.draw_seed || 'seed') + '-' + r.pairKey + '-' + Date.now();
  const draw = seededShuffle(all, seed).slice(0, k);

  BRANCH_SESSION = {
    pairKey: r.pairKey,
    left: r.left,    // 题目 A 计 left（如 C1/B0）
    right: r.right,  // 题目 C 计 right（如 C2/B3）
    items: draw,
    answers: []      // 'A'|'B'|'C'
  };

  $('#branchHint').textContent = `${r.left} vs ${r.right}`;
  $('#branchProgress').textContent = `0 / ${draw.length}`;
  renderBranchItems(draw);

  return true;
}

function renderBranchItems(items){
  const wrap = $('#branchItems');
  wrap.innerHTML = '';
  $('#submitBranch').disabled = true;

  items.forEach((q, idx)=>{
    const node = document.createElement('div');
    node.className = 'fc3 card';
    node.setAttribute('data-idx', String(idx));
    node.innerHTML = `
      <div class="stem"><span class="muted">#${idx+1}</span> ${q.stem}</div>
      <div class="fc3-options">
        <button class="fc3-opt" data-v="A"><b>A</b> ${q.A}</button>
        <button class="fc3-opt" data-v="B"><b>B</b> ${q.B}</button>
        <button class="fc3-opt" data-v="C"><b>C</b> ${q.C}</button>
      </div>
    `;
    wrap.appendChild(node);
  });

  // 事件委托
  wrap.addEventListener('click', onPickFc3, { once: true, passive: false });
  // 我们在 handler 里会把 once=false 的委托再挂回（为了避免重复绑定）
}

function onPickFc3(e){
  const btn = e.target.closest('.fc3-opt');
  if (!btn) { // 重新挂载委托继续监听
    $('#branchItems').addEventListener('click', onPickFc3, { once: true, passive: false });
    return;
  }
  const card = btn.closest('.fc3');
  if (!card) return;
  const idx = +card.getAttribute('data-idx');

  // 写入答案
  const v = btn.getAttribute('data-v'); // 'A'|'B'|'C'
  BRANCH_SESSION.answers[idx] = v;

  // 视觉选中
  card.querySelectorAll('.fc3-opt').forEach(x=>x.classList.remove('picked'));
  btn.classList.add('picked');

  // 进度
  const total = BRANCH_SESSION.items.length;
  const done  = BRANCH_SESSION.answers.filter(x=>x==='A'||x==='B'||x==='C').length;
  $('#branchProgress').textContent = `${done} / ${total}`;

  // 全部答完可以提交
  if (done === total) $('#submitBranch').disabled = false;

  // 继续监听后续点击
  $('#branchItems').addEventListener('click', onPickFc3, { once: true, passive: false });
}

/* ---------- Branch fusion ---------- */
function fuseBranch(coreRanked, sess){
  // 将支线的 A / C 计分成左右阵营
  let left = 0, right = 0;
  sess.answers.forEach(v=>{
    if (v==='A') left++;
    else if (v==='C') right++;
  });

  // 把 core 的概率变回 logits，加上分数偏移，再做 softmax
  const tau_pre = CFG.core.classify.softmax_tau || 1.25;
  const labels  = coreRanked.map(r=>r.macro);
  const probs   = coreRanked.map(r=>r.prob);
  const logits0 = probs.map(p => Math.log(Math.max(p,1e-9)));

  const w = CFG.routing.fusion.per_item_logit || 0.4;
  const maxN = CFG.routing.fusion.max_items_effect || 10;
  const nEff = Math.min(sess.answers.length, maxN);
  const delta = w * (left - right);

  const idxL = labels.indexOf(sess.left);
  const idxR = labels.indexOf(sess.right);
  if (idxL>=0) logits0[idxL] += delta;
  if (idxR>=0) logits0[idxR] -= delta;

  const tau_post = CFG.routing.fusion.post_softmax_tau || 1.0;
  const probsNew = softmax(logits0, tau_post);
  const merged = labels.map((macro, i)=>({
    macro, prob:+probsNew[i].toFixed(4)
  })).sort((a,b)=> b.prob - a.prob);

  return {
    duel: { left:sess.left, right:sess.right, leftCount:left, rightCount:right, n:sess.answers.length },
    merged
  };
}

/* ---------- Merged report ---------- */
function renderMergedReport(out){
  const box = $('#mergedReportContent');
  const duel = out.duel;
  const top  = out.merged.slice(0,5);

  box.innerHTML = `
    <p><strong>支线对决</strong>：${duel.left} vs ${duel.right}</p>
    <p>计分：A→${duel.left} = ${duel.leftCount}，C→${duel.right} = ${duel.rightCount}（共 ${duel.n} 题）</p>
    <p><strong>融合后 Top 排序</strong></p>
    <ol>${top.map(r=>`<li>${r.macro}（p=${r.prob}）</li>`).join('')}</ol>
    <p class="muted">说明：支线以强迫选择题拉开“行动取向”与“合规则/功效取向”的差异，只在相关两类上调整后验。</p>
  `;
}

/* ---------- Go ---------- */
window.addEventListener('DOMContentLoaded', boot);
