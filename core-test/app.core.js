/* ===== Core 三轴量表（R/J/E′）— 与基线 UI 对齐版 ===== */

/* ---------- 路径 ---------- */
const CORE_CFG_PATH   = './core-test/app.core.config.json';
let CORE_ITEMS_PATH   = './core-test/items.core.v1.json';

/* ---------- 状态 ---------- */
let CORE_CFG = null;
let CORE_ITEMS = [];          // [{id,text,dim:'R'|'J'|'D', dir: +1|-1, domain?:string}]
const CORE_ANS = new Map();   // Map<id, raw 1..7>

/* ---------- DOM ---------- */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

/* ---------- 工具 ---------- */
const mapLikertToFive = v => 1 + (v - 1) * (4/6);
const clip = (x, lo=1, hi=5) => Math.max(lo, Math.min(hi, x));
const escapeHTML = s => String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));

/* ---------- 加载 ---------- */
async function loadCore(){
  const cfg = await fetch(CORE_CFG_PATH).then(r=>r.json());
  CORE_CFG = cfg;
  if (cfg?.core?.itemsPath) CORE_ITEMS_PATH = cfg.core.itemsPath;

  const dat = await fetch(CORE_ITEMS_PATH).then(r=>r.json());
  // 兼容两种结构：{items:[...]} 或直接数组
  const arr = Array.isArray(dat) ? dat : (Array.isArray(dat.items) ? dat.items : []);
  CORE_ITEMS = arr.map((n, i)=>({
    id: n.id ?? (i+1),
    text: n.text || `Q${i+1}`,
    dim: (n.dim || 'R').toUpperCase(),   // R / J / D
    dir: (typeof n.dir === 'number' ? (n.dir >= 0 ? 1 : -1) : 1),
    domain: n.domain || null,
    w: (typeof n.w === 'number' ? n.w : 1.0)
  }));
}

/* ---------- 初始化（沿用基线 ID） ---------- */
function initCore(){
  const btnStart   = $('#startBtn');
  const btnSubmit  = $('#submitSurvey');
  const btnDownload= $('#download');

  if(btnStart){
    btnStart.addEventListener('click', ()=>{
      $('#intro')?.classList.add('hidden');
      $('#survey')?.classList.remove('hidden');
      startSurveyCore();
    });
  }
  if(btnSubmit){
    btnSubmit.addEventListener('click', ()=>{
      const got = readSurveyCore();
      if(!got.ok){ alert('还有题未作答。'); return; }
      const est = estimateTheta(got.answers);
      const cls = classify(est);
      renderReportCore(est, cls);
    });
  }
  if(btnDownload){
    btnDownload.addEventListener('click', ()=>{
      const data = window.__coreResult || {};
      const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'core-test-result.json';
      a.click();
      URL.revokeObjectURL(url);
    });
  }
}

/* ---------- Progressive 渲染（与基线一致） ---------- */
function startSurveyCore(){
  CORE_ANS.clear();
  const form = $('#surveyForm');
  if(form) form.innerHTML = '';
  const actions = $('#submitSurvey')?.closest('.actions');
  if(actions) actions.style.display = 'none';
  updateProgress(0);
  renderOneCore(0);
}
function updateProgress(done){
  const p = $('#progress');
  if(p) p.textContent = `${done} / ${CORE_ITEMS.length}`;
}
function buildLikert7(name, onPick){
  const wrap = document.createElement('div');
  wrap.className = 'likert7';
  for(let v=1; v<=7; v++){
    const opt = document.createElement('label');
    opt.className = 'likert-option' + (v===4 ? ' is-center':'');

    const input = document.createElement('input');
    input.type = 'radio'; input.name = name; input.value = String(v);

    const dot = document.createElement('span');
    dot.className = 'likert-dot';

    opt.appendChild(input); opt.appendChild(dot);
    input.addEventListener('change', ()=>{
      wrap.querySelectorAll('.likert-option').forEach(k=>k.classList.remove('is-selected','tapped'));
      opt.classList.add('is-selected','tapped');
      setTimeout(()=>opt.classList.remove('tapped'), 120);
      onPick(parseInt(input.value,10));
    });
    wrap.appendChild(opt);
  }
  return wrap;
}
function renderOneCore(idx){
  const form = $('#surveyForm');
  if(!form) return;

  if(idx >= CORE_ITEMS.length){
    const actions = $('#submitSurvey')?.closest('.actions');
    if(actions) actions.style.display = 'flex';
    return;
  }
  if(form.querySelector(`[data-q-idx="${idx}"]`)) return;

  const it = CORE_ITEMS[idx];
  const node = document.createElement('div');
  node.className = 'item card slide-in';
  node.setAttribute('data-q-idx', idx);
  node.innerHTML = `
    <h3 class="q-title">Q${idx+1}. ${escapeHTML(it.text)}</h3>
    <div class="scale-hint"><span>非常不同意</span><span>非常同意</span></div>
  `;
  const scale = buildLikert7('q' + it.id, (raw)=>{
    CORE_ANS.set(it.id, raw);
    updateProgress(CORE_ANS.size);
    if(node.getAttribute('data-next')!=='1'){
      node.setAttribute('data-next','1');
      const nextIdx = idx + 1;
      renderOneCore(nextIdx);
      const nextEl = form.querySelector(`[data-q-idx="${nextIdx}"]`);
      if(nextEl) setTimeout(()=> nextEl.scrollIntoView({behavior:'smooth', block:'center'}), 60);
    }
  });
  node.appendChild(scale);
  form.appendChild(node);
}

/* ---------- 读取答案 ---------- */
function readSurveyCore(){
  if(CORE_ANS.size < CORE_ITEMS.length) return {ok:false};
  const out = {};
  for(const it of CORE_ITEMS){
    const raw = CORE_ANS.get(it.id);
    if(typeof raw!=='number') return {ok:false};
    out[it.id] = raw;
  }
  return {ok:true, answers: out};
}

/* ---------- 估计三轴 θ ---------- */
function estimateTheta(answers){
  const acc = { R:{n:0,d:0}, J:{n:0,d:0}, D:{n:0,d:0} };
  for(const it of CORE_ITEMS){
    const raw = answers[it.id];
    const s = mapLikertToFive(raw);            // 1..5
    const signed = (it.dir >= 0) ? s : (6 - s); // 反向计分
    const w = Math.abs(it.w || 1);
    acc[it.dim].n += w * signed;
    acc[it.dim].d += w;
  }
  const avg = k => acc[k].d>0 ? acc[k].n/acc[k].d : 3.0;
  const R = clip(avg('R'));
  const J = clip(avg('J'));
  const E_raw = clip(avg('D'));

  const beta = CORE_CFG?.core?.theta?.beta_RE ?? 0.60;
  const Eprime = clip(E_raw - beta*(R-3));  // 以 3 为中心做残差近似
  return { R:+R.toFixed(2), J:+J.toFixed(2), E_raw:+E_raw.toFixed(2), E:+Eprime.toFixed(2) };
}

/* ---------- 分类 ---------- */
function classify(theta){
  const vec = [theta.R, theta.J, theta.E];
  const protos = CORE_CFG?.core?.classify?.prototypes || [];
  let best = null, second = null;

  function dist2(p){ const dR=vec[0]-p.R, dJ=vec[1]-p.J, dE=vec[2]-p.E; return dR*dR + dJ*dJ + dE*dE; }
  protos.forEach(p=>{
    const d2 = dist2(p);
    const item = { id:p.id, name:p.name, d2, sim: 1 / (1 + Math.sqrt(d2)) };
    if(!best || d2 < best.d2) { second = best; best = item; }
    else if(!second || d2 < second.d2) { second = item; }
  });
  return { top1: best, top2: second };
}

/* ---------- 报告 ---------- */
function renderReportCore(theta, cls){
  $('#survey')?.classList.add('hidden');
  const wrap = $('#reportContent');
  if(!wrap) return;

  const lines = [];
  lines.push(`<p><strong>核心三轴（1–5）</strong></p>`);
  lines.push(`<ul>
    <li>反身/觉察 R：${theta.R}</li>
    <li>外部正当化 J：${theta.J}</li>
    <li>去魅残差 E′：${theta.E} <span class="muted">(原始 D=${theta.E_raw})</span></li>
  </ul>`);

  if(cls?.top1){
    const t1 = cls.top1, t2 = cls.top2;
    lines.push(`<p>宏姿态候选：<span class="badge">${t1.id} ${t1.name}</span>（相似度 ${t1.sim.toFixed(4)}）</p>`);
    if(t2) lines.push(`<p class="muted">Top2：${t2.id} ${t2.name}（相似度 ${t2.sim.toFixed(4)}）</p>`);
  }

  wrap.innerHTML = lines.join('\n');
  $('#report')?.classList.remove('hidden');
  window.__coreResult = { theta, classify: cls };
}

/* ---------- 启动 ---------- */
window.addEventListener('DOMContentLoaded', async ()=>{
  try{
    await loadCore();
    initCore();
  }catch(e){
    console.error(e);
    alert('Core 加载失败：' + e.message);
  }
});

