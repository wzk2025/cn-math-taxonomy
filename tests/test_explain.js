/* 通俗讲解模块（explain.js）单元测试：node tests/test_explain.js */
'use strict';
const fs = require('fs');
const path = require('path');
const E = require('../diagnose/explain.js');
const F = require('../diagnose/figures.js');
const topics = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'topics.json'), 'utf8'));

let pass = 0, fail = 0;
function t(ok, msg) { if (ok) { pass++; console.log('  ok   ' + msg); } else { fail++; console.log('  FAIL ' + msg); } }

t(E.count >= 20, '讲解条目 ≥ 20（实际 ' + E.count + '）');
t(E.forTopic(null) === null, '空入参返回 null');
t(E.forTopic({ name: '黄金分割' }) === null, '无关主题返回 null');

/* 七上所有知识点（含外部小学节点除外）都应有讲解 */
const g7 = topics.filter(x => x.grade === 7 && x.semester === '上');
const missing = g7.filter(x => !E.forTopic(x)).map(x => x.name);
t(missing.length === 0, '七上 ' + g7.length + ' 个知识点全部有讲解（缺：' + missing.join('、') + '）');

/* 全部年级（外部小学节点除外）都应有讲解 */
const all = topics.filter(x => !x.external);
const missAll = all.filter(x => !E.forTopic(x)).map(x => x.grade + x.semester + ' ' + x.name);
t(missAll.length === 0, '全部 ' + all.length + ' 个知识点全部有讲解（缺：' + missAll.join('、') + '）');

/* html 完整性：talk 必有，无 undefined/NaN */
let bad = [];
for (const name of ['数轴', '绝对值的概念与几何意义', '去括号法则', '合并同类项', '等式的性质', '移项与合并同类项解方程',
  '行程问题（相遇与追及）', '余角和补角', '角的概念与表示', '乘方的概念', '科学记数法', '直线、射线、线段']) {
  const e = E.forTopic({ name: name });
  if (!e) { bad.push(name); continue; }
  if (!e.html || e.html.indexOf('class="talk"') < 0) bad.push(name + '(无talk)');
  if (/undefined|NaN/.test(e.html)) bad.push(name + '(含undefined)');
}
t(bad.length === 0, '12 个关键主题讲解 html 完整（坏：' + bad.join(',') + '）');

/* 匹配优先级：概念题 vs 解法题 */
function titleOf(n) { const e = E.forTopic({ name: n }); return e ? e.title : ''; }
t(/天平/.test(titleOf('一元一次方程的概念')), '方程概念 → 天平（而非五步流程）');
t(/五步/.test(titleOf('含分母的一元一次方程')), '解方程 → 五步流程');
t(/应用题/.test(titleOf('列一元一次方程解应用题的步骤')), '应用题步骤 → 应用题方法（优先于解法图）');
t(/角平分线/.test(titleOf('角的比较与运算（含角平分线）')), '含角平分线 → 角平分线讲解');
t(/角的认识|^角/.test(titleOf('角的概念与表示')), '角的表示 → 角的认识');

/* 图解与讲解独立工作 */
t(F.count >= 55, '图集数量 ≥ 55（实际 ' + F.count + '）');

console.log(fail === 0 ? '全部通过：' + pass + ' 项' : '失败 ' + fail + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
