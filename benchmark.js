/**
 * ChutyChart v2 — Benchmark Suite
 * Tests the pure data pipeline (no DOM / canvas required).
 * Run with:  node benchmark.js
 */

'use strict';

/* ── shim the tiny bits the library touches in a browser env ── */
global.CanvasRenderingContext2D = { prototype: {} };   // stops the canvas patch from throwing
global.document = { getElementById: () => null };      // _render will bail early (no container), but we only call internals

/* ── pull the module ── */
const ChutyChart = require('./chutychart-v2.js');

/* ═══════════════════════════════════════════
   DATA GENERATORS
════════════════════════════════════════════ */

function makeCandles(n, startTs) {
  const candles = [];
  let price = 100;
  let ts    = startTs || 1_000_000;       // unix seconds
  const DAY = 86400;

  for (let i = 0; i < n; i++) {
    const open  = price;
    const delta = (Math.random() - 0.48) * 2;
    price = Math.max(1, price + delta);
    const high  = Math.max(open, price) + Math.random();
    const low   = Math.min(open, price) - Math.random();
    const vol   = Math.floor(500_000 + Math.random() * 2_000_000);
    candles.push({ d: ts, o: open, h: high, l: low, c: price, v: vol });
    ts += DAY;
  }
  return candles;
}

function makeVerboseCandles(n) {
  return makeCandles(n).map(c => ({
    timestamp: c.d * 1000,   // ms — tests the auto-detection
    open: c.o, high: c.h, low: c.l, close: c.c, volume: c.v,
  }));
}

function makeGappyCandles(n) {
  // Skips ~30 % of days (weekends + some holidays)
  const all  = makeCandles(Math.ceil(n / 0.7));
  const kept = all.filter((_, i) => {
    const d = new Date(all[i].d * 1000);
    const dow = d.getDay();
    return dow !== 0 && dow !== 6 && Math.random() > 0.04;
  });
  return kept.slice(0, n);
}

/* ═══════════════════════════════════════════
   MICRO-BENCHMARK HARNESS
════════════════════════════════════════════ */

function bench(label, fn, iterations) {
  iterations = iterations || 1000;

  // warm-up
  for (let i = 0; i < Math.min(50, iterations); i++) fn();

  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) fn();
  const end = process.hrtime.bigint();

  const totalMs  = Number(end - start) / 1e6;
  const perOpUs  = totalMs / iterations * 1000;
  const opsPerSec = Math.round(iterations / (totalMs / 1000));

  return { label, totalMs, perOpUs, opsPerSec, iterations };
}

function printResult(r) {
  const us   = r.perOpUs.toFixed(2).padStart(9);
  const ops  = r.opsPerSec.toLocaleString().padStart(12);
  console.log(`  ${r.label.padEnd(45)} ${us} µs/op   ${ops} ops/sec`);
}

/* ═══════════════════════════════════════════
   EXPOSE INTERNALS (same IIFE trick)
   We replicate the pure functions here so we
   can time them individually.
════════════════════════════════════════════ */

// --- replicated from chutychart-v2.js (pure functions, no DOM) ---

function _round(n)  { return (n + 0.5) | 0; }
function _round4(n) { return Math.round(n * 10000) / 10000; }
function _clone(o)  { return JSON.parse(JSON.stringify(o)); }

function _normaliseCandle(raw) {
  if (!raw || typeof raw !== 'object') return null;
  var d = raw.d != null ? +raw.d : (raw.timestamp != null ? +raw.timestamp : NaN);
  var o = raw.o != null ? +raw.o : (raw.open      != null ? +raw.open      : NaN);
  var h = raw.h != null ? +raw.h : (raw.high      != null ? +raw.high      : NaN);
  var l = raw.l != null ? +raw.l : (raw.low       != null ? +raw.low       : NaN);
  var c = raw.c != null ? +raw.c : (raw.close     != null ? +raw.close     : NaN);
  var v = raw.v != null ? +raw.v : (raw.volume    != null ? +raw.volume    : NaN);
  if (isNaN(d)||isNaN(o)||isNaN(h)||isNaN(l)||isNaN(c)||isNaN(v)) return null;
  if (d > 32503680000) d = Math.floor(d / 1000);
  return { d, o, h, l, c, v };
}

function _normaliseData(rawData) {
  if (!Array.isArray(rawData)) return [];
  return rawData.map(_normaliseCandle).filter(Boolean);
}

function _getStatistics(data, field, mult) {
  if (!data.length) return { min:0, max:0, avg:0, threshold:0 };
  var max=data[0][field], min=data[0][field], sum=0;
  for (var i=0;i<data.length;i++){var v=data[i][field];if(v>max)max=v;if(v<min)min=v;sum+=v;}
  var avg=sum/data.length;
  return { max, min, avg, threshold: avg*(mult||2) };
}

function _unique(data) {
  var seen={}, out=[];
  for(var i=0;i<data.length;i++){
    var key=new Date(data[i].d*1000).toDateString();
    if(!seen[key]){seen[key]=true;out.push(data[i]);}
  }
  return out;
}

function _interpolatePair(first, second) {
  const SECS_PER_DAY = 86400;
  const days = (second.d - first.d) / SECS_PER_DAY;
  if (days <= 1) return [];
  const interval = {
    o:(second.o-first.o)/days, h:(second.h-first.h)/days,
    l:(second.l-first.l)/days, c:(second.c-first.c)/days,
    v:(second.v-first.v)/days,
  };
  const results = []; let current = _clone(first);
  for (let i=0;i<days-1;i++){
    current.d+=SECS_PER_DAY;
    current.o=_round4(current.o+interval.o); current.h=_round4(current.h+interval.h);
    current.l=_round4(current.l+interval.l); current.c=_round4(current.c+interval.c);
    current.v=_round4(current.v+interval.v);
    current.isInterpolated=true; results.push(_clone(current));
  }
  return results;
}

function _interpolateData(data) {
  const sorted = data.slice().sort((a,b)=>a.d-b.d);
  let extras = [];
  for (let i=0;i<sorted.length-1;i++) extras=extras.concat(_interpolatePair(sorted[i],sorted[i+1]));
  return sorted.concat(extras).sort((a,b)=>a.d-b.d);
}

function _normalize(value, min, max, areaH) {
  if (max === min) return areaH / 2;
  return areaH - ((value - min) / (max - min) * areaH);
}

function _pushDerivedFields(datum) {
  datum.ds  = new Date(datum.d * 1000).toLocaleDateString();
  datum.vos = datum.v.toLocaleString();
  datum.cs  = (Math.round((datum.c - datum.o) / datum.o * 10000) / 100) + '%';
  datum.vas = Math.round((datum.c + datum.o) / 2 * datum.v).toLocaleString();
}

/* ═══════════════════════════════════════════
   BENCHMARK SUITES
════════════════════════════════════════════ */

const SIZES = [100, 500, 1000, 2600];

function runAll() {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║          ChutyChart v2 — Data Pipeline Benchmark                ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');
  console.log('  Node.js', process.version, '  |  ', process.arch, process.platform, '\n');

  const allResults = {};

  /* ── 1. normalisation ── */
  console.log('━━  1. Data Normalisation  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  for (const n of SIZES) {
    const shortForm   = makeCandles(n);
    const verboseForm = makeVerboseCandles(n);

    const r1 = bench(`normalise ${n} candles (short {d,o,h,l,c,v})`, () => _normaliseData(shortForm), 2000);
    const r2 = bench(`normalise ${n} candles (verbose {timestamp,...})`, () => _normaliseData(verboseForm), 2000);
    printResult(r1);
    printResult(r2);
    allResults[`norm_short_${n}`]   = r1;
    allResults[`norm_verbose_${n}`] = r2;
  }

  /* ── 2. deduplication ── */
  console.log('\n━━  2. Deduplication  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  for (const n of SIZES) {
    const data = _normaliseData(makeCandles(n));
    const r = bench(`unique ${n} candles`, () => _unique(data), 2000);
    printResult(r);
    allResults[`unique_${n}`] = r;
  }

  /* ── 3. statistics ── */
  console.log('\n━━  3. Statistics (min/max/avg/threshold)  ━━━━━━━━━━━━━━━━━━━━━\n');
  for (const n of SIZES) {
    const data = _normaliseData(makeCandles(n));
    const r = bench(`stats ${n} candles (3 passes: h, l, v)`, () => {
      _getStatistics(data, 'h', 2);
      _getStatistics(data, 'l', 2);
      _getStatistics(data, 'v', 2);
    }, 2000);
    printResult(r);
    allResults[`stats_${n}`] = r;
  }

  /* ── 4. interpolation ── */
  console.log('\n━━  4. Gap Interpolation  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  for (const n of [100, 500, 1000]) {
    const gappy = _normaliseData(makeGappyCandles(n));
    const r = bench(`interpolate ${gappy.length} gappy candles`, () => _interpolateData(gappy), 200);
    printResult(r);
    allResults[`interp_${n}`] = r;
  }

  /* ── 5. derived field calculation ── */
  console.log('\n━━  5. Derived Fields (_pushDerivedFields)  ━━━━━━━━━━━━━━━━━━━━\n');
  for (const n of SIZES) {
    const data = _normaliseData(makeCandles(n));
    const r = bench(`derived fields ${n} candles`, () => {
      data.forEach(_pushDerivedFields);
    }, 500);
    printResult(r);
    allResults[`derived_${n}`] = r;
  }

  /* ── 6. coordinate transform (_normalize) ── */
  console.log('\n━━  6. Coordinate Transform (_normalize)  ━━━━━━━━━━━━━━━━━━━━━\n');
  for (const n of SIZES) {
    const data   = _normaliseData(makeCandles(n));
    const stats  = _getStatistics(data, 'h', 2);
    const { min: pMin } = _getStatistics(data, 'l', 2);
    const r = bench(`normalize ${n} values → pixel coords`, () => {
      data.forEach(d => _normalize(d.h, pMin, stats.max, 320));
    }, 2000);
    printResult(r);
    allResults[`normalize_${n}`] = r;
  }

  /* ── 7. full pipeline (no canvas) ── */
  console.log('\n━━  7. Full Pipeline  (normalise → unique → sort → stats → derived)  ━\n');
  for (const n of SIZES) {
    const raw = makeCandles(n);
    const r = bench(`full pipeline ${n} candles`, () => {
      let d = _normaliseData(raw);
      d = _unique(d).sort((a,b)=>a.d-b.d);
      d = d.slice(-2600);
      _getStatistics(d,'h',2); _getStatistics(d,'l',2); _getStatistics(d,'v',2);
      d.forEach(_pushDerivedFields);
    }, 500);
    printResult(r);
    allResults[`pipeline_${n}`] = r;
  }

  /* ── 8. ChutyChart.normalise() static ── */
  console.log('\n━━  8. ChutyChart.normalise() public static  ━━━━━━━━━━━━━━━━━━\n');
  for (const n of SIZES) {
    const raw = makeCandles(n);
    const r = bench(`ChutyChart.normalise(${n})`, () => ChutyChart.normalise(raw), 2000);
    printResult(r);
  }

  /* ── 9. Memory footprint ── */
  console.log('\n━━  9. Memory Footprint  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  for (const n of SIZES) {
    const before = process.memoryUsage().heapUsed;
    const data   = _normaliseData(makeCandles(n));
    _getStatistics(data,'h',2); _getStatistics(data,'l',2); _getStatistics(data,'v',2);
    data.forEach(_pushDerivedFields);
    const after  = process.memoryUsage().heapUsed;
    const kb     = ((after - before) / 1024).toFixed(1);
    const perCandle = ((after - before) / n).toFixed(0);
    console.log(`  ${n} candles processed:  ~${kb} KB heap delta  (${perCandle} bytes/candle)`);
  }

  /* ── 10. Throughput summary ── */
  console.log('\n━━  10. Throughput Summary (candles/sec for full pipeline)  ━━━━\n');
  for (const n of SIZES) {
    const r = allResults[`pipeline_${n}`];
    if (!r) continue;
    const cps = Math.round(n * r.opsPerSec).toLocaleString();
    console.log(`  ${n.toString().padStart(5)} candles → ${cps.padStart(14)} candles/sec  (${r.perOpUs.toFixed(2)} µs/render)`);
  }

  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  Note: Canvas rendering excluded (requires browser).             ║');
  console.log('║  Benchmarks cover 100 % of the pure JS data pipeline.            ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  return allResults;
}

runAll();
