/* =========================================================
   Общие константы, форматтеры, тултип и расчёты (d3)
   ========================================================= */

export const SERVICE_CAT = "Услуги Груши";
export const STATUS_OK = "доставлен";
export const TOP_N = 10;
export const TOP_CATS = 5;

export const ADDRESSES = [
  { key: "all", label: "Все адреса", match: () => true },
  { key: "msk", label: "Москва", match: a => a.startsWith("Москва") },
  { key: "dacha", label: "Дача (СНТ)", match: a => a.includes("СНТ") }
];

export const CAT_METRICS = [
  { key: "spend", label: "₽", title: "Траты" },
  { key: "orders", label: "Заказы", title: "Заказов с категорией" },
  { key: "qty", label: "Штуки", title: "Куплено штук" }
];

// Цвет закреплён за категорией (а не за местом в рейтинге); раскрашиваются только топ-5
export const CAT_COLORS = {
  "Фрукты": "#9cc130",
  "Готовая еда": "#2fa7b8",
  "База": "#4e9a3c",
  "Овощи": "#0a6f64",
  "Сладости": "#e2709a",
  "Товары для дома": "#8a76d6",
  "Напитки": "#e0a030",
  "Аптека": "#d9625b",
  "Вода": "#4a90d9",
  "Снеки": "#e8803a"
};
export const catColor = c => CAT_COLORS[c] || "var(--accent)";

// ---------- Локаль и форматтеры ----------
export const ru = d3.formatLocale({ decimal: ",", thousands: " ", grouping: [3], currency: ["", " ₽"] });
export const fInt = ru.format(",d");
export const f1 = ru.format(".1f");
export const fRub = v => fInt(Math.round(v)) + " ₽";
export const fPct = v => (v == null || isNaN(v)) ? "—" : ru.format(".1f")(v * 100) + "%";
export const fCompact = v => {
  const a = Math.abs(v);
  if (a >= 1e6) return ru.format(".1~f")(v / 1e6) + " млн";
  if (a >= 1e3) return ru.format(".0f")(v / 1e3) + " тыс";
  return fInt(v);
};

const tl = d3.timeFormatLocale({
  dateTime: "%A, %e %B %Y г. %X", date: "%d.%m.%Y", time: "%H:%M:%S", periods: ["", ""],
  days: ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"],
  shortDays: ["вс", "пн", "вт", "ср", "чт", "пт", "сб"],
  months: ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"],
  shortMonths: ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]
});
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
export const fMonth = d => cap(tl.format("%B %Y")(d));
export const fDate = tl.format("%d.%m.%Y");

export function plural(n, forms) {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return forms[0];
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return forms[1];
  return forms[2];
}
export const pOrders = n => `${fInt(n)} ${plural(n, ["заказ", "заказа", "заказов"])}`;
export const pPcs = n => `${fInt(n)} шт`;
export const pGoods = n => `${fInt(n)} ${plural(n, ["товар", "товара", "товаров"])}`;

// ---------- Тултип (один на страницу, вне Vue-приложения) ----------
const tipEl = () => document.getElementById("tooltip");
export function showTip(html, ev) {
  const el = tipEl();
  el.innerHTML = html;
  el.hidden = false;
  moveTip(ev);
}
export function moveTip(ev) {
  const el = tipEl(), pad = 14;
  const w = el.offsetWidth, h = el.offsetHeight;
  let x = ev.clientX + pad, y = ev.clientY + pad;
  if (x + w > window.innerWidth - 8) x = ev.clientX - w - pad;
  if (y + h > window.innerHeight - 8) y = ev.clientY - h - pad;
  el.style.left = Math.max(8, x) + "px";
  el.style.top = Math.max(8, y) + "px";
}
export function hideTip() { tipEl().hidden = true; }
export const ttRow = (label, value, color) =>
  `<div class="tt-row"><span>${color ? `<i class="key" style="background:${color}"></i>` : ""}${label}</span><span>${value}</span></div>`;

export function itemTip(d, img) {
  return (img ? `<img class="tt-img" src="${img}" alt="">` : "") +
    `<h4>${d.item}</h4><div class="tt-sub">${d.cat}</div><div style="clear:both"></div>` +
    ttRow("Заказов", fInt(d.orders)) +
    ttRow("Куплено", pPcs(d.qty)) +
    ttRow("Потрачено", fRub(d.spend)) +
    ttRow("Средняя цена", fRub(d.spend / d.qty)) +
    ttRow("Скидка", fPct(d.full ? d.saved / d.full : null)) +
    ttRow("Первая покупка", fDate(d.first)) +
    ttRow("Последняя", fDate(d.last));
}

// ---------- Загрузка данных ----------
const parseDate = d3.timeParse("%Y-%m-%d");

export async function loadData() {
  const [rows, items] = await Promise.all([
    d3.csv("data/orders.csv", d => {
      const date = parseDate(d.order_date);
      return {
        order: d.order_id,
        date,
        month: d3.timeMonth(date),
        ok: d.status === STATUS_OK,
        addr: d.delivery_address,
        item: d.item_name,
        cat: d.category,
        service: d.category === SERVICE_CAT,
        price: +d.price,
        disc: +d.discount,
        qty: +d.quantity,
        amount: +d.amount
      };
    }),
    d3.csv("data/items.csv")
  ]);
  const images = new Map(items.map(d => [d.item_name, d.image]));
  const [m0, m1] = d3.extent(rows, d => d.month);
  const months = d3.timeMonth.range(m0, d3.timeMonth.offset(m1, 1));
  return { rows, images, months };
}

// ---------- Агрегаты ----------
export function summarize(rows) {
  const products = rows.filter(d => !d.service);
  const full = d3.sum(products, d => d.price * d.qty);
  const saved = d3.sum(products, d => d.disc * d.qty);
  return {
    orders: new Set(rows.map(d => d.order)).size,
    spend: d3.sum(rows, d => d.amount),
    saved,
    discPct: full > 0 ? saved / full : null,
    lines: products.length,
    discLines: products.filter(d => d.disc > 0).length,
    qty: d3.sum(products, d => d.qty)
  };
}

export function aggregateItems(rows) {
  return d3.rollups(rows, v => ({
    item: v[0].item,
    cat: v[0].cat,
    orders: new Set(v.map(d => d.order)).size,
    qty: d3.sum(v, d => d.qty),
    spend: d3.sum(v, d => d.amount),
    saved: d3.sum(v, d => d.disc * d.qty),
    full: d3.sum(v, d => d.price * d.qty),
    first: d3.min(v, d => d.date),
    last: d3.max(v, d => d.date)
  }), d => d.item).map(d => d[1]);
}

export const byFrequency = (a, b) => b.orders - a.orders || b.spend - a.spend;
export const bySpend = (a, b) => b.spend - a.spend;
