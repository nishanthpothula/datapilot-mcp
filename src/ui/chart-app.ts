/**
 * DataPilot MCP — Chart "MCP App" template (SEP-1865 / io.modelcontextprotocol/ui)
 *
 * This exports a STATIC HTML template (no per-call data). It is registered once as a
 * `ui://datapilot/chart` resource (see src/ui/registry.ts) with mimeType
 * `text/html;profile=mcp-app`. The host renders it in a sandboxed iframe and delivers
 * the chart data at runtime as `structuredContent` via a `ui/notifications/tool-result`
 * message. The template talks to the host over postMessage + JSON-RPC 2.0:
 *
 *   → ui/initialize            (request; we read theme from the HostContext result)
 *   ← ui/notifications/tool-result  (host pushes { structuredContent: { chart, rows } })
 *   → ui/notifications/size-changed (we report our rendered height)
 *
 * Everything is self-contained: no external requests. The chart is drawn with vanilla
 * SVG. The `structuredContent` shape it expects:
 *   { chart: { chartType, xField, yField, colorField, title, description }, rows: [...] }
 */

// Browser-side script. Kept as a plain string (opaque to the Node TS compiler, no DOM
// lib friction) using single quotes and string concatenation only — no backticks, no
// `${` — so it embeds inside the outer template literal without escaping.
const CLIENT_JS = `
(function () {
  var DATA = [], CFG = {}, current = 'bar', host = null;

  var PALETTE = ['#4f8cff','#22b8a6','#f6a723','#e0568b','#8b5cf6','#3ecf8e','#ef6f53','#6b8afd','#d98cff','#5ac8fa'];
  var W = 700, H = 380, M = { t: 26, r: 18, b: 78, l: 64 };
  var PW = W - M.l - M.r, PH = H - M.t - M.b;

  function num(v) { var n = (typeof v === 'number') ? v : parseFloat(v); return isNaN(n) ? 0 : n; }
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function fmt(n) {
    if (typeof n !== 'number' || !isFinite(n)) return String(n);
    if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
    return (Math.round(n * 100) / 100).toString();
  }

  // ── postMessage / JSON-RPC bridge to the host ──────────────────────────────
  var nextId = 1, pending = {};
  function req(method, params) {
    var id = nextId++;
    return new Promise(function (resolve) {
      pending[id] = resolve;
      window.parent.postMessage({ jsonrpc: '2.0', id: id, method: method, params: params }, '*');
      setTimeout(function () { if (pending[id]) { delete pending[id]; resolve(null); } }, 3000);
    });
  }
  function notify(method, params) {
    window.parent.postMessage({ jsonrpc: '2.0', method: method, params: params }, '*');
  }
  window.addEventListener('message', function (e) {
    var m = e.data; if (!m || m.jsonrpc !== '2.0') return;
    if (m.id && pending[m.id]) { var r = pending[m.id]; delete pending[m.id]; r(m.result || null); return; }
    if (m.method === 'ui/notifications/tool-result') {
      var sc = m.params && m.params.structuredContent;
      if (sc) boot(sc);
    }
  });

  function applyTheme(hostCtx) {
    try {
      var theme = hostCtx && hostCtx.hostContext && hostCtx.hostContext.theme;
      if (theme === 'dark' || theme === 'light') document.documentElement.setAttribute('data-theme', theme);
    } catch (err) {}
  }

  function postSize() {
    try {
      var h = Math.ceil(document.body.scrollHeight) + 4;
      notify('ui/notifications/size-changed', { width: document.body.scrollWidth, height: h });
    } catch (err) {}
  }

  function boot(sc) {
    CFG = sc.chart || {};
    DATA = sc.rows || [];
    current = CFG.chartType || 'bar';
    document.getElementById('title').textContent = CFG.title || 'Chart';
    document.getElementById('desc').textContent = CFG.description || '';
    document.getElementById('rowcount').textContent = DATA.length + (DATA.length === 1 ? ' row' : ' rows');
    document.getElementById('empty').style.display = DATA.length ? 'none' : 'block';
    render();
    postSize();
  }

  // ── chart drawing (vanilla SVG) ────────────────────────────────────────────
  function grouped() {
    var xf = CFG.xField, yf = CFG.yField, map = {}, order = [];
    for (var i = 0; i < DATA.length; i++) {
      var k = String(DATA[i][xf]);
      var y = yf ? num(DATA[i][yf]) : 1;
      if (!(k in map)) { map[k] = 0; order.push(k); }
      map[k] += y;
    }
    return order.map(function (k) { return { key: k, value: map[k] }; });
  }
  function niceMax(v) {
    if (v <= 0) return 1;
    var pow = Math.pow(10, Math.floor(Math.log10(v))), f = v / pow;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
  }
  function axes(svg, yMax, xLabels, band) {
    var i, y, yy, gx;
    for (i = 0; i <= 4; i++) {
      y = yMax * i / 4; yy = M.t + PH - (y / yMax) * PH;
      svg.push('<line x1="' + M.l + '" y1="' + yy + '" x2="' + (M.l + PW) + '" y2="' + yy + '" class="grid"/>');
      svg.push('<text x="' + (M.l - 8) + '" y="' + (yy + 4) + '" class="tick tick-y">' + esc(fmt(y)) + '</text>');
    }
    if (xLabels) for (i = 0; i < xLabels.length; i++) {
      gx = M.l + band * i + band / 2;
      var lbl = xLabels[i]; if (lbl.length > 12) lbl = lbl.slice(0, 11) + '…';
      svg.push('<text x="' + gx + '" y="' + (M.t + PH + 16) + '" class="tick tick-x" transform="rotate(35 ' + gx + ' ' + (M.t + PH + 16) + ')">' + esc(lbl) + '</text>');
    }
  }
  function drawBar() {
    var g = grouped(), svg = [];
    var yMax = niceMax(Math.max.apply(null, g.map(function (d) { return d.value; }).concat([0])));
    var band = PW / Math.max(g.length, 1), bw = Math.max(2, Math.min(band * 0.7, 64));
    axes(svg, yMax, g.map(function (d) { return d.key; }), band);
    for (var i = 0; i < g.length; i++) {
      var h = (g[i].value / yMax) * PH, x = M.l + band * i + (band - bw) / 2, y = M.t + PH - h;
      svg.push('<rect class="mark" x="' + x + '" y="' + y + '" width="' + bw + '" height="' + Math.max(0, h) + '" rx="3" fill="' + PALETTE[i % PALETTE.length] + '"><title>' + esc(g[i].key) + ': ' + esc(fmt(g[i].value)) + '</title></rect>');
    }
    return svg.join('');
  }
  function drawHistogram() {
    var xf = CFG.xField, vals = DATA.map(function (r) { return num(r[xf]); }).filter(function (v) { return isFinite(v); }), svg = [];
    if (!vals.length) return '';
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals), bins = 10, width = (mx - mn) || 1, bw0 = width / bins, counts = new Array(bins).fill(0);
    for (var i = 0; i < vals.length; i++) counts[Math.min(bins - 1, Math.floor((vals[i] - mn) / bw0))]++;
    var yMax = niceMax(Math.max.apply(null, counts)), band = PW / bins;
    axes(svg, yMax, counts.map(function (_, i) { return fmt(mn + i * bw0); }), band);
    for (var j = 0; j < bins; j++) {
      var h = (counts[j] / yMax) * PH, x = M.l + band * j + 1, y = M.t + PH - h;
      svg.push('<rect class="mark" x="' + x + '" y="' + y + '" width="' + (band - 2) + '" height="' + Math.max(0, h) + '" fill="' + PALETTE[0] + '"><title>' + esc(fmt(mn + j * bw0)) + ' – ' + esc(fmt(mn + (j + 1) * bw0)) + ': ' + counts[j] + '</title></rect>');
    }
    return svg.join('');
  }
  function drawLine() {
    var yf = CFG.yField, xf = CFG.xField, svg = [], ys = DATA.map(function (r) { return yf ? num(r[yf]) : 0; });
    var yMax = niceMax(Math.max.apply(null, ys.concat([0]))), band = PW / Math.max(DATA.length, 1);
    axes(svg, yMax, DATA.map(function (r) { return String(r[xf]); }), band);
    var pts = [];
    for (var i = 0; i < DATA.length; i++) pts.push((M.l + band * i + band / 2) + ',' + (M.t + PH - (ys[i] / yMax) * PH));
    svg.push('<polyline class="line" points="' + pts.join(' ') + '" fill="none" stroke="' + PALETTE[0] + '" stroke-width="2.5"/>');
    for (var k = 0; k < DATA.length; k++) {
      var px = M.l + band * k + band / 2, py = M.t + PH - (ys[k] / yMax) * PH;
      svg.push('<circle class="mark" cx="' + px + '" cy="' + py + '" r="3.5" fill="' + PALETTE[0] + '"><title>' + esc(String(DATA[k][xf])) + ': ' + esc(fmt(ys[k])) + '</title></circle>');
    }
    return svg.join('');
  }
  function drawScatter() {
    var xf = CFG.xField, yf = CFG.yField, svg = [];
    var xs = DATA.map(function (r) { return num(r[xf]); }), ys = DATA.map(function (r) { return yf ? num(r[yf]) : 0; });
    var xMax = niceMax(Math.max.apply(null, xs.concat([0]))), xMin = Math.min.apply(null, xs.concat([0])), yMax = niceMax(Math.max.apply(null, ys.concat([0])));
    var i, yy, xx, tx;
    for (i = 0; i <= 4; i++) {
      yy = M.t + PH - (i / 4) * PH;
      svg.push('<line x1="' + M.l + '" y1="' + yy + '" x2="' + (M.l + PW) + '" y2="' + yy + '" class="grid"/>');
      svg.push('<text x="' + (M.l - 8) + '" y="' + (yy + 4) + '" class="tick tick-y">' + esc(fmt(yMax * i / 4)) + '</text>');
      xx = M.l + (PW * i / 4); tx = xMin + (xMax - xMin) * i / 4;
      svg.push('<text x="' + xx + '" y="' + (M.t + PH + 16) + '" class="tick tick-x">' + esc(fmt(tx)) + '</text>');
    }
    for (i = 0; i < DATA.length; i++) {
      var cx = M.l + ((xs[i] - xMin) / ((xMax - xMin) || 1)) * PW, cy = M.t + PH - (ys[i] / yMax) * PH;
      svg.push('<circle class="mark" cx="' + cx + '" cy="' + cy + '" r="4.5" fill="' + PALETTE[0] + '" fill-opacity="0.72"><title>' + esc(fmt(xs[i])) + ', ' + esc(fmt(ys[i])) + '</title></circle>');
    }
    return svg.join('');
  }
  function drawPie() {
    var g = grouped(), svg = [], legend = [], total = g.reduce(function (a, d) { return a + d.value; }, 0) || 1;
    var cx = M.l + PW / 2, cy = M.t + PH / 2, R = Math.min(PW, PH) / 2 - 6, a0 = -Math.PI / 2;
    for (var i = 0; i < g.length; i++) {
      var frac = g[i].value / total, a1 = a0 + frac * Math.PI * 2;
      var x0 = cx + R * Math.cos(a0), y0 = cy + R * Math.sin(a0), x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1);
      var large = frac > 0.5 ? 1 : 0, col = PALETTE[i % PALETTE.length];
      svg.push('<path class="mark" d="M ' + cx + ' ' + cy + ' L ' + x0 + ' ' + y0 + ' A ' + R + ' ' + R + ' 0 ' + large + ' 1 ' + x1 + ' ' + y1 + ' Z" fill="' + col + '"><title>' + esc(g[i].key) + ': ' + esc(fmt(g[i].value)) + ' (' + Math.round(frac * 100) + '%)</title></path>');
      if (i < 8) legend.push('<span class="lg"><i style="background:' + col + '"></i>' + esc(g[i].key) + '</span>');
      a0 = a1;
    }
    document.getElementById('legend').innerHTML = legend.join('');
    return svg.join('');
  }
  var DRAW = { bar: drawBar, line: drawLine, scatter: drawScatter, pie: drawPie, histogram: drawHistogram };

  function render() {
    document.getElementById('legend').innerHTML = '';
    var body = (DRAW[current] || drawBar)();
    document.getElementById('chart').innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img">' + body + '</svg>';
    var btns = document.querySelectorAll('.seg');
    for (var i = 0; i < btns.length; i++) btns[i].className = 'seg' + (btns[i].getAttribute('data-t') === current ? ' on' : '');
  }
  function toCsv() {
    if (!DATA.length) return '';
    var cols = Object.keys(DATA[0]), lines = [cols.join(',')];
    for (var i = 0; i < DATA.length; i++) lines.push(cols.map(function (c) {
      var v = DATA[i][c]; v = (v === null || v === undefined) ? '' : String(v);
      return /[",\\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    }).join(','));
    return lines.join('\\n');
  }
  function buildTable() {
    if (!DATA.length) return '<p class="muted">No rows.</p>';
    var cols = Object.keys(DATA[0]), h = '<table><thead><tr>';
    for (var c = 0; c < cols.length; c++) h += '<th>' + esc(cols[c]) + '</th>';
    h += '</tr></thead><tbody>';
    var max = Math.min(DATA.length, 100);
    for (var i = 0; i < max; i++) { h += '<tr>'; for (var j = 0; j < cols.length; j++) h += '<td>' + esc(DATA[i][cols[j]]) + '</td>'; h += '</tr>'; }
    h += '</tbody></table>';
    if (DATA.length > max) h += '<p class="muted">Showing first ' + max + ' of ' + DATA.length + ' rows.</p>';
    return h;
  }

  // ── wire controls ──────────────────────────────────────────────────────────
  var segs = document.querySelectorAll('.seg');
  for (var s = 0; s < segs.length; s++) segs[s].addEventListener('click', function () { current = this.getAttribute('data-t'); render(); postSize(); });
  var tableWrap = document.getElementById('tablewrap');
  document.getElementById('toggle').addEventListener('click', function () {
    if (tableWrap.style.display === 'block') { tableWrap.style.display = 'none'; this.textContent = 'Show data ▾'; }
    else { tableWrap.innerHTML = buildTable(); tableWrap.style.display = 'block'; this.textContent = 'Hide data ▴'; }
    postSize();
  });
  document.getElementById('csv').addEventListener('click', function () {
    var blob = new Blob([toCsv()], { type: 'text/csv' }), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'datapilot-data.csv'; a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });

  // ── handshake ──────────────────────────────────────────────────────────────
  req('ui/initialize', {
    appCapabilities: { availableDisplayModes: ['inline'] },
    clientInfo: { name: 'datapilot-chart', version: '1.0.0' },
    protocolVersion: '2026-01-26'
  }).then(function (result) { host = result; applyTheme(result); postSize(); });

  postSize();
})();
`;

/**
 * The static chart template served as the `ui://datapilot/chart` resource.
 * Contains NO data — data arrives at runtime via `ui/notifications/tool-result`.
 */
export const CHART_TEMPLATE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>DataPilot Chart</title>
<style>
  :root {
    --bg:#fff; --fg:#1f2430; --muted:#6b7280; --border:#e5e7eb; --panel:#f7f8fa; --grid:#eceef1; --accent:#4f8cff;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#14171c; --fg:#e6e8ec; --muted:#9aa2ad; --border:#2a2f37; --panel:#1b1f25; --grid:#262b32; --accent:#6b8afd; }
  }
  :root[data-theme="light"] { --bg:#fff; --fg:#1f2430; --muted:#6b7280; --border:#e5e7eb; --panel:#f7f8fa; --grid:#eceef1; --accent:#4f8cff; }
  :root[data-theme="dark"]  { --bg:#14171c; --fg:#e6e8ec; --muted:#9aa2ad; --border:#2a2f37; --panel:#1b1f25; --grid:#262b32; --accent:#6b8afd; }
  * { box-sizing: border-box; }
  body { margin:0; padding:14px; background:var(--bg); color:var(--fg); font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  .head { display:flex; justify-content:space-between; align-items:baseline; gap:12px; flex-wrap:wrap; }
  h1 { font-size:16px; margin:0 0 2px; font-weight:650; }
  .desc { color:var(--muted); margin:0; font-size:12.5px; }
  .rowcount { color:var(--muted); font-size:12px; white-space:nowrap; }
  .toolbar { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin:12px 0 6px; }
  .seg-group { display:inline-flex; border:1px solid var(--border); border-radius:8px; overflow:hidden; }
  .seg { border:0; background:var(--panel); color:var(--fg); padding:5px 11px; font-size:12.5px; cursor:pointer; border-right:1px solid var(--border); }
  .seg:last-child { border-right:0; }
  .seg.on { background:var(--accent); color:#fff; }
  .btn { border:1px solid var(--border); background:var(--panel); color:var(--fg); padding:5px 11px; font-size:12.5px; border-radius:8px; cursor:pointer; }
  .btn:hover { border-color:var(--accent); }
  .card { border:1px solid var(--border); border-radius:12px; padding:8px; background:var(--panel); }
  #chart svg { width:100%; height:auto; display:block; }
  .grid { stroke:var(--grid); stroke-width:1; }
  .tick { fill:var(--muted); font-size:11px; }
  .tick-y { text-anchor:end; } .tick-x { text-anchor:middle; }
  .mark { transition:opacity .12s; cursor:default; } .mark:hover { opacity:.78; }
  #legend { display:flex; flex-wrap:wrap; gap:6px 14px; margin-top:8px; }
  .lg { display:inline-flex; align-items:center; gap:6px; font-size:12px; color:var(--muted); }
  .lg i { width:10px; height:10px; border-radius:2px; display:inline-block; }
  #tablewrap { display:none; margin-top:12px; max-height:320px; overflow:auto; border:1px solid var(--border); border-radius:10px; }
  table { border-collapse:collapse; width:100%; font-size:12px; }
  th,td { text-align:left; padding:6px 10px; border-bottom:1px solid var(--border); white-space:nowrap; }
  th { position:sticky; top:0; background:var(--panel); font-weight:600; }
  .muted { color:var(--muted); font-size:12px; padding:8px 10px; margin:0; }
  #empty { color:var(--muted); padding:24px; text-align:center; }
</style>
</head>
<body>
  <div class="head">
    <div><h1 id="title">Loading chart…</h1><p class="desc" id="desc"></p></div>
    <span class="rowcount" id="rowcount"></span>
  </div>
  <div class="toolbar">
    <div class="seg-group">
      <button class="seg on" data-t="bar">Bar</button>
      <button class="seg" data-t="line">Line</button>
      <button class="seg" data-t="scatter">Scatter</button>
      <button class="seg" data-t="pie">Pie</button>
      <button class="seg" data-t="histogram">Histogram</button>
    </div>
    <button class="btn" id="toggle">Show data ▾</button>
    <button class="btn" id="csv">Download CSV</button>
  </div>
  <div class="card">
    <div id="empty">Waiting for data…</div>
    <div id="chart"></div>
    <div id="legend"></div>
  </div>
  <div id="tablewrap"></div>
  <script>${CLIENT_JS}</script>
</body>
</html>`;
