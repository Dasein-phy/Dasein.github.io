/* meaning-test/app.js — 兼容版
   - MBTI 同时支持：旧版 radio+select & 新版四下拉 .mbti-select
   - 渐进出题 + 自动滚动 + 7点小圆
   - 带符号多维加权
   - 主题色注入：#718771, #FFD9A3, #73AE52
*/

// ---------- 配置与题库 ----------
const cfgPath = './app.config.json';
const mbtiPriorPath = './mbti.prior.config.json';
const itemsPathV2 = './items.baseline.v2.json';
const itemsPathV1 = './items.baseline.json';

// ---------- 全局 ----------
let CFG = null;
let MBTI = null;
let ITEMS = [];
let ANSWERS = new Map();
let revealedUntil = -1;

const $  = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

// ---------- 工具 ----------
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

// ---------- 主题色注入 ----------
function injectThemeColors(){
  const root = document.documentElement;
  [
    ['--mt-brand',   '#718771'],
    ['--mt-accent',  '#FFD9A3'],
    ['--mt-success', '#73AE52'],
    // 兼容站内其他用到的变量名
    ['--brand',      '#718771'],
    ['--accent',     '#FFD9A3'],
  ].forEach(([k,v])=> root.style.setProperty(k, v));
}

// ---------- 加载 ----------
async function loadAll(){
  const [cfg, prior] = await Promise.all([
    fetch(cfgPath).then(r=>r.json()),
    fetch(mbtiPriorPath).then(r=>r.json()),
  ]);
  CFG = cfg; MBTI = prior;

  let v2 = await tryFetchJSON(itemsPathV2);
  if(v2 && Array.isArray(v2) && v2.length){
    ITEMS = v2.map(n => ({
      id: n.id,
      text: n.text || n.stem || ('Q' + n.id),
      w:   (typeof n.w === 'number' ? n.w : 1.0),
      A: n.A||0, C: n.C||0, D: n.D||0, M: n.M||0, S: n.S||0, L: n.L||0,
    }));
  }else{
    const v1 = await tryFetchJSON(itemsPathV1);
    if(!v1) throw new Error('题库加载失败');
    ITEMS = v1.map(n => ({
      id: n.id,
      text: n.text || n.stem || ('Q' + n.id),
      w: (typeof n.weight === 'number' ? n.weight : 1.0),
      A: 0, C: 0, D: 0, M: 0, S: 0, L: 0,
    }));
  }
}

// ---------- 初始化 ----------
function init(){
  injectThemeColors();

  $('#startBtn')?.addEventListener('click', ()=>{
    $('#intro')?.classList.add('hidden');
    $('#mbti')?.classList.remove('hidden');
    setupMBTI();          // 兼容两种结构
  });

  $('#toSurvey')?.addEventListener('click', ()=>{
    $('#mbti')?.classList.add('hidden');
    $('#survey')?.classList.remove('hidden');
    startProgressiveSurvey();
  });

  $('#submitSurvey')?.addEventListener('click', ()=>{
    const read = readSurvey();
    if(!read.ok){ alert('还有题未作答。'); return; }
    const result = scoreAll(read);
    renderReport(result);
  });

  $('#download')?.addEventListener('click', downloadJSON);
  $('#restart')?.addEventListener('click', ()=>location.reload());
}

// =====================================================
// MBTI —— 双模式兼容
// =====================================================
function setupMBTI(){
  const rail = $('#mbti-axes');               // 新结构：四个 .mbti-select 的容器
  const untestedBox = $('#mbti-untested');    // 可选的“未测”复选框

  // 新结构存在 → 装配四下拉
  if(rail && rail.querySelector('.mbti-select')){
    const selects = rail.querySelectorAll('.mbti-select');
    selects.forEach(sel => setupOneDropdown(sel));

    // 点击空白收起
    document.addEventListener('click', (e)=>{
      if(!rail.contains(e.target)){
        selects.forEach(s=> s.classList.remove('mt-open'));
      }
    });

    // 未测复选框
    if(untestedBox){
      untestedBox.addEventListener('change', ()=>{
        applyUntestedState_New(untestedBox.checked);
      });
      // 初始同步一次
      applyUntestedState_New(untestedBox.checked);
    }
    return;
  }

  // —— 否则：回退到旧结构 —— //
  const radiosEI = $$('input[name="ei"]');     // I/E/X/（可能还有 value="" 表示未测）
  const selNS = $('#ns');
  const selFT = $('#ft');
  const selPJ = $('#pj');

  // 旧结构：若存在“未测”复选框也接上；否则从 ei 单选里找 value="" 的选项
  if(untestedBox){
    untestedBox.addEventListener('change', ()=>{
      if(untestedBox.checked){
        // 清空四轴
        clearOldAxes();
        setOldAxesDisabled(true);
      }else{
        setOldAxesDisabled(false);
      }
    });
    applyUntestedState_Old(untestedBox.checked);
  }else if(radiosEI && radiosEI.length){
    radiosEI.forEach(r=>{
      r.addEventListener('change', ()=>{
        if(r.value==='' && r.checked){
          // 把它当“未测”
          clearOldAxes();
          setOldAxesDisabled(true);
        }else{
          setOldAxesDisabled(false);
        }
      });
    });
  }

  function clearOldAxes(){
    // ei 设为未选择
    radiosEI?.forEach(r=> r.checked = false);
    // 其余三轴清空
    if(selNS) selNS.value = '';
    if(selFT) selFT.value = '';
    if(selPJ) selPJ.value = '';
  }
  function setOldAxesDisabled(disabled){
    [selNS, selFT, selPJ].forEach(s=>{
      if(s){ s.disabled = disabled; }
    });
  }
  function applyUntestedState_Old(flag){
    if(flag){
      clearOldAxes();
      setOldAxesDisabled(true);
    }else{
      setOldAxesDisabled(false);
    }
  }
}

// 新结构：装配一个右展开下拉
function setupOneDropdown(sel){
  const axis    = sel.getAttribute('data-axis'); // ei/ns/ft/pj
  const current = sel.querySelector('.mbti-current');
  const menu    = sel.querySelector('.mbti-menu');
  if(!axis || !current || !menu) return;

  // 隐藏 input 保存值
  let hidden = sel.querySelector('input[type="hidden"]');
  if(!hidden){
    hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.id   = `mbti-${axis}`;
    sel.appendChild(hidden);
  }

  current.addEventListener('click', (e)=>{
    e.stopPropagation();
    // 关闭兄弟
    sel.parentElement?.querySelectorAll('.mbti-select.mt-open')?.forEach(x=>{
      if(x!==sel) x.classList.remove('mt-open');
    });
    sel.classList.toggle('mt-open');
  });

  menu.querySelectorAll('li[data-v]').forEach(li=>{
    li.addEventListener('click', (e)=>{
      e.stopPropagation();
      const v = li.getAttribute('data-v') || '';
      hidden.value = v;
      current.textContent = li.textContent.trim() || '未填';
      menu.querySelectorAll('li').forEach(n=> n.classList.remove('is-active'));
      li.classList.add('is-active');
      sel.classList.remove('mt-open');
    });
  });
}

// 新结构：未测 → 统一置灰/清空
function applyUntestedState_New(flag){
  const rail = $('#mbti-axes');
  if(!rail) return;
  rail.classList.toggle('disabled', flag);
  rail.querySelectorAll('.mbti-select').forEach(sel=>{
    const hidden  = sel.querySelector('input[type="hidden"]');
    const current = sel.querySelector('.mbti-current');
    if(flag){
      if(hidden)  hidden.value = '';
      if(current) current.textContent = '未填';
      sel.classList.remove('mt-open');
    }
  });
}

// 读取 MBTI 概率（自动识别新/旧结构）
function readMBTIProbs(){
  const untestedBox = $('#mbti-untested');
  if(untestedBox && untestedBox.checked) return null;

  // —— 先读新结构的隐藏值 —— //
  const eiH = $('#mbti-ei')?.value || '';
  const nsH = $('#mbti-ns')?.value || '';
  const ftH = $('#mbti-ft')?.value || '';
  const pjH = $('#mbti-pj')?.value || '';
  if(eiH || nsH || ftH || pjH){
    return probsFromAxes(eiH, nsH, ftH, pjH);
  }

  // —— 回退旧结构 —— //
  const eiRadio = [...$$('input[name="ei"]')].find(x=>x.checked);
  const ei = eiRadio ? (eiRadio.value || '') : '';
  const ns = $('#ns')?.value || '';
  const ft = $('#ft')?.value || '';
  const pj = $('#pj')?.value || '';

  // 旧结构里：如果选中了 value="" 的 ei（表示“未测”），直接视为未测
  if(ei === '' && (eiRadio || (!ns && !ft && !pj))) return null;

  if(!ei && !ns && !ft && !pj) return null;
  return probsFromAxes(ei, ns, ft, pj);

  function probsFromAxes(ei, ns, ft, pj){
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
}

// =====================================================
// 问卷：逐题滑出 + 自动滚动
// =====================================================
function startProgressiveSurvey(){
  ANSWERS.clear();
  revealedUntil = -1;
  const form = $('#surveyForm');
  form.innerHTML = '';
  renderOneItem(0);
  const actions = $('#submitSurvey')?.closest('.actions');
  if(actions) actions.style.display = 'none';
}

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

async function renderOneItem(idx){
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
      await renderOneItem(idx+1);
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

// =====================================================
// 计分：带符号多维加权
// =====================================================
function computeSurveyDims(answers){
  const acc = {
    A:{num:0, den:0}, C:{num:0, den:0}, D:{num:0, den:0},
    M:{num:0, den:0}, S:{num:0, den:0}, L:{num:0, den:0}
  };
  for(const it of ITEMS){
    const raw = answers[it.id];
    const score = mapLikertToFive(raw);
    const w = (typeof it.w === 'number' ? it.w : 1.0);

    [['A',it.A],['C',it.C],['D',it.D],['M',it.M],['S',it.S],['L',it.L]].forEach(([k,coef])=>{
      const c = Number(coef)||0;
      if(c === 0) return;
      const weightAbs = Math.abs(w * c);
      const signed = (c >= 0) ? score : (6 - score);  // 反向
      acc[k].num += weightAbs * signed;
      acc[k].den += weightAbs;
    });
  }
  const avg = x => x.den>0 ? (x.num/x.den) : 3.0;
  return {
    A_s: clip(avg(acc.A)), C_s: clip(avg(acc.C)), D_s: clip(avg(acc.D)),
    M_s: clip(avg(acc.M)), S_s: clip(avg(acc.S)), L_s: clip(avg(acc.L))
  };
}

// ---------- MBTI 先验 ----------
function alphaFromMBTI(meta){
  if(!meta) return 0.0;
  const x = meta.xCount;
  let base = 0.30; if(x>=1) base=0.20;
  let cert = 1.0; if(x===1) cert=.67; else if(x===2) cert=.50; else if(x>=3) cert=.40;
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
const fuse = (p,s,a)=> a*p + (1-a)*s;

// ---------- 汇总 + 初判 ----------
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
    A:+A_final.toFixed(2), C:+C_final.toFixed(2), D:+D_final.toFixed(2),
    M:+dims.M_s.toFixed(2), S:+dims.S_s.toFixed(2), L:+dims.L_s.toFixed(2),
    prior: mbti ? {A_p, C_p, D_p, alpha:+alpha.toFixed(3)} : null,
    survey_raw: dims
  };

  const tLow=2.5, tMid=3.5;
  let macro = null;
  if(res.A < tLow){
    macro = (res.C >= 3.5) ? 'A1 未触及—高依赖外部建构' : 'A0 未触及—低觉察沉浸';
  }else if(res.A >= tMid && res.D >= tMid){
    if(res.S >= 4.0)                         macro = 'C2 去魅—彻底停滞/冻结（候选）';
    else if(res.C <= 3.0 && res.L <= 3.0)    macro = 'C1 去魅—理想自由人（候选）';
    else                                     macro = (res.C <= 2.5) ? 'C0 去魅—“解”候选' : 'C1/C2 去魅—待细分';
  }else if(res.A >= 3.0 && res.D <= tMid){
    if(res.C >= 4.0)                         macro = 'B0 建构—高建构依赖';
    else if(res.C >= 3.0 && res.L <= 3.0)    macro = 'B1 建构—局部建构（候选）';
    else if(res.C < 2.5 && res.M >= 3.5)     macro = 'B3 建构—功能主义姿态（候选）';
    else                                     macro = 'B2 建构—透明虚构（候选）';
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
