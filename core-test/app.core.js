/* ===== Core 模型 app.core.js（UI 由 /shared/ui.scaffold.js 提供） ===== */

const CORE_CFG_PATH = './app.core.config.json';

let CORE_CFG = null;      // {itemsPath, beta_RE, prototypes:[{id,label,center}] ...}
let CORE_ITEMS = [];      // [{id,text,domain?,weights:{R,J,E}, w?}, ...]
const CORE_ANSWERS = new Map();

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

/* ---------- 小工具 ---------- */
function mapLikertToFive(raw){ return 1 + (raw - 1) * (4/6); } // 1..7 → 1..5
function clip(x, lo=1, hi=5){ return Math.max(lo, Math.min(hi, x)); }
function escapeHTML(s){
  return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}

/* ---------- 加载 ---------- */
async function fetchJSON(path){
  const r = await fetch(path);
  if(!r.ok) throw new Error('fetch fail: ' + path);
  return r.json();
}

async function loadCore(){
  CORE_CFG = await fetchJSON(CORE_CFG_PATH);
  const itemsPath = CORE_CFG.itemsPath || './items.core.v1.json';
  CORE_ITEMS = await fetchJSON(itemsPath);

  // 规范化
  CORE_ITEMS = CORE_ITEMS.map(n=>{
    const w = n.weights || {};
    return {
      id: n.id,
      text: n.text || ('Q' + n.id),
      domain: n.domain || null,
      w: (typeof n.w === 'number' ? n.w : 1.0),
      R: +w.R || 0,
      J: +w.J || 0,
      E: +w.E || 0
    };
  });
}

/* ---------- Progressive 问卷 ---------- */
function startCoreSurvey(){
  CORE_ANSWERS.clear();
  const form = $('#surveyForm');
  if(form) form.innerHTML = '';

  // 隐藏提交按钮条
  const actions = $('#submitSurvey')?.closest('.actions');
  if(actions) actions.style.display = 'none';

  // 逐题渲染
  renderOneItem(0);
}

function buildLikert7(name, onPick){
  const wrap = document.createElement('div');
  wrap.className = 'likert7';
  for(let v=1; v<=7; v++){
    const opt = document.createElement('label');
    opt.className = 'likert-option' + (v===4 ? ' is-center':'');

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = String(v);

    const dot = document.createElement('span');
    dot.className = 'likert-dot';

    opt.appendChild(input);
    opt.appendChild(dot);

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

function renderOneItem(idx){
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
  node.setAttribute('data-qid', it.id);
  node.setAttribute('data-q-idx', idx);

  node.innerHTML = `
    <h3 class="q-title">Q${idx+1}. ${escapeHTML(it.text)}</h3>
    <div class="scale-hint"><span>非常不同意</span><span>非常同意</span></div>
  `;

  const scale = buildLikert7('q' + it.id, (raw)=>{
    CORE_ANSWERS.set(it.id, raw);
    if(node.getAttribute('data-next-spawned') !== '1'){
      node.setAttribute('data-next-spawned','1');
      const nextIdx = idx + 1;
      renderOneItem(nextIdx);
      const nextEl = form.querySelector(`[data-q-idx="${nextIdx}"]`);
      if(nextEl){
        setTimeout(()=> nextEl.scrollIntoView({ behavior:'smooth', block:'center' }), 60);
      }
    }
  });

  node.appendChild(scale);
  form.appendChild(node);
}

function readCoreSurvey(){
  if(CORE_ANSWERS.size < CORE_ITEMS.length) return {ok:false};
  const out = {};
  for(const it of CORE_ITEMS){
    const raw = CORE_ANSWERS.get(it.id);
    if(typeof raw !== 'number') return {ok:false};
    out[it.id] = raw;
  }
  return {ok:true, answers: out};
}

/* ---------- 估计 R/J/E & E′ ---------- */
function estimate_theta_core(answers){
  // 按权重与正反向聚合
  const acc = { R:{num:0,den:0}, J:{num:0,den:0}, E:{num:0,den:0} };
  for(const it of CORE_ITEMS){
    const raw = answers[it.id];
    const score = mapLikertToFive(raw); // 1..5
    const baseW = (typeof it.w === 'number') ? it.w : 1.0;

    [['R',it.R],['J',it.J],['E',it.E]].forEach(([k,coef])=>{
      const c = Number(coef)||0;
      if(c === 0) return;
      const w = Math.abs(baseW * c);
      const signed = (c >= 0) ? score : (6 - score);  // 反向题：1↔5
      acc[k].num += w * signed;
      acc[k].den += w;
    });
  }

  const avg = x => x.den>0 ? (x.num/x.den) : 3.0;
  const R = clip(avg(acc.R));
  const J = clip(avg(acc.J));
  const E = clip(avg(acc.E));

  // 残差 E′ = E - beta*R （由配置给出 beta_RE）
  const beta = (CORE_CFG && typeof CORE_CFG.beta_RE === 'number') ? CORE_CFG.beta_RE : 0.65;
  const E_resid = clip(E - beta * (R - 3) - (3 - beta*0)); // 以 3 为中心的近似校正
  // 上式做一个中心化近似：让 R=3 时 E′≈E；R 偏高时适度扣减

  return { R:+R.toFixed(2), J:+J.toFixed(2), E:+E.toFixed(2), E_resid:+E_resid.toFixed(2) };
}

/* ---------- 原型判别 ---------- */
function classify_core(theta){
  // 欧氏距离 + softmax 相似度
  const centers = (CORE_CFG && Array.isArray(CORE_CFG.prototypes)) ? CORE_CFG.prototypes : [];
  const rows = centers.map(p=>{
    const dx = (theta.R - p.center.R);
    const dy = (theta.J - p.center.J);
    const dz = ((theta.E_resid ?? theta.E) - (p.center.E_resid ?? p.center.E));
    const d = Math.sqrt(dx*dx + dy*dy + dz*dz);
    return { id:p.id, label:p.label||p.id, dist:d };
  }).sort((a,b)=> a.dist - b.dist);

  // 相似度（越近越大）：sim = exp(-0.5 * d^2)
  const sims = rows.map(r=>Math.exp(-0.5 * r.dist * r.dist));
  const sum = sims.reduce((a,b)=>a+b,0) || 1;
  rows.forEach((r,i)=> r.sim = +(sims[i]/sum).toFixed(4));

  return rows;
}

/* ---------- 报告 ---------- */
function renderCoreReport(theta, ranks){
  $('#survey')?.classList.add('hidden');
  const wrap = $('#reportContent');
  if(!wrap) return;

  const topN = ranks.slice(0,3);
  const lines = [];
  lines.push(`<p><strong>核心三轴（1–5）</strong></p>`);
  lines.push(`<ul>
    <li>反身/觉察 R：${theta.R}</li>
    <li>外部正当化 J：${theta.J}</li>
    <li>去魅残差 E′：${theta.E_resid} <span style="color:#888">(原始 E=${theta.E})</span></li>
  </ul>`);

  lines.push(`<p><strong>宏姿态候选</strong></p>`);
  lines.push(`<ol>` + topN.map(r=>(
    `<li>${r.label} <span style="color:#888">（相似度 ${r.sim}，距离 ${r.dist.toFixed(3)}）</span></li>`
  )).join('') + `</ol>`);

  wrap.innerHTML = lines.join('\n');
  $('#report')?.classList.remove('hidden');
  window.__coreReport = { theta, ranks };
}

/* ---------- 入口 ---------- */
function initCoreUI(){
  const btnStart   = $('#startBtn');
  const btnSubmit  = $('#submitSurvey');

  if(btnStart){
    btnStart.addEventListener('click', ()=>{
      $('#intro')?.classList.add('hidden');
      $('#survey')?.classList.remove('hidden');
      startCoreSurvey();
    });
  }

  if(btnSubmit){
    btnSubmit.addEventListener('click', ()=>{
      const read = readCoreSurvey();
      if(!read.ok){ alert('还有题未作答。'); return; }
      const theta = estimate_theta_core(read.answers);
      const ranks = classify_core(theta);
      renderCoreReport(theta, ranks);
    });
  }
}

window.addEventListener('DOMContentLoaded', async ()=>{
  try{
    await loadCore();
    initCoreUI();
  }catch(e){
    console.error(e);
    alert('Core 加载失败：' + e.message);
  }
});
