/* =========================================================
   Корневое Vue-приложение: состояние, фильтры, расчёты
   ========================================================= */
import {
  SERVICE_CAT, ADDRESSES, CAT_METRICS, TOP_N, TOP_CATS, catColor,
  fInt, f1, fRub, fPct, fMonth, pOrders, pPcs, pGoods,
  showTip, hideTip, itemTip,
  loadData, summarize, aggregateItems, byFrequency, bySpend
} from "./utils.js";
import { MonthlyChart, CategoryChart, ScatterChart } from "./charts.js";

const { createApp, ref, shallowRef, computed, onMounted } = Vue;

/* Топ-список товаров с картинками (чистый Vue-шаблон + анимация перестановки) */
const TopList = {
  name: "TopList",
  props: {
    items: { type: Array, required: true },
    images: { type: Object, required: true },
    value: { type: Function, required: true },  // числовое значение для полоски
    main: { type: Function, required: true },   // подпись значения
    extra: { type: Function, required: true }   // дополнительная подпись
  },
  template: `
    <p v-if="!items.length" class="empty">Нет покупок за выбранный период</p>
    <transition-group v-else tag="ol" name="list" class="toplist">
      <li v-for="(d, i) in items" :key="d.item" class="toprow"
          @pointermove="tip(d, $event)" @pointerleave="hideTip">
        <span class="toprow__rank">{{ i + 1 }}</span>
        <img class="toprow__img" :src="images.get(d.item)" :alt="d.item">
        <div class="toprow__body">
          <div class="toprow__name" :title="d.item">{{ d.item }}</div>
          <div class="toprow__cat">{{ d.cat }}</div>
          <div class="toprow__track"><div class="toprow__fill" :style="{ width: pct(d) + '%' }"></div></div>
        </div>
        <div class="toprow__val">{{ main(d) }}<small>{{ extra(d) }}</small></div>
      </li>
    </transition-group>`,
  setup(props) {
    const max = computed(() => Math.max(1, ...props.items.map(props.value)));
    const pct = d => props.value(d) / max.value * 100;
    const tip = (d, ev) => showTip(itemTip(d, props.images.get(d.item)), ev);
    return { pct, tip, hideTip };
  }
};

const App = {
  components: { MonthlyChart, CategoryChart, ScatterChart, TopList },
  setup() {
    // ---------- состояние ----------
    const loading = ref(true);
    const error = ref(false);
    const rows = shallowRef([]);        // shallowRef: 5 800 строк не нужно делать глубоко реактивными
    const images = shallowRef(new Map());
    const months = shallowRef([]);

    const range = shallowRef(null);     // [начало месяца, начало месяца после конца] | null
    const addr = ref("all");
    const category = ref(null);
    const catMetric = ref("spend");
    const theme = ref(initTheme());

    onMounted(async () => {
      try {
        const data = await loadData();
        rows.value = data.rows;
        images.value = data.images;
        months.value = data.months;
      } catch (e) {
        console.error(e);
        error.value = true;
      } finally {
        loading.value = false;
      }
    });

    // ---------- фильтры ----------
    const dataEnd = computed(() => months.value.length ? d3.timeMonth.offset(months.value[months.value.length - 1], 1) : null);
    const yearOptions = computed(() => {
      if (!months.value.length) return [];
      const y0 = months.value[0].getFullYear(), y1 = months.value[months.value.length - 1].getFullYear();
      return [{ key: "all", label: "Всё время" }, ...d3.range(y0, y1 + 1).map(y => ({ key: y, label: String(y) }))];
    });
    const yearRange = y => [
      new Date(Math.max(+new Date(y, 0, 1), +months.value[0])),
      new Date(Math.min(+new Date(y + 1, 0, 1), +dataEnd.value))
    ];
    function setYear(key) { range.value = key === "all" ? null : yearRange(key); }
    function isYearActive(key) {
      if (key === "all") return !range.value;
      if (!range.value) return false;
      const [a, b] = yearRange(key);
      return +a === +range.value[0] && +b === +range.value[1];
    }
    function selectCategory(cat) { category.value = category.value === cat ? null : cat; }

    const addrMatch = computed(() => ADDRESSES.find(a => a.key === addr.value).match);
    const inRange = d => !range.value || (d.month >= range.value[0] && d.month < range.value[1]);

    // ---------- данные ----------
    const delivered = computed(() => rows.value.filter(d => d.ok && addrMatch.value(d.addr)));
    const cancelled = computed(() => rows.value.filter(d => !d.ok && addrMatch.value(d.addr)));
    const rangeRows = computed(() => delivered.value.filter(inRange));
    const products = computed(() => rangeRows.value.filter(d => !d.service));

    // помесячный ряд (зависит только от адреса — период подсвечивается на графике)
    const monthly = computed(() => {
      const byM = d3.group(delivered.value, d => +d.month);
      const cancByM = d3.rollup(cancelled.value, v => new Set(v.map(d => d.order)).size, d => +d.month);
      return months.value.map(m => ({ month: m, ...summarize(byM.get(+m) || []), cancelled: cancByM.get(+m) || 0 }));
    });

    const summary = computed(() => summarize(rangeRows.value));

    const kpis = computed(() => {
      const s = summary.value;
      const nMonths = range.value ? d3.timeMonth.count(range.value[0], range.value[1]) : months.value.length || 1;
      const canc = new Set(cancelled.value.filter(inRange).map(d => d.order)).size;
      const uniq = new Set(products.value.map(d => d.item)).size;
      return [
        { label: "Заказов", value: fInt(s.orders), note: `≈ ${f1(s.orders / nMonths)} в месяц · ${canc} отменено` },
        { label: "Сумма трат", value: fRub(s.spend), note: `≈ ${fRub(s.spend / nMonths)} в месяц`, hero: true },
        { label: "Средний чек", value: fRub(s.orders ? s.spend / s.orders : 0), note: `${f1(s.orders ? s.qty / s.orders : 0)} шт товаров в заказе` },
        { label: "Средняя скидка", value: fPct(s.discPct), note: `сэкономлено ${fRub(s.saved)}` },
        { label: "Разных товаров", value: fInt(uniq), note: `${fPct(s.lines ? s.discLines / s.lines : null)} позиций куплено со скидкой` }
      ];
    });

    const periodLabel = computed(() => {
      if (!months.value.length) return "Загрузка данных…";
      const r = range.value || [months.value[0], dataEnd.value];
      const last = d3.timeMonth.offset(r[1], -1);
      return `${fMonth(r[0])} — ${fMonth(last).toLowerCase()} · ${pOrders(summary.value.orders)}` +
        (addr.value !== "all" ? ` · ${ADDRESSES.find(a => a.key === addr.value).label}` : "");
    });

    const categories = computed(() => {
      const total = d3.sum(products.value, d => d.amount);
      return d3.rollups(products.value, v => ({
        spend: d3.sum(v, d => d.amount),
        orders: new Set(v.map(d => d.order)).size,
        qty: d3.sum(v, d => d.qty)
      }), d => d.cat).map(([cat, s]) => ({ cat, ...s, share: total ? s.spend / total : 0 }));
    });

    const servicesNote = computed(() => {
      const svc = rangeRows.value.filter(d => d.cat === SERVICE_CAT);
      if (!svc.length) return "";
      const deliv = svc.filter(d => d.item === "Доставка");
      const pack = svc.filter(d => d.item === "Упаковка");
      const free = deliv.filter(d => d.amount === 0).length;
      return `Не вошли в график: доставка ${fRub(d3.sum(deliv, d => d.amount))} и упаковка ${fRub(d3.sum(pack, d => d.amount))} — ` +
        `${fPct(d3.sum(svc, d => d.amount) / summary.value.spend)} всех трат. Доставка была бесплатной в ${fPct(deliv.length ? free / deliv.length : null)} заказов.`;
    });

    const items = computed(() => aggregateItems(products.value));
    const catItems = computed(() => category.value ? items.value.filter(d => d.cat === category.value) : items.value);
    const topFreq = computed(() => catItems.value.slice().sort(byFrequency).slice(0, TOP_N));
    const topSpend = computed(() => catItems.value.slice().sort(bySpend).slice(0, TOP_N));

    const shelves = computed(() => {
      const total = d3.sum(products.value, d => d.amount);
      const list = d3.groups(items.value, d => d.cat).map(([cat, its]) => {
        const spend = d3.sum(its, d => d.spend);
        return { cat, spend, share: total ? spend / total : 0, count: its.length, top: its.slice().sort(byFrequency).slice(0, 3) };
      }).sort((a, b) => b.spend - a.spend);
      const maxShare = d3.max(list, d => d.share) || 1;
      list.forEach((d, i) => {
        d.meter = d.share / maxShare * 100;
        d.color = i < TOP_CATS ? catColor(d.cat) : "var(--rest)";
      });
      return list;
    });

    // ---------- тема ----------
    function initTheme() {
      let saved = null;
      try { saved = localStorage.getItem("grusha-theme"); } catch (e) { /* нет доступа */ }
      if (saved) document.documentElement.setAttribute("data-theme", saved);
      return saved || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    }
    function toggleTheme() {
      theme.value = theme.value === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", theme.value);
      try { localStorage.setItem("grusha-theme", theme.value); } catch (e) { /* ignore */ }
    }

    // подписи для топов
    const fmt = {
      orders: d => d.orders,
      spend: d => d.spend,
      ordersMain: d => fInt(d.orders),
      spendMain: d => fRub(d.spend),
      qtyExtra: d => pPcs(d.qty),
      ordersExtra: d => pOrders(d.orders)
    };

    return {
      loading, error, images, range, addr, category, catMetric, theme,
      ADDRESSES, CAT_METRICS,
      yearOptions, setYear, isYearActive, selectCategory, toggleTheme,
      monthly, kpis, periodLabel, categories, servicesNote, items, topFreq, topSpend, shelves,
      fmt, fRub, fPct, pGoods,
      tip: (d, ev) => showTip(itemTip(d, images.value.get(d.item)), ev), hideTip
    };
  }
};

createApp(App).mount("#app");
