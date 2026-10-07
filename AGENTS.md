# Дашборд «Покупки в Груше»

Интерактивный HTML-дашборд заказов клиента сервиса доставки продуктов на **d3.js v7** и **Vue.js 3**.
Без сборки: библиотеки подключаются с CDN в `index.html`, JS — ES-модули.

## Структура
- `index.html` — разметка и шаблон Vue-приложения (in-DOM template: компоненты в kebab-case, теги закрываются явно).
- `js/app.js` — корневое приложение (Composition API): состояние фильтров, `computed`-агрегаты, компонент `TopList`.
- `js/charts.js` — Vue-компоненты-обёртки над d3: `MonthlyChart` (3 панели + brush, `v-model:range`), `CategoryChart` (топ-5 в цвете, событие `select`), `ScatterChart`.
- `js/utils.js` — константы, цвета категорий, форматтеры (русская локаль), тултип, `loadData`, `summarize`, `aggregateItems`.
- `css/style.css` — токены цветов на `:root`, тёмная тема через `prefers-color-scheme` и `[data-theme]`.
- `data/orders.csv` — датасет; `data/items.csv` — товар → картинка в `img/items/`.

## Правила расчёта метрик
- Только заказы со статусом «доставлен»; отменённые считаются отдельно.
- Сумма трат = Σ `amount`, включая доставку и упаковку.
- Средняя скидка = Σ(`discount` × `quantity`) / Σ(`price` × `quantity`) по товарам без категории «Услуги Груши».
- Анализ товаров и категорий исключает «Услуги Груши».

## Запуск
`python -m http.server` в корне проекта → http://localhost:8000 (через file:// CSV не загрузится).
