#!/usr/bin/env node
/* 无头 Chrome 冒烟测试 + 截图（无依赖：用 Node 内置 WebSocket 直接说 Chrome DevTools Protocol）。
 *
 *   node scripts/screenshot.js
 *
 * 做的事：起一个 python3 http.server，启动系统 Chrome（headless），
 *   1) 打开 /diagnose/，选目标、「不会」两次（出第二题 → 判薄弱 → 回溯先修）、刷新验证存档、一路答到结果页、导出 JSON、生成 PDF；
 *      再用固定 seed 分别测选择题（点选项）和数值题（输入答案）的自动判题与解析显示；全程监听 console 错误；
 *   2) 用 ?target=cnm_221&demo=1 的演示模式（掌握 / 不稳 / 薄弱 三种状态都会出现）截
 *      screenshots/01-start.png、02-question.png、03-result.png、04-graph.png，
 *      并截答题后显示解析的 05-explanation.png（1280×900）。
 * 环境变量：CHROME=/path/to/chrome  PORT=8765  DEBUG_PORT=9333
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const E = require('../diagnose/engine.js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'screenshots');
const PORT = parseInt(process.env.PORT || '8765', 10);
const DEBUG_PORT = parseInt(process.env.DEBUG_PORT || '9333', 10);
const BASE = 'http://127.0.0.1:' + PORT;

// 引擎是确定性的：在 Node 里用同一个 seed 预先算出浏览器里会出现哪道题
const DATA = path.join(ROOT, 'data');
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const GRAPH = E.buildGraph(readJson('topics.json'), readJson('dependencies.json'), readJson('questions.json'));
function seedFor(topicId, pred) {
  for (let i = 0; i < 60; i++) {
    const seed = 'smoke' + i;
    const it = E.nextItem(GRAPH, E.createSession(GRAPH, [topicId], { seed: seed, avoid: [] }));
    if (pred(it.question)) return { seed: seed, q: it.question };
  }
  throw new Error('找不到合适的 seed：' + topicId);
}

function findChrome() {
  const cands = [process.env.CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
  const hit = cands.find((p) => fs.existsSync(p));
  if (!hit) throw new Error('找不到 Chrome/Chromium，请设置环境变量 CHROME');
  return hit;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } }); }).on('error', reject);
  });
}
async function waitFor(fn, what, ms) {
  const end = Date.now() + (ms || 15000);
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch (e) { /* retry */ }
    if (Date.now() > end) throw new Error('等待超时：' + what);
    await sleep(100);
  }
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = []; ws.addEventListener('message', (m) => this.onMessage(m.data)); }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    return new CDP(ws);
  }
  onMessage(data) {
    const msg = JSON.parse(data);
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
    } else if (msg.method) this.handlers.forEach((h) => h(msg));
  }
  send(method, params) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  on(fn) { this.handlers.push(fn); }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const chromePath = findChrome();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cnm-chrome-'));
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  const chrome = spawn(chromePath, [
    '--headless=new', '--remote-debugging-port=' + DEBUG_PORT, '--user-data-dir=' + profile,
    '--window-size=1280,900', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'
  ], { stdio: 'ignore' });
  const errors = [];
  const checks = [];
  const check = (ok, msg) => { checks.push([ok, msg]); console.log((ok ? '  ok   ' : '  FAIL ') + msg); };
  let exitCode = 0;
  let dumpPage = null;
  try {
    await waitFor(() => getJson(BASE + '/diagnose/engine.js').then(() => true, () => fetchOk(BASE + '/diagnose/engine.js')), 'http.server');
    const targets = await waitFor(async () => { const l = await getJson('http://127.0.0.1:' + DEBUG_PORT + '/json/list'); return l.find((t) => t.type === 'page'); }, 'Chrome 调试端口');
    const cdp = await CDP.connect(targets.webSocketDebuggerUrl);
    cdp.on((m) => {
      if (m.method === 'Runtime.exceptionThrown') errors.push('exception: ' + (m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text));
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error: ' + m.params.args.map((a) => a.value || a.description).join(' '));
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push('log: ' + m.params.entry.text + ' ' + (m.params.entry.url || ''));
      if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) errors.push('http ' + m.params.response.status + ' ' + m.params.response.url);
    });
    await Promise.all(['Runtime', 'Log', 'Page', 'Network'].map((d) => cdp.send(d + '.enable')));
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

    const evalJs = async (expr) => {
      const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error('evaluate 失败：' + expr + ' → ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description));
      return r.result.value;
    };
    const goto = async (url) => {
      await cdp.send('Page.navigate', { url });
      await waitFor(() => evalJs('document.readyState === "complete"'), 'load ' + url);
    };
    dumpPage = () => evalJs('document.body.innerText.slice(0, 1500)');
    const exists = (sel) => evalJs('!!document.querySelector(' + JSON.stringify(sel) + ')');
    const click = (sel) => evalJs('(() => { const e = document.querySelector(' + JSON.stringify(sel) + '); if (!e) throw new Error("no " + ' + JSON.stringify(sel) + '); e.click(); return true; })()');
    const shot = async (file, selector) => {
      await sleep(300);
      // 默认截页面顶部 1280×900；给 selector 则从该元素上沿起截 1280×900（可超出当前视口）
      const y = selector ? await evalJs('Math.max(0, document.querySelector(' + JSON.stringify(selector) + ').getBoundingClientRect().top + window.scrollY - 12)') : 0;
      const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: y, width: 1280, height: 900, scale: 1 } });
      fs.writeFileSync(path.join(OUT, file), Buffer.from(r.data, 'base64'));
      console.log('  截图 screenshots/' + file);
    };

    console.log('冒烟测试');
    await goto(BASE + '/diagnose/');
    await evalJs('localStorage.clear()');
    await goto(BASE + '/diagnose/');
    await waitFor(() => exists('#target-list .topic-row'), '开始页列表');
    const rows = await evalJs('document.querySelectorAll("#target-list .topic-row").length');
    check(rows > 100, '开始页渲染了知识点列表（' + rows + ' 行）');
    check(await exists('.chap-head button.primary'), '有「以整章为目标」按钮');
    check(await evalJs('Array.from(document.querySelectorAll("a.back")).some(a => a.getAttribute("href") === "../index.html")'), '有返回知识图谱的链接');

    // 搜索并选目标
    await evalJs('(() => { const s = document.getElementById("search"); s.value = "配方法"; s.dispatchEvent(new Event("input", {bubbles:true})); })()');
    const found = await evalJs('document.querySelectorAll("#target-list .topic-row").length');
    check(found >= 1 && found < 20, '搜索「配方法」得到 ' + found + ' 个知识点');
    await click('#target-list .topic-row button');
    await waitFor(() => exists('.q-text'), '出题页');
    check(true, '能选目标并进入出题页');
    check((await evalJs('document.querySelector(".q-title").textContent')).includes('配方法'), '首题是目标知识点本身（配方法）');

    // 第一题：点「不会」→ 显示解析与参考答案 → 下一题；同一知识点出第二题
    check(await exists('.tag.diff-basic, .tag.diff-standard, .tag.diff-advanced'), '题目显示难度标签');
    check(await exists('#btn-skip'), '有「不会」按钮');
    await click('#btn-skip');
    await waitFor(() => exists('.refans'), '「不会」后显示参考答案');
    check(await exists('#explain') && (await evalJs('document.querySelector("#explain").textContent')).includes('解析'), '「不会」后显示解析和参考答案');
    await click('#btn-next');
    await waitFor(() => evalJs('document.querySelector(".q-text") && !document.querySelector(".refans")'), '第二题');
    const cardText2 = await evalJs('document.querySelector(".card").textContent');
    check(/第 2 题/.test(cardText2) && cardText2.includes('本知识点第 2 题') && (await evalJs('document.querySelector(".q-title").textContent')).includes('配方法'),
      '第一题没过 → 同一知识点（配方法）再出第 2 题');
    await click('#btn-skip');
    await click('#btn-next');
    await waitFor(() => evalJs('document.querySelector(".q-text") && !document.querySelector(".refans")'), '回溯到先修');
    const cardText3 = await evalJs('document.querySelector(".card").textContent');
    check(/第 3 题/.test(cardText3) && !(await evalJs('document.querySelector(".q-title").textContent')).includes('配方法') && cardText3.includes('本知识点第 1 题'),
      '两题都没过 → 判薄弱并回溯到先修知识点（第 3 题是别的知识点）');
    const saved = await evalJs('JSON.parse(localStorage.getItem("cnmDiagnose.session.v2")).answers.length');
    check(saved === 2, '进度已保存到 localStorage（answers=' + saved + '）');
    check(await evalJs('JSON.parse(localStorage.getItem("cnmDiagnose.seen.v1")).length') === 2, '出过的题 id 记录在 localStorage（2 道）');

    // 刷新后可继续
    await goto(BASE + '/diagnose/');
    await waitFor(() => exists('.banner button.primary'), '继续存档横幅');
    await click('.banner button.primary');
    await waitFor(() => exists('.q-text'), '继续后的出题页');
    check(/第 3 题/.test(await evalJs('document.querySelector(".card").textContent')), '刷新后点「继续」仍在第 3 题');

    // 一路点「不会」到结果页
    for (let i = 0; i < 40; i++) {
      if (await exists('#summary')) break;
      if (await exists('#btn-skip')) await click('#btn-skip');
      await waitFor(() => exists('#btn-next'), '下一题按钮');
      await click('#btn-next');
      await sleep(30);
    }
    await waitFor(() => exists('#summary'), '结果页');
    check(await exists('#roots') && await exists('#path') && await exists('svg.graph') && await exists('#shaky'), '结果页含 根因 / 不稳 / 学习路径 / SVG 路径图');
    const asked = await evalJs('document.querySelectorAll("#log tbody tr").length');
    check(asked > 2 && asked <= 16, '答题数不超过上限 16（实际 ' + asked + '）');
    check((await evalJs('document.querySelectorAll("#roots details.topic").length')) >= 1, '至少有一个薄弱根因可展开');
    check((await evalJs('document.querySelectorAll("#standards .std").length')) >= 1, '列出了相关课标条目（含原文）');
    await click('#btn-export');
    check(true, '「导出 JSON」点击无异常');
    const pdf = await cdp.send('Page.printToPDF', { printBackground: true });
    check(pdf.data.length > 1000, '打印为 PDF 成功（' + Math.round(pdf.data.length * 0.75 / 1024) + ' KB）');
    // 改答案
    await evalJs('(() => { const sel = document.querySelector("#log select"); sel.value = "correct"; sel.dispatchEvent(new Event("change", {bubbles:true})); })()');
    await sleep(200);
    check(await exists('#summary') || await exists('.q-text'), '更正某题答案后页面正常重算');

    // 选择题：固定 seed，点选项 → 提交 → 自动判题 + 解析
    console.log('选择题 / 数值题');
    const ch = seedFor('cnm_221', (q) => q.type === 'choice');
    await goto(BASE + '/diagnose/');
    await evalJs('localStorage.clear()');
    await goto(BASE + '/diagnose/?target=cnm_221&seed=' + ch.seed);
    await waitFor(() => exists('#choices'), '选择题出题页');
    check((await evalJs('document.querySelector("#q-text").textContent')) === ch.q.prompt, '固定 seed 出的是预期的题（' + ch.q.id + '）');
    check((await evalJs('document.querySelectorAll("#choices .choice").length')) === ch.q.choices.length, '渲染了 ' + ch.q.choices.length + ' 个选项');
    const wrongKey = ch.q.choices.find((c) => c.key !== ch.q.answer).key;
    await click('#choice-' + wrongKey);
    await click('#btn-submit');
    await waitFor(() => exists('.verdict'), '选择题判定');
    check((await evalJs('document.querySelector(".verdict").textContent')).includes('不正确'), '选错的选项被判为不正确');
    check((await evalJs('document.querySelector("#explain").textContent')).includes(ch.q.explanation), '自动判题后也显示解析');
    check((await evalJs('document.querySelector(".refans").textContent')).includes(ch.q.answer + '.'), '显示参考答案（含选项文字）');
    await click('#btn-flip');
    await waitFor(() => exists('#summary'), '改判为对后目标即掌握，直接到结果页');
    check((await evalJs('JSON.parse(localStorage.getItem("cnmDiagnose.session.v2")).answers[0].result')) === 'correct', '「判错了，我其实做对了」可更正为对（目标掌握，结果页无需补课）');

    // 找一个答案是分数 / 负数的数值题，用全角写法作答
    let nu = null, nuTopic = null;
    for (const t of GRAPH.topics) {
      if (t.external) continue;
      try { nu = seedFor(t.id, (q) => q.type === 'numeric' && /^-?\d+\/\d+$|^-\d+$/.test(q.answer)); nuTopic = t.id; break; } catch (e) { /* 换一个知识点 */ }
    }
    await goto(BASE + '/diagnose/');
    await evalJs('localStorage.clear()');
    await goto(BASE + '/diagnose/?target=' + nuTopic + '&seed=' + nu.seed);
    await waitFor(() => exists('#ans'), '数值题出题页');
    const typed = nu.q.answer;
    await evalJs('(() => { const i = document.getElementById("ans"); i.value = ' + JSON.stringify(typed.replace(/[0-9]/g, (d) => String.fromCharCode(d.charCodeAt(0) + 0xFEE0)).replace('-', '－').replace('/', '／')) + '; i.dispatchEvent(new Event("input", {bubbles:true})); })()');
    await click('#btn-submit');
    await waitFor(() => exists('.verdict'), '数值题自动判定');
    check((await evalJs('document.querySelector(".verdict").textContent')).includes('正确'), '数值题自动判题：全角写法的「' + typed + '」被判为正确（' + nu.q.id + '）');
    await shot('05-explanation.png');

    // 截图（演示模式）
    console.log('截图');
    await goto(BASE + '/diagnose/');
    await evalJs('localStorage.clear()');
    await goto(BASE + '/diagnose/');
    await waitFor(() => exists('#target-list .topic-row'), '开始页');
    await shot('01-start.png');
    await goto(BASE + '/diagnose/?target=cnm_221&demo=1&step=2');
    await waitFor(() => exists('.q-text'), '演示出题页');
    await shot('02-question.png');
    await goto(BASE + '/diagnose/?target=cnm_221&demo=1');
    await waitFor(() => exists('#summary'), '演示结果页');
    check(await exists('#roots details.topic'), '演示模式到达结果页并有根因');
    const stat = (cls) => evalJs('parseInt(document.querySelector("#summary .stat.' + cls + ' b").textContent, 10)');
    check((await stat('ok')) > 0 && (await stat('shaky')) > 0 && (await stat('bad')) > 0,
      '演示模式同时出现 掌握（' + await stat('ok') + '）/ 不稳（' + await stat('shaky') + '）/ 薄弱（' + await stat('bad') + '）三种状态');
    check(await exists('#shaky details.topic') && await exists('#path .tag.shaky'), '「不稳」的点单独列出，并出现在学习路径里');
    await shot('03-result.png');
    // 路径图单独存一张便于检查
    await shot('04-graph.png', '#graph');

    // 整章目标（URL 参数 chapter）+ 数值题自动判题
    await goto(BASE + '/diagnose/?chapter=' + encodeURIComponent('七上 第一章') + '&demo=1');
    await waitFor(() => exists('#summary'), '整章演示结果页');
    check((await evalJs('document.querySelector("#summary h2").textContent')).includes('整章'), '整章作为目标（?chapter=七上 第一章）可诊断');

    check(errors.length === 0, 'console / 网络无错误' + (errors.length ? '：\n       ' + errors.join('\n       ') : ''));
    if (checks.some((c) => !c[0])) exitCode = 1;
    cdp.ws.close();
  } catch (e) {
    console.error('冒烟测试异常：' + (e && e.stack || e));
    if (dumpPage) { try { console.error('当前页面文字：\n' + await dumpPage()); } catch (e2) { /* ignore */ } }
    if (errors.length) console.error('已捕获的浏览器错误：\n' + errors.join('\n'));
    exitCode = 1;
  } finally {
    chrome.kill('SIGKILL');
    server.kill('SIGKILL');
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
  console.log(exitCode ? '\n冒烟测试未通过' : '\n冒烟测试通过（' + checks.length + ' 项）');
  process.exit(exitCode);
}

function fetchOk(url) { return fetch(url).then((r) => r.ok, () => false); }
main();
