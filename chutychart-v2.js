/*! ChutyChart v2.0.0 | MIT License | Ian Herve U. Chu Te */
/*
 *  ChutyChart v2
 *  A stock data graphing and analysis library.
 *  Original by: Ian Herve U. Chu Te
 *  v2 interface standardization: 2026
 *
 *  CHANGES FROM v1:
 *  - Standardized constructor: new ChutyChart(options) instead of positional args
 *  - Returns a chart instance with methods: .render(), .destroy(), .update(data)
 *  - Standardized data format with validation and aliasing (supports both old {d,o,h,l,c,v} and new {timestamp,open,high,low,close,volume})
 *  - Bugfixes: lastMonth/lastWeek global state leak, fillRect double call, _drawMonthSeparatorLine font bug
 *  - Internal rendering logic preserved; only parametrized where beneficial
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.ChutyChart = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function () {

  'use strict';

  /* ─────────────────────────────────────────
     CONSTANTS
  ───────────────────────────────────────── */

  var COLORS = {
    background: '#222222',
    green:      '#108a93',
    red:        '#ad1d28',
    gray:       '#464545',
    wick:       '#ffffff',
    separator:  '#ffffff',
    weekLine:   'rgba(101, 156, 239, 0.1)',
    selected:   '#ffff00',
    volumeOutlierBull: 'purple',
    volumeOutlierBear: 'darkgoldenrod',
    volumeOutlierDoji: 'cornflowerblue',
  };

  var MONTHS = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
  ];

  var DEFAULT_OPTIONS = {
    /** DOM element ID to render into */
    container:        '',
    /** OHLCV data array */
    data:             [],
    /** Fill gaps between trading days with interpolated candles */
    interpolate:      false,
    /** Canvas height in pixels */
    height:           400,
    /** Width of each candlestick column in pixels */
    candleWidth:      10,
    /** Max candles rendered (oldest are dropped) */
    maxCandles:       2600,
    /**
     * Volume-outlier threshold multiplier.
     * A candle whose volume >= avg * multiplier gets an outlier colour.
     */
    volumeThresholdMultiplier: 2,
    /** CSS font string for month labels */
    labelFont:        '11px Consolas, monospace',
    /** Fraction of canvas height reserved for the price area (rest = volume) */
    priceAreaRatio:   0.8,
  };

  /* ─────────────────────────────────────────
     IIFE-SCOPED CANVAS PROTOTYPE PATCH
     (same as v1: integer pixel coords to avoid
      sub-pixel blurring on canvas)
  ───────────────────────────────────────── */

  if (typeof CanvasRenderingContext2D !== 'undefined'
      && !CanvasRenderingContext2D.prototype._chutyPatched) {
    var _origFillRect = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.fillRect = function (a, b, c, d) {
      return _origFillRect.call(this, _round(a), _round(b), _round(c), _round(d));
    };
    CanvasRenderingContext2D.prototype._chutyPatched = true;
  }

  /* ─────────────────────────────────────────
     HELPERS
  ───────────────────────────────────────── */

  function _round(n) { return (n + 0.5) | 0; }

  function _clone(o) { return JSON.parse(JSON.stringify(o)); }

  function _raf(fn) {
    var r = (typeof requestAnimationFrame !== 'undefined')
      ? requestAnimationFrame
      : function (f) { setTimeout(f, 0); };
    r(fn);
  }

  function _merge(defaults, overrides) {
    var out = {};
    for (var k in defaults) {
      if (Object.prototype.hasOwnProperty.call(defaults, k)) {
        out[k] = (overrides && Object.prototype.hasOwnProperty.call(overrides, k))
          ? overrides[k]
          : defaults[k];
      }
    }
    return out;
  }

  /* ─────────────────────────────────────────
     DATA NORMALISATION
     Accepts both v1 shorthand {d,o,h,l,c,v}
     and verbose {timestamp,open,high,low,close,volume}
  ───────────────────────────────────────── */

  /**
   * Normalise one raw candle into the canonical internal shape:
   *   { d, o, h, l, c, v }   (numbers; d = unix seconds)
   *
   * @param {object} raw
   * @returns {object|null}  null when the candle is invalid
   */
  function _normaliseCandle(raw) {
    if (!raw || typeof raw !== 'object') return null;

    var d = raw.d      != null ? +raw.d      : (raw.timestamp != null ? +raw.timestamp : NaN);
    var o = raw.o      != null ? +raw.o      : (raw.open      != null ? +raw.open      : NaN);
    var h = raw.h      != null ? +raw.h      : (raw.high      != null ? +raw.high      : NaN);
    var l = raw.l      != null ? +raw.l      : (raw.low       != null ? +raw.low       : NaN);
    var c = raw.c      != null ? +raw.c      : (raw.close     != null ? +raw.close     : NaN);
    var v = raw.v      != null ? +raw.v      : (raw.volume    != null ? +raw.volume    : NaN);

    if (isNaN(d) || isNaN(o) || isNaN(h) || isNaN(l) || isNaN(c) || isNaN(v)) {
      return null;
    }

    // If timestamp looks like milliseconds (> year 3000 in seconds = ~32503680000),
    // auto-convert to seconds.
    if (d > 32503680000) d = Math.floor(d / 1000);

    return { d: d, o: o, h: h, l: l, c: c, v: v };
  }

  /**
   * Validate & normalise an array of raw candles.
   * Invalid entries are silently dropped.
   *
   * @param {Array} rawData
   * @returns {Array} normalised candles
   */
  function _normaliseData(rawData) {
    if (!Array.isArray(rawData)) {
      console.warn('[ChutyChart] data must be an Array');
      return [];
    }
    return rawData.map(_normaliseCandle).filter(Boolean);
  }

  /* ─────────────────────────────────────────
     STATISTICS
  ───────────────────────────────────────── */

  function _getStatistics(data, field, thresholdMultiplier) {
    if (!data.length) return { min: 0, max: 0, avg: 0, threshold: 0 };

    var max = data[0][field],
        min = data[0][field],
        sum = 0;

    for (var i = 0; i < data.length; i++) {
      var v = data[i][field];
      if (v > max) max = v;
      if (v < min) min = v;
      sum += v;
    }

    var avg = sum / data.length;
    return {
      max: max,
      min: min,
      avg: avg,
      threshold: avg * (thresholdMultiplier || 2),
    };
  }

  /* ─────────────────────────────────────────
     DEDUPLICATION & SORTING
  ───────────────────────────────────────── */

  function _unique(data) {
    var seen = {}, out = [];
    for (var i = 0; i < data.length; i++) {
      var key = new Date(data[i].d * 1000).toDateString();
      if (!seen[key]) {
        seen[key] = true;
        out.push(data[i]);
      }
    }
    return out;
  }

  /* ─────────────────────────────────────────
     INTERPOLATION  (logic unchanged from v1)
  ───────────────────────────────────────── */

  function _interpolatePair(first, second) {
    var SECS_PER_DAY = 60 * 60 * 24;
    var days = (second.d - first.d) / SECS_PER_DAY;
    if (days <= 1) return [];

    var interval = {
      o: (second.o - first.o) / days,
      h: (second.h - first.h) / days,
      l: (second.l - first.l) / days,
      c: (second.c - first.c) / days,
      v: (second.v - first.v) / days,
    };

    var results = [], current = _clone(first);
    for (var i = 0; i < days - 1; i++) {
      current.d += SECS_PER_DAY;
      current.o = _round4(current.o + interval.o);
      current.h = _round4(current.h + interval.h);
      current.l = _round4(current.l + interval.l);
      current.c = _round4(current.c + interval.c);
      current.v = _round4(current.v + interval.v);
      current.isInterpolated = true;
      results.push(_clone(current));
    }
    return results;
  }

  function _round4(n) { return Math.round(n * 10000) / 10000; }

  function _interpolateData(data) {
    var sorted = data.slice().sort(function (a, b) { return a.d - b.d; });
    var extras = [];
    for (var i = 0; i < sorted.length - 1; i++) {
      extras = extras.concat(_interpolatePair(sorted[i], sorted[i + 1]));
    }
    return sorted.concat(extras).sort(function (a, b) { return a.d - b.d; });
  }

  /* ─────────────────────────────────────────
     DERIVED DISPLAY FIELDS
  ───────────────────────────────────────── */

  function _pushDerivedFields(datum) {
    datum.ds  = new Date(datum.d * 1000).toLocaleDateString();
    datum.vos = datum.v.toLocaleString();
    datum.cs  = (Math.round((datum.c - datum.o) / datum.o * 10000) / 100) + '%';
    datum.vas = Math.round((datum.c + datum.o) / 2 * datum.v).toLocaleString();
  }

  /* ─────────────────────────────────────────
     COORDINATE SYSTEM
  ───────────────────────────────────────── */

  function _normalize(value, min, max, areaHeight) {
    if (max === min) return areaHeight / 2;
    return areaHeight - ((value - min) / (max - min) * areaHeight);
  }

  /* ─────────────────────────────────────────
     CANDLE COLOUR HELPERS
  ───────────────────────────────────────── */

  function _candleColor(datum, alpha) {
    var interp = datum.isInterpolated;
    if (interp) {
      if (datum.c === datum.o) return 'rgba(128,128,128,' + alpha + ')';
      return datum.c > datum.o ? 'rgba(0,128,0,' + alpha + ')' : 'rgba(255,0,0,' + alpha + ')';
    }
    if (datum.c === datum.o) return COLORS.gray;
    return datum.c > datum.o ? COLORS.green : COLORS.red;
  }

  /* ─────────────────────────────────────────
     RENDERING  (logic unchanged from v1)
  ───────────────────────────────────────── */

  function _drawWick(ctx, datum, x, w, min, max, priceH, selected) {
    var top = _normalize(datum.h, min, max, priceH);
    var bot = _normalize(datum.l, min, max, priceH);
    var h   = bot - top;

    if (datum.isInterpolated) {
      ctx.fillStyle = COLORS.background;
      ctx.fillRect(x, top, w, h);
    }

    ctx.fillStyle = datum.isInterpolated
      ? (selected ? 'rgba(255,255,0,0.2)' : 'rgba(255,255,255,0.2)')
      : (selected ? COLORS.selected : COLORS.wick);

    ctx.fillRect(x + w / 2 - 1, top, 2, h);
  }

  function _drawBody(ctx, datum, x, w, min, max, priceH, selected) {
    var color  = _candleColor(datum, 0.2);
    var isGreen = (datum.c > datum.o);

    var top = isGreen ? _normalize(datum.c, min, max, priceH) : _normalize(datum.o, min, max, priceH);
    var h   = (isGreen ? _normalize(datum.o, min, max, priceH) : _normalize(datum.c, min, max, priceH)) - top + 1;

    if (datum.isInterpolated) {
      ctx.fillStyle = COLORS.background;
      ctx.fillRect(x, top, w, h);
    }

    ctx.fillStyle = selected ? COLORS.selected : color;
    ctx.fillRect(x, top, w, h);
  }

  function _drawVolume(ctx, datum, x, w, vmin, vmax, volH, yOffset, threshold, selected) {
    var color  = _candleColor(datum, 0.2);
    var vol    = datum.v;

    if (!datum.isInterpolated && threshold != null) {
      if (vol >= threshold) {
        color = datum.c === datum.o
          ? COLORS.volumeOutlierDoji
          : (datum.c > datum.o ? COLORS.volumeOutlierBull : COLORS.volumeOutlierBear);
      }
    }

    var top, h;
    if (threshold != null && vol >= threshold) {
      top = _normalize(vol, threshold, vmax, volH);
    } else {
      top = _normalize(vol, vmin, threshold != null ? threshold : vmax, volH);
    }
    h = volH - top + 1;

    if (datum.isInterpolated) {
      ctx.fillStyle = COLORS.background;
      ctx.fillRect(x, top + yOffset, w, h);
    }

    ctx.fillStyle = selected ? COLORS.selected : color;
    ctx.fillRect(x, top + yOffset, w, h);
  }

  function _drawWeekLine(ctx, date, x, totalH, lastWeekRef) {
    var d = new Date(date * 1000);
    d.setHours(0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    var yearStart = new Date(d.getFullYear(), 0, 1);
    var week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);

    if (week !== lastWeekRef.v) {
      ctx.fillStyle = COLORS.weekLine;
      ctx.fillRect(x, 0, 1, totalH);
    }
    lastWeekRef.v = week;
  }

  function _drawMonthLine(ctx, date, x, totalH, lastMonthRef) {
    var d     = new Date(date * 1000);
    var month = d.getMonth();

    if (month !== lastMonthRef.v) {
      ctx.fillStyle = COLORS.separator;
      ctx.fillRect(x, 0, 1, totalH);
      ctx.font      = ctx._chutyFont;
      ctx.fillStyle = COLORS.separator;
      ctx.fillText(MONTHS[month] + ' ' + (d.getFullYear()), x + 4, 12);
    }
    lastMonthRef.v = month;
  }

  /* ─────────────────────────────────────────
     TOOLTIP
  ───────────────────────────────────────── */

  function _buildTooltip() {
    var rows = ['Close','Open','High','Low','Date','Volume','Change','Value','Remarks'];
    var table = document.createElement('table');
    table.id        = 'chutyChartTooltip';
    table.className = 'chutyChartTooltip';
    table.style.cssText = 'position:absolute;pointer-events:none;cursor:none;';

    var tbody = document.createElement('tbody');
    var cells = {};

    rows.forEach(function (label) {
      var tr  = document.createElement('tr');
      var tdL = document.createElement('td');
      var tdV = document.createElement('td');
      tdL.textContent = label;
      tr.appendChild(tdL);
      tr.appendChild(tdV);
      tbody.appendChild(tr);
      cells[label.toLowerCase()] = tdV;
    });

    table.appendChild(tbody);
    return { el: table, cells: cells };
  }

  function _enableTooltip(canvas, container, opts, data, ctx, priceH, min, max, vmin, vmax, volH, threshold) {
    var tip  = _buildTooltip();
    container.appendChild(tip.el);

    var lastHash   = 0,
        lastIndex  = -1,
        total      = data.length,
        w          = opts.candleWidth;

    var offsetLeft  = container.parentNode ? (container.parentNode.offsetLeft || 0) : 0;
    var offsetTop   = container.parentNode ? (container.parentNode.offsetTop  || 0) : 0;
    var halfW       = container.offsetWidth  / 2 + offsetLeft;
    var halfH       = container.offsetHeight / 2;

    canvas.addEventListener('mousemove', function (e) {
      var index = Math.floor(e.offsetX / w);
      if (index < 0 || index >= total) return;

      var datum = data[index];
      var px    = e.pageX - offsetLeft;
      var py    = e.pageY - offsetTop;

      _raf(function () {
        tip.el.style.left = ((px < halfW) ? px : (px - tip.el.offsetWidth))  + 'px';
        tip.el.style.top  = ((py < halfH) ? py : (py - tip.el.offsetHeight)) + 'px';
      });

      if (datum.d === lastHash) return;

      _raf(function () {
        tip.cells.close.textContent   = datum.c;
        tip.cells.open.textContent    = datum.o;
        tip.cells.high.textContent    = datum.h;
        tip.cells.low.textContent     = datum.l;
        tip.cells.date.textContent    = datum.ds;
        tip.cells.volume.textContent  = datum.vos;
        tip.cells.change.textContent  = datum.cs;
        tip.cells.value.textContent   = datum.vas;
        tip.cells.remarks.textContent = (threshold != null && datum.v >= threshold) ? 'V-Outlier' : 'None';
        tip.el.setAttribute('data-color',
          datum.c === datum.o ? COLORS.gray : (datum.c > datum.o ? COLORS.green : COLORS.red));
      });

      _raf(function () {
        // restore former
        if (lastIndex !== -1) {
          var prev = data[lastIndex], px0 = lastIndex * w;
          _drawWick(ctx, prev, px0, w, min, max, priceH, false);
          _drawBody(ctx, prev, px0, w, min, max, priceH, false);
          _drawVolume(ctx, prev, px0, w, vmin, vmax, volH, priceH, threshold, false);
        }
        // highlight new
        var px1 = index * w;
        _drawWick(ctx, datum, px1, w, min, max, priceH, true);
        _drawBody(ctx, datum, px1, w, min, max, priceH, true);
        _drawVolume(ctx, datum, px1, w, vmin, vmax, volH, priceH, threshold, true);
        lastIndex = index;
      });

      lastHash = datum.d;
    });

    canvas.addEventListener('mouseleave', function () {
      tip.el.style.left = '-9999px';
    });
  }

  /* ─────────────────────────────────────────
     CORE RENDER
  ───────────────────────────────────────── */

  function _render(opts, rawData) {
    var container = document.getElementById(opts.container);
    if (!container) {
      console.error('[ChutyChart] container not found: #' + opts.container);
      return null;
    }

    // Normalise
    var data = _normaliseData(rawData);
    if (opts.interpolate) data = _interpolateData(data);
    data = _unique(data).sort(function (a, b) { return a.d - b.d; });
    data = data.slice(-opts.maxCandles);

    // Statistics
    var highStats = _getStatistics(data, 'h', opts.volumeThresholdMultiplier);
    var lowStats  = _getStatistics(data, 'l', opts.volumeThresholdMultiplier);
    var volStats  = _getStatistics(data, 'v', opts.volumeThresholdMultiplier);
    var min = lowStats.min, max = highStats.max;

    // Canvas
    var canvas  = document.createElement('canvas');
    var w       = opts.candleWidth;
    var totalW  = data.length * w;
    var totalH  = opts.height;

    canvas.width  = totalW;
    canvas.height = totalH;
    canvas.style.cursor = 'crosshair';

    var ctx = canvas.getContext('2d');
    ctx._chutyFont = opts.labelFont;   // store for label drawing

    var priceH = Math.floor(totalH * opts.priceAreaRatio);
    var volH   = totalH - priceH;

    // Background
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, totalW, totalH);

    // Separator line
    ctx.fillStyle = COLORS.separator;
    ctx.fillRect(0, priceH, totalW, 1);

    // Per-candle state (refs to avoid global leaks fixed in v1)
    var lastMonth = { v: -1 };
    var lastWeek  = { v: -1 };

    // Draw
    data.forEach(function (datum, i) {
      _pushDerivedFields(datum);
      var x = i * w;
      _drawWick(ctx, datum, x, w, min, max, priceH, false);
      _drawBody(ctx, datum, x, w, min, max, priceH, false);
      _drawVolume(ctx, datum, x, w, volStats.min, volStats.max, volH, priceH, volStats.threshold, false);
      _drawWeekLine(ctx, datum.d, x, totalH, lastWeek);
      _drawMonthLine(ctx, datum.d, x, totalH, lastMonth);
    });

    // Mount
    container.innerHTML = '';
    container.style.overflowX = 'scroll';
    container.style.position  = 'relative';
    container.appendChild(canvas);

    _enableTooltip(canvas, container, opts, data, ctx, priceH, min, max, volStats.min, volStats.max, volH, volStats.threshold);

    container.scrollLeft = container.scrollWidth;

    return { canvas: canvas, data: data, opts: opts };
  }

  /* ─────────────────────────────────────────
     PUBLIC CLASS
  ───────────────────────────────────────── */

  /**
   * ChutyChart v2
   *
   * @param {object} options
   * @param {string}  options.container   - ID of the DOM element to render into (required)
   * @param {Array}   options.data        - OHLCV candles (required)
   * @param {boolean} [options.interpolate=false]       - Fill gaps with interpolated candles
   * @param {number}  [options.height=400]              - Canvas height in pixels
   * @param {number}  [options.candleWidth=10]          - Pixels per candle column
   * @param {number}  [options.maxCandles=2600]         - Max candles to display
   * @param {number}  [options.volumeThresholdMultiplier=2] - Volume outlier threshold multiplier
   * @param {string}  [options.labelFont]               - CSS font for month labels
   * @param {number}  [options.priceAreaRatio=0.8]      - Fraction of height for price vs volume
   *
   * @example
   * const chart = new ChutyChart({
   *   container: 'chart',
   *   data: ohlcvArray,
   *   height: 500,
   *   candleWidth: 8,
   *   interpolate: true,
   * });
   * chart.render();
   */
  function ChutyChart(options) {
    if (!(this instanceof ChutyChart)) {
      // Allow calling without `new`
      return new ChutyChart(options);
    }
    if (!options || !options.container) {
      throw new Error('[ChutyChart] options.container is required');
    }
    this._opts  = _merge(DEFAULT_OPTIONS, options);
    this._state = null;
  }

  /**
   * Render (or re-render) the chart.
   * @param {Array} [data] - Optionally supply new data; otherwise uses options.data
   * @returns {ChutyChart} this (chainable)
   */
  ChutyChart.prototype.render = function (data) {
    var self = this;
    var d    = data || self._opts.data;
    _raf(function () {
      self._state = _render(self._opts, d);
    });
    return this;
  };

  /**
   * Update the chart with new data and re-render.
   * @param {Array} data
   * @returns {ChutyChart} this
   */
  ChutyChart.prototype.update = function (data) {
    this._opts.data = data;
    return this.render(data);
  };

  /**
   * Remove the chart from the DOM.
   * @returns {ChutyChart} this
   */
  ChutyChart.prototype.destroy = function () {
    var el = document.getElementById(this._opts.container);
    if (el) el.innerHTML = '';
    this._state = null;
    return this;
  };

  /**
   * Return the processed (normalised + sorted) data used in the last render.
   * @returns {Array|null}
   */
  ChutyChart.prototype.getData = function () {
    return this._state ? this._state.data : null;
  };

  /**
   * Return current resolved options.
   * @returns {object}
   */
  ChutyChart.prototype.getOptions = function () {
    return _merge({}, this._opts);
  };

  /* ─────────────────────────────────────────
     STATIC HELPERS (exposed on the class)
  ───────────────────────────────────────── */

  /** Validate and normalise a raw candle array without rendering */
  ChutyChart.normalise  = _normaliseData;
  ChutyChart.normalize  = _normaliseData;  // alias for US spelling

  /** Version */
  ChutyChart.version = '2.0.0';

  return ChutyChart;

}));
