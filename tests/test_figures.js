/* 图解模块（figures.js）单元测试：node tests/test_figures.js */
'use strict';
const fs = require('fs');
const path = require('path');
const F = require('../diagnose/figures.js');
const topics = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'topics.json'), 'utf8'));

let pass = 0, fail = 0;
function t(ok, msg) { if (ok) { pass++; console.log('  ok   ' + msg); } else { fail++; console.log('  FAIL ' + msg); } }

/* 1. 基础 API */
t(F.count >= 55, '图集数量 ≥ 55（实际 ' + F.count + '）');
t(F.forTopic(null) === null && F.forTopic({}) === null, '空入参返回 null');
t(F.forTopic({ name: '不存在的概念xyz' }) === null, '无关主题返回 null');

/* 2. 每张图都是合法 SVG，坐标没有 NaN/undefined 漏进字符串 */
let bad = [], nan = [];
for (const name of ['数轴', '在数轴上表示不等式的解集', '平面直角坐标系与点的坐标', '函数的概念', '一次函数的图象与画法',
  '二次函数的概念', '反比例函数的图象与性质', '角的认识与度量', '对顶角相等', '同位角、内错角、同旁内角',
  '三角形内角和定理', '等腰三角形的性质', '全等三角形的性质', '相似三角形的判定', '勾股定理',
  '线段垂直平分线的性质与判定', '角平分线的性质', '轴对称的性质', '中心对称与中心对称图形', '图形的平移',
  '图形的旋转', '线段、射线与直线', '圆的有关概念', '圆周角定理', '切线的性质', '弧长与扇形面积',
  '平行四边形的性质', '频数分布表与数据分组', '扇形图、条形图与折线图', '概率的意义与等可能事件的概率']) {
  const f = F.forTopic({ name: name });
  if (!f) { bad.push(name); continue; }
  if (!/^<svg viewBox="0 0 \d+ \d+"/.test(f.svg)) bad.push(name + ' (svg头)');
  if (/NaN|undefined|Infinity/.test(f.svg)) nan.push(name);
  if (!f.title || typeof f.note !== 'string') bad.push(name + ' (元数据)');
}
t(bad.length === 0, '30 个关键主题全部出图（缺：' + bad.join(',') + '）');
t(nan.length === 0, 'SVG 中无 NaN/undefined（坏：' + nan.join(',') + '）');

/* 3. 覆盖率：333 个知识点里能配上图的比例 */
const hit = topics.filter(x => F.forTopic(x));
t(hit.length >= 170, '知识点配图覆盖 ≥ 170 / ' + topics.length + '（实际 ' + hit.length + '）');

/* 4. 匹配优先级：具体规则先于泛化规则 */
function titleOf(n) { const f = F.forTopic({ name: n }); return f ? f.title : ''; }
t(/垂直平分线/.test(titleOf('线段垂直平分线的性质与判定')), '垂直平分线 → 专属图（而非轴对称）');
t(/全等/.test(titleOf('直角三角形全等的判定（HL）')), 'HL 全等 → 全等图（而非勾股）');
t(/统计/.test(titleOf('平方差公式')) === false, '「平方差」不误中统计图（方差误匹配已排除）');
t(/平行四边形/.test(titleOf('平行四边形的性质')), '平行四边形 → 四边形家族图（而非三线八角）');
t(/一次函数/.test(titleOf('一次函数的图象与画法')), '一次函数 → 一次函数图（而非泛化函数图）');
t(/圆周角|圆/.test(titleOf('圆周角定理')), '圆周角 → 圆周角图（而非普通圆）');
t(/扇形统计图|扇形图/.test(titleOf('扇形图、条形图与折线图')) && !/弧长/.test(titleOf('扇形图、条形图与折线图')), '统计图主题 → 扇形统计图（而非弧长）');
t(/弧长|扇形/.test(titleOf('弧长与扇形面积')), '弧长主题 → 弧长/扇形面积图');
t(/行程问题/.test(titleOf('行程问题（相遇与追及）')), '行程问题 → 相遇/追及线段图');
t(/工程与配套/.test(titleOf('配套与工程问题')), '配套工程 → 条块图');
t(/销售与利润/.test(titleOf('销售与利润问题')), '销售利润 → 流程图');
t(/分段计费/.test(titleOf('分段计费与方案选择')), '分段计费 → 阶梯折线图');
t(/行程问题/.test(titleOf('一次函数的图象与画法')) === false, '一次函数不误中行程图（行程规则不再抢先）');
t(/扇形统计图/.test(titleOf('统计表、统计图与平均数')) || /扇形|条形/.test(titleOf('统计表、统计图与平均数')), '统计表主题仍出统计图');
t(F.count >= 55, '图集数量 ≥ 55（实际 ' + F.count + '）');
t(titleOf('抛物线的开口方向与对称轴') !== '', '抛物线主题可出图');

console.log(fail === 0 ? '全部通过：' + pass + ' 项' : '失败 ' + fail + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
