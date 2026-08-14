/**
 * DataPilot MCP — Chart "MCP App" renderer
 *
 * Produces a single self-contained HTML document that renders an interactive
 * chart from query rows. Returned by `generate_chart_config` as an MCP Apps
 * resource (`text/html;profile=mcp-app`) and rendered inline by supporting
 * clients (e.g. Claude Desktop) inside a sandboxed iframe.
 *
 * Constraints this file honours:
 *   - No external network requests (CDNs, fonts, images) — the iframe is sandboxed.
 *   - All data, CSS and JS are inlined into the returned string.
 *   - Chart drawing is plain SVG built with vanilla JS (no chart library).
 */

export type ChartAppType = 'bar' | 'line' | 'scatter' | 'pie' | 'histogram';

export interface ChartAppOptions {
  title: string;
  description: string;
  chartType: ChartAppType;
  xField: string;
  yField?: string;
  colorField?: string;
  rows: Record<string, unknown>[];
}

// Escapes a JSON string for safe inlining inside a <script> tag (prevents a
// `</script>` sequence in the data from terminating the script early).
function inlineJson(value: unknown): string {
  return JSON.stringify(value ?? null)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Browser-side script ──────────────────────────────────────────────────────
// Written as a plain string (NOT a tagged template) so it is opaque to the Node
// TypeScript compiler and free of DOM-lib type friction. It uses string
// concatenation and single quotes only — no backticks, no `${` — so it can be
// embedded inside the outer template literal without escaping.
const CLIENT_JS = `
(function () {
  var DATA = (window.__DATA__ || []);
  var CFG = (window.__CONFIG__ || {});
  var xf = CFG.xField, yf = CFG.yField;
  var current = CFG.chartType || 'bar';

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

  // Group rows by the x field, aggregating y (sum). Used by bar and pie.
  function grouped() {
    var map = {}, order = [];
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
    var pow = Math.pow(10, Math.floor(Math.log10(v)));
    var f = v / pow;
    var nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nf * pow;
  }

  function axes(svg, yMax, xLabels, band) {
    var i, y, yy, gx;
    // horizontal gridlines + y ticks
    for (i = 0; i <= 4; i++) {
      y = yMax * i / 4;
      yy = M.t + PH - (y / yMax) * PH;
      svg.push('<line x1="' + M.l + '" y1="' + yy + '" x2="' + (M.l + PW) + '" y2="' + yy + '" class="grid"/>');
      svg.push('<text x="' + (M.l - 8) + '" y="' + (yy + 4) + '" class="tick tick-y">' + esc(fmt(y)) + '</text>');
    }
    // x labels
    if (xLabels) {
      for (i = 0; i < xLabels.length; i++) {
        gx = M.l + band * i + band / 2;
        var lbl = xLabels[i];
        if (lbl.length > 12) lbl = lbl.slice(0, 11) + '…';
        svg.push('<text x="' + gx + '" y="' + (M.t + PH + 16) + '" class="tick tick-x" transform="rotate(35 ' + gx + ' ' + (M.t + PH + 16) + ')">' + esc(lbl) + '</text>');
      }
    }
  }

  function drawBar() {
    var g = grouped(), svg = [];
    var yMax = niceMax(Math.max.apply(null, g.map(function (d) { return d.value; }).concat([0])));
    var band = PW / Math.max(g.length, 1);
    var bw = Math.max(2, Math.min(band * 0.7, 64));
    axes(svg, yMax, g.map(function (d) { return d.key; }), band);
    for (var i = 0; i < g.length; i++) {
      var h = (g[i].value / yMax) * PH;
      var x = M.l + band * i + (band - bw) / 2;
      var y = M.t + PH - h;
      svg.push('<rect class="mark" x="' + x + '" y="' + y + '" width="' + bw + '" height="' + Math.max(0, h) + '" rx="3" fill="' + PALETTE[i % PALETTE.length] + '"><title>' + esc(g[i].key) + ': ' + esc(fmt(g[i].value)) + '</title></rect>');
    }
    return svg.join('');
  }

  function drawHistogram() {
    var vals = DATA.map(function (r) { return num(r[xf]); }).filter(function (v) { return isFinite(v); });
    var svg = [];
    if (!vals.length) return '';
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    var bins = 10, width = (mx - mn) || 1, bw0 = width / bins;
    var counts = new Array(bins).fill(0);
    for (var i = 0; i < vals.length; i++) {
      var idx = Math.min(bins - 1, Math.floor((vals[i] - mn) / bw0));
      counts[idx]++;
    }
    var yMax = niceMax(Math.max.apply(null, counts));
    var band = PW / bins;
    var labels = counts.map(function (_, i) { return fmt(mn + i * bw0); });
    axes(svg, yMax, labels, band);
    for (var j = 0; j < bins; j++) {
      var h = (counts[j] / yMax) * PH;
      var x = M.l + band * j + 1;
      var y = M.t + PH - h;
      svg.push('<rect class="mark" x="' + x + '" y="' + y + '" width="' + (band - 2) + '" height="' + Math.max(0, h) + '" fill="' + PALETTE[0] + '"><title>' + esc(fmt(mn + j * bw0)) + ' – ' + esc(fmt(mn + (j + 1) * bw0)) + ': ' + counts[j] + '</title></rect>');
    }
    return svg.join('');
  }

  function drawLine() {
    var svg = [];
    var ys = DATA.map(function (r) { return yf ? num(r[yf]) : 0; });
    var yMax = niceMax(Math.max.apply(null, ys.concat([0])));
    var band = PW / Math.max(DATA.length, 1);
    axes(svg, yMax, DATA.map(function (r) { return String(r[xf]); }), band);
    var pts = [];
    for (var i = 0; i < DATA.length; i++) {
      var x = M.l + band * i + band / 2;
      var y = M.t + PH - (ys[i] / yMax) * PH;
      pts.push(x + ',' + y);
    }
    svg.push('<polyline class="line" points="' + pts.join(' ') + '" fill="none" stroke="' + PALETTE[0] + '" stroke-width="2.5"/>');
    for (var k = 0; k < DATA.length; k++) {
      var px = M.l + band * k + band / 2;
      var py = M.t + PH - (ys[k] / yMax) * PH;
      svg.push('<circle class="mark" cx="' + px + '" cy="' + py + '" r="3.5" fill="' + PALETTE[0] + '"><title>' + esc(String(DATA[k][xf])) + ': ' + esc(fmt(ys[k])) + '</title></circle>');
    }
    return svg.join('');
  }

  function drawScatter() {
    var svg = [];
    var xs = DATA.map(function (r) { return num(r[xf]); });
    var ys = DATA.map(function (r) { return yf ? num(r[yf]) : 0; });
    var xMax = niceMax(Math.max.apply(null, xs.concat([0]))), xMin = Math.min.apply(null, xs.concat([0]));
    var yMax = niceMax(Math.max.apply(null, ys.concat([0])));
    var i, yy, xx, tx;
    for (i = 0; i <= 4; i++) {
      yy = M.t + PH - (yMax * i / 4 / yMax) * PH;
      svg.push('<line x1="' + M.l + '" y1="' + yy + '" x2="' + (M.l + PW) + '" y2="' + yy + '" class="grid"/>');
      svg.push('<text x="' + (M.l - 8) + '" y="' + (yy + 4) + '" class="tick tick-y">' + esc(fmt(yMax * i / 4)) + '</text>');
      xx = M.l + (PW * i / 4);
      tx = xMin + (xMax - xMin) * i / 4;
      svg.push('<text x="' + xx + '" y="' + (M.t + PH + 16) + '" class="tick tick-x">' + esc(fmt(tx)) + '</text>');
    }
    for (i = 0; i < DATA.length; i++) {
      var cx = M.l + ((xs[i] - xMin) / ((xMax - xMin) || 1)) * PW;
      var cy = M.t + PH - (ys[i] / yMax) * PH;
      svg.push('<circle class="mark" cx="' + cx + '" cy="' + cy + '" r="4.5" fill="' + PALETTE[0] + '" fill-opacity="0.72"><title>' + esc(fmt(xs[i])) + ', ' + esc(fmt(ys[i])) + '</title></circle>');
    }
    return svg.join('');
  }

  function drawPie() {
    var g = grouped(), svg = [], legend = [];
    var total = g.reduce(function (a, d) { return a + d.value; }, 0) || 1;
    var cx = M.l + PW / 2, cy = M.t + PH / 2, R = Math.min(PW, PH) / 2 - 6;
    var a0 = -Math.PI / 2;
    for (var i = 0; i < g.length; i++) {
      var frac = g[i].value / total, a1 = a0 + frac * Math.PI * 2;
      var x0 = cx + R * Math.cos(a0), y0 = cy + R * Math.sin(a0);
      var x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1);
      var large = frac > 0.5 ? 1 : 0;
      var col = PALETTE[i % PALETTE.length];
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
    document.getElementById('chart').innerHTML =
      '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img">' + body + '</svg>';
    var btns = document.querySelectorAll('.seg');
    for (var i = 0; i < btns.length; i++) {
      btns[i].className = 'seg' + (btns[i].getAttribute('data-t') === current ? ' on' : '');
    }
  }

  function toCsv() {
    if (!DATA.length) return '';
    var cols = Object.keys(DATA[0]);
    var lines = [cols.join(',')];
    for (var i = 0; i < DATA.length; i++) {
      lines.push(cols.map(function (c) {
        var v = DATA[i][c]; v = (v === null || v === undefined) ? '' : String(v);
        return /[",\\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }).join(','));
    }
    return lines.join('\\n');
  }

  function buildTable() {
    if (!DATA.length) return '<p class="muted">No rows.</p>';
    var cols = Object.keys(DATA[0]);
    var h = '<table><thead><tr>';
    for (var c = 0; c < cols.length; c++) h += '<th>' + esc(cols[c]) + '</th>';
    h += '</tr></thead><tbody>';
    var max = Math.min(DATA.length, 100);
    for (var i = 0; i < max; i++) {
      h += '<tr>';
      for (var j = 0; j < cols.length; j++) h += '<td>' + esc(DATA[i][cols[j]]) + '</td>';
      h += '</tr>';
    }
    h += '</tbody></table>';
    if (DATA.length > max) h += '<p class="muted">Showing first ' + max + ' of ' + DATA.length + ' rows.</p>';
    return h;
  }

  // Wire controls
  var segs = document.querySelectorAll('.seg');
  for (var s = 0; s < segs.length; s++) {
    segs[s].addEventListener('click', function () { current = this.getAttribute('data-t'); render(); });
  }
  var tableWrap = document.getElementById('tablewrap');
  document.getElementById('toggle').addEventListener('click', function () {
    if (tableWrap.style.display === 'block') { tableWrap.style.display = 'none'; this.textContent = 'Show data ▾'; }
    else { tableWrap.innerHTML = buildTable(); tableWrap.style.display = 'block'; this.textContent = 'Hide data ▴'; }
  });
  document.getElementById('csv').addEventListener('click', function () {
    var blob = new Blob([toCsv()], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'datapilot-data.csv'; a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });

  document.getElementById('rowcount').textContent = DATA.length + (DATA.length === 1 ? ' row' : ' rows');
  render();
})();
`;

/**
 * Render the full self-contained HTML document for a chart widget.
 */
export function renderChartApp(opts: ChartAppOptions): string {
  const cfg = {
    chartType: opts.chartType,
    xField: opts.xField,
    yField: opts.yField ?? null,
    colorField: opts.colorField ?? null,
  };

  const segButton = (t: ChartAppType, label: string): string =>
    `<button class="seg${t === opts.chartType ? ' on' : ''}" data-t="${t}">${label}</button>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(opts.title)}</title>
<style>
  :root {
    --bg: #ffffff; --fg: #1f2430; --muted: #6b7280; --border: #e5e7eb;
    --panel: #f7f8fa; --grid: #eceef1; --accent: #4f8cff;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #14171c; --fg: #e6e8ec; --muted: #9aa2ad; --border: #2a2f37;
      --panel: #1b1f25; --grid: #262b32; --accent: #6b8afd;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 16px; background: var(--bg); color: var(--fg);
    font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  .head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  h1 { font-size: 16px; margin: 0 0 2px; font-weight: 650; }
  .desc { color: var(--muted); margin: 0; font-size: 12.5px; }
  .rowcount { color: var(--muted); font-size: 12px; white-space: nowrap; }
  .toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 12px 0 6px; }
  .seg-group { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .seg { border: 0; background: var(--panel); color: var(--fg); padding: 5px 11px; font-size: 12.5px; cursor: pointer; border-right: 1px solid var(--border); }
  .seg:last-child { border-right: 0; }
  .seg.on { background: var(--accent); color: #fff; }
  .btn { border: 1px solid var(--border); background: var(--panel); color: var(--fg); padding: 5px 11px; font-size: 12.5px; border-radius: 8px; cursor: pointer; }
  .btn:hover { border-color: var(--accent); }
  .card { border: 1px solid var(--border); border-radius: 12px; padding: 8px; background: var(--panel); }
  #chart svg { width: 100%; height: auto; display: block; }
  .grid { stroke: var(--grid); stroke-width: 1; }
  .tick { fill: var(--muted); font-size: 11px; }
  .tick-y { text-anchor: end; }
  .tick-x { text-anchor: middle; }
  .mark { transition: opacity .12s; cursor: default; }
  .mark:hover { opacity: 0.78; }
  #legend { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 8px; }
  .lg { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }
  .lg i { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
  #tablewrap { display: none; margin-top: 12px; max-height: 320px; overflow: auto; border: 1px solid var(--border); border-radius: 10px; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--border); white-space: nowrap; }
  th { position: sticky; top: 0; background: var(--panel); font-weight: 600; }
  .muted { color: var(--muted); font-size: 12px; padding: 8px 10px; margin: 0; }
</style>
</head>
<body>
  <div class="head">
    <div>
      <h1>${escapeHtml(opts.title)}</h1>
      <p class="desc">${escapeHtml(opts.description)}</p>
    </div>
    <span class="rowcount" id="rowcount"></span>
  </div>

  <div class="toolbar">
    <div class="seg-group">
      ${segButton('bar', 'Bar')}
      ${segButton('line', 'Line')}
      ${segButton('scatter', 'Scatter')}
      ${segButton('pie', 'Pie')}
      ${segButton('histogram', 'Histogram')}
    </div>
    <button class="btn" id="toggle">Show data ▾</button>
    <button class="btn" id="csv">Download CSV</button>
  </div>

  <div class="card">
    <div id="chart"></div>
    <div id="legend"></div>
  </div>
  <div id="tablewrap"></div>

  <script>window.__DATA__ = ${inlineJson(opts.rows)};window.__CONFIG__ = ${inlineJson(cfg)};</script>
  <script>${CLIENT_JS}</script>
</body>
</html>`;
}
