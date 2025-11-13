# План реалізації Warehouse Assistant (ТОС + AI)

## 1. Мета та обсяг МВП
- Імпорт/синхронізація даних складу (каталог, продажі, запаси, закупівлі) через CSV/API з ідемпотентністю.
- Розрахунки sales_daily, avg_daily_demand, lead_time_days, buffers, рекомендації, KPI (DoS, turns, FEFO).
- REST API з Swagger (/docs) для ingest, KPI, рекомендацій, AI-асистента, auth.
- Frontend (Next.js) з сторінками `/login`, `/import`, `/recommendations`, `/kpi`, `/assistant`.
- AI-асистент на OpenAI для пояснень і запитів природною мовою.
- docker-compose для локального запуску (Postgres, Redis, backend, frontend).

## 2. Фази та вехи
| Фаза | Вміст | Тривалість | Вихід |
| --- | --- | --- | --- |
| 0. Архітектура | Структура монорепо, CI, Swagger stub | 1 тиждень | `/backend`, `/frontend`, `/infra`, CI |
| 1. Дані | Prisma схеми, міграції, ingest сервіси | 1 тиждень | базові таблиці, CSV/APIs |
| 2. Розрахунки | sales_daily, demand, lead time, buffers, KPI + AI I/O | 1 тиждень | скрипти перерахунків + jobs + AI payload |
| 3. API | Express маршрути + захист + Swagger | 1 тиждень | /api ... + /docs |
| 4. Frontend | Next.js сторінки, таблиці, графіки, імпорт | 1 тиждень | UI MVP |
| 5. AI | Інтеграція OpenAI, пояснення, чат | 1 тиждень | /assistant* |
| 6. Docker/Ops | Dockerfiles, docker-compose, env | 0.5 тижня | `docker-compose up` |

## 3. Архітектура
- **Моно-репо**: `/backend` (Express + TypeScript), `/frontend` (Next.js 14, App Router), `/infra` (Docker, env, діаграми).
- **Бекенд**: Express, zod, Prisma ORM, PostgreSQL, Redis, BullMQ/cron, OpenAI API.
- **Фронтенд**: Next.js 14, React Query, TanStack Table, Chart.js/Recharts.
- **БД**: PostgreSQL 15+, multi-tenant (org_id), опціонально pgvector.
- **Кеш/Jobs**: Redis 7.
- **AI**: OpenAI GPT-4o-mini з function calling.

## 4. Основні роботи по шарах
1. **Data ingestion**
   - CSV/JSON парсери, перевірка схем (zod), upsert через Prisma/транзакції.
   - Маршрути `/ingest/*` (catalog, sales, stock, PO header/lines, warehouses, suppliers), rate-limit, черга обробки великих файлів.
2. **Aggregations & Forecast**
   - `sales_daily` builder (02:00 UTC) + scheduler.
   - Avg daily demand (winsorized), demand_variability, seasonality hints.
   - Lead time (медіана/IQR), inbound qty, buffer engine + зони R/Y/G, DoS/Turns/FEFO.
   - Recommendation service (MOQ, pack, inbound, reservations).
3. **KPI/Analytics**
   - DoS, turns, median days-to-sell, FEFO ризики.
   - API `/kpi/sku/:sku`, `/buffers`, `/recommendations`.
4. **AI Assistant**
   - System prompt, function calling (getRecommendations/getKPI/explain).
   - Кешування, ліміти, аудит логів.
5. **Frontend Experience**
   - Auth guard (JWT), React Query hooks, таблиці/графіки, імпорт CSV, чат.
   - Експорт рекомендацій у CSV.
6. **Ops & Security**
   - JWT auth, org_id фільтри, logging (pino), audit trails.
   - Dockerfiles, compose, env templates, smoke tests.

## 7. Дані та AI-вектор
- Мінімальні потоки: catalog, warehouses, suppliers, sales, stock, PO (див. `docs/integration-spec.md`).
- ТОС-метрики: `avg_daily_demand`, `demand_variability`, `lead_time_days`, `buffer_qty`, `buffer_penetration`, DoS, Turns, FEFO, `order_qty`.
- AI отримує payload із time series, сезонністю, LT, ABC/XYZ, promo, constraints і повертає прогноз попиту, рекомендований `buffer_factor`, список аномалій та людські пояснення. ТОС залишається детермінованим — AI лише корегує і пояснює.

## 5. Acceptance Criteria (швидка перевірка)
- Імпорт через CSV/API ↔ оновлює БД ідемпотентно.
- Планувальник відпрацьовує ланцюжок 02:00–03:00.
- GET `/recommendations` повертає коректні кількості та reason.
- KPI UI показує DoS/turns/median d2sell/FEFO.
- AI-чат відповідає на базові запити та пояснення SKU.
- Swagger доступний на `/docs`.
- `docker-compose up -d` піднімає весь стек.

## 6. Наступні кроки (Phase 0)
1. Проініціалізувати монорепо структуру (`backend`, `frontend`, `infra`, `docs`).
2. Створити базові `package.json`, `tsconfig`, конфіг для ESLint/Prettier.
3. Додати README з інструкціями запуску.
4. Підготувати шаблони env та docker-compose скелет.

## 8. Поточний статус
**Реалізовано**
- API-реєстрація, JWT та мульти-організаційна модель даних.
- Ingest-маршрути для catalog, warehouses, suppliers, sales, stock, PO header/lines (idempotent upsert).
- Builder `sales_daily`, ТОС-розрахунки (avg_daily_demand, lead time, buffer qty, DoS/Turns/FEFO), рекомендації, KPI, сигналізація про overstock + пагінація.
- AI-асистент (`/assistant/query`, `/assistant/explain`), який через function calling отримує продажі, залишки, буфери, PO, рекомендації (див. `assistant/tools.ts`). Додані інструменти `get_stock_by_warehouse`, `get_sales_summary`, `suggest_rebalance` для аналізу розподілу запасів, порівняння попиту та рекомендацій по переміщенню між складами.
- Frontend (Next.js 14) з login/register, рекомендаціями (динамічний список складів, клієнтські фільтри, серверна пагінація + мережевий блок із картками складів), KPI, імпортом, AI-чатом.
- Рекомендації на фронті підтримують пошук SKU по всій мережі: введений текст одночасно фільтрує поточний склад і показує агреговану таблицю “Пошук по мережі” (on hand/inbound/target/suggested/zone/reason) для всіх складів, де знайдено збіг. Мережевий блок тепер також доступний у верхній частині сторінки, щоб швидко зорієнтуватися в пріоритетах, перш ніж переходити до деталізації конкретного складу.

**Що залишилось**
- Підключити реальні вивантаження (1С → SFTP/webhook) і автоматизувати ingest pipeline.
- Додати розширені метрики (ABC/XYZ, промо-факти, бюджетні обмеження) та дашборди.
- Налаштувати моніторинг, сповіщення, SLA по інтеграціях та експорт/архів даних.
