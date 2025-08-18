/* ===== Core Test app.core.js (R/J/E′) ===== */

/* ---------- DOM Helpers ---------- */
const $  = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

/* ---------- State ---------- */
let CORE_CFG = null;
let CORE_ITEMS = [];      // [{id,text,domain,weights:{R,J,E}, w?}, ...]
const ANSWERS = new Map();// id -> raw(1..7)
let currentIndex = 0;

/* ---------- Utils ---------- */
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const clip  = (x, lo=1, hi=5) => Math.max(lo, Math.min(hi, x));
const map7  = raw => (CORE_CFG?.core?.scale?.likert7_map || [1,1.67,2.33,3,3.67,4.33,5])[raw-1] || 3;
function escapeHTML(s){
  return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}
async function loadJSON(path){
  const r = await fetch(path);
  if(!r.ok) throw new Error('fetch fail: ' + path);
  return await r.json();
}

/* ---------- Load ---------- */
async function loadAll(){
  const cfgPath   = window.__CORE_CFG_PATH   || './app.core.config.json';
  const itemsPath = window.__CORE_ITEMS_PATH || './items.core.v1.json';
  CORE_CFG   = await loadJSON(cfgPath);
  CORE_ITEMS = await loadJSON(itemsPath);

  // 允许整体打乱（可传 ?seed=xxx）
  const seed = (new URL(location.href)).searchParams.get('seed') || '';
  if(seed){
    CORE_ITEMS = seededShuffle(CORE_ITEMS, seed);
  }
}
function seededShuffle(arr, s){
  let h = 2166136261;
  for(let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  const out = arr.slice();
  for(let i=out.length-1;i>0;i--){
    h ^= (h<<13); h ^= (h>>>7); h ^= (h<<17);
    const j = Math.abs(h) % (i+1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* ---------- UI Init ---------- */
function init(){
  const btnStart   = $('#startBtn');
  const btnSubmit  = $('#submitSurvey');

  if(btnStart){
    btnStart.addEventListener('click', ()=>{
      $('#intro')?.classList.add('hidden');
      $('#survey')?.classList.remove('hidden');
      startSurvey();
    });
  }
  if(btnSubmit){
    btnSubmit.addEventListener('click', ()=>{
      const read = readSurvey();
      if(!read.ok){ alert('还有题未作答。'); return; }
      const est  = estimate_theta(read.answers);
      const cls  = classify(est);
      renderReport(est, cls);
    });
  }
}

/* ---------- Progressive Survey ---------- */
function startSurvey(){
  ANSWERS.clear();
  currentIndex = 0;
  const form = $('#surveyForm');
  if(form) form.innerHTML = '';
  const actions = $('#submitSurvey')?.closest('.actions');
  if(actions) actions.style.display = 'none';
  renderOneItem(currentIndex);
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

  const dom = it.domain ? `<span class="badge">${escapeHTML(it.domain)}</span>` : '';
  node.innerHTML = `
    <h3 class="q-title">Q${idx+1}. ${escapeHTML(it.text)} ${dom}</h3>
    <div class="scale-hint"><span>非常不同意</span><span>非常同意</span></div>
  `;

  const scale = buildLikert7('q' + it.id, (raw)=>{
    ANSWERS.set(it.id, raw);
    if(node.getAttribute('data-next-spawned') !== '1'){
      node.setAttribute('data-next-spawned', '1');
      const nextIdx = idx + 1;
      renderOneItem(nextIdx);
      const nextEl = form.querySelector(`[data-q-idx="${nextIdx}"]`);
      if(nextEl){
        setTimeout(()=> nextEl.scrollIntoView({behavior:'smooth', block:'center'}), 60);
      }
    }
  });
  node.appendChild(scale);
  form.appendChild(node);
}

function readSurvey(){
  if(ANSWERS.size < CORE_ITEMS.length) return {ok:false};
  const out = {};
  for(const it of CORE_ITEMS){
    const v = ANSWERS.get(it.id);
    if(typeof v !== 'number') return {ok:false};
    out[it.id] = v;
  }
  return {ok:true, answers: out};
}

/* ---------- Core Estimation ---------- */
/**
 * estimate_theta(answers) -> { R, J, E, E_prime, byDomain:{...}, qc:{...} }
 * 简化版：按题目 weights 线性加权→域均值→全局均值；E′ = E - beta*R
 */
function estimate_theta(answers){
  const norms = CORE_CFG?.core?.norms || {};
  const beta  = typeof norms.beta_RE === 'number' ? norms.beta_RE : 0.6;

  // 累积器
  const acc = { R:{num:0,den:0}, J:{num:0,den:0}, E:{num:0,den:0} };
  const domainAcc = {};

  for(const it of CORE_ITEMS){
    const raw = answers[it.id];
    const score = map7(raw); // 1..5
    const w = (typeof it.w === 'number') ? it.w : 1.0;

    const ws = it.weights || {};
    for(const k of ['R','J','E']){
      const c = +ws[k] || 0;
      if(c===0) continue;
      const weightAbs = Math.abs(w * c);
      const signed    = (c >= 0) ? score : (6 - score);
      acc[k].num += weightAbs * signed;
      acc[k].den += weightAbs;

      const d = it.domain || 'GEN';
      domainAcc[d] = domainAcc[d] || {R:{num:0,den:0},J:{num:0,den:0},E:{num:0,den:0}};
      domainAcc[d][k].num += weightAbs * signed;
      domainAcc[d][k].den += weightAbs;
    }
  }

  const avg = x => x.den>0 ? (x.num/x.den) : 3.0;
  const R = clip(avg(acc.R)), J = clip(avg(acc.J)), E = clip(avg(acc.E));
  const E_prime = clip(E - beta * (R - 3) - 0 + 3); // 把回归扣除后的残差平移回 1..5 近似

  const byDomain = {};
  Object.keys(domainAcc).forEach(d=>{
    byDomain[d] = {
      R: clip(avg(domainAcc[d].R)),
      J: clip(avg(domainAcc[d].J)),
      E: clip(avg(domainAcc[d].E))
    };
  });

  // 简单质量指标（可扩展）
  const qc = {
    answered: ANSWERS.size,
    total: CORE_ITEMS.length
  };

  return { R:+R.toFixed(2), J:+J.toFixed(2), E:+E.toFixed(2), E_prime:+E_prime.toFixed(2), byDomain, qc };
}

/* ---------- Classification ---------- */
/**
 * classify(est) -> { top1, top2, ranks:[...], entropy, gap }
 */
function classify(est){
  const models = CORE_CFG?.models || [];
  if(!models.length) return { ranks:[], entropy:null, gap:null };

  // 以 E′ 参与
  const P = { R: est.R, J: est.J, E: est.E_prime };
  const sigma = 1.0;

  const withDist = models.map(m=>{
    const C = m.centroid || {};
    const d2 = Math.pow(P.R-(C.R||3),2) + Math.pow(P.J-(C.J||3),2) + Math.pow(P.E-(C.E||3),2);
    const dist = Math.sqrt(d2);
    const sim = Math.exp(-d2/(2*sigma*sigma));
    return { macro:m.macro, label:m.label, dist: +dist.toFixed(3), sim: +sim.toFixed(4) };
  }).sort((a,b)=> b.sim - a.sim);

  // softmax 概率
  const logits = withDist.map(x=>x.sim);
  const Z = logits.reduce((a,b)=>a+b,0) || 1;
  const probs = logits.map(x=>x/Z);
  const entropy = -probs.reduce((s,p)=> s + (p>0? p*Math.log(p):0), 0);

  // gap（Top1-Top2）
  const gap = (withDist[0]?.sim || 0) - (withDist[1]?.sim || 0);

  return {
    top1: withDist[0],
    top2: withDist[1],
    ranks: withDist,
    entropy: +entropy.toFixed(3),
    gap: +gap.toFixed(4)
  };
}

/* ---------- Report ---------- */
function renderReport(est, cls){
  $('#survey')?.classList.add('hidden');
  const wrap = $('#reportContent');
  if(!wrap) return;

  const lines = [];
  lines.push(`<p><strong>核心三轴（1–5）</strong></p>`);
  lines.push(`<ul>
    <li>反身/觉察 R：${est.R}</li>
    <li>外部正当化 J：${est.J}</li>
    <li>去魅残差 E′：${est.E_prime} <span style="color:#888">(原始E=${est.E})</span></li>
  </ul>`);

  if(cls?.top1){
    lines.push(`<p><strong>宏姿态候选</strong></p>`);
    lines.push(`<ul>
      <li>Top1：${cls.top1.macro}（${cls.top1.label}）<span style="color:#888"> 相似度 ${cls.top1.sim}，距离 ${cls.top1.dist}</span></li>
      <li>Top2：${cls.top2.macro}（${cls.top2.label}）<span style="color:#888"> 相似度 ${cls.top2.sim}，距离 ${cls.top2.dist}</span></li>
      <li>分布熵：${cls.entropy}；Top1–Top2 差距：${cls.gap}</li>
    </ul>`);
  }

  // 域分布
  if(est.byDomain && Object.keys(est.byDomain).length){
    lines.push(`<p><strong>按域分布</strong></p>`);
    const seg = Object.entries(est.byDomain).map(([d,v])=>`${d}: R=${v.R} J=${v.J} E=${v.E}`).join(' | ');
    lines.push(`<p>${seg}</p>`);
  }

  wrap.innerHTML = lines.join('\n');
  $('#report')?.classList.remove('hidden');
  window.__coreResult = { est, cls };
}

/* ---------- Boot ---------- */
window.addEventListener('DOMContentLoaded', async ()=>{
  try{
    await loadAll();
    init();
  }catch(e){
    console.error(e);
    alert('Core 加载失败：' + e.message);
  }
});
