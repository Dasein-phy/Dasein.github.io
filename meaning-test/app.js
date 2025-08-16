/* meaning-test/app.js — clean v3 (MBTI fix + progressive likert + signed weights)
   - Fixes:
     * MBTI “未测” id = #mbti-none (not #mbti-untested)
     * Hover open with 150ms delay; stays open while moving into menu
     * Click on options writes hidden inputs (#mbti-ei/ns/ft/pj)
     * Toggling “未测” disables/reenables axis rail without greying the checkbox row
     * Likert 7 evenly spaced, large hit area, re-select allowed, gentle feedback
*/

const cfgPath = './app.config.json';
const mbtiPriorPath = './mbti.prior.config.json';
const itemsPathV2 = './items.baseline.v2.json';
const itemsPathV1 = './items.baseline.json';

// ---- global state ----
let CFG = null;
let MBTI = null;
let ITEMS = [];                  // {id,text,w,A,C,D,M,S,L}
let ANSWERS = new Map();         // id -> raw(1..7)
let currentIndex = 0;

// ---- DOM helpers ----
const $  = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

// ---- utils ----
const sleep = ms => new Promise(r=>setTimeout(r, ms));
const clip  = (x, lo=1, hi=5) => Math.max(lo, Math.min(hi, x));
const mapLikertToFive = raw => 1 + (raw - 1) * (4/6);
const escapeHTML = s => String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));

async function tryFetchJSON(path){
  try{
    const r = await fetch(path);
    if(!r.ok) throw new Error('HTTP '+r.status);
    return await r.json();
  }catch(e){
    return null;
  }
}

async function loadAll(){
  const [cfg, prior] = await Promise.all([
    fetch(cfgPath).then(r=>r.json()),
    fetch(mbtiPriorPath).then(r=>r.json())
  ]);
  CFG = cfg; MBTI = prior;

  let v2 = await tryFetchJSON(itemsPathV2);
  if(Array.isArray(v2) && v2.length){
    ITEMS = v2.map(n => ({
      id: n.id,
      text: n.text || n.stem || ('Q'+n.id),
      w: (typeof n.w === 'number' ? n.w : 1.0),
      A: n.A||0, C: n.C||0, D: n.D||0, M: n.M||0, S: n.S||0, L: n.L||0
    }));
  }else{
    const v1 = await tryFetchJSON(itemsPathV1);
    if(!Array.isArray(v1) || !v1.length) throw new Error('题库加载失败');
    ITEMS = v1.map(n => ({
      id: n.id,
      text: n.text || n.stem || ('Q'+n.id),
      w: (typeof n.weight === 'number' ? n.weight : 1.0),
      A: 0, C: 0, D: 0, M: 0, S: 0, L: 0
    }));
  }
}

// ---- init ----
function init(){
  const startBtn = $('#startBtn');
  if(startBtn){
    startBtn.addEventListener('click', ()=>{
      $('#intro')?.classList.add('hidden');
      $('#mbti')?.classList.remove('hidden');
      initMBTIDropdowns();
    });
  }

  $('#toSurvey')?.addEventListener('click', ()=>{
    $('#mbti')?.classList.add('hidden');
    $('#survey')?.classList.remove('hidden');
    startProgressiveSurvey();
  });

  $('#submitSurvey')?.addEventListener('click', ()=>{
    const read = readSurvey();
    if(!read.ok){ alert('还有题未作答。'); return; }
    const res = scoreAll(read);
    renderReport(res);
  });

  $('#download')?.addEventListener('click', downloadJSON);
  $('#restart')?.addEventListener('click', ()=>location.reload());
}

// ---- MBTI rail (hover-open w/150ms, click select, “未测” toggle) ----
function initMBTIDropdowns(){
  const rail = $('#mbti-axes');
  const none = $('#mbti-none');

  // timers map for open/close delay per select
  const openTimers  = new WeakMap();
  const closeTimers = new WeakMap();

  function open(sel){
    clearTimeout(closeTimers.get(sel));
    const t = setTimeout(()=> sel.classList.add('mt-open'), 150);
    openTimers.set(sel, t);
  }
  function close(sel){
    clearTimeout(openTimers.get(sel));
    const t = setTimeout(()=> sel.classList.remove('mt-open'), 150);
    closeTimers.set(sel, t);
  }

  // bind each dropdown
  rail?.querySelectorAll('.mbti-select').forEach(sel=>{
    const current = sel.querySelector('.mbti-current');
    const menu    = sel.querySelector('.mbti-menu');
    const axisKey = sel.dataset.target;           // 'ei' | 'ns' | 'ft' | 'pj'
    const hidden  = $('#mbti-' + axisKey);

    // hover open/close with delay
    sel.addEventListener('mouseenter', ()=> open(sel));
    sel.addEventListener('mouseleave', ()=> close(sel));

    // click toggles (for mobile)
    current?.addEventListener('click', (e)=>{
      e.stopPropagation();
      sel.classList.toggle('mt-open');
    });

    // option click
    menu?.querySelectorAll('li').forEach(li=>{
      li.addEventListener('click', (e)=>{
        e.stopPropagation();
        const v = li.dataset.v ?? '';
        if(hidden) hidden.value = v;
        if(current) current.textContent = li.textContent.trim();

        // highlight active option
        menu.querySelectorAll('li').forEach(x=>x.classList.remove('is-active'));
        li.classList.add('is-active');

        sel.classList.remove('mt-open');
      });
    });
  });

  // outside click closes any open select
  document.addEventListener('click', (e)=>{
    if(!rail) return;
    if(rail.contains(e.target)) return;
    rail.querySelectorAll('.mbti-select.mt-open').forEach(s=>s.classList.remove('mt-open'));
  });

  // “我没有做过 MBTI 测试”
  if(none){
    none.addEventListener('change', ()=>{
      const disabled = none.checked;
      rail?.classList.toggle('disabled', disabled);
      if(disabled){
        // reset values & labels
        const pairs = [
          ['ei','未填'],
          ['ns','未填'],
          ['ft','未填'],
          ['pj','未填']
        ];
        pairs.forEach(([k,label])=>{
          const h = $('#mbti-'+k);
          const sel = rail.querySelector(`.mbti-select[data-target="${k}"]`);
          const cur = sel?.querySelector('.mbti-current');
          if(h) h.value = '';
          if(cur) cur.textContent = label;
          sel?.querySelectorAll('.mbti-menu li').forEach(li=>li.classList.remove('is-active'));
          sel?.classList.remove('mt-open');
        });
      }
    });
  }
}

// read MBTI probs; return null if none/untested
function readMBTIProbs(){
  const none = $('#mbti-none');
  if(none && none.checked) return null;

  const ei = ($('#mbti-ei')?.value || '');
  const ns = ($('#mbti-ns')?.value || '');
  const ft = ($('#mbti-ft')?.value || '');
  const pj = ($('#mbti-pj')?.value || '');

  if(ei==='' && ns==='' && ft==='' && pj==='') return null;

  function pairProb(v, a, b){
    if(v==='') return null;
    if(v==='X') return {[a]:0.5, [b]:0.5};
    if(v===a)  return {[a]:1.0, [b]:0.0};
    if(v===b)  return {[a]:0.0, [b]:1.0};
    return null;
  }
  const eiP = pairProb(ei,'I','E') || {I:0.5,E:0.5};
  const nsP = pairProb(ns,'N','S') || {N:0.5,S:0.5};
  const ftP = pairProb(ft,'F','T') || {F:0.5,T:0.5};
  const pjP = pairProb(pj,'P','J') || {P:0.5,J:0.5};

  const xCount = [ei,ns,ft,pj].filter(v=>v==='X').length;
  const unset  = [ei,ns,ft,pj].filter(v=>v==='').length;

  return {prob:{...eiP, ...nsP, ...ftP, ...pjP}, meta:{xCount, unset}};
}

// ---- progressive survey ----
function startProgressiveSurvey(){
  ANSWERS.clear();
  currentIndex = 0;
  const form = $('#surveyForm');
  if(form) form.innerHTML = '';
  renderOneItem(currentIndex);
  const actions = $('#submitSurvey')?.closest('.actions');
  if(actions) actions.style.display = 'none';
}

function buildLikert7(name, onPick){
  const wrap = document.createElement('div');
  wrap.className = 'likert7';
  for(let v=1; v<=7; v++){
    const cell = document.createElement('label');
    cell.className = 'likert-option' + (v===4 ? ' is-center' : '');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = String(v);
    const dot = document.createElement('span');
    dot.className = 'likert-dot';
    cell.appendChild(input);
    cell.appendChild(dot);

    input.addEventListener('change', ()=>{
      onPick(v, cell);
    });
    // Clicking anywhere in the cell triggers input
    cell.addEventListener('click', (e)=>{
      if(input.disabled) return;
      input.checked = true;
      input.dispatchEvent(new Event('change', {bubbles:true}));
    });

    wrap.appendChild(cell);
  }
  return wrap;
}

function renderOneItem(idx){
  const form = $('#surveyForm');
  if(!form) return;

  if(idx >= ITEMS.length){
    const actions = $('#submitSurvey')?.closest('.actions');
    if(actions) actions.style.display = 'flex';
    return;
  }
  const it = ITEMS[idx];

  const node = document.createElement('div');
  node.className = 'item card slide-in';
  node.dataset.qid = it.id;

  node.innerHTML = `
    <h3 class="q-title">Q${idx+1}. ${escapeHTML(it.text)}</h3>
    <div class="scale-hint"><span>非常不同意</span><span>非常同意</span></div>
  `;
  const scale = buildLikert7('q'+it.id, (raw, cell)=>{
    // allow re-select: just overwrite
    ANSWERS.set(it.id, raw);

    // visual selection
    node.querySelectorAll('.likert-option').forEach(l=>l.classList.remove('is-selected','tapped'));
    cell.classList.add('is-selected','tapped');
    setTimeout(()=>cell.classList.remove('tapped'), 120);

    // reveal next
    currentIndex = idx + 1;
    if(currentIndex === idx + 1){   // guard
      renderOneItem(currentIndex);
      const last = form.lastElementChild;
      if(last){
        last.scrollIntoView({behavior:'smooth', block:'center'});
        setTimeout(()=>{
          const rect = last.getBoundingClientRect();
          const y = window.scrollY + rect.top - Math.min(120, window.innerHeight*0.15);
          window.scrollTo({top:y, behavior:'smooth'});
        }, 60);
      }
    }
  });

  node.appendChild(scale);
  form.appendChild(node);
}

// read answers -> {ok, answers:{}}
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

// ---- scoring (signed weighted averages) ----
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
      if(c===0) return;
      const weightAbs = Math.abs(w*c);
      const signed = (c>=0) ? score : (6 - score); // reverse within 1..5 range
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

// MBTI prior
function alphaFromMBTI(meta){
  if(!meta) return 0.0;
  const x = meta.xCount;
  let base = 0.30;
  if(x>=1) base = 0.20;
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
const fuse = (prior, survey, alpha)=> alpha*prior + (1-alpha)*survey;

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

  // simple macro hint (same as previous)
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

// ---- report ----
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

// ---- download ----
function downloadJSON(){
  const data = window.__meaningReport || {};
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'meaning-test-result.json';
  a.click();
  URL.revokeObjectURL(url);
}

// ---- boot ----
window.addEventListener('DOMContentLoaded', async ()=>{
  await loadAll();
  init();
});
