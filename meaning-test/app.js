/* ===== 意义姿态测试 app.js — 精修稳定版 ===== */

/* ---------- 资源路径 ---------- */
const cfgPath = './app.config.json';
const mbtiPriorPath = './mbti.prior.config.json';
const itemsPathV2 = './items.baseline.v2.json';
const itemsPathV1 = './items.baseline.json';

/* ---------- 全局状态 ---------- */
let CFG = null;
let MBTI = null;
/** 统一题库：{id, text, w, A,C,D,M,S,L} */
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

/* ---------- 加载 ---------- */
async function tryFetchJSON(path){
  try{
    const r = await fetch(path);
    if(!r.ok) throw new Error(path + ' not ok');
    return await r.json();
  }catch(e){ return null; }
}

async function loadAll(){
  const [cfg, prior] = await Promise.all([
    fetch(cfgPath).then(r=>r.json()),
    fetch(mbtiPriorPath).then(r=>r.json())
  ]);
  CFG = cfg; MBTI = prior;

  let v2 = await tryFetchJSON(itemsPathV2);
  if (Array.isArray(v2) && v2.length){
    ITEMS = v2.map(n => ({
      id: n.id,
      text: n.text || n.stem || ('Q' + n.id),
      w:   (typeof n.w === 'number' ? n.w : 1.0),
      A: n.A||0, C: n.C||0, D: n.D||0, M: n.M||0, S: n.S||0, L: n.L||0
    }));
  }else{
    const v1 = await tryFetchJSON(itemsPathV1);
    if(!Array.isArray(v1) || !v1.length) throw new Error('题库加载失败');
    ITEMS = v1.map(n => ({
      id: n.id,
      text: n.text || n.stem || ('Q' + n.id),
      w: (typeof n.weight === 'number' ? n.weight : 1.0),
      A: 0, C: 0, D: 0, M: 0, S: 0, L: 0
    }));
  }
}

/* ---------- 初始化入口 ---------- */
function init(){
  const btnStart   = $('#startBtn');
  const btnToSurvey= $('#toSurvey');
  const btnSubmit  = $('#submitSurvey');
  const btnDownload= $('#download');
  const btnRestart = $('#restart');

  if(btnStart){
    btnStart.addEventListener('click', ()=>{
      const intro = $('#intro');
      const mbti  = $('#mbti');
      if(intro) intro.classList.add('hidden');
      if(mbti)  mbti.classList.remove('hidden');
      initMBTIDropdowns(); // 初始化 MBTI 交互
    });
  }

  if(btnToSurvey){
    btnToSurvey.addEventListener('click', ()=>{
      const mbti  = $('#mbti');
      const survey= $('#survey');
      if(mbti)  mbti.classList.add('hidden');
      if(survey) survey.classList.remove('hidden');
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

/* ---------- MBTI 交互（四轴侧滑菜单 + 150ms 延时；适配 .mbti-rail / #mbti-none） ---------- */
function initMBTIDropdowns(){
  const rail     = document.querySelector('.mbti-rail');   // ← 适配你的 HTML
  const untested = document.querySelector('#mbti-none');   // ← 适配你的 HTML
  if(!rail) return;

  const selects = Array.from(rail.querySelectorAll('.mbti-select'));

  selects.forEach(sel=>{
    let openTimer=null, closeTimer=null;
    const cur  = sel.querySelector('.mbti-current');
    const menu = sel.querySelector('.mbti-menu');
    const items= Array.from(menu.querySelectorAll('li[data-v]'));

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
    menu.addEventListener('click', e=>{
      const li = e.target.closest('li[data-v]');
      if(!li) return;
      const v = li.getAttribute('data-v') || '';
      sel.dataset.value = v;                                // ← 不再依赖隐藏 input
      items.forEach(x=>x.classList.remove('is-active'));
      li.classList.add('is-active');
      if(cur) cur.textContent = (v==='' ? '未填' : v);
      sel.classList.remove('mt-open');
    });
  });

  // “未测”只禁用四个选择器，不禁用自身
  if(untested){
    untested.addEventListener('change', ()=>{
      const dis = untested.checked;
      selects.forEach(sel=>{
        sel.classList.toggle('is-disabled', dis);
        if(dis){
          sel.dataset.value = '';
          const cur = sel.querySelector('.mbti-current');
          cur && (cur.textContent='未填');
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


  // —— 新结构：隐藏 input —— 
  const eiNew = $('#mbti-ei'), nsNew = $('#mbti-ns'), ftNew = $('#mbti-ft'), pjNew = $('#mbti-pj');
  let ei = eiNew ? (eiNew.value||'') : '';
  let ns = nsNew ? (nsNew.value||'') : '';
  let ft = ftNew ? (ftNew.value||'') : '';
  let pj = pjNew ? (pjNew.value||'') : '';

  // —— 旧结构回退：EI 用一组 radio，其余三轴 select —— 
  if(!eiNew && !nsNew && !ftNew && !pjNew){
    const eiRadio = $$('input[name="ei"]');
    const picked  = eiRadio.find(x=>x.checked);
    ei = picked ? (picked.value||'') : '';
    ns = ($('#ns')?.value || '');
    ft = ($('#ft')?.value || '');
    pj = ($('#pj')?.value || '');
  }

  if(ei==='' && ns==='' && ft==='' && pj==='') return null;

  function pairProb(v, a, b){
    if(v==='') return null;
    if(v==='X') return { [a]:0.5, [b]:0.5 };
    if(v===a)  return { [a]:1.0, [b]:0.0 };
    if(v===b)  return { [a]:0.0, [b]:1.0 };
    return null;
  }
  const eiP = pairProb(ei,'I','E') || {I:0.5,E:0.5};
  const nsP = pairProb(ns,'N','S') || {N:0.5,S:0.5};
  const ftP = pairProb(ft,'F','T') || {F:0.5,T:0.5};
  const pjP = pairProb(pj,'P','J') || {P:0.5,J:0.5};

  const xCount = [ei,ns,ft,pj].filter(v=>v==='X').length;
  const unset  = [ei,ns,ft,pj].filter(v=>v==='').length;

  return { prob:{...eiP, ...nsP, ...ftP, ...pjP}, meta:{xCount, unset} };
}

/* ---------- Progressive 问卷 ---------- */
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

    // 改变选中态（可重复选择，不锁定）
    input.addEventListener('change', ()=>{
      // 清除旧态
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

/** 渲染单题（确保不会重复渲染下一题） */
function renderOneItem(idx){
  const form = $('#surveyForm');
  if(!form) return;

  if(idx >= ITEMS.length){
    // 所有题渲染完，显示提交
    const actions = $('#submitSurvey')?.closest('.actions');
    if(actions) actions.style.display = 'flex';
    return;
  }

  // 如果该题 DOM 已存在，则不重复创建
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
    // 记录答案
    ANSWERS.set(it.id, raw);
    // 若未触发下一题，则只触发一次
    if(node.getAttribute('data-next-spawned') !== '1'){
      node.setAttribute('data-next-spawned', '1');
      // 渲染下一题
      const nextIdx = idx + 1;
      renderOneItem(nextIdx);
      // 滚动到新出场的题
      const nextEl = form.querySelector(`[data-q-idx="${nextIdx}"]`);
      if(nextEl){
        // 微延时，等待布局稳定
        setTimeout(()=>{
          nextEl.scrollIntoView({ behavior:'smooth', block:'center' });
        }, 60);
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

/* ---------- 计分：带符号多维加权 ---------- */
function computeSurveyDims(answers){
  const acc = {
    A:{num:0, den:0}, C:{num:0, den:0}, D:{num:0, den:0},
    M:{num:0, den:0}, S:{num:0, den:0}, L:{num:0, den:0}
  };
  for(const it of ITEMS){
    const raw = answers[it.id];
    const score = mapLikertToFive(raw); // 1..5
    const w = (typeof it.w === 'number') ? it.w : 1.0;

    [['A',it.A],['C',it.C],['D',it.D],['M',it.M],['S',it.S],['L',it.L]]
    .forEach(([k,coef])=>{
      const c = Number(coef)||0;
      if(c===0) return;
      const weightAbs = Math.abs(w * c);
      const signed    = (c >= 0) ? score : (6 - score); // 反向：1->5, 5->1
      acc[k].num += weightAbs * signed;
      acc[k].den += weightAbs;
    });
  }
  const avg = x => x.den > 0 ? (x.num / x.den) : 3.0;
  return {
    A_s: clip(avg(acc.A)), C_s: clip(avg(acc.C)), D_s: clip(avg(acc.D)),
    M_s: clip(avg(acc.M)), S_s: clip(avg(acc.S)), L_s: clip(avg(acc.L))
  };
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

function scoreAll(read){
  const mbti = readMBTIProbs();
  const dims = computeSurveyDims(read.answers);

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
    L: +dims.L_s.toFixed(2),
    prior: mbti ? {A_p, C_p, D_p, alpha:+alpha.toFixed(3)} : null,
    survey_raw: dims
  };

  // 宏类型粗判（与你之前规则一致）
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
  }else if(report.A >= 3.0 && report.D <= tMid){
    if(report.C >= 4.0) macro = "B0 建构—高建构依赖";
    else if(report.C >= 3.0 && report.L <= 3.0) macro = "B1 建构—局部建构（候选）";
    else if(report.C < 2.5 && report.M >= 3.5) macro = "B3 建构—功能主义姿态（候选）";
    else macro = "B2 建构—透明虚构（候选）";
  }else{
    macro = "B2 建构—透明虚构（候选）";
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
    <li>动因模式 M：${res.M}</li>
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
  await loadAll();
  init();
});
