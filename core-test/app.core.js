/* ===== Core path（R/J/E′）——逐题式问卷，与 baseline UI 一致 ===== */

/* ---------- 路径 ---------- */
const CORE_CFG_PATH   = './app.core.config.json';
const CORE_ITEMS_PATH = './items.core.v1.json';

/* ---------- 状态 ---------- */
let CORE_CFG = null;
let CORE_ITEMS = [];              // [{id,text,w,weights:{R,J,E}}, ...]
const CORE_ANS = new Map();       // Map<id, 1..5>
let coreIndex = 0;                // 当前题索引

/* ---------- DOM ---------- */
const $  = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>Array.from(r.querySelectorAll(s));

/* ---------- 工具 ---------- */
const clip=(x,lo=1,hi=5)=>Math.max(lo,Math.min(hi,x));
const escapeHTML=s=>String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

/* ---------- 加载 ---------- */
async function fetchJSON(p){ const r = await fetch(p); if(!r.ok) throw new Error(p+' not ok'); return r.json(); }

async function coreLoadAll(){
  CORE_CFG   = await fetchJSON(CORE_CFG_PATH);
  CORE_ITEMS = await fetchJSON(CORE_ITEMS_PATH);
  if(!Array.isArray(CORE_ITEMS) || !CORE_ITEMS.length) throw new Error('Core items empty');
}

/* ---------- Likert: 1..5（与 baseline 相同视觉） ---------- */
function buildLikert5(name, onPick){
  const wrap = document.createElement('div');
  wrap.className = 'likert7'; // 复用样式：5 个也行（中点定位到第3个）
  for(let v=1; v<=5; v++){
    const opt  = document.createElement('label');
    opt.className = 'likert-option' + (v===3 ? ' is-center' : '');
    const input= document.createElement('input');
    input.type='radio'; input.name=name; input.value=String(v);
    const dot  = document.createElement('span'); dot.className='likert-dot';
    opt.appendChild(input); opt.appendChild(dot);

    input.addEventListener('change',()=>{
      wrap.querySelectorAll('.likert-option').forEach(k=>k.classList.remove('is-selected','tapped'));
      opt.classList.add('is-selected','tapped'); setTimeout(()=>opt.classList.remove('tapped'),120);
      onPick(parseInt(input.value,10));
    });
    wrap.appendChild(opt);
  }
  return wrap;
}

/* ---------- 逐题渲染 ---------- */
function coreStartSurvey(){
  CORE_ANS.clear();
  coreIndex = 0;
  $('#core-intro')?.classList.add('hidden');
  $('#core-report')?.classList.add('hidden');
  $('#core-survey')?.classList.remove('hidden');
  $('#coreSurveyForm').innerHTML = '';
  $('#coreSubmitWrap').style.display = 'none';
  $('#coreProgress').textContent = `0 / ${CORE_ITEMS.length}`;
  coreRenderItem(coreIndex);
}

function coreRenderItem(idx){
  const form = $('#coreSurveyForm');
  if(!form) return;

  if(idx >= CORE_ITEMS.length){
    $('#coreSubmitWrap').style.display = 'block';
    return;
  }
  if(form.querySelector(`[data-q-idx="${idx}"]`)) return;

  const it = CORE_ITEMS[idx];
  const node = document.createElement('div');
  node.className = 'item card slide-in';
  node.setAttribute('data-qid', it.id);
  node.setAttribute('data-q-idx', idx);

  node.innerHTML = `
    <h3 class="q-title">Q${idx+1}. ${escapeHTML(it.text)}</h3>
    <div class="scale-hint"><span>非常不同意</span><span>非常同意</span></div>
  `;

  const scale = buildLikert5('q' + it.id, raw=>{
    CORE_ANS.set(it.id, raw);
    $('#coreProgress').textContent = `${CORE_ANS.size} / ${CORE_ITEMS.length}`;
    if(node.getAttribute('data-next')!=='1'){
      node.setAttribute('data-next','1');
      const next = idx+1;
      coreRenderItem(next);
      const nextEl = form.querySelector(`[data-q-idx="${next}"]`);
      if(nextEl){
        setTimeout(()=>nextEl.scrollIntoView({behavior:'smooth',block:'center'}),60);
      }
    }
  });

  node.appendChild(scale);
  form.appendChild(node);
}

/* ---------- 读卷 ---------- */
function coreRead(){
  if(CORE_ANS.size < CORE_ITEMS.length) return {ok:false};
  const out={}; for(const it of CORE_ITEMS){ const v = CORE_ANS.get(it.id); if(typeof v!=='number') return {ok:false}; out[it.id]=v; }
  return {ok:true, answers: out};
}

/* ---------- 估计（与你上次跑出的结果一致的版本） ---------- */
function estimate_theta_core(answers, items){
  // 简化：加权平均 → R,J,E；再正交化 E' = E - beta*R
  const acc = {R:{n:0,d:0}, J:{n:0,d:0}, E:{n:0,d:0}};
  for(const it of items){
    const raw = answers[it.id]; if(typeof raw!=='number') continue;
    const w = typeof it.w==='number'?it.w:1;
    const ww = it.weights||{};
    (['R','J','E']).forEach(k=>{
      const c = +ww[k] || 0; if(!c) return;
      const signed = c>=0 ? raw : (6-raw);
      const a = acc[k]; a.n += Math.abs(c*w)*signed; a.d += Math.abs(c*w);
    });
  }
  const avg = k => acc[k].d>0 ? (acc[k].n/acc[k].d) : 3;
  let R = clip(avg('R')), J = clip(avg('J')), E = clip(avg('E'));
  // 正交化：经验系数（保守）beta≈0.55，限制到 [0,1]
  const beta = (CORE_CFG?.orth_beta_R2E ?? 0.55);
  const Eprime = clip(E - beta*(R-3)); // 以3为中点
  return {R:+R.toFixed(2), J:+J.toFixed(2), E:+E.toFixed(2), Eprime:+Eprime.toFixed(2)};
}

/* ---------- 原型判别（Top1/Top2） ---------- */
function classify_core(t, proto){
  // 余弦相似 + 欧氏距离并列出
  const vx = [t.R-3, t.J-3, t.Eprime-3];
  function sim(a,b){ const dot=a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; const na=Math.hypot(...a)||1, nb=Math.hypot(...b)||1; return dot/(na*nb); }
  function dist(a,b){ return Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]); }

  const rows = proto.map(p=>{
    const v=[(p.R-3),(p.J-3),(p.Ep-3)];
    return {macro:p.macro, label:p.label, sim:sim(vx,v), dis:dist(vx,v)};
  }).sort((a,b)=>b.sim-a.sim);
  return {top:rows.slice(0,2), all:rows};
}

/* ---------- 渲染报告 ---------- */
function render_core_report(est, cls){
  $('#core-survey')?.classList.add('hidden');
  const box = $('#coreReportContent'); if(!box) return;

  const [t1,t2] = cls.top;
  const html = `
    <p><strong>核心三轴（1–5）</strong></p>
    <ul>
      <li>反身/觉察 R：${est.R}</li>
      <li>外部正当化 J：${est.J}</li>
      <li>去魅残差 E′：${est.Eprime} <span class="hint">(原始 E=${est.E})</span></li>
    </ul>

    <p><strong>宏姿态候选</strong></p>
    <p>Top1：<span class="badge-macro">${t1.label}</span> <span class="hint">（相似度 ${t1.sim.toFixed(4)}，距离 ${t1.dis.toFixed(3)}）</span></p>
    <p>Top2：<span class="badge-macro">${t2.label}</span> <span class="hint">（相似度 ${t2.sim.toFixed(4)}，距离 ${t2.dis.toFixed(3)}）</span></p>

    <p class="hint">说明：本页基于 Core 三轴点估计。若 Top1 与 Top2 接近，可在后续“支线判别”中加测冲突题以确认。</p>
  `;
  box.innerHTML = html;
  $('#core-report')?.classList.remove('hidden');
}

/* ---------- 事件 ---------- */
function coreInit(){
  $('#coreStartBtn')?.addEventListener('click', coreStartSurvey);
  $('#coreSubmitBtn')?.addEventListener('click', ()=>{
    const r = coreRead();
    if(!r.ok){ alert('还有题未作答。'); return; }
    const est = estimate_theta_core(r.answers, CORE_ITEMS);
    const cls = classify_core(est, CORE_CFG.prototypes||[]);
    render_core_report(est, cls);
  });
  $('#coreRestartBtn')?.addEventListener('click', ()=>location.reload());
}

/* ---------- 启动 ---------- */
window.addEventListener('DOMContentLoaded', async ()=>{
  try{
    await coreLoadAll();
    coreInit();
  }catch(e){
    alert('Core 加载失败：' + e.message);
    console.error(e);
  }
});
