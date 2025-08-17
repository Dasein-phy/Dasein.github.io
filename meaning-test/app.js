/* =========================================================
   意义姿态测试 app.js — 稳定整合版
   - 题库（v2/v1）统一解析 weights
   - Progressive 渐进出题 + 可控打散
   - MBTI 右侧卡片式菜单（150ms 悬停展开/可点击）
   - 计分：带符号多维加权 + M_func/M_aff + L 的矛盾惩罚
   - 宏类型判读（含 A 的过渡带细分）
   ========================================================= */

/* ---------- 资源路径（如需改路径只改这里） ---------- */
const cfgPath        = './app.config.json';
const mbtiPriorPath  = './mbti.prior.config.json';
const itemsPathV2    = './items.baseline.v2.json';
const itemsPathV1    = './items.baseline.json';

/* ---------- 全局状态 ---------- */
let CFG  = null;
let MBTI = null;
/** 统一题库项（内部格式）
 * {
 *   id, text, w(默认1.0),
 *   A, C, D, S, L (可正可负),
 *   M_func, M_aff,
 *   meta?: { is_attention?:bool, duplicate_of?:id|null }
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

/* ---------- 工具函数 ---------- */
function mapLikertToFive(raw){ return 1 + (raw - 1) * (4/6); }
function clip(x, lo=1, hi=5){ return Math.max(lo, Math.min(hi, x)); }
const sleep = ms => new Promise(r=>setTimeout(r, ms));
function escapeHTML(s){
  return String(s).replace(/[&<>"']/g, m=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}
async function tryFetchJSON(path){
  try{
    const r = await fetch(path);
    if(!r.ok) throw new Error(path+' not ok');
    return await r.json();
  }catch(e){ return null; }
}

/* =========================================================
   模块 A：加载全部配置和题库（★这是你以后要找“解析题库”的地方）
   - 正确解析 v2 的 weights 字段；v1 退化为 0 权重（可按需映射）
   - 按主导维度分桶 + 可复现打乱 + 轮盘交错出题
   ========================================================= */
async function loadAll(){
  const [cfg, prior] = await Promise.all([
    tryFetchJSON(cfgPath),
    tryFetchJSON(mbtiPriorPath)
  ]);
  CFG  = cfg;
  MBTI = prior;

  // ---- v2 优先（你当前提供的是 v2）----
  const v2 = await tryFetchJSON(itemsPathV2);
  if (Array.isArray(v2) && v2.length){
    ITEMS = v2.map(n=>{
      const w = n.weights || {};
      return {
        id: n.id,
        text: n.text || n.stem || ('Q'+n.id),
        w: (typeof n.w==='number' ? n.w : 1.0),
        A: +w.A || 0, C: +w.C || 0, D: +w.D || 0, S: +w.S || 0, L: +w.L || 0,
        M_func: +w.M_func || 0,
        M_aff : +w.M_aff  || 0,
        meta: { is_attention: !!n.is_attention, duplicate_of: n.duplicate_of || null }
      };
    });

    // ---- 可控打散（把同类分开，提升一致性可测性）----
    // 1) 主导维度归桶（A / C / D / M / S / L）
    const buckets = {A:[],C:[],D:[],M:[],S:[],L:[]};
    ITEMS.forEach(it=>{
      const absMap = {
        A: Math.abs(it.A),
        C: Math.abs(it.C),
        D: Math.abs(it.D),
        M: Math.max(Math.abs(it.M_func||0), Math.abs(it.M_aff||0)),
        S: Math.abs(it.S),
        L: Math.abs(it.L)
      };
      let dom='A', maxv=absMap.A;
      for(const k of ['C','D','M','S','L']){
        if(absMap[k] > maxv){ dom=k; maxv=absMap[k]; }
      }
      buckets[dom].push(it);
    });

    // 2) 桶内可复现打乱（URL ?seed=xxx）
    const seed = (new URL(location.href)).searchParams.get('seed') || 'mt-seed';
    function seededShuffle(arr, s){
      let h = 2166136261;
      for(let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
      const out = arr.slice();
      for(let i=out.length-1;i>0;i--){
        // 线性同余式扰动
        h ^= (h<<13); h ^= (h>>>7); h ^= (h<<17);
        const j = Math.abs(h) % (i+1);
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    }
    for(const k in buckets){ buckets[k] = seededShuffle(buckets[k], seed + '-' + k); }

    // 3) 轮盘交错：A→C→D→M→S→L 循环抽取，尽量避免同类连续
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

  }else{
    // ---- v1 退化：如果只有 v1，就先把所有维度权重设 0（或在此做你的映射）----
    const v1 = await tryFetchJSON(itemsPathV1);
    if(!Array.isArray(v1) || !v1.length) throw new Error('题库加载失败');
    ITEMS = v1.map(n=>({
      id: n.id,
      text: n.text || n.stem || ('Q'+n.id),
      w: (typeof n.w==='number' ? n.w : 1.0),
      A:0, C:0, D:0, S:0, L:0, M_func:0, M_aff:0
    }));
  }
}

/* =========================================================
   模块 B：初始化入口与导航（按钮切卡片）
   - 你只需要确保 index.html 里的 id：#startBtn / #toSurvey / #submitSurvey ...
   ========================================================= */
function init(){
  const btnStart    = $('#startBtn');
  const btnToSurvey = $('#toSurvey');
  const btnSubmit   = $('#submitSurvey');
  const btnDownload = $('#download');
  const btnRestart  = $('#restart');

  if(btnStart){
    btnStart.addEventListener('click', ()=>{
      $('#intro')?.classList.add('hidden');
      $('#mbti')?.classList.remove('hidden');
      initMBTIDropdowns(); // 初始化 MBTI 交互（必须在显示后调用）
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

/* =========================================================
   模块 C：MBTI 交互（右侧卡片式下拉 + 150ms 悬停延迟）
   - HTML 结构见 index.html 的 .mbti-rail 区域
   - 复选框 #mbti-none 只禁用四个选择器本身，不把整条 rail 置灰
   ========================================================= */
function initMBTIDropdowns(){
  const rail     = $('.mbti-rail');
  const untested = $('#mbti-none');
  if(!rail) return;

  const selects = $$('.mbti-select', rail);
  selects.forEach(sel=>{
    let openTimer=null, closeTimer=null;
    const cur  = $('.mbti-current', sel);
    const menu = $('.mbti-menu', sel);

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

    // 点击选项：写 data-value，更新文案与选中样式
    if(menu){
      menu.addEventListener('click', e=>{
        const li = e.target.closest('li[data-v]');
        if(!li) return;
        const v = li.getAttribute('data-v') || '';
        sel.dataset.value = v;
        $$('.mbti-menu li', sel).forEach(x=>x.classList.remove('is-active'));
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
          const cur = $('.mbti-current', sel);
          if(cur) cur.textContent = '未填';
          $$('.mbti-menu li', sel).forEach(x=>x.classList.remove('is-active'));
        }
      });
    });
  }
}

/** 读取 MBTI 概率（从 .mbti-select 的 data-value；未测→null） */
function readMBTIProbs(){
  const untested = $('#mbti-none');
  if(untested && untested.checked) return null;

  const get = axis => ($(`.mbti-select[data-target="${axis}"]`)?.dataset.value || '');
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

/* =========================================================
   模块 D：Progressive 问卷（逐题滑入）
   - 7 点小圆：整格热区；中点略大；选中后渲染下一题+滚动对焦
   - 防重复渲染/防“重复下一题”
   ========================================================= */
function startProgressiveSurvey(){
  ANSWERS.clear();
  currentIndex = 0;
  const form = $('#surveyForm');
  if(form) form.innerHTML = '';
  // 提交按钮先隐藏
  const actions = $('#submitSurvey')?.closest('.actions');
  if(actions) actions.style.display = 'none';
  // 首题
  renderOneItem(currentIndex);
}

/** 构建 7 点小圆控件（只返回容器） */
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

function renderOneItem(idx){
  const form = $('#surveyForm');
  if(!form) return;

  if(idx >= ITEMS.length){
    const actions = $('#submitSurvey')?.closest('.actions');
    if(actions) actions.style.display = 'flex';
    return;
  }

  // 防重复：已存在就不再创建
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

  const qKey = `q_${idx}`; // ★ 用“索引键”记录这题的作答
  const scale = buildLikert7('q'+it.id, (raw)=>{
    ANSWERS.set(qKey, raw); // ★ 按索引存，不按 id 存

    if(node.getAttribute('data-next-spawned') !== '1'){
      node.setAttribute('data-next-spawned', '1');
      const nextIdx = idx + 1;
      renderOneItem(nextIdx);
      const nextEl = form.querySelector(`[data-q-idx="${nextIdx}"]`);
      if(nextEl){
        setTimeout(()=>{ nextEl.scrollIntoView({behavior:'smooth', block:'center'}); }, 60);
      }
    }
  });
  node.appendChild(scale);
  form.appendChild(node);
}

function readSurvey(){
  // 先用“题目总数 vs 已记录条目数”做个快速判断
  if(ANSWERS.size < ITEMS.length){
    return { ok:false, reason:`未答数量 ≈ ${ITEMS.length - ANSWERS.size}` };
  }

  // 构建与 ITEMS 对齐的答案数组
  const arr = new Array(ITEMS.length);
  for(let i=0; i<ITEMS.length; i++){
    const key = `q_${i}`;
    const raw = ANSWERS.get(key);
    if(typeof raw !== 'number'){
      return { ok:false, reason:`第 ${i+1} 题无效/缺失` };
    }
    arr[i] = raw;
  }
  return { ok:true, answers: arr }; // ★ 这里开始，answers 是“按索引”的数组
}


/* =========================================================
   模块 E：计分（带符号多维加权 + M 拆分 + L 的矛盾惩罚）
   - 这里是你要调参时最常改动的地方
   ========================================================= */

/** 1) 基础各维得分（带符号多维加权） */
function computeSurveyDims(answers){ // answers: number[] 与 ITEMS 对齐
  const acc = {
    A:{num:0, den:0}, C:{num:0, den:0}, D:{num:0, den:0},
    S:{num:0, den:0}, L:{num:0, den:0},
    M_func:{num:0, den:0}, M_aff:{num:0, den:0}
  };

  for(let i=0; i<ITEMS.length; i++){
    const it = ITEMS[i];
    const raw = answers[i];             // ★ 按索引取答
    const score = mapLikertToFive(raw); // 1..5
    const baseW = (typeof it.w==='number') ? it.w : 1.0;

    const accOne = (key, coef)=>{
      const c = Number(coef)||0;
      if(c===0) return;
      const w = Math.abs(baseW * c);
      const signed = (c >= 0) ? score : (6 - score);
      acc[key].num += w * signed;
      acc[key].den += w;
    };

    accOne('A', it.A);
    accOne('C', it.C);
    accOne('D', it.D);
    accOne('S', it.S);
    accOne('L', it.L);
    accOne('M_func', it.M_func);
    accOne('M_aff',  it.M_aff);
  }

  const avg = x => x.den > 0 ? (x.num/x.den) : 3.0;
  const m_func = clip(avg(acc.M_func));
  const m_aff  = clip(avg(acc.M_aff));
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

function computeAmbivalenceFromAnswers(answers){ // answers: number[]
  const dims = ['A','C','D'];
  const agg = {}; dims.forEach(k=> agg[k] = {pos:{num:0,den:0}, neg:{num:0,den:0}} );

  for(let i=0; i<ITEMS.length; i++){
    const it = ITEMS[i];
    const raw = answers[i];                         // ★ 按索引取答
    const score = mapLikertToFive(raw);
    const w = (typeof it.w==='number' ? it.w : 1.0);

    for(const k of dims){
      const c = Number(it[k])||0;
      if(c===0) continue;
      const weightAbs = Math.abs(w * c);
      const signed = (c>=0) ? score : (6 - score);
      if(c>=0){
        agg[k].pos.num += weightAbs * signed;
        agg[k].pos.den += weightAbs;
      }else{
        agg[k].neg.num += weightAbs * signed;
        agg[k].neg.den += weightAbs;
      }
    }
  }

  const res = {};
  const list = [];
  dims.forEach(k=>{
    const pos = agg[k].pos.den>0 ? (agg[k].pos.num/agg[k].pos.den) : 3.0;
    const neg = agg[k].neg.den>0 ? (agg[k].neg.num/agg[k].neg.den) : 3.0;
    const posHi = Math.max(0, pos - 3) / 2;
    const negHi = Math.max(0, neg - 3) / 2;
    const amb   = Math.min(posHi, negHi);
    res[k] = {pos:+pos.toFixed(2), neg:+neg.toFixed(2), amb:+amb.toFixed(3)};
    list.push(amb);
  });

  const ci = list.length ? (list.reduce((a,b)=>a+b,0)/list.length) : 0;
  return { byDim: res, ci: +ci.toFixed(3) };
}


/** 3) MBTI 先验与融合（A/C/D 三个维度） */
function alphaFromMBTI(meta){
  if(!meta) return 0.0;
  const x = meta.xCount;
  let base = (x>=1) ? 0.20 : 0.30;
  let cert = 1.0;
  if(x===1) cert=0.67;
  else if(x===2) cert=0.50;
  else if(x>=3) cert=0.40;
  return base * cert;
}
// —— MBTI 先验：安全取系数 + D 维收缩（更保守） ——
function priorsFromProbs(p){
  const {A0,C0,D0} = MBTI.baseline;
  const cA = MBTI.coeff.A || {};
  const cC = MBTI.coeff.C || {};
  const cD = MBTI.coeff.D || {};
  const g = (o,k) => Number(o?.[k] ?? 0);

  const dNS = (p.N - p.S);
  const dIE = (p.I - p.E);
  const dPJ = (p.P - p.J);
  const dTF = (p.T - p.F);

  let A = A0
    + g(cA,"N-S")*dNS + g(cA,"I-E")*dIE + g(cA,"P-J")*dPJ
    + g(cA,"N*T")*(p.N*p.T) + g(cA,"S*J")*(p.S*p.J);

  let C = C0
    + g(cC,"J-P")*(p.J - p.P) + g(cC,"F-T")*(p.F - p.T) + g(cC,"S-N")*(p.S - p.N)
    + g(cC,"I-E")*dIE + g(cC,"S*J")*(p.S*p.J);

  // D 的整体先验强度收敛为 50%（相关性最弱）
  let D = D0 + 0.5 * (
      g(cD,"N-S")*dNS + g(cD,"T-F")*dTF + g(cD,"P-J")*dPJ
    + g(cD,"F*J")*(p.F*p.J) + g(cD,"N*P")*(p.N*p.P)
  );

  return { A_p: clip(A), C_p: clip(C), D_p: clip(D) };
}

function fuse(prior, survey, alpha){ return alpha*prior + (1-alpha)*survey; }

// —— 注意力题（81/82）：未通过则禁用 MBTI 先验 ——
function checkAttention(answers){
  const a81 = answers[81]; // “请选择非常不同意” → 1
  const a82 = answers[82]; // “请选择非常同意”   → 7
  let ok = true, reason = [];
  if (typeof a81 === 'number' && a81 !== 1){ ok = false; reason.push('Q81≠非常不同意'); }
  if (typeof a82 === 'number' && a82 !== 7){ ok = false; reason.push('Q82≠非常同意'); }
  return { ok, reason };
}

// —— 计算 α：填写完整度 × X惩罚 ×（问卷不可靠度）× 矛盾噪声 ——
// mbtiMeta: {xCount, unset} 来自 readMBTIProbs()
// dims: computeSurveyDims() 的返回（含 S_s / L_s）
// L_adj: L 经矛盾惩罚后的值
// amb: computeAmbivalenceFromAnswers().ci  ∈[0,1]
// attentionOK: 注意力是否通过
function computeAlpha(mbtiMeta, dims, L_adj, amb, attentionOK){
  if(!mbtiMeta || !attentionOK) return 0.0;

  const fill = (4 - Math.min(4, mbtiMeta.unset||0)) / 4;      // MBTI 填写完整度 0..1
  const xpen = [1, 0.67, 0.50, 0.40][Math.min(3, mbtiMeta.xCount||0)]; // X 越多 → α 越低
  const reliability = Math.max(0, Math.min(1, ( (dims.S_s||3) + (L_adj||3) ) / 10 )); // 稳定+一致
  const noisiness  = 0.5 + 0.5 * Math.max(0, Math.min(1, amb||0));     // 矛盾越高 → 越依赖先验
  const alpha_max  = 0.25; // 顶帽（更保守）

  let alpha = alpha_max * fill * xpen * (1 - 0.6*reliability) * noisiness;
  return Math.max(0, Math.min(0.3, alpha)); // 再保险夹住
}


// —— 15类宏姿态：判别器 ——
// 返回 { macro, reason }；阈值可随数据迭代微调
function classifyMacro(r){
  const A=r.A, C=r.C, D=r.D, S=r.S, L=r.L, M=r.M, Mf=r.M_func, Ma=r.M_aff;

  // 优先判“极端/高置信”模式（从强到弱）
  if (A>=3.5 && D>=3.8 && S<=2.8 && M<=3.0) return {macro:"C2 停滞冻结姿态", reason:"A高D高S低M低"};
  if (A>=3.6 && D>=3.4 && C<=3.2 && S>=3.0) return {macro:"C1 反身介入姿态", reason:"高反身低依附"};
  if (D>=3.5 && C<=2.7 && (Math.max(Mf,Ma)<=3.2)) return {macro:"C0 去建构姿态", reason:"高去魅低建构"};
  if (A>=2.5 && A<3.0 && D>=3.6 && C<=3.0)  return {macro:"C3 去魅萌发姿态", reason:"A过渡带且D高C低"};

  if (Mf>=3.8 && D<=3.4 && C>=3.0)          return {macro:"B3 功能主义姿态", reason:"功能驱动高"};
  if (Mf>=3.8 && C>=3.5 && S>=3.5 && D<=3.2)return {macro:"E0 义务契约姿态", reason:"责任/契约信号"};
  if (Ma>=3.8 && C<=3.2 && D<=3.4)          return {macro:"E1 享乐幸福姿态", reason:"情感/幸福驱动"};

  if (D>=3.8 && C<=3.2 && A>=3.2)           return {macro:"D1 荒诞反抗姿态", reason:"高去魅+能动"};
  if (Ma>=3.8 && D>=3.2 && D<=3.8 && C>=2.6 && C<=3.6)
                                             return {macro:"D0 审美姿态", reason:"高感受+中度去魅"};

  if (C>=4.0 || (C>=3.8 && S>=3.5 && D<=3.2)) return {macro:"B0 高建构依赖姿态", reason:"建构依赖高"};
  if (C>=3.2 && L<=3.0)                       return {macro:"B1 局部建构姿态", reason:"建构依赖且跨域不一致"};
  if (A>=3.0 && C>=3.0 && D>=3.0)             return {macro:"B2 透明虚构姿态", reason:"自知其构而仍用"};

  if (A<2.5 && C>=3.5)                        return {macro:"A1 外部建构依赖姿态", reason:"低觉察+高依附"};
  if (A<2.5)                                   return {macro:"A0 低觉察沉浸姿态",   reason:"低觉察"};

  // 低稳定+低一致：倾向“动态混合”
  if (S<=2.6 && L<=2.8)                       return {macro:"F0 动态混合姿态", reason:"低稳定且低一致"};

  return {macro:"F0 动态混合姿态", reason:"多信号并存/边界"};
}

// —— 总分 & 报告 ——（融合改良 α + 15 类输出）
function scoreAll(read){
  const mbti = readMBTIProbs();
  const dims = computeSurveyDims(read.answers);

  // 自相矛盾 → 惩罚 L
  const amb  = computeAmbivalenceFromAnswers(read.answers);
  const L_adj = clip(dims.L_s - 1.2 * (amb.ci||0), 1, 5);

  // 注意力题
  const att = checkAttention(read.answers);

  // MBTI 融合（仅 A/C/D）
  let A_final = dims.A_s, C_final = dims.C_s, D_final = dims.D_s;
  let A_p=null, C_p=null, D_p=null, alpha=0.0;

  if(mbti){
    const pri  = priorsFromProbs(mbti.prob);
    A_p = pri.A_p; C_p = pri.C_p; D_p = pri.D_p;
    alpha = computeAlpha(mbti.meta, dims, L_adj, amb.ci, att.ok);

    // 注意：D 的先验已在 priorsFromProbs() 收敛 50%，此处同权融合即可
    const fuse = (prior, survey, a) => a*prior + (1-a)*survey;
    A_final = fuse(A_p, dims.A_s, alpha);
    C_final = fuse(C_p, dims.C_s, alpha);
    D_final = fuse(D_p, dims.D_s, alpha);
  }

  // 动因子：展示用 M 取更大者，同时保留子维
  const M_func = (dims.M_detail?.m_func ?? dims.M_s);
  const M_aff  = (dims.M_detail?.m_aff  ?? dims.M_s);
  const M_show = Math.max(M_func, M_aff);

  // 汇总（四舍五入只用于展示）
  const report = {
    A: +A_final.toFixed(2),
    C: +C_final.toFixed(2),
    D: +D_final.toFixed(2),
    M: +M_show.toFixed(2),
    M_func: +M_func.toFixed(2),
    M_aff : +M_aff.toFixed(2),
    S: +dims.S_s.toFixed(2),
    L: +L_adj.toFixed(2),
    prior: mbti ? {A_p, C_p, D_p, alpha:+alpha.toFixed(3)} : null,
    attention_ok: att.ok,
    attention_reason: att.reason,
    ambivalence: amb,
    survey_raw: {...dims, L_s_raw: dims.L_s}
  };

  // 15 类宏姿态
  const pick = classifyMacro(report);
  report.macro_hint = pick.macro;
  report.macro_reason = pick.reason;

  return report;
}


/* =========================================================
   模块 F：报告渲染 & 下载
   ========================================================= */
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
    <li>动因模式 M：${res.M} <span style="color:#888">(功能 ${res.M_func ?? '—'} / 情感 ${res.M_aff ?? '—'})</span></li>
    <li>姿态稳定 S：${res.S}</li>
    <li>领域一致 L：${res.L}</li>
  </ul>`);

  if(res.prior){
    const dA = Math.abs(res.prior.A_p - (res.survey_raw?.A_s ?? res.A)).toFixed(2);
    const dC = Math.abs(res.prior.C_p - (res.survey_raw?.C_s ?? res.C)).toFixed(2);
    const dD = Math.abs(res.prior.D_p - (res.survey_raw?.D_s ?? res.D)).toFixed(2);
    lines.push(`<p>先验影响系数 α=${res.prior.alpha}；先验-问卷差值 |ΔA|=${dA} |ΔC|=${dC} |ΔD|=${dD}</p>`);

    const attText = (res.attention_ok === false)
      ? '未通过（已将先验影响压到接近 0）'
      : (res.attention_ok === true ? '通过' : '—');
    const ci = (res.ambivalence && typeof res.ambivalence.ci === 'number')
      ? res.ambivalence.ci.toFixed(3) : '—';

    lines.push(
      `<p style="color:#6b7280">
        透明说明：注意力检查：${attText}；矛盾指数 ci=${ci}。
        <br><small>注：为避免过度拉动，“去魅 D”的 MBTI 先验仅以 <code>0.5×</code> 的力度参与融合。</small>
      </p>`
    );
  }else{
    lines.push(`<p>未使用 MBTI 先验。</p>`);
  }

  lines.push(
    `<p>宏类型初判：<span class="badge">${res.macro_hint}</span>${
      res.macro_reason ? ` <span style="color:#888">（依据：${res.macro_reason}）</span>` : ''
    }</p>`
  );

  wrap.innerHTML = lines.join('\n');
  $('#report')?.classList.remove('hidden');
  window.__meaningReport = res;
}


function downloadJSON(){
  const data = window.__meaningReport || {};
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'meaning-test-result.json';
  a.click();
  URL.revokeObjectURL(url);
}

/* =========================================================
   启动（先 loadAll 再 init，确保按钮已绑定且题库正确）
   ========================================================= */
window.addEventListener('DOMContentLoaded', async ()=>{
  await loadAll();   // ★ 解析 weights 的正确位置（不要把 await 写到顶层）
  init();
});
