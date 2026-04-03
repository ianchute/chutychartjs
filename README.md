# ChutyChart

[![npm version](https://img.shields.io/npm/v/chutychart.svg)](https://www.npmjs.com/package/chutychart)
[![npm downloads](https://img.shields.io/npm/dm/chutychart.svg)](https://www.npmjs.com/package/chutychart)
[![license](https://img.shields.io/npm/l/chutychart.svg)](./LICENSE)
[![bundle size](https://img.shields.io/badge/minified-7.5KB-brightgreen.svg)](https://cdn.jsdelivr.net/npm/chutychart/chutychart-v2.min.js)

A zero-dependency, canvas-based OHLCV candlestick charting library.
Originally written from scratch by **Ian Herve U. Chu Te** (2016). v2 interface standardized in 2026.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Installation](#installation)
- [API Reference](#api-reference)
  - [Constructor Options](#constructor-options)
  - [Instance Methods](#instance-methods)
  - [Static Helpers](#static-helpers)
  - [Data Formats](#data-formats)
- [Migrating from v1](#migrating-from-v1)
- [Benchmarks](#benchmarks)
- [Comparison with Other Libraries](#comparison-with-other-libraries)
- [How It Works](#how-it-works)
- [License](#license)

---

## Quick Start

```html
<div id="chart"></div>
<script src="https://cdn.jsdelivr.net/npm/chutychart/chutychart-v2.min.js"></script>
<script>
  const chart = new ChutyChart({
    container: 'chart',
    data: [
      { timestamp: 1700000000000, open: 100, high: 105, low: 98,  close: 103, volume: 1200000 },
      { timestamp: 1700086400000, open: 103, high: 108, low: 101, close: 107, volume: 980000  },
      // ...
    ],
    height: 400,
    candleWidth: 10,
    interpolate: false,
  });

  chart.render();
</script>
```

---

## Installation

**npm**

```bash
npm install chutychart
```

**CDN (jsDelivr)**

```html
<!-- Latest (recommended) -->
<script src="https://cdn.jsdelivr.net/npm/chutychart/chutychart-v2.min.js"></script>

<!-- Pinned to a specific version -->
<script src="https://cdn.jsdelivr.net/npm/chutychart@2.0.0/chutychart-v2.min.js"></script>

<!-- Unminified -->
<script src="https://cdn.jsdelivr.net/npm/chutychart/chutychart-v2.js"></script>
```

**CDN (unpkg)**

```html
<!-- Latest -->
<script src="https://unpkg.com/chutychart/chutychart-v2.min.js"></script>

<!-- Pinned to a specific version -->
<script src="https://unpkg.com/chutychart@2.0.0/chutychart-v2.min.js"></script>
```

**CommonJS / Node**

```js
const ChutyChart = require('chutychart');
```

**ES module**

```js
import ChutyChart from 'chutychart';
```

No build step required. Zero dependencies. Drop the file in and go.

---

## API Reference

### Constructor Options

```js
new ChutyChart({
  // ── Required ────────────────────────────────────────────────────
  container:  'chart',   // string  — ID of the DOM element to render into

  // ── Data ────────────────────────────────────────────────────────
  data:       [],        // Array   — OHLCV candle objects (see Data Formats below)

  // ── Layout ──────────────────────────────────────────────────────
  height:           400, // number  — canvas height in pixels               (default 400)
  candleWidth:       10, // number  — pixels per candle column               (default 10)
  priceAreaRatio:   0.8, // 0–1    — fraction of height used for price area  (default 0.8)

  // ── Data Processing ─────────────────────────────────────────────
  maxCandles:      2600, // number  — oldest candles dropped beyond this     (default 2600)
  interpolate:    false, // boolean — fill calendar gaps with interpolated candles (default false)

  // ── Volume ──────────────────────────────────────────────────────
  volumeThresholdMultiplier: 2, // number — avg×multiplier = outlier threshold (default 2)

  // ── Styling ─────────────────────────────────────────────────────
  labelFont: '11px Consolas, monospace', // CSS font for month labels
})
```

### Instance Methods

| Method | Returns | Description |
|---|---|---|
| `.render([data])` | `this` | Render (or re-render) the chart. Optionally pass new data. |
| `.update(data)` | `this` | Replace data and re-render. |
| `.destroy()` | `this` | Clear the chart from the DOM. |
| `.getData()` | `Array\|null` | Return the processed candle array from the last render. |
| `.getOptions()` | `object` | Return a copy of the current resolved options. |

All methods are chainable:

```js
chart.update(newData).render();
```

### Static Helpers

```js
// Validate and normalise a raw candle array — no rendering.
// Accepts both {d,o,h,l,c,v} and {timestamp,open,high,low,close,volume}.
// Invalid entries are silently dropped.
const clean = ChutyChart.normalise(rawData);   // or .normalize()

// Library version
ChutyChart.version; // '2.0.0'
```

### Data Formats

Both formats are accepted and can be mixed in the same array.

**Verbose (recommended)**

```js
{
  timestamp: 1700000000000,  // Unix milliseconds or seconds — auto-detected
  open:      100,
  high:      105,
  low:        98,
  close:     103,
  volume:  1200000,
}
```

**Short (v1 compat)**

```js
{
  d: 1700000000,   // Unix seconds
  o: 100,
  h: 105,
  l:  98,
  c: 103,
  v: 1200000,
}
```

The library auto-detects milliseconds vs. seconds (any timestamp > year 3000 in seconds is treated as ms).
Invalid or missing fields are silently dropped.

---

## Migrating from v1

| What changed | v1 | v2 |
|---|---|---|
| Constructor | `ChutyChart('chart', data, interp, h, w)` positional args | `new ChutyChart({ container, data, ... })` options object |
| Return value | `undefined` | Instance with `.render()`, `.update()`, `.destroy()`, `.getData()` |
| Data format | `{d,o,h,l,c,v}` only | Both short and verbose; ms timestamps auto-detected |
| Global state | `lastMonth`, `lastWeek` leaked to `window` — multiple charts conflict | Scoped per render — safe to use multiple charts on one page |
| Canvas patch | Re-applied on every load | Guarded with `_chutyPatched` flag — applied once |
| Font rendering | `context.font = 'Consolas'` (invalid — missing size) | Configurable `labelFont: '11px Consolas, monospace'` |
| Module format | Browser global only | UMD (CommonJS + ES import + global) |

**Minimal migration:**

```js
// v1
ChutyChart('chart', data, false, 400, 10);

// v2 equivalent
new ChutyChart({ container: 'chart', data, height: 400, candleWidth: 10 }).render();
```

---

## Benchmarks

Benchmarks were run on **Node.js v22.22.0** (`arm64 linux`), covering the pure JavaScript data pipeline.
Canvas rendering is excluded — it requires a browser and is bounded by GPU/display refresh rate, not JS throughput.

Run them yourself:

```bash
node benchmark.js
```

### Data Normalisation

| Candles | Short `{d,o,h,l,c,v}` | Verbose `{timestamp,...}` |
|---:|---:|---:|
| 100 | 3.86 µs | 4.78 µs |
| 500 | 22.78 µs | 13.40 µs |
| 1,000 | 33.58 µs | 20.44 µs |
| 2,600 | 95.76 µs | 56.16 µs |

### Statistics (min/max/avg — 3 passes: high, low, volume)

| Candles | Time |
|---:|---:|
| 100 | 3.32 µs |
| 500 | 12.49 µs |
| 1,000 | 30.00 µs |
| 2,600 | 69.96 µs |

### Gap Interpolation

| Input candles (gappy) | Time |
|---:|---:|
| ~97 | 105.60 µs |
| ~492 | 487.12 µs |
| ~963 | 1,076 µs |

### Derived Fields (`toLocaleDateString`, `toLocaleString`, change %)

| Candles | Time |
|---:|---:|
| 100 | 148 µs |
| 500 | 768 µs |
| 1,000 | 1,541 µs |
| 2,600 | 3,964 µs |

> **Note:** `toLocaleDateString()` and `toLocaleString()` are the dominant cost in this pass —
> they call into the platform's internationalization layer (ICU). This is an avoidable cost:
> if you don't need locale-formatted strings in the tooltip, supply pre-formatted values and skip
> `_pushDerivedFields`, or cache the results.

### Full Pipeline (normalise → deduplicate → sort → stats → derived)

| Candles | Time | Throughput |
|---:|---:|---:|
| 100 | 227 µs | ~440 K candles/sec |
| 500 | 1,119 µs | ~447 K candles/sec |
| 1,000 | 2,266 µs | ~441 K candles/sec |
| 2,600 | 5,824 µs | ~447 K candles/sec |

Throughput is near-linear at **~440,000–450,000 candles/second** across all sizes.
A typical 2,600-candle chart (10 years of daily data) processes in **~6 ms** before any pixels are drawn.

### Coordinate Transform

| Candles | Time |
|---:|---:|
| 100 | 1.41 µs |
| 500 | 3.24 µs |
| 1,000 | 3.59 µs |
| 2,600 | 9.35 µs |

The linear normalization function (`areaH - ((v - min) / (max - min) * areaH)`) is branch-free and extremely fast.

### Memory Footprint

| Candles | Heap delta | Per-candle |
|---:|---:|---:|
| 100 | ~103 KB | ~1,049 bytes |
| 500 | ~496 KB | ~1,015 bytes |
| 1,000 | ~1,002 KB | ~1,026 bytes |
| 2,600 | ~2,591 KB | ~1,020 bytes |

Approximately **1 KB per candle** after processing (includes all derived fields, Date objects, locale strings).
A max-candle chart (2,600 entries) uses ~2.5 MB of heap — well within budget for any modern browser.

### Where the time actually goes

```
Full pipeline breakdown (2,600 candles):
  Normalisation      ~96 µs   ( 1.6%)
  Dedup + sort     ~1,770 µs  (30.4%)   ← Object.prototype.hasOwnProperty + new Date() per candle
  Statistics          ~70 µs   ( 1.2%)
  Derived fields   ~3,964 µs  (68.1%)   ← toLocaleDateString / toLocaleString (ICU calls)
  Coord transform      ~9 µs   ( 0.2%)
```

**The bottleneck is Intl/locale formatting, not the math.** If you profile a slow render, look here first.

---

## Comparison with Other Libraries

ChutyChart's design is intentionally narrow: one canvas, one chart type, zero dependencies, drop-in script.
Here's how that trade-off sits relative to the broader ecosystem.

| Library | Size (min+gz) | Dependencies | Chart types | Canvas/SVG | OHLC | Indicators | TypeScript | License |
|---|---|---|---|---|---|---|---|---|
| **ChutyChart v2** | **~6 KB** | **0** | OHLCV only | Canvas | ✅ | — | — | MIT |
| [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts) | ~35 KB | 0 | Line, Area, Bar, Candle, Histogram | Canvas | ✅ | — | ✅ | Apache 2.0 |
| [KLineChart](https://github.com/klinecharts/KLineChart) | ~50 KB gz | 0 | K-line + overlays | Canvas | ✅ | ✅ (dozens) | ✅ | Apache 2.0 |
| [Chart.js + chartjs-chart-financial](https://www.chartjs.org/chartjs-chart-financial/) | ~70 KB+ | Chart.js | Many + candlestick | Canvas | ✅ | — | ✅ | MIT |
| [Plotly.js (finance bundle)](https://plotly.com/javascript/financial-charts/) | ~1.2 MB | Several | 40+ types | SVG + WebGL | ✅ | ✅ | ✅ | MIT |
| [Highcharts Stock](https://www.highcharts.com/products/stock/) | ~200 KB+ | — | Many | SVG | ✅ | ✅ | Partial | Commercial |
| [SciChart.js](https://www.scichart.com/) | Large | WebAssembly | Many (1M+ pts) | WebGL | ✅ | ✅ | ✅ | Commercial |
| [LightningChart JS](https://lightningchart.com/js-charts/) | Large | — | Many | WebGL | ✅ | ✅ | ✅ | Commercial |

### When ChutyChart makes sense

- You want **one file, no build step, no CDN dependency** — just `<script src>` and done.
- Your dataset is daily OHLCV data (up to ~2,600 candles — 10 years of trading days).
- You want a **dark-themed, canvas-rendered, scroll-to-end** chart with hover tooltips out of the box.
- Bundle size is a hard constraint (6 KB gzipped vs. 35–1,200 KB for alternatives).
- You need to embed a chart inside an existing page without pulling in a framework.

### When to reach for something else

- **Real-time streaming / tick data at scale:** TradingView Lightweight Charts or SciChart.js handle 10,000+ candles at 60 FPS using highly optimized incremental render paths. ChutyChart redraws the full canvas on every render.
- **Technical indicators (MA, RSI, MACD, Bollinger Bands, etc.):** KLineChart ships dozens built-in. ChutyChart has none — you'd compute and overlay them manually.
- **Multiple series / overlays / multi-pane layouts:** Lightweight Charts v5 now supports multi-pane. ChutyChart renders a single chart with a fixed price+volume split.
- **TypeScript projects:** KLineChart and Lightweight Charts ship full `.d.ts` declarations. ChutyChart is plain ES5 with JSDoc.
- **Millions of data points:** Use SciChart.js (WebAssembly + WebGL) or LightningChart JS. Canvas `fillRect` at this scale will not keep up.

### Performance perspective

ChutyChart's canvas approach is fast for its use case. Each candle is 3–5 `fillRect` calls (wick, body, volume bar, optional separators). At `candleWidth=10`, a 2,600-candle chart is a 26,000 px wide canvas with ~13,000 draw calls — rendered in a single synchronous pass in the browser.

For reference:
- **SVG-based libraries** (older Highcharts, D3 candlestick examples) create one DOM node per candle. At 2,600 candles that's 2,600 SVG elements — the DOM overhead alone is 10–50× slower than canvas `fillRect`.
- **WebGL libraries** (SciChart, LightningChart) batch geometry on the GPU and handle millions of points, but they carry significant bundle weight and initialization cost.
- **ChutyChart** sits in the sweet spot for daily data: it's faster than SVG and simpler (and smaller) than WebGL, with no startup overhead beyond a `new` call.

---

## How It Works

### Rendering pipeline

```
Raw data (any format)
    │
    ▼
_normaliseData()         — validate, coerce types, ms→s timestamp auto-detection
    │
    ▼
_interpolateData()       — (if enabled) fill calendar gaps with linear interpolation
    │
    ▼
_unique() + sort()       — deduplicate by date, sort chronologically
    │
    ▼
.slice(-maxCandles)      — cap dataset
    │
    ▼
_getStatistics()         — min/max/avg/threshold for price (h,l) and volume
    │
    ▼
Per-candle loop:
  _pushDerivedFields()   — date string, volume string, change %, value
  _drawWick()            — 2 px high-low line via fillRect
  _drawBody()            — open-close rectangle, color-coded
  _drawVolume()          — volume bar with outlier detection
  _drawWeekLine()        — faint blue week separator
  _drawMonthLine()       — white month separator + text label
    │
    ▼
DOM mount + scrollLeft   — insert canvas, scroll to latest candle
    │
    ▼
_enableTooltip()         — mousemove listener, raf-batched DOM updates
```

### Canvas pixel precision

`CanvasRenderingContext2D.fillRect` is monkey-patched once (guarded by `_chutyPatched`) to round all coordinates to integers using a fast bitwise trick:

```js
function _round(n) { return (n + 0.5) | 0; }
```

This eliminates sub-pixel anti-aliasing blur on candle edges — the chart stays crisp at any DPI.

### Volume outlier detection

Volume bars use a two-range normalisation. The average volume is computed, and any bar above `avg × volumeThresholdMultiplier` is:
1. Normalised against the range `[threshold, vmax]` instead of `[vmin, vmax]` — so it doesn't compress normal bars.
2. Colored distinctly: purple (bullish spike), dark golden rod (bearish spike), cornflower blue (doji spike).

### Interpolation

When `interpolate: true`, gaps between consecutive trading days are filled with linearly interpolated candles (`isInterpolated: true`). Interpolated candles render at 20% opacity so they're visually distinguishable from real data.

---

## License

MIT © 2016 Ian Herve U. Chu Te
