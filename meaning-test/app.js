/* ===== 意义姿态测试 app.js — v3（修复“总是3分” & 正确读取v2题库权重） =====
 *
 * 这份文件可直接替换你当前的 app.js。
 * 主要修复点：
 * 1) 正确解析 items.baseline.v2.json / items.baseline.json 中的 weights 结构
 *    （例如 {A: +1, C: -0.6, ..., M_aff: +0.8, M_func: -0.4}）。
 * 2) 计分采用“带符号多维加权”，并分别计算 M_func 与 M_aff 两个子分数。
 * 3) 宏类型判读中，功能主义姿态（B3）改用 M_func_s 作为触发条件。
 *
 * 结构导航：
 * - 资源路径常量
 * - 全局状态（CFG / MBTI / ITEMS / ANSWERS 等）
 * - 小工具函数（mapLikertToFive / clip / sleep / escapeHTML）
 * - 加载模块 loadAll()  ←★ 修复点（解析 weights）
 * - 初始化入口 init()   ← 绑定按钮，进入 MBTI / 问卷
 * - MBTI 交互 initMBTIDropdowns() / readMBTIProbs()
 * - Progressive 问卷：startProgressiveSurvey() / buildLikert7() / renderOneItem() / readSurvey()
 * - 计分：computeSurveyDims()   ←★ 修复点（累计 A/C/D/S/L + M_func/M_aff）
 * - 先验与融合：alphaFromMBTI() / priorsFromProbs() / scoreAll()
 * - 报告渲染 renderReport()
 * - 下载 downloadJSON()
 * - 启动 DOMContentLoaded
 */

/* ---------- 资源路径 ---------- */
const cfgPath = './app.config.json';
const mbtiPriorPath = './mbti.prior.config.json';
const itemsPathV2 = './items.baseline.v2.json';
const itemsPathV1 = './items.baseline.json';

/* ---------- 全局状态 ---------- */
let CFG = null;
let MBTI = null;
/** 统一题库项：
 * {
 *   id, text, w(题目整体权重，默认1.0),
 *   A,C,D,S,L (数值系数，可正可负),
 *   M_func, M_aff (动因子维度)
 * }
 */
let ITEMS = [];
/** 答案：Map<id, raw(1..7)> */
const ANSWERS = new Map();
/** 当前要渲染的题目索引（0-based） */
let currentIndex = 0;

/* ---------- DOM 快捷 ---------- */
const $  = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

/* ---------- 工具 ---------- */
function mapLikertToFive(raw){ return 1 + (raw - 1) * (4/6); }
function clip(x, lo=1, hi=5){ return Math.max(lo, Math.min(hi, x)); }
const sleep = ms => new Promise(r=>setTimeout(r, ms));
function escapeHTML(s){
  return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}

/* ---------- 加载：读取配置 + 题库（★修复“权重未解析”） ----------
 * 题库 v2/v1 均使用：{ id, text, w?, weights:{A,C,D,S,L,M_func,M_aff} }
 * 过去版本错误地读取了 n.A / n.C… 导致全为 0；这会使分母=0 → 默认3分。
 * 这里统一按 weights 表驱动生成内部 ITEMS 结构。
 */
async function tryFetchJSON(path){
  try{
    const r = await fetch(path);
    if(!r.ok) throw new Error(path + ' not ok');
    return await r.json();
  }catch(e){ return null; }
}

function normalizeItem(node){
  const weights = node.weights || {};
  return {
    id   : node.id,
    text : node.text || node.stem || ('Q' + node.id),
    w    : (typeof node.w === 'number' ? node.w : 1.0),
    A    : +weights.A    || 0,
    C    : +weights.C    || 0,
    D    : +weights.D    || 0,
    S    : +weights.S    || 0,
    L    : +weights.L    || 0,
    // 动因：分别处理功能/情感两个子维度；若只有 M 则可在此兼容性映射
    M_func: +weights.M_func || 0,
    M_aff : +weights.M_aff  || 0,
  };
}

// ---- 在 loadAll() 内，替换 v2 分支 ----
let v2 = await tryFetchJSON(itemsPathV2);
if (Array.isArray(v2) && v2.length){
  ITEMS = v2.map(n => {
    const w = n.weights || {};
    return {
      id: n.id,
      text: n.text || n.stem || ('Q' + n.id),
      // 统一字段：A/C/D/S/L + M_func/M_aff；默认 0
      A: +w.A || 0,
      C: +w.C || 0,
      D: +w.D || 0,
      S: +w.S || 0,
      L: +w.L || 0,
      M_func: +w.M_func || 0,
      M_aff: +w.M_aff || 0,
      // 题面权重（整体重要度），若日后需要可额外加；先默认 1
      w: (typeof n.w === 'number' ? n.w : 1.0),
      meta: {
        is_attention: !!n.is_attention,
        duplicate_of: n.duplicate_of || null
      }
    };
  });

  // —— 可控随机出题（打散同类）——
  // 1) 先按“主导维度”归桶（看绝对权重最大的维度）
  const buckets = {A:[],C:[],D:[],M:[],S:[],L:[]};
  ITEMS.forEach(it=>{
    const absMap = {
      A: Math.abs(it.A), C: Math.abs(it.C), D: Math.abs(it.D),
      M: Math.max(Math.abs(it.M_func||0), Math.abs(it.M_aff||0)), // M 取两者的较大值做主导参考
      S: Math.abs(it.S), L: Math.abs(it.L)
    };
    let dom = 'A', maxv = absMap.A;
    for(const k of ['C','D','M','S','L']){
      if(absMap[k] > maxv){ dom = k; maxv = absMap[k]; }
    }
    buckets[dom].push(it);
  });

  // 2) 每个桶内部做可复现打乱（用 URL ?seed=xxx 控制）
  const seed = (new URL(location.href)).searchParams.get('seed') || 'mt-seed';
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
  for(const k in buckets){ buckets[k] = seededShuffle(buckets[k], seed + '-' + k); }

  // 3) 轮盘式交错抽题：A→C→D→M→S→L 轮转，尽量避免同类连在一起
  const order = [];
  const keys = ['A','C','D','M','S','L'];
  let has = true, p = 0;
  while(has){
    has = false;
    for(let step=0; step<keys.length; step++){
      const k = keys[(p+step)%keys.length];
      if(buckets[k].length){
        order.push(buckets[k].shift());
        has = true;
      }
    }
    p++;
  }
  ITEMS = order;
}

/* ---------- 初始化入口：绑定按钮/切换卡片 ---------- */
function init(){
  const btnStart   = $('#startBtn');
  const btnToSurvey= $('#toSurvey');
  const btnSubmit  = $('#submitSurvey');
  const btnDownload= $('#download');
  const btnRestart = $('#restart');

  if(btnStart){
    btnStart.addEventListener('click', ()=>{
      $('#intro')?.classList.add('hidden');
      $('#mbti')?.classList.remove('hidden');
      initMBTIDropdowns(); // 初始化 MBTI 交互
    });
  }

  if(btnToSurvey){
    btnToSurvey.addEventListener('click', ()=>{
      $('#mbti')?.classList.add('hidden');
      $('#survey')?.classList.remove('hidden');
      startProgressiveSurvey();
    });
  }

  if(btnSubmit){
    btnSubmit.addEventListener('click', ()=>{
      const read = readSurvey();
      if(!read.ok){ alert('还有题未作答。'); return; }
      const result = scoreAll(read);
      renderReport(result);
    });
  }

  if(btnDownload) btnDownload.addEventListener('click', downloadJSON);
  if(btnRestart)  btnRestart.addEventListener('click', ()=>location.reload());
}

/* ---------- MBTI 交互（四轴卡片式：点击/悬停展开 + 150ms 延迟） ----------
 * HTML 结构（见 index.html）：
 * .mbti-rail > .mbti-item[data-axis]
 *   > .axis
 *   > .mbti-select[data-target="ei/ns/ft/pj"][data-value=""]
 *       .mbti-current(按钮)
 *       ul.mbti-menu > li[data-v] （'' / 轴两端字母 / 'X'）
 * 未测复选框：#mbti-none
 */
function initMBTIDropdowns(){
  const rail     = document.querySelector('.mbti-rail');
  const untested = document.querySelector('#mbti-none');
  if(!rail) return;

  const selects = Array.from(rail.querySelectorAll('.mbti-select'));

  selects.forEach(sel=>{
    let openTimer=null, closeTimer=null;
    const cur  = sel.querySelector('.mbti-current');
    const menu = sel.querySelector('.mbti-menu');

    // 悬停 150ms 展开 / 离开 160ms 收起
    sel.addEventListener('mouseenter', ()=>{
      clearTimeout(closeTimer);
      openTimer = setTimeout(()=> sel.classList.add('mt-open'), 150);
    });
    sel.addEventListener('mouseleave', ()=>{
      clearTimeout(openTimer);
      closeTimer = setTimeout(()=> sel.classList.remove('mt-open'), 160);
    });

    // 点击当前框立即展开
    cur && cur.addEventListener('click', ()=>{
      clearTimeout(closeTimer);
      sel.classList.add('mt-open');
    });

    // 点击选项：写入 data-value，更新文案与高亮
    if(menu){
      menu.addEventListener('click', e=>{
        const li = e.target.closest('li[data-v]');
        if(!li) return;
        const v = li.getAttribute('data-v') || '';
        sel.dataset.value = v;
        menu.querySelectorAll('li').forEach(x=>x.classList.remove('is-active'));
        li.classList.add('is-active');
        if(cur) cur.textContent = (v==='' ? '未填' : v);
        sel.classList.remove('mt-open');
      });
    }
  });

  // “未测”只禁用四个选择器；取消勾选即可恢复
  if(untested){
    untested.addEventListener('change', ()=>{
      const dis = untested.checked;
      selects.forEach(sel=>{
        sel.classList.toggle('is-disabled', dis);
        if(dis){
          sel.dataset.value = '';
          const cur = sel.querySelector('.mbti-current');
          if(cur) cur.textContent = '未填';
          sel.querySelectorAll('.mbti-menu li').forEach(x=>x.classList.remove('is-active'));
        }
      });
    });
  }
}

/** 读取 MBTI 概率（从 .mbti-select 的 data-value 读取；未测→null） */
function readMBTIProbs(){
  const untested = document.querySelector('#mbti-none');
  if(untested && untested.checked) return null;

  const get = axis => {
    const el = document.querySelector(`.mbti-select[data-target="${axis}"]`);
    return el ? (el.dataset.value || '') : '';
  };
  const ei = get('ei'), ns = get('ns'), ft = get('ft'), pj = get('pj');

  if(ei==='' && ns==='' && ft==='' && pj==='') return null;

  const pair = (v,a,b)=>{
    if(v==='') return null;
    if(v==='X') return {[a]:0.5,[b]:0.5};
    if(v===a)  return {[a]:1.0,[b]:0.0};
    if(v===b)  return {[a]:0.0,[b]:1.0};
    return null;
  };
  const eiP = pair(ei,'I','E') || {I:0.5,E:0.5};
  const nsP = pair(ns,'N','S') || {N:0.5,S:0.5};
  const ftP = pair(ft,'F','T') || {F:0.5,T:0.5};
  const pjP = pair(pj,'P','J') || {P:0.5,J:0.5};

  const xCount = [ei,ns,ft,pj].filter(v=>v==='X').length;
  const unset  = [ei,ns,ft,pj].filter(v=>v==='').length;

  return { prob:{...eiP, ...nsP, ...ftP, ...pjP}, meta:{xCount, unset} };
}

/* ---------- Progressive 问卷：逐题出现 ---------- */
function startProgressiveSurvey(){
  ANSWERS.clear();
  currentIndex = 0;
  const form = $('#surveyForm');
  if(form) form.innerHTML = '';
  // 先隐藏提交按钮
  const actions = $('#submitSurvey')?.closest('.actions');
  if(actions) actions.style.display = 'none';
  // 渲染首题
  renderOneItem(currentIndex);
}

/** 构建 7 点小圆（整格热区），仅返回容器 */
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

    // 可重复选择，不锁定
    input.addEventListener('change', ()=>{
      wrap.querySelectorAll('.likert-option').forEach(k=>k.classList.remove('is-selected','tapped'));
      opt.classList.add('is-selected','tapped');
      setTimeout(()=>opt.classList.remove('tapped'), 130);
      const raw = parseInt(input.value,10);
      onPick(raw);
    });

    wrap.appendChild(opt);
  }
  return wrap;
}

/** 渲染单题（防重复渲染/防重复下一题） */
function renderOneItem(idx){
  const form = $('#surveyForm');
  if(!form) return;

  if(idx >= ITEMS.length){
    const actions = $('#submitSurvey')?.closest('.actions');
    if(actions) actions.style.display = 'flex';
    return;
  }

  if(form.querySelector(`[data-q-idx="${idx}"]`)) return;

  const it = ITEMS[idx];
  const node = document.createElement('div');
  node.className = 'item card slide-in';
  node.setAttribute('data-qid', it.id);
  node.setAttribute('data-q-idx', idx);

  node.innerHTML = `
    <h3 class="q-title">Q${idx+1}. ${escapeHTML(it.text)}</h3>
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
        setTimeout(()=>{ nextEl.scrollIntoView({ behavior:'smooth', block:'center' }); }, 60);
      }
    }
  });
  node.appendChild(scale);
  form.appendChild(node);
}

/** 读取答案（确认全答完） */
function readSurvey(){
  if(ANSWERS.size < ITEMS.length) return {ok:false};
  const out = {};
  for(const it of ITEMS){
    const raw = ANSWERS.get(it.id);
    if(typeof raw !== 'number') return {ok:false};
    out[it.id] = raw;
  }
  return {ok:true, answers: out};
}


function computeSurveyDims(answers){
  const acc = {
    A:{num:0, den:0}, C:{num:0, den:0}, D:{num:0, den:0},
    S:{num:0, den:0}, L:{num:0, den:0},
    M_func:{num:0, den:0}, M_aff:{num:0, den:0}
  };
  for(const it of ITEMS){
    const raw = answers[it.id];
    const score = mapLikertToFive(raw); // 1..5
    const baseW = (typeof it.w === 'number') ? it.w : 1.0;

    // 通用累计器
    function accOne(key, coef){
      const c = Number(coef)||0;
      if(c===0) return;
      const w = Math.abs(baseW * c);
      const signed = (c >= 0) ? score : (6 - score);
      acc[key].num += w * signed;
      acc[key].den += w;
    }

    accOne('A', it.A);
    accOne('C', it.C);
    accOne('D', it.D);
    accOne('S', it.S);
    accOne('L', it.L);
    accOne('M_func', it.M_func);
    accOne('M_aff',  it.M_aff);
  }

  const avg = x => x.den > 0 ? (x.num / x.den) : 3.0;
  const m_func = clip(avg(acc.M_func));
  const m_aff  = clip(avg(acc.M_aff));
  // 输出一个 M_s 供现有报告用（不丢信息：也把子分一并塞进 survey_raw 里）
  const M_s = Math.max(m_func, m_aff);

  return {
    A_s: clip(avg(acc.A)),
    C_s: clip(avg(acc.C)),
    D_s: clip(avg(acc.D)),
    S_s: clip(avg(acc.S)),
    L_s: clip(avg(acc.L)),
    M_s,
    M_detail: {m_func, m_aff}
  };
}


  const avg = x => x.den > 0 ? (x.num / x.den) : 3.0;

  return {
    A_s: clip(avg(acc.A)),
    C_s: clip(avg(acc.C)),
    D_s: clip(avg(acc.D)),
    S_s: clip(avg(acc.S)),
    L_s: clip(avg(acc.L)),
    M_func_s: clip(avg(acc.M_func)),
    M_aff_s : clip(avg(acc.M_aff))
  };
}

/* ---------- 自相矛盾/两极并存指数 → 注入 L（领域一致）惩罚 ---------- */
/**
 * 思路：针对 A/C/D 三维，分别统计“正向条目均分”(pos) 与 “反向条目均分”(neg)。
 * 若 pos 与 neg 都明显 >3（同意区），说明同一维度上出现“同时赞同对立叙事”，
 * 这定义为两极并存（自相矛盾）信号。取三维的平均作为 ci∈[0,1]。
 * ci 越高，L 越低： L_adj = clip(L_s - 1.2 * ci, 1, 5)。
 */
function computeAmbivalenceFromAnswers(answers){
  const dims = ['A','C','D']; // 先聚焦 A/C/D 三维的自相矛盾
  const agg = {};
  dims.forEach(k=>{
    agg[k] = {pos:{num:0,den:0}, neg:{num:0,den:0}};
  });

  for(const it of ITEMS){
    const raw = answers[it.id];
    const score = mapLikertToFive(raw); // 1..5
    const w = (typeof it.w==='number'? it.w : 1.0);
    for(const k of dims){
      const c = Number(it[k]) || 0;
      if(c === 0) continue;
      const weightAbs = Math.abs(w * c);
      const signed = (c >= 0) ? score : (6 - score); // 反向：1->5, 5->1
      if(c >= 0){
        agg[k].pos.num += weightAbs * signed;
        agg[k].pos.den += weightAbs;
      }else{
        agg[k].neg.num += weightAbs * signed;
        agg[k].neg.den += weightAbs;
      }
    }
  }

  const res = {};
  let ambList = [];
  dims.forEach(k=>{
    const pos = agg[k].pos.den>0 ? (agg[k].pos.num/agg[k].pos.den) : 3.0;
    const neg = agg[k].neg.den>0 ? (agg[k].neg.num/agg[k].neg.den) : 3.0;
    // 把“>3 的强同意”映射到 [0,1]，同时高才算矛盾：取二者较小
    const posHi = Math.max(0, pos - 3) / 2; // 0..1
    const negHi = Math.max(0, neg - 3) / 2; // 0..1
    const amb   = Math.min(posHi, negHi);
    res[k] = {pos:+pos.toFixed(2), neg:+neg.toFixed(2), amb:+amb.toFixed(3)};
    ambList.push(amb);
  });

  // 还可加入“跨维冲突”项：C 与 D 同时很高的情形（可选）
  // const cOverlap = Math.max(0, (computeSurveyDims(answers).C_s - 3)/2) *
  //                  Math.max(0, (computeSurveyDims(answers).D_s - 3)/2);

  const ciMicro = ambList.length ? (ambList.reduce((a,b)=>a+b,0) / ambList.length) : 0;
  return { byDim: res, ci: +ciMicro.toFixed(3) };
}


/* ---------- MBTI 先验与融合 ---------- */
function alphaFromMBTI(meta){
  if(!meta) return 0.0;
  const x = meta.xCount;
  let base = (x>=1) ? 0.20 : 0.30;
  let cert = 1.0;
  if(x===1) cert = 0.67;
  else if(x===2) cert = 0.50;
  else if(x>=3) cert = 0.40;
  return base * cert;
}

function priorsFromProbs(p){
  const {A0,C0,D0} = MBTI.baseline;
  const cA = MBTI.coeff.A, cC = MBTI.coeff.C, cD = MBTI.coeff.D;
  const dNS = (p.N - p.S), dIE = (p.I - p.E), dPJ = (p.P - p.J), dTF = (p.T - p.F);
  let A = A0 + cA["N-S"]*dNS + cA["I-E"]*dIE + cA["P-J"]*dPJ + cA["N*T"]*(p.N*p.T) + cA["S*J"]*(p.S*p.J);
  let C = C0 + cC["J-P"]*(p.J - p.P) + cC["F-T"]*(p.F - p.T) + cC["S-N"]*(p.S - p.N) + cC["I-E"]*dIE + cC["S*J"]*(p.S*p.J);
  let D = D0 + cD["N-S"]*dNS + cD["T-F"]*dTF + cD["P-J"]*dPJ + cD["F*J"]*(p.F*p.J) + cD["N*P"]*(p.N*p.P);
  return {A_p:clip(A), C_p:clip(C), D_p:clip(D)};
}

function fuse(prior, survey, alpha){ return alpha*prior + (1-alpha)*survey; }

/* ---------- 总分与宏类型判读 ----------
 * - 动因 M 的展示：我们取 M = max(M_func_s, M_aff_s) 作为显示用强度；
 * - 但功能主义姿态（B3）的规则用 M_func_s（功能驱动强）触发。
 */
function scoreAll(read){
  const mbti = readMBTIProbs();
  const dims = computeSurveyDims(read.answers);

  // —— 自相矛盾指数（注入到 L）——
  const amb = computeAmbivalenceFromAnswers(read.answers);
  let L_adj = clip(dims.L_s - 1.2 * amb.ci, 1, 5); // 惩罚系数 1.2 可后续回归校正

  // —— 先验融合（仅 A/C/D）——
  let A_final = dims.A_s, C_final = dims.C_s, D_final = dims.D_s;
  let A_p=null, C_p=null, D_p=null, alpha=0.0;
  if(mbti){
    const pri = priorsFromProbs(mbti.prob);
    A_p = pri.A_p; C_p = pri.C_p; D_p = pri.D_p;
    alpha = alphaFromMBTI(mbti.meta);
    A_final = fuse(A_p, dims.A_s, alpha);
    C_final = fuse(C_p, dims.C_s, alpha);
    D_final = fuse(D_p, dims.D_s, alpha);
  }

  const report = {
    A: +A_final.toFixed(2),
    C: +C_final.toFixed(2),
    D: +D_final.toFixed(2),
    M: +dims.M_s.toFixed(2),
    S: +dims.S_s.toFixed(2),
    L: +L_adj.toFixed(2),                 // 用“惩罚后的 L”
    prior: mbti ? {A_p, C_p, D_p, alpha:+alpha.toFixed(3)} : null,
    survey_raw: {...dims, L_s_raw: dims.L_s}, // 额外保留“未惩罚 L”以便调参
    ambivalence: amb                       // 输出矛盾诊断细节（便于迭代）
  };

  // —— 宏类型初判（加入 A 的过渡带分流）——
  const tLow = 2.5, tMid = 3.5;
  let macro = null;

  if(report.A < tLow){
    macro = (report.C >= 3.5) ? "A1 未触及—高依赖外部建构" : "A0 未触及—低觉察沉浸";
  }
  else if(report.A >= tMid && report.D >= tMid){
    if(report.S >= 4.0){
      macro = "C2 去魅—彻底停滞/冻结（候选）";
    }else if(report.C <= 3.0 && report.L <= 3.0){
      macro = "C1 去魅—理想自由人（候选）";
    }else{
      macro = (report.C <= 2.5) ? "C0 去魅—“解”候选" : "C1/C2 去魅—待细分";
    }
  }
  else if(report.A >= 3.0 && report.D <= tMid){
    if(report.C >= 4.0) macro = "B0 建构—高建构依赖";
    else if(report.C >= 3.0 && report.L <= 3.0) macro = "B1 建构—局部建构（候选）";
    else if(report.C < 2.5 && report.M >= 3.5) macro = "B3 建构—功能主义姿态（候选）";
    else macro = "B2 建构—透明虚构（候选）";
  }
  // === 新增：A 的“过渡带”2.5–3.0 的细分 ===
  else if(report.A >= 2.5 && report.A < 3.0){
    if(report.D >= 3.6 && report.C <= 3.0){
      macro = "C-seed 去魅萌发（候选）";
    }else if(report.C >= 3.8 && report.D <= 3.2){
      macro = (report.L <= 3.0) ? "B1 建构—局部建构（边界）" : "B0 建构—高建构依赖（边界）";
    }else{
      macro = "过渡带—待观察（默认 B2 候选）";
    }
  }
  else{
    macro = "B2 建构—透明虚构（候选）";
  }

  report.macro_hint = macro;
  return report;
}


  // 展示用动因强度：取两者较大者；同时保留子分给判读
  const M_func = dims.M_func_s;
  const M_aff  = dims.M_aff_s;
  const M_show = Math.max(M_func, M_aff);

  const report = {
    A: +A_final.toFixed(2),
    C: +C_final.toFixed(2),
    D: +D_final.toFixed(2),
    M: +M_show.toFixed(2),         // 展示用
    M_func: +M_func.toFixed(2),    // 供逻辑判读
    M_aff : +M_aff.toFixed(2),     // 供逻辑判读
    S: +dims.S_s.toFixed(2),
    L: +dims.L_s.toFixed(2),
    prior: mbti ? {A_p, C_p, D_p, alpha:+alpha.toFixed(3)} : null,
    survey_raw: dims
  };

  // 宏类型粗判（与你之前规则一致，B3 用 M_func）
  const tLow = 2.5, tMid = 3.5;
  let macro = null;

  if(report.A < tLow){
    macro = (report.C >= 3.5) ? "A1 未触及—高依赖外部建构" : "A0 未触及—低觉察沉浸";
  }else if(report.A >= tMid && report.D >= tMid){
    if(report.S >= 4.0){
      macro = "C2 去魅—彻底停滞/冻结（候选）";
    }else if(report.C <= 3.0 && report.L <= 3.0){
      macro = "C1 去魅—理想自由人（候选）";
    }else{
      macro = (report.C <= 2.5) ? "C0 去魅—“解”候选" : "C1/C2 去魅—待细分";
    }
    } else if (report.A >= 2.5 && report.A < 3.0) {
  // —— A 过渡带的细分 —— 
  if (report.D >= 3.6 && report.C <= 3.0) {
    macro = "C-seed 去魅萌发（候选）";
  } else if (report.C >= 3.8 && report.D <= 3.2) {
    macro = (report.L <= 3.0) ? "B1 建构—局部建构（边界）" : "B0 建构—高建构依赖（边界）";
  } else {
    macro = "过渡带—待观察（默认 B2 候选）";
  }
} else {
  macro = "B2 建构—透明虚构（候选）";
}

  }
  report.macro_hint = macro;

  return report;
}

/* ---------- 报告 ---------- */
function renderReport(res){
  $('#survey')?.classList.add('hidden');
  const wrap = $('#reportContent');
  if(!wrap) return;
  const lines = [];
  lines.push(`<p><strong>六维得分</strong></p>`);
  lines.push(`<ul>
    <li>觉察 A：${res.A}</li>
    <li>建构依赖 C：${res.C}</li>
    <li>去魅 D：${res.D}</li>
    <li>动因模式 M：${res.M} <span style="color:#888">(功能 ${res.M_func} / 情感 ${res.M_aff})</span></li>
    <li>姿态稳定 S：${res.S}</li>
    <li>领域一致 L：${res.L}</li>
  </ul>`);
  if(res.prior){
    const dA = Math.abs(res.prior.A_p - res.survey_raw.A_s).toFixed(2);
    const dC = Math.abs(res.prior.C_p - res.survey_raw.C_s).toFixed(2);
    const dD = Math.abs(res.prior.D_p - res.survey_raw.D_s).toFixed(2);
    lines.push(`<p>先验影响系数 α=${res.prior.alpha}；先验-问卷差值 |ΔA|=${dA} |ΔC|=${dC} |ΔD|=${dD}</p>`);
  }else{
    lines.push(`<p>未使用 MBTI 先验。</p>`);
  }
  lines.push(`<p>宏类型初判：<span class="badge">${res.macro_hint}</span></p>`);
  wrap.innerHTML = lines.join('\n');
  $('#report')?.classList.remove('hidden');
  window.__meaningReport = res;
}

/* ---------- 下载 ---------- */
function downloadJSON(){
  const data = window.__meaningReport || {};
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'meaning-test-result.json';
  a.click();
  URL.revokeObjectURL(url);
}

/* ---------- 启动 ---------- */
window.addEventListener('DOMContentLoaded', async ()=>{
  await loadAll(); // ← 现在会正确解析 weights，从而不再是“全 3 分”
  init();
});

