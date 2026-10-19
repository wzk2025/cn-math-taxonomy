/* 学习画像：汇总 localStorage 中的 topicStatus / history，展示整体掌握情况。
 * 纯静态、无依赖；数据仍只在本机浏览器。 */
(function () {
  'use strict';
  const LS_STATUS = 'cnmDiagnose.topicStatus.v1';
  const LS_HISTORY = 'cnmDiagnose.history.v1';
  const GRADE_ZH = { 7: '七', 8: '八', 9: '九' };
  const STATUS_LABEL = { mastered: '已掌握', shaky: '不稳', weak: '要先补' };
  const STATUS_ORDER = ['weak', 'shaky', 'mastered'];

  function h(tag, attrs) {
    const el = document.createElement(tag);
    const a = attrs || {};
    Object.keys(a).forEach(function (k) {
      const v = a[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'open' || k === 'disabled') el[k] = v === true;
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  function lsJson(k, fallback) {
    try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? fallback : v; }
    catch (e) { return fallback; }
  }

  async function load() {
    const [tr, qr] = await Promise.all([fetch('data/topics.json'), fetch('data/questions.json').catch(function () { return null; })]);
    if (!tr.ok) throw new Error('topics.json → HTTP ' + tr.status);
    const topics = await tr.json();
    return { topics: topics, byId: new Map(topics.map(function (t) { return [t.id, t]; })) };
  }

  function volKey(t) { return t.external ? '小学' : GRADE_ZH[t.grade] + t.semester; }
  const VOL_ORDER = ['七上', '七下', '八上', '八下', '九上', '九下', '小学'];
  const VOL_LABEL = { '七上': '七年级上册', '七下': '七年级下册', '八上': '八年级上册', '八下': '八年级下册', '九上': '九年级上册', '九下': '九年级下册', '小学': '小学先修' };

  function render() {
    const root = document.getElementById('root');
    while (root.firstChild) root.removeChild(root.firstChild);
    const status = lsJson(LS_STATUS, {});
    const history = lsJson(LS_HISTORY, []);
    const testedIds = Object.keys(status);
    const testedSet = new Set(testedIds);

    // ---------- 空状态 ----------
    if (!testedIds.length && !history.length) {
      root.append(h('div', { class: 'card hint-empty' },
        h('h2', { text: '还没有诊断记录' }),
        h('p', { class: 'muted' }, '完成第一次诊断后，这里会出现你的掌握情况、分册进度和薄弱点清单一览。'),
        h('a', { class: 'btn primary', href: 'diagnose/', style: 'display:inline-block;margin-top:8px;text-decoration:none;' }, '开始第一次诊断 →')));
      return;
    }

    // ---------- 总览 ----------
    const counts = { mastered: 0, shaky: 0, weak: 0, untested: 0 };
    D.topics.forEach(function (t) {
      if (t.external) return;
      const s = status[t.id];
      if (s && STATUS_ORDER.indexOf(s.s) >= 0) counts[s.s] += 1;
      else counts.untested += 1;
    });
    const total = D.topics.filter(function (t) { return !t.external; }).length;
    const tested = counts.mastered + counts.shaky + counts.weak;
    const lastTs = testedIds.length ? Math.max.apply(null, testedIds.map(function (id) { return status[id].t || 0; })) : 0;
    const fmtDate = function (ms) { return ms ? new Date(ms).toLocaleDateString('zh-CN') : ''; };

    root.append(h('div', { class: 'card' },
      h('h2', { text: '总体掌握情况' }),
      h('p', { class: 'muted small', text: '「测过」= 在历次诊断中被测到（任意状态）；已掌握含由后续知识点答对推断的部分。最近更新：' + fmtDate(lastTs) }),
      h('div', { class: 'stats' },
        stat('ok', counts.mastered, '已掌握'),
        stat('shaky', counts.shaky, '不稳'),
        stat('bad', counts.weak, '要先补'),
        stat('unk', counts.untested, '从没测到'),
        stat('ask', tested + ' / ' + total, '已测覆盖')),
      h('div', { class: 'bar' },
        h('i', { class: 'm', style: 'width:' + (counts.mastered / total * 100) + '%' }),
        h('i', { class: 's', style: 'width:' + (counts.shaky / total * 100) + '%' }),
        h('i', { class: 'w', style: 'width:' + (counts.weak / total * 100) + '%' })),
      h('p', { class: 'muted small', style: 'margin:2px 0 0' },
        '覆盖率 ' + Math.round(tested / total * 100) + '%，其中掌握 ' + Math.round(counts.mastered / total * 100) + '%')));

    // ---------- 分册进度 ----------
    const byVol = {};
    D.topics.forEach(function (t) {
      const k = volKey(t);
      const v = byVol[k] || (byVol[k] = { total: 0, m: 0, s: 0, w: 0 });
      if (!t.external) v.total += 1; else v.total += 0;
      if (t.external) return;
      const s = status[t.id];
      if (s && STATUS_ORDER.indexOf(s.s) >= 0) v[s.s.charAt(0) === 'm' ? 'm' : s.s.charAt(0) === 's' ? 's' : 'w'] += 1;
    });
    const volCard = h('div', { class: 'card' }, h('h2', { text: '各册进度' }));
    VOL_ORDER.forEach(function (k) {
      const v = byVol[k];
      if (!v) return;
      const done = v.m + v.s + v.w;
      volCard.append(h('div', { class: 'volrow' },
        h('div', { class: 'lbl' },
          h('b', { text: VOL_LABEL[k] }),
          h('span', { class: 'pct', text: done ? '测过 ' + done + '/' + v.total + '，掌握 ' + v.m : '还没测过' })),
        h('div', { class: 'bar' },
          h('i', { class: 'm', style: 'width:' + (v.total ? v.m / v.total * 100 : 0) + '%' }),
          h('i', { class: 's', style: 'width:' + (v.total ? v.s / v.total * 100 : 0) + '%' }),
          h('i', { class: 'w', style: 'width:' + (v.total ? v.w / v.total * 100 : 0) + '%' }))));
    });
    root.append(volCard);

    // ---------- 领域分布 ----------
    const byDomain = {};
    D.topics.forEach(function (t) {
      if (t.external) return;
      const d = t.domain || '其他';
      const v = byDomain[d] || (byDomain[d] = { total: 0, m: 0, s: 0, w: 0 });
      v.total += 1;
      const s = status[t.id];
      if (s && STATUS_ORDER.indexOf(s.s) >= 0) v[s.s.charAt(0) === 'm' ? 'm' : s.s.charAt(0) === 's' ? 's' : 'w'] += 1;
    });
    const domCard = h('div', { class: 'card' }, h('h2', { text: '各领域进度' }));
    Object.keys(byDomain).forEach(function (d) {
      const v = byDomain[d];
      domCard.append(h('div', { class: 'volrow' },
        h('div', { class: 'lbl' },
          h('b', { text: d }),
          h('span', { class: 'pct', text: '掌握 ' + v.m + '/' + v.total })),
        h('div', { class: 'bar' },
          h('i', { class: 'm', style: 'width:' + (v.total ? v.m / v.total * 100 : 0) + '%' }),
          h('i', { class: 's', style: 'width:' + (v.total ? v.s / v.total * 100 : 0) + '%' }),
          h('i', { class: 'w', style: 'width:' + (v.total ? v.w / v.total * 100 : 0) + '%' }))));
    });
    root.append(domCard);

    // ---------- 薄弱点清单 + 一键复习 ----------
    const weakIds = testedIds.filter(function (id) { return status[id] && status[id].s === 'weak'; });
    const shakyIds = testedIds.filter(function (id) { return status[id] && status[id].s === 'shaky'; });
    const weakCard = h('div', { class: 'card' },
      h('h2', { text: '目前要先补的（' + weakIds.length + '）' }),
      h('p', { class: 'muted small' }, '由最近一次测到它们的状态汇总。补完可以回到诊断页复测，状态会自动更新。'),
      weakIds.length ? [
        h('div', { class: 'row', style: 'margin-bottom:8px' },
          h('button', {
            class: 'primary',
            onclick: function () { location.href = 'diagnose/?target=' + encodeURIComponent(weakIds.slice(0, 12).join(',')); }
          }, '一键复习全部（一次最多 12 个）')),
        weakIds.map(function (id) {
          return h('div', { class: 'topic-row' },
            h('span', { class: 'nm', text: nameOf(id) }),
            h('span', { class: 'sec', text: chapterOf(id) }),
            h('button', { onclick: function () { location.href = 'diagnose/?target=' + encodeURIComponent(id); } }, '复习'));
        })
      ] : h('p', { class: 'muted' }, '没有。太棒了!'));
    root.append(weakCard);

    if (shakyIds.length) {
      root.append(h('div', { class: 'card' },
        h('h2', { text: '有点不稳的（' + shakyIds.length + '）' }),
        h('div', null, shakyIds.map(function (id) {
          return h('span', { class: 'tag shaky', style: 'display:inline-block;margin:2px 4px 2px 0;', text: nameOf(id) });
        }))));
    }
    function nameOf(id) { const t = D.byId.get(id); return t ? t.name : id; }
    function chapterOf(id) { const t = D.byId.get(id); return t ? (t.external ? '小学' : t.chapter) : ''; }

    // ---------- 诊断历史时间线 ----------
    const histCard = h('div', { class: 'card' },
      h('h2', { text: '诊断记录（最近 ' + Math.min(history.length, 20) + ' 次）' }),
      h('p', { class: 'muted small' }, '每完成一次诊断在这里留一条记录，可点「复测该目标」重新做一次同样的测试。'),
      history.length ? history.slice(-20).reverse().map(function (e) {
        return h('div', { class: 'topic-row' },
          h('span', { class: 'nm' }, new Date(e.t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }), '　', h('b', { text: e.label })),
          h('span', { class: 'sec', text: '答 ' + e.asked + ' 题 · 要补 ' + (e.weak || []).length + ' · 不稳 ' + (e.shaky || []).length }),
          h('button', { onclick: function () { location.href = 'diagnose/?target=' + encodeURIComponent(e.targets.join(',')); } }, '复测该目标'));
      }) : h('p', { class: 'muted' }, '还没有记录。'));
    root.append(histCard);

    // ---------- 数据管理 ----------
    root.append(h('div', { class: 'card no-print' },
      h('h2', { text: '数据管理' }),
      h('p', { class: 'muted small' }, '所有数据只在本机浏览器 localStorage 里。换设备或清理浏览器前请先导出备份。'),
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: exportJson }, '导出画像 JSON'),
        h('button', { onclick: importJson }, '导入备份'),
        h('button', {
          class: 'clear-btn',
          onclick: function () {
            if (confirm('确定清空全部画像数据吗？（诊断中的会话存档不受影响）')) {
              [LS_STATUS, LS_HISTORY, 'cnmDiagnose.mastered.v1'].forEach(function (k) { localStorage.removeItem(k); });
              render();
            }
          }
        }, '清空画像数据'))));

    function stat(cls, n, label) { return h('div', { class: 'stat ' + cls }, h('b', { text: String(n) }), label); }
  }

  function exportJson() {
    const out = {
      tool: 'cn-math-taxonomy/portrait', version: 1,
      exportedAt: new Date().toISOString(),
      topicStatus: lsJson(LS_STATUS, {}),
      history: lsJson(LS_HISTORY, [])
    };
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'math-portrait-' + new Date().toISOString().slice(0, 10) + '.json' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  function importJson() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'application/json,.json';
    inp.onchange = function () {
      const f = inp.files && inp.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = function () {
        try {
          const d = JSON.parse(r.result);
          if (!d || d.tool !== 'cn-math-taxonomy/portrait') throw new Error('不是本工具导出的画像文件');
          const st = lsJson(LS_STATUS, {});
          const incoming = d.topicStatus || {};
          Object.keys(incoming).forEach(function (id) {
            const cur = st[id];
            if (!cur || (incoming[id].t || 0) >= (cur.t || 0)) st[id] = incoming[id];
          });
          const hist = lsJson(LS_HISTORY, []);
          (d.history || []).forEach(function (e) { if (!hist.some(function (x) { return x.t === e.t && x.label === e.label; })) hist.push(e); });
          hist.sort(function (a, b) { return a.t - b.t; });
          localStorage.setItem(LS_STATUS, JSON.stringify(st));
          localStorage.setItem(LS_HISTORY, JSON.stringify(hist));
          render();
        } catch (e) { alert('导入失败：' + e.message); }
      };
      r.readAsText(f);
    };
    inp.click();
  }

  let D = null;
  load().then(function (d) { D = d; render(); }).catch(function (e) {
    document.getElementById('root').append(h('div', { class: 'card' },
      h('h2', { class: 'err', text: '数据加载失败' }), h('p', null, String(e.message || e))));
  });
})();
