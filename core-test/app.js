/* =========================================================
   CORE 测量管线 app.js — R/J/E′ 三轴（UI与流程保持一致）
   - 使用 items.core.v1.json（36题）
   - 不依赖 MBTI 先验；报告显示 R/J/E′ + Top1/Top2 宏姿态
   ========================================================= */

/* ---------- 资源路径 ---------- */
const cfgPath        = './app.config.json';
const itemsCorePath  = './items.core.v1.json';

/* ---------- 全局状态 ---------- */
let CFG  = { useCoreModel:true };
let CORE_ITEMS = [];                // 题库（含 weights: {R,J,"E'"}）
const ANSWERS = new Map();          // 用“索引键”q_0, q_1 存（保持与UI一致）
let currentIndex = 0;

/* ---------- DOM 工具 ---------- */
const $  = (s, r=document)=>r.querySelector(s);
const $$ = (s, r=document)=>Array.from(r.querySelectorAll(s));

/* ---------- 通用工具 ---------- */
function mapLikertToFive(raw){ return 1 + (raw - 1) * (4/6); }
function clip(x, lo=1, hi=5){ return Math.max(lo, Math.min(hi, x)); }
function escapeHTML(s){ return String(s).replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
async function tryFetchJSON(path){ try{ const r=await fetch(path); if(!r.ok) throw 0; return await r.json(); } catch{ return null; } }

/* ====================== 加载 CORE 题库 ====================== */
async function loadAll(){
  const cfg = await tryFetchJSON(cfgPath);
  if(cfg) CFG = {...CFG, ...cfg};
  const raw = await tryFetchJSON(itemsCorePath);
  if(!Array.isArray(raw) || !raw.length) throw new Error('CORE 题库缺失或为空');

  CORE_ITEMS = raw.map(n=>{
    const w = n.weights || {};
    return {
      id: n.id,
      text: n.text || n.stem || ('Q'+n.id),
      w: (typeof n.w==='number'?n.w:1.0),
      weights: {
        R: +w.R || 0,
        J: +w.J || 0,
        Eprime: (typeof w["E'"]==='number' ? +w["E'"] : (+w.Eprime || 0))
      }
    };
  });

  // 简单可复现打散
  const seed = (new URL(location.href)).searchParams.get('seed') || 'core-seed';
  let h=2166136261; for(const ch of seed){ h ^= ch.charCodeAt(0); h=Math.imul(h,16777619); }
  for(let i=CORE_ITEMS.length-1;i>0;i--){
    h^=(h<<13); h^=(h>>>7); h^=(h<<17);
    const j
