<!-- 文件路径：/shared/ui.scaffold.js -->
<script>
/**
 * 标准测试 UI 脚手架
 * - 生成你旧版那套 DOM：#intro → #survey → #report
 * - 创建按钮 #startBtn / #submitSurvey，表单 #surveyForm
 * - 复用你的 styles.css（card/actions/btn/hidden 等）
 * - 如果页面里本来已手写了这些节点，则什么都不做（安全幂等）
 *
 * 用法：
 *   <script src="../shared/ui.scaffold.js"></script>
 *   <script>
 *     mountStandardTestUI({
 *       title: '意义姿态 · 核心模型（Core）',
 *       subtitle: 'R/J/E′ 三轴量表',
 *       intro: '36题，逐题出现；完成后给出 Top1/Top2 候选。',
 *       homeHref: '../index.html'   // 报告页“返回首页”的地址
 *     });
 *   </script>
 */
(function(){
  function exists(sel){ return !!document.querySelector(sel); }

  function el(tag, attrs={}, html){
    const n = document.createElement(tag);
    Object.entries(attrs||{}).forEach(([k,v])=>{
      if(k==='class') n.className = v;
      else if(k==='text') n.textContent = v;
      else n.setAttribute(k,String(v));
    });
    if(html != null) n.innerHTML = html;
    return n;
  }

  function mountStandardTestUI(opts={}){
    // 若已经存在旧版结构，就不重复渲染，避免冲突
    if (exists('#intro') && exists('#survey') && exists('#report')) return;

    const {
      title    = '意义姿态测试',
      subtitle = '',
      intro    = '本测试为逐题出现的量表，完成后显示结果。',
      homeHref = 'index.html'
    } = opts;

    // 容器
    let container = document.querySelector('.container');
    if(!container){
      container = el('div',{class:'container'});
      document.body.appendChild(container);
    }

    // 标题（与你旧版相同结构）
    const h1 = el('h1',{}, '');
    h1.appendChild(document.createTextNode(title));
    if(subtitle){
      const sub = el('span',{class:'subtle'}, '');
      sub.textContent = ' ' + subtitle;
      h1.appendChild(sub);
    }
    container.appendChild(h1);

    // Intro 卡片
    const introSec = el('section',{id:'intro', class:'card'}, '');
    introSec.appendChild(el('h2',{}, '开始'));
    introSec.appendChild(el('p',{}, intro));
    const introAct = el('div',{class:'actions'});
    introAct.appendChild(el('button',{id:'startBtn', class:'btn primary'}, '开始测试'));
    introSec.appendChild(introAct);
    container.appendChild(introSec);

    // Survey 卡片
    const surveySec = el('section',{id:'survey', class:'hidden'}, '');
    surveySec.appendChild(el('form',{id:'surveyForm'}, ''));
    const surveyAct = el('div',{class:'actions'});
    surveyAct.style.display = 'none';
    surveyAct.appendChild(el('button',{id:'submitSurvey', class:'btn primary'}, '提交'));
    surveySec.appendChild(surveyAct);
    container.appendChild(surveySec);

    // Report 卡片
    const reportSec = el('section',{id:'report', class:'hidden'}, '');
    reportSec.appendChild(el('div',{id:'reportContent', class:'card'}, ''));
    const reportAct = el('div',{class:'actions'}, '');
    const back = el('a',{class:'btn', href: homeHref}, '返回首页');
    reportAct.appendChild(back);
    reportSec.appendChild(reportAct);
    container.appendChild(reportSec);
  }

  // 挂到全局
  window.mountStandardTestUI = mountStandardTestUI;
})();
</script>
