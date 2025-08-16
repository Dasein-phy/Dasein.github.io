/* meaning-test/app.js — 四下拉 MBTI（稳健选择）+ 渐进出题 + 带符号多维加权
   自动注入三色变量：--mt-brand #718771, --mt-accent #FFD9A3, --mt-success #73AE52
*/

// ---------- 路径 ----------
const cfgPath = './app.config.json';
const mbtiPriorPath = './mbti.prior.config.json';
const itemsPathV2 = './items.baseline.v2.json';
const itemsPathV1 = './items.baseline.json';

// ---------- 全局状态 ----------
let CFG = null;
let MBTI = null;
let ITEMS = [];                  // {id, text, w, A,C,D,M,S,L}
let ANSWERS = new Map();         // id -> raw(1..7)
let revealedUntil = -1;          // 已经渲染到的索引
let currentIndex = 0;

// ---------- DOM 工具 ----------
const $  = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

// ---------- 小工具 ----------
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const clip  = (x, lo=1, hi=5) => Math.max(lo, Math.min(hi, x));
const mapLikertToFive = raw => 1 + (raw - 1) * (4/6);
function escapeHTML(s){
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
async function tryFetchJSON(path){
  try{ const r = await fetch(path); if(!r.ok) throw 0; return await r.json(); }
  catch{ return null; }
}

// ---------- 注入三色变量 ----------
function injectThemeColors(){
  const root = document.documentElement;
  [
    ['--mt-brand',   '#718771'],
    ['--mt-accent',  '#FFD9A3'],
    ['--mt-success', '#73AE52'],
    // 兼容站内旧变量名（有些样式会用）
    ['--brand',      '#718771'],
    ['--accent',     '#FFD9A3']
  ].forEach(([k,v])=> root.style.setProperty(k, v));
}

// ---------- 加载 ----------
async function loadAll(){
  const [cfg, prior] = await Promise.all([
    fetch(cfgPath).then(r=>r.json()),
    fetch(mbtiPriorPath).then(r=>r.json())
  ]);
  CFG = cfg; MBTI = prior;

  let v2 = await tryFetchJSON(itemsPathV2);
  if(v2 && Array.isArray(v2) && v2.length){
    ITEMS = v2.map(n => ({
      id: n.id,
      text: n.text || n.stem || ('Q' + n.id),
      w:   (typeof n.w === 'number' ? n.w : 1.0),
      A: n.A||0, C: n.C||0, D: n.D||0, M: n.M||0, S: n.S||0, L: n.L||0
    }));
  }else{
    const v1 = await tryFetchJSON(itemsPathV1);
    if(!v1) throw new Error('题库加载失败');
    ITEMS = v1.map(n => ({
      id: n.id,
      text: n.text || n.stem || ('Q' + n.id),
      w: (typeof n.weight === 'number' ? n.weight : 1.0),
      A: 0, C: 0, D: 0, M: 0, S: 0, L: 0
    }));
  }
}

// ---------- 初始化 ----------
function init(){
  injectThemeColors();

  // Intro → MBTI
  $('#startBtn')?.addEventListener('click', ()=>{
    $('#intro')?.classList.add('hidden');
    $('#mbti')?.classList.remove('hidden');
    initMBTIDropdowns();
  });

  // MBTI → Survey
  $('#toSurvey')?.addEventListener('click', ()=>{
    $('#mbti')?.classList.add('hidden');
    $('#survey')?.classList.remove('hidden');
    startProgressiveSurvey();
  });

  // 提交
  $('#submitSurvey')?.addEventListener('click', ()=>{
    const read = readSurvey();
    if(!read.ok){ alert('还有题未作答。'); return; }
    const result = scoreAll(read);
    renderReport(result);
  });

  // 下载/重启
  $('#download')?.addEventListener('click', downloadJSON);
  $('#restart')?.addEventListener('click', ()=>location.reload());
}

// ---------- MBTI：四个“右展开下拉”（稳健版：事件委托 + 文本兜底） ----------
function initMBTIDropdowns(){
  const rail     = $('#mbti-axes');         // .mbti-rail
  const untested = $('#mbti-untested');     // 未测勾选
  if(!rail) return;

  // 为每个选择器准备一个隐藏 input（取值）与初始文案
  rail.querySelectorAll('.mbti-select').forEach(sel=>{
    const axis = sel.getAttribute('data-axis'); // ei/ns/ft/pj
    if(!axis) return;

    // 隐藏 input
    let hidden = sel.querySelector('input[type="hidden"]');
    if(!hidden){
      hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.id   = `mbti-${axis}`;
      sel.appendChild(hidden);
    }

    // 初始文案
    const current = sel.querySelector('.mbti-current');
    if(current && !current.textContent.trim()){
      current.textContent = '未填';
    }
  });

  // —— 事件委托：点击 current 切换展开；点击 li 赋值（支持 data-v 或纯文本）——
  rail.addEventListener('click', e=>{
    // 点击 current：展开/收起（并收起兄弟）
    const cur = e.target.closest('.mbti-current');
    if(cur && rail.contains(cur)){
      const sel = cur.closest('.mbti-select');
      if(sel){
        sel.parentElement?.querySelectorAll('.mbti-select.mt-open').forEach(x=>{ if(x!==sel) x.classList.remove('mt-open'); });
        sel.classList.toggle('mt-open');
      }
      return;
    }

    // 点击选项 li
    const li = e.target.closest('.mbti-menu li');
    if(li && rail.contains(li)){
      const sel   = li.closest('.mbti-select');
      const axis  = sel?.getAttribute('data-axis');
      const menu  = sel?.querySelector('.mbti-menu');
      const curEl = sel?.querySelector('.mbti-current');
      const hidden= sel?.querySelector('input[type="hidden"]');
      if(!axis || !curEl || !hidden) return;

      const v = normalizeMBTIValue(axis, li.getAttribute('data-v'), li.textContent);
      hidden.value = v;                                      // 真实值
      curEl.textContent = (v==='' ? '未填' : v);             // 显示值（E/I/X… 或 未填）

      // 选中态高亮
      menu?.querySelectorAll('li').forEach(n=> n.classList.remove('is-active'));
      li.classList.add('is-active');

      sel.classList.remove('mt-open');                       // 收起
      e.stopPropagation();
      return;
    }
  });

  // 点击容器外：收起所有
  document.addEventListener('click', e=>{
    if(!rail.contains(e.target)){
      rail.querySelectorAll('.mbti-select.mt-open').forEach(s=> s.classList.remove('mt-open'));
    }
  });

  // “未测”勾选：清空并灰化；取消恢复
  if(untested){
    untested.addEventListener('change', ()=>{
      const disable = untested.checked;
      rail.classList.toggle('disabled', disable);
      rail.querySelectorAll('.mbti-select').forEach(sel=>{
        const curEl = sel.querySelector('.mbti-current');
        const hidden= sel.querySelector('input[type="hidden"]');
        if(disable){
          if(hidden) hidden.value = '';
          if(curEl)  curEl.textContent = '未填';
          sel.classList.remove('mt-open');
        }
      });
    });
  }
}

// 允许 data-v 缺失时通过文本兜底（E/I/X、N/S/X、F/T/X、P/J/X、未填）
function normalizeMBTIValue(axis, dataV, text){
  const fromAttr = (dataV ?? '').trim().toUpperCase();
  if(fromAttr) return fromAttr;

  const t = (text || '').trim().toUpperCase();
  if(t === '未填' || t === '未選' || t === '未选') return '';

  const allow = {
    ei: ['E','I','X'],
    ns: ['N','S','X'],
    ft: ['F','T','X'],
    pj: ['P','J','X'],
  }[axis] || [];

  return allow.includes(t) ? t : '';
}

// 读取 MBTI 概率（仅四下拉；若未测打勾 → null）
function readMBTIProbs(){
  const untested = $('#mbti-untested');
  if(untested && untested.checked) return null;

  // 优先从隐藏 input 读；没有则从 current 文本兜底
  function readAxis(axis){
    const hid = $(`#mbti-${axis}`);
    if(hid && hid.value !== undefined) return hid.value || '';
    const cur = $(`.mbti-select[data-axis="${axis}"] .mbti-current`);
    return normalizeMBTIValue(axis, '', cur?.textContent || '');
  }

  const ei = readAxis('ei');
  const ns = readAxis('ns');
  const ft = readAxis('ft');
  const pj = readAxis('pj');

  if(!ei && !ns && !ft && !pj) return null;

  const pairProb = (v,a,b)=>{
    if(v==='')  return null;
    if(v==='X') return {[a]:.5,[b]:.5};
    if(v===a)   return {[a]:1,[b]:0};
    return       {[a]:0,[b]:1};
  };

  const eiP = pairProb(ei,'I','E') || {I:.5,E:.5};
  const nsP = pairProb(ns,'N','S') || {N:.5,S:.5};
  const ftP = pairProb(ft,'F','T') || {F:.5,T:.5};
  const pjP = pairProb(pj,'P','J') || {P:.5,J:.5};

  const xCount = [ei,ns,ft,pj].filter(v=>v==='X').length;
  const unset  = [ei,ns,ft,pj].filter(v=>v==='').length;

  return { prob:{...eiP, ...nsP, ...ftP, ...pjP}, meta:{xCount, unset} };
}

// ---------- Progressive Survey ----------
function startProgressiveSurvey(){
  ANSWERS.clear();
  revealedUntil = -1;
  currentIndex = 0;

  const form = $('#surveyForm');
  form.innerHTML = '';

  renderOneItem(currentIndex);

  const actions = $('#submitSurvey')?.closest('.actions');
  if(actions) actions.style.display = 'none';
}

// 7 点小圆（与你的 styles.css 的 .dot-scale 对接）
function buildDotScale(name, onPick){
  const wrap = document.createElement('div');
  wrap.className = 'dot-scale';
  for(let v=1; v<=7; v++){
    const id = `${name}-${v}-${Math.random().toString(36).slice(2,7)}`;
    const label = document.createElement('label'); label.className = 'dot' + (v===4?' dot-center':'');
    const input = document.createElement('input'); input.type='radio'; input.name=name; input.value=String(v); input.id=id;
    const span  = document.createElement('span');
    label.appendChild(input); label.appendChild(span);

    input.addEventListener('change', ()=> onPick(parseInt(input.value,10)));
    wrap.appendChild(label);
  }
  return wrap;
}

function renderOneItem(idx){
  const form = $('#surveyForm');
  if(idx >= ITEMS.length){
    const actions = $('#submitSurvey')?.closest('.actions');
    if(actions) actions.style.display = 'flex';
    return;
  }
  if(idx <= revealedUntil) return;

  const it = ITEMS[idx];
  const node = document.createElement('div');
  node.className = 'item card slide-in';
  node.setAttribute('data-qid', it.id);
  node.innerHTML = `
    <h3 class="q-title">Q${idx+1}. ${escapeHTML(it.text)}</h3>
    <div class="scale-hint"><span>非常不同意</span><span>非常同意</span></div>
  `;

  const scale = buildDotScale('q'+it.id, async raw=>{
    const first = !ANSWERS.has(it.id);
    ANSWERS.set(it.id, raw);
    if(first){
      renderOneItem(idx+1);
      await sleep(30);
      const last = form.lastElementChild;
      if(last){
        last.scrollIntoView({behavior:'smooth', block:'center'});
        setTimeout(()=>{
          const rect = last.getBoundingClientRect();
          const y = window.scrollY + rect.top - Math.min(120, window.innerHeight*0.15);
          window.scrollTo({top:y, behavior:'smooth'});
        }, 80);
      }
    }
  });

  node.appendChild(scale);
  form.appendChild(node);
  revealedUntil = idx;
}

// ---------- 读取答案 ----------
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

// ---------- 带符号多维加权 ----------
function computeSurveyDims(answers){
  const acc = {
    A:{num:0, den:0}, C:{num:0, den:0}, D:{num:0, den:0},
    M:{num:0, den:0}, S:{num:0, den:0}, L:{num:0, den:0}
  };
  for(const it of ITEMS){
    const raw = answers[it.id];
    const score = mapLikertToFive(raw); // 1..5
    const w = (typeof it.w === 'number' ? it.w : 1.0);
    [['A',it.A],['C',it.C],['D',it.D],['M',it.M],['S',it.S],['L',it.L]].forEach(([k,coef])=>{
      const c = Number(coef)||0;
      if(c === 0) return;
      const weightAbs = Math.abs(w * c);
      const signed = (c >= 0) ? score : (6 - score); // 反向：1↔5
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

// ---------- MBTI 先验 ----------
function alphaFromMBTI(meta){
  if(!meta) return 0.0;
  const x = meta.xCount;
  let base = 0.30; if(x >= 1) base = 0.20;
  let cert = 1.0; if(x===1) cert=0.67; else if(x===2) cert=0.50; else if(x>=3) cert=0.40;
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
const fuse = (prior, survey, alpha) => alpha*prior + (1-alpha)*survey;

// ---------- 计分 + 初判 ----------
function scoreAll(read){
  const mbti = readMBTIProbs();
  const dims = computeSurveyDims(read.answers);

  let A_final = dims.A_s, C_final = dims.C_s, D_final = dims.D_s;
  let A_p=null,C_p=null,D_p=null,alpha=0.0;

  if(mbti){
    const pri = priorsFromProbs(mbti.prob);
    A_p = pri.A_p; C_p = pri.C_p; D_p = pri.D_p;
    alpha = alphaFromMBTI(mbti.meta);
    A_final = fuse(A_p, dims.A_s, alpha);
    C_final = fuse(C_p, dims.C_s, alpha);
    D_final = fuse(D_p, dims.D_s, alpha);
  }

  const res = {
    A: +A_final.toFixed(2),
    C: +C_final.toFixed(2),
    D: +D_final.toFixed(2),
    M: +dims.M_s.toFixed(2),
    S: +dims.S_s.toFixed(2),
    L: +dims.L_s.toFixed(2),
    prior: mbti ? {A_p, C_p, D_p, alpha:+alpha.toFixed(3)} : null,
    survey_raw: dims
  };

  const tLow = 2.5, tMid = 3.5;
  let macro = null;
  if(res.A < tLow){
    macro = (res.C >= 3.5) ? 'A1 未触及—高依赖外部建构' : 'A0 未触及—低觉察沉浸';
  }else if(res.A >= tMid && res.D >= tMid){
    if(res.S >= 4.0)                           macro = 'C2 去魅—彻底停滞/冻结（候选）';
    else if(res.C <= 3.0 && res.L <= 3.0)      macro = 'C1 去魅—理想自由人（候选）';
    else                                       macro = (res.C <= 2.5) ? 'C0 去魅—“解”候选' : 'C1/C2 去魅—待细分';
  }else if(res.A >= 3.0 && res.D <= tMid){
    if(res.C >= 4.0)                           macro = 'B0 建构—高建构依赖';
    else if(res.C >= 3.0 && res.L <= 3.0)      macro = 'B1 建构—局部建构（候选）';
    else if(res.C < 2.5 && res.M >= 3.5)       macro = 'B3 建构—功能主义姿态（候选）';
    else                                       macro = 'B2 建构—透明虚构（候选）';
  }else{
    macro = 'B2 建构—透明虚构（候选）';
  }
  res.macro_hint = macro;
  return res;
}

// ---------- 报告 ----------
function renderReport(res){
  $('#survey')?.classList.add('hidden');
  const wrap = $('#reportContent');
  const lines = [];
  lines.push('<p><strong>六维得分</strong></p>');
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
    lines.push('<p>未使用 MBTI 先验。</p>');
  }
  lines.push(`<p>宏类型初判：<span class="badge">${res.macro_hint}</span></p>`);
  wrap.innerHTML = lines.join('\n');
  $('#report')?.classList.remove('hidden');
  window.__meaningReport = res;
}

// ---------- 下载 ----------
function downloadJSON(){
  const data = window.__meaningReport || {};
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'meaning-test-result.json';
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- 启动 ----------
window.addEventListener('DOMContentLoaded', async ()=>{
  await loadAll();
  init();
});
