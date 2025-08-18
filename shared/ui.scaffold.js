// /shared/ui.scaffold.js
(function () {
  function exists(sel) { return !!document.querySelector(sel); }
  function el(tag, attrs = {}, html) {
    const n = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else n.setAttribute(k, String(v));
    });
    if (html != null) n.innerHTML = html;
    return n;
  }

  function mountStandardTestUI(opts = {}) {
    // 已有旧结构就不重复渲染（安全幂等）
    if (exists('#intro') && exists('#survey') && exists('#report')) return;

    const {
      title = '意义姿态测试',
      subtitle = '',
      intro = '本测试为逐题出现的量表，完成后显示结果。',
      homeHref = '../index.html'
    } = opts;

    // 容器：沿用 .container（你的 styles.css 已支持）
    let container = document.querySelector('.container');
    if (!container) {
      container = el('div', { class: 'container' });
      document.body.appendChild(container);
    }

    // 标题（与你旧版一致）
    const h1 = el('h1', {}, '');
    h1.appendChild(document.createTextNode(title));
    if (subtitle) {
      const sub = el('span', { class: 'subtle' }, ' ' + subtitle);
      sub.textContent = ' ' + subtitle;
      h1.appendChild(sub);
    }
    container.appendChild(h1);

    // Intro
    const introSec = el('section', { id: 'intro', class: 'card' }, '');
    introSec.appendChild(el('h2', {}, '开始'));
    introSec.appendChild(el('p', {}, intro));
    const introAct = el('div', { class: 'actions' });
    introAct.appendChild(el('button', { id: 'startBtn', class: 'btn primary' }, '开始测试'));
    introSec.appendChild(introAct);
    container.appendChild(introSec);

    // Survey
    const surveySec = el('section', { id: 'survey', class: 'hidden' }, '');
    surveySec.appendChild(el('form', { id: 'surveyForm' }, ''));
    const surveyAct = el('div', { class: 'actions' });
    surveyAct.style.display = 'none';
    surveyAct.appendChild(el('button', { id: 'submitSurvey', class: 'btn primary' }, '提交'));
    surveySec.appendChild(surveyAct);
    container.appendChild(surveySec);

    // Report
    const reportSec = el('section', { id: 'report', class: 'hidden' }, '');
    reportSec.appendChild(el('div', { id: 'reportContent', class: 'card' }, ''));
    const reportAct = el('div', { class: 'actions' }, '');
    const back = el('a', { class: 'btn', href: homeHref }, '返回首页');
    reportAct.appendChild(back);
    reportSec.appendChild(reportAct);
    container.appendChild(reportSec);
  }

  window.mountStandardTestUI = mountStandardTestUI;
})();
