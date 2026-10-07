/* =========================================================
   Vue-компоненты с графиками на d3.js
   Vue отвечает за данные и жизненный цикл, d3 — за отрисовку SVG.
   ========================================================= */
import {
  ru, fInt, fRub, fPct, fCompact, fMonth, TOP_CATS, catColor,
  showTip, hideTip, ttRow, itemTip
} from "./utils.js";

const { ref, onMounted, onBeforeUnmount, watch } = Vue;

// Перерисовка при изменении ширины контейнера
function useResize(hostRef, cb) {
  let ro, lastW = 0;
  onMounted(() => {
    ro = new ResizeObserver(entries => {
      const w = Math.round(entries[0].contentRect.width);
      if (w && w !== lastW) { lastW = w; cb(); }
    });
    ro.observe(hostRef.value);
  });
  onBeforeUnmount(() => ro && ro.disconnect());
}

/* ---------------------------------------------------------
   1. Помесячная динамика: 3 панели с общей осью X + brush
   --------------------------------------------------------- */
export const MonthlyChart = {
  name: "MonthlyChart",
  props: {
    series: { type: Array, required: true },   // [{month, orders, spend, discPct, saved, cancelled}]
    range: { type: Array, default: null }       // [startMonth, endMonthExclusive] | null
  },
  emits: ["update:range"],
  template: `<div class="chart" ref="host"></div>`,
  setup(props, { emit }) {
    const host = ref(null);
    let x, brush, gBrush, bars = {}, programmatic = false;

    const inRange = d => !props.range || (d.month >= props.range[0] && d.month < props.range[1]);

    function roundedTop(x0, y0, w, h, r) {
      if (h <= 0) return "";
      r = Math.min(r, w / 2, h);
      return `M${x0},${y0 + h}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + w - r}Q${x0 + w},${y0} ${x0 + w},${y0 + r}V${y0 + h}Z`;
    }

    function render() {
      const el = d3.select(host.value);
      el.selectAll("*").remove();
      const data = props.series;
      if (!data.length) return;
      const months = data.map(d => d.month);

      const W = host.value.clientWidth;
      const narrow = W < 560;
      const m = { top: 8, right: 12, bottom: 28, left: narrow ? 44 : 56 };
      const panels = [
        { key: "orders", title: "Количество заказов", h: narrow ? 90 : 110, fmt: fInt, type: "bar" },
        { key: "spend", title: "Сумма трат, ₽", h: narrow ? 100 : 130, fmt: fCompact, type: "bar" },
        { key: "discPct", title: "Средняя скидка, %", h: narrow ? 80 : 100, fmt: v => ru.format(".0f")(v * 100) + "%", type: "line" }
      ];
      const titleH = 26, gap = 14;
      let yOff = 0;
      panels.forEach(p => { p.y0 = yOff + titleH; yOff = p.y0 + p.h + gap; });
      const innerH = yOff - gap;
      const H = innerH + m.top + m.bottom;
      const innerW = W - m.left - m.right;

      x = d3.scaleBand().domain(months.map(d => +d)).range([0, innerW]).paddingInner(0.22).paddingOuter(0.1);
      const bw = Math.min(24, x.bandwidth());
      const bx = d => x(+d.month) + (x.bandwidth() - bw) / 2;

      const svg = el.append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("height", H)
        .attr("role", "img").attr("aria-label", "Количество заказов, сумма трат и средняя скидка по месяцам");
      const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);

      // разделители годов
      g.append("g").selectAll("line").data(months.filter(d => d.getMonth() === 0)).join("line")
        .attr("class", "year-sep")
        .attr("x1", d => x(+d) - x.step() * x.paddingInner() / 2)
        .attr("x2", d => x(+d) - x.step() * x.paddingInner() / 2)
        .attr("y1", 0).attr("y2", innerH);

      bars = {};
      panels.forEach(p => {
        const gp = g.append("g").attr("transform", `translate(0,${p.y0})`);
        const max = d3.max(data, d => d[p.key]) || 1;
        const y = d3.scaleLinear().domain([0, max]).nice(3).range([p.h, 0]);
        p.y = y;

        g.append("text").attr("class", "panel-title").attr("x", -m.left + 4).attr("y", p.y0 - 10).text(p.title);
        gp.append("g").attr("class", "gridline")
          .selectAll("line").data(y.ticks(3).filter(t => t > 0)).join("line")
          .attr("x1", 0).attr("x2", innerW).attr("y1", y).attr("y2", y);
        gp.append("g").attr("class", "axis")
          .call(d3.axisLeft(y).ticks(3).tickFormat(p.fmt).tickSize(0).tickPadding(8));
        gp.append("line").attr("class", "baseline").attr("x1", 0).attr("x2", innerW).attr("y1", p.h).attr("y2", p.h);

        if (p.type === "bar") {
          bars[p.key] = gp.append("g").selectAll("path").data(data).join("path")
            .attr("class", "bar")
            .attr("d", d => roundedTop(bx(d), y(d[p.key]), bw, p.h - y(d[p.key]), 4));
        } else {
          const cx = d => x(+d.month) + x.bandwidth() / 2;
          const defined = d => d.discPct != null;
          gp.append("path").datum(data).attr("class", "line-area")
            .attr("d", d3.area().defined(defined).x(cx).y0(p.h).y1(d => y(d.discPct)).curve(d3.curveMonotoneX));
          gp.append("path").datum(data).attr("class", "line")
            .attr("d", d3.line().defined(defined).x(cx).y(d => y(d.discPct)).curve(d3.curveMonotoneX));
          p.dot = gp.append("circle").attr("class", "dot").attr("r", 4.5).style("display", "none");
        }
      });

      // ось X — подписи годов по центру своих месяцев
      g.append("g").selectAll("text").data(d3.groups(months, d => d.getFullYear())).join("text")
        .attr("class", "year-label")
        .attr("text-anchor", "middle")
        .attr("x", ([, ms]) => (x(+ms[0]) + x(+ms[ms.length - 1]) + x.bandwidth()) / 2)
        .attr("y", innerH + 20)
        .text(([yr, ms]) => (ms.length < 4 && narrow) ? "" : yr);

      const cross = g.append("line").attr("class", "crosshair").attr("y1", 0).attr("y2", innerH).style("display", "none");

      // выбор периода мышью
      brush = d3.brushX().extent([[0, 0], [innerW, innerH]]).on("end", ev => {
        if (programmatic || !ev.sourceEvent) return;
        let next = null;
        if (ev.selection) {
          const [s0, s1] = ev.selection;
          const picked = months.filter(mm => {
            const c = x(+mm) + x.bandwidth() / 2;
            return c >= s0 && c <= s1;
          });
          if (picked.length) next = [picked[0], d3.timeMonth.offset(picked[picked.length - 1], 1)];
        }
        emit("update:range", next);
        syncBrush(next);   // «прилипание» к границам месяцев
      });
      gBrush = g.append("g").attr("class", "brush").call(brush);
      syncBrush(props.range);
      styleRange();

      // наведение: общий crosshair и тултип по месяцу
      const disc = panels[2];
      const leave = () => {
        cross.style("display", "none");
        disc.dot.style("display", "none");
        Object.values(bars).forEach(b => b.classed("is-hover", false));
        hideTip();
      };
      svg.on("pointermove", ev => {
        const [mx] = d3.pointer(ev, g.node());
        const i = Math.floor((mx - x.step() * x.paddingOuter()) / x.step());
        if (i < 0 || i >= data.length || mx < 0 || mx > innerW) { leave(); return; }
        const d = data[i];
        const cxv = x(+d.month) + x.bandwidth() / 2;
        cross.style("display", null).attr("x1", cxv).attr("x2", cxv);
        Object.values(bars).forEach(b => b.classed("is-hover", e => e === d));
        if (d.discPct != null) disc.dot.style("display", null).attr("cx", cxv).attr("cy", disc.y(d.discPct));
        else disc.dot.style("display", "none");
        showTip(
          `<h4>${fMonth(d.month)}</h4>` +
          ttRow("Заказов", fInt(d.orders), "var(--accent)") +
          ttRow("Сумма трат", fRub(d.spend), "var(--accent)") +
          ttRow("Средний чек", d.orders ? fRub(d.spend / d.orders) : "—") +
          ttRow("Средняя скидка", fPct(d.discPct), "var(--accent-2)") +
          ttRow("Сэкономлено", fRub(d.saved)) +
          (d.cancelled ? ttRow("Отменено заказов", fInt(d.cancelled)) : ""), ev);
      }).on("pointerleave", leave);
    }

    function syncBrush(range) {
      if (!gBrush) return;
      programmatic = true;
      if (!range) gBrush.call(brush.move, null);
      else {
        const last = d3.timeMonth.offset(range[1], -1);
        const pad = x.step() * x.paddingInner() / 2;
        gBrush.call(brush.move, [x(+range[0]) - pad, x(+last) + x.bandwidth() + pad]);
      }
      programmatic = false;
    }

    function styleRange() {
      Object.values(bars).forEach(b => b.classed("is-out", d => !!props.range && !inRange(d)));
    }

    useResize(host, render);
    watch(() => props.series, render);
    watch(() => props.range, r => { syncBrush(r); styleRange(); });

    return { host };
  }
};

/* ---------------------------------------------------------
   2. Категории: горизонтальные столбцы, топ-5 в цвете
   --------------------------------------------------------- */
export const CategoryChart = {
  name: "CategoryChart",
  props: {
    data: { type: Array, required: true },     // [{cat, spend, orders, qty, share}]
    metric: { type: String, default: "spend" },
    selected: { type: String, default: null }
  },
  emits: ["select"],
  template: `<div class="chart" ref="host"></div>`,
  setup(props, { emit }) {
    const host = ref(null);

    function render() {
      const el = d3.select(host.value);
      const metric = props.metric;
      const data = props.data.slice().sort((a, b) => d3.descending(a[metric], b[metric]));
      const fmt = metric === "spend" ? fRub : fInt;
      const top = new Set(data.slice(0, TOP_CATS).map(d => d.cat));
      const sel = props.selected;

      const W = host.value.clientWidth;
      const rowH = 34, valueW = 84, bh = 20;
      // ширина колонки подписей — по самой длинной подписи
      const probe = el.append("svg").attr("width", 0).attr("height", 0).style("position", "absolute");
      const labelW = (d3.max(data, d => probe.append("text").attr("class", "cat-name").text(d.cat).node().getComputedTextLength()) || 100) + 16;
      probe.remove();
      const H = Math.max(rowH * data.length, 40);
      const xs = d3.scaleLinear().domain([0, d3.max(data, d => d[metric]) || 1]).range([0, Math.max(40, W - labelW - valueW)]);

      let svg = el.select("svg");
      if (svg.empty()) svg = el.append("svg").attr("role", "img").attr("aria-label", "Категории товаров");
      svg.attr("viewBox", `0 0 ${W} ${H}`).attr("height", H);

      const t = svg.transition().duration(450).ease(d3.easeCubicOut);
      const rows = svg.selectAll(".cat-row").data(data, d => d.cat).join(enter => {
        const r = enter.append("g").attr("class", "cat-row").attr("transform", (d, i) => `translate(0,${i * rowH})`);
        r.append("rect").attr("class", "cat-hit").attr("rx", 6);
        r.append("text").attr("class", "cat-name").attr("dy", "0.35em");
        r.append("path").attr("class", "cat-bar");
        r.append("text").attr("class", "cat-value").attr("dy", "0.35em");
        return r;
      });

      rows.classed("is-dim", d => sel && d.cat !== sel)
        .classed("is-top", d => sel ? d.cat === sel : top.has(d.cat))
        .attr("tabindex", 0)
        .on("click", (ev, d) => emit("select", d.cat))
        .on("keydown", (ev, d) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); emit("select", d.cat); } })
        .on("pointermove", (ev, d) => showTip(
          `<h4>${d.cat}</h4>` +
          ttRow("Траты", fRub(d.spend)) +
          ttRow("Доля в тратах на товары", fPct(d.share)) +
          ttRow("Заказов с категорией", fInt(d.orders)) +
          ttRow("Куплено штук", fInt(d.qty)), ev))
        .on("pointerleave", hideTip);

      rows.transition(t).attr("transform", (d, i) => `translate(0,${i * rowH})`);
      rows.select(".cat-hit").attr("x", -4).attr("y", 1).attr("width", W + 4).attr("height", rowH - 2);
      rows.select(".cat-name").attr("x", 4).attr("y", rowH / 2).text(d => d.cat);
      rows.select(".cat-bar")
        .style("fill", d => sel
          ? (d.cat === sel ? catColor(d.cat) : "var(--dim)")
          : (top.has(d.cat) ? catColor(d.cat) : "var(--rest)"))
        .transition(t).attr("d", d => {
          const w = Math.max(1, xs(d[metric])), r = Math.min(4, w);
          const y0 = (rowH - bh) / 2, x0 = labelW;
          return `M${x0},${y0}H${x0 + w - r}Q${x0 + w},${y0} ${x0 + w},${y0 + r}V${y0 + bh - r}Q${x0 + w},${y0 + bh} ${x0 + w - r},${y0 + bh}H${x0}Z`;
        });
      rows.select(".cat-value").transition(t)
        .attr("x", d => labelW + xs(d[metric]) + 8).attr("y", rowH / 2)
        .text(d => fmt(d[metric]));
    }

    useResize(host, render);
    watch(() => [props.data, props.metric, props.selected], render);
    return { host };
  }
};

/* ---------------------------------------------------------
   3. Scatter: частота покупок × траты, лидеры — картинками
   --------------------------------------------------------- */
export const ScatterChart = {
  name: "ScatterChart",
  props: {
    items: { type: Array, required: true },    // агрегаты по товарам
    selected: { type: String, default: null },
    images: { type: Object, required: true }   // Map: товар -> картинка
  },
  template: `<div class="chart" ref="host"></div>`,
  setup(props) {
    const host = ref(null);

    function render() {
      const el = d3.select(host.value);
      el.selectAll("*").remove();
      const items = props.items;
      if (!items.length) { el.append("div").attr("class", "empty").text("Нет покупок за выбранный период"); return; }

      const W = host.value.clientWidth;
      const H = Math.max(300, Math.min(420, W * 0.72));
      const m = { top: 24, right: 24, bottom: 40, left: 58 };
      const iw = W - m.left - m.right, ih = H - m.top - m.bottom;

      const x = d3.scaleLog().domain([0.8, d3.max(items, d => d.orders) * 2]).range([0, iw]);
      const y = d3.scaleLog().domain([d3.min(items, d => d.spend) * 0.7 || 1, d3.max(items, d => d.spend) * 3]).range([ih, 0]);

      const svg = el.append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("height", H)
        .attr("role", "img").attr("aria-label", "Товары: число заказов против суммы трат");
      const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);

      const xt = [1, 2, 5, 10, 20, 50, 100, 200, 500].filter(v => v >= x.domain()[0] && v <= x.domain()[1]);
      const yt = [10, 30, 100, 300, 1e3, 3e3, 1e4, 3e4, 1e5].filter(v => v >= y.domain()[0] && v <= y.domain()[1]);

      g.append("g").attr("class", "gridline").selectAll("line").data(yt).join("line")
        .attr("x1", 0).attr("x2", iw).attr("y1", y).attr("y2", y);
      g.append("g").attr("class", "gridline").selectAll("line").data(xt).join("line")
        .attr("y1", 0).attr("y2", ih).attr("x1", x).attr("x2", x);
      g.append("g").attr("class", "axis").attr("transform", `translate(0,${ih})`)
        .call(d3.axisBottom(x).tickValues(xt).tickFormat(fInt).tickSize(0).tickPadding(8));
      g.append("g").attr("class", "axis")
        .call(d3.axisLeft(y).tickValues(yt).tickFormat(fCompact).tickSize(0).tickPadding(8));
      g.append("text").attr("class", "axis-title").attr("x", iw).attr("y", ih + 34).attr("text-anchor", "end")
        .text("Число заказов с товаром (лог. шкала) →");
      g.append("text").attr("class", "axis-title").attr("x", -m.left + 4).attr("y", -12)
        .text("↑ Потрачено, ₽ (лог. шкала)");

      const sel = props.selected;
      const pool = sel ? items.filter(d => d.cat === sel) : items;

      // лидеры: топ по частоте ∪ топ по тратам
      const nLead = W < 480 ? 4 : 5;
      const leaders = Array.from(new Set([
        ...pool.slice().sort((a, b) => b.orders - a.orders || b.spend - a.spend).slice(0, nLead),
        ...pool.slice().sort((a, b) => b.spend - a.spend).slice(0, nLead)
      ]));
      const leadSet = new Set(leaders);

      // сначала приглушённые точки, поверх — выбранная категория
      const dots = items.filter(d => !leadSet.has(d))
        .sort((a, b) => (sel && a.cat !== sel ? 0 : 1) - (sel && b.cat !== sel ? 0 : 1));
      g.append("g").selectAll("circle").data(dots).join("circle")
        .attr("class", "pt")
        .classed("is-dim", d => sel && d.cat !== sel)
        .attr("cx", d => x(d.orders)).attr("cy", d => y(d.spend)).attr("r", 4.5)
        .on("pointermove", (ev, d) => showTip(itemTip(d, props.images.get(d.item)), ev))
        .on("pointerleave", hideTip);

      // раскладка картинок без наложений (force-collide)
      const R = W < 480 ? 14 : 18;
      const nodes = leaders.map(d => ({ d, tx: x(d.orders), ty: y(d.spend), x: x(d.orders), y: y(d.spend) }));
      const sim = d3.forceSimulation(nodes)
        .force("x", d3.forceX(n => n.tx).strength(0.6))
        .force("y", d3.forceY(n => n.ty).strength(0.6))
        .force("collide", d3.forceCollide(R + 3))
        .stop();
      for (let i = 0; i < 200; i++) sim.tick();
      nodes.forEach(n => {
        n.x = Math.max(R, Math.min(iw - R, n.x));
        n.y = Math.max(R, Math.min(ih - R, n.y));
      });

      svg.append("defs").append("clipPath").attr("id", "clip-circle").attr("clipPathUnits", "objectBoundingBox")
        .append("circle").attr("cx", 0.5).attr("cy", 0.5).attr("r", 0.5);

      const lead = g.append("g").selectAll("g").data(nodes).join("g")
        .attr("class", "pt-img")
        .on("pointermove", (ev, n) => showTip(itemTip(n.d, props.images.get(n.d.item)), ev))
        .on("pointerleave", hideTip);
      lead.append("line").attr("class", "crosshair")
        .attr("x1", n => n.tx).attr("y1", n => n.ty).attr("x2", n => n.x).attr("y2", n => n.y);
      lead.append("circle").attr("class", "dot").style("fill", "var(--accent)")
        .attr("cx", n => n.tx).attr("cy", n => n.ty).attr("r", 3);
      lead.append("circle").attr("class", "pt-img-ring").attr("cx", n => n.x).attr("cy", n => n.y).attr("r", R + 1.5);
      lead.append("image")
        .attr("href", n => props.images.get(n.d.item))
        .attr("x", n => n.x - R + 1).attr("y", n => n.y - R + 1)
        .attr("width", 2 * R - 2).attr("height", 2 * R - 2)
        .attr("clip-path", "url(#clip-circle)")
        .attr("preserveAspectRatio", "xMidYMid slice");
    }

    useResize(host, render);
    watch(() => [props.items, props.selected], render);
    return { host };
  }
};
