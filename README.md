# CodeLearnML

Локальный trainer по коду (ЛЛМ стек)

> **Статус: 0.0.2 Beta.** Версия предназначена для локальной оценки. Это не hardened multi-tenant production deployment: Judge0 использует privileged Docker-контейнеры и должен оставаться доступным только на `127.0.0.1`.

![Hero screen](assets/screenshots/hero.png)

## Интерфейс

### Чат с LLM-куратором

![Чатовый интерфейс CodeLearnML](assets/screenshots/chat.png)

### Профиль и активность

![Годовая активность пользователя](assets/screenshots/activity.png)

### Тесты

![Интерактивный тест CodeLearnML](assets/screenshots/tests.png)

### Задачи и выполнение кода

![Рабочее окно coding-задачи](assets/screenshots/task.png)

## Стек

- Frontend: React 19, Vite.
- Backend: Node.js.
- Хранилище: SQLite.
- Graph memory: Python 3.12, FalkorDB.
- Выполнение кода: локальный Judge0 CE, PostgreSQL и Redis.


## Требования

- Node.js 22+.
- npm.
- Python 3.12+ для `tests/memory-service-check.py` и опционального memory service.
- Docker для container/runtime workflows.

## Запуск

```sh
npm start
```

Команда установит Node.js-зависимости, соберёт frontend, поднимет FalkorDB, Graph Memory и локальный Judge0 со служебными PostgreSQL/Redis, затем запустит backend на `http://127.0.0.1:4173`.
Для первого запуска Docker скачает необходимые образы; образ Judge0 большой, поэтому первый старт может занять заметное время. Последующие запуски используют локальный cache. На Apple Silicon Judge0 запускается через Docker-эмуляцию `linux/amd64`.

Основные переменные:

- `OPENAI_API_KEY`, `OPENAI_ADMIN_KEY`, `OPENROUTER_API_KEY`, `YANDEX_AI_STUDIO_API_KEY` - ключи провайдеров, используются только backend.
- `YANDEX_AI_STUDIO_FOLDER_ID` - нужен для Yandex AI Studio.
- `CODELEARN_ENV_PATH` - локальный env-файл, который обновляет Settings API. По умолчанию `./.env`.
- `CODELEARN_DB_PATH` - путь к SQLite. По умолчанию `./data/codelearn.sqlite`.
- `CODELEARN_SEED_DEV_DATA` - `true` только для локального bootstrap.
- `JUDGE0_BASE_URL` - endpoint sandbox для `/api/execute`, по умолчанию локальный `http://127.0.0.1:2358`.
- `GRAPH_MEMORY_URL` - URL graph memory service.


## Раздельный запуск для разработки

Frontend dev server:

```sh
npm run dev
```

Backend:

```sh
npm run build
npm run server
```

Backend URL по умолчанию:

```text
http://127.0.0.1:4173
```

## Docker

```sh
docker build -t codelearn .
docker run --rm -p 4173:4173 -v codelearn-data:/data -v codelearn-workspace:/app/workspace codelearn
```

Container хранит runtime `.env`, SQLite data и personality memory в `/data`.

## Runtime services

Graph memory runtime:

```sh
npm run runtime:memory
```

Все runtime services:

```sh
npm run runtime:all
```

Команда поднимает FalkorDB, Graph Memory, Judge0 CE, PostgreSQL и Redis. API Judge0 доступен только локально на `127.0.0.1:2358`.

Остановка runtime services:

```sh
npm run runtime:down
```

## Проверки

```sh
npm test
npm run build
```

## Основные API

- `GET /api/app-state` - текущий урок, задачи, progress, settings, memory и runtime state.
- `POST /api/lessons` - импорт JSON-спеки урока из ответа ЛЛМ и создание workspace-файлов задачи.
- `PATCH /api/tasks/:id/progress` - сохранение draft-кода и индекса подсказки.
- `GET /api/tasks/:id/log` - история запусков задачи и assigned markdown.
- `POST /api/tasks/:id/runs` - сохранение результата запуска задачи.
- `GET /api/workspace/tasks/:taskId/files` - список workspace-файлов задачи.
- `GET /api/workspace/tasks/:taskId/files/:path` - чтение workspace-файла задачи.
- `GET|POST /api/memory/events` - чтение/создание memory review events.
- `PATCH /api/memory/events/:id` - обновление review status memory event.
- `POST /api/memory/graph-sync` - синхронизация accepted memory events в graph memory service.
- `POST /api/memory/graph-search` - запрос к graph memory service.
- `GET /api/runtime/health` - проверка опциональных runtime integrations.
- `POST /api/execute` - запуск кода через Judge0-compatible sandbox.
- `POST /api/models` - proxy для списка моделей провайдера.
- `POST /api/responses` - proxy для LLM requests.
- `GET|POST|DELETE /api/personality` - управление markdown personality memory.

## Благодарности

Спасибо открытым проектам, чьи специализированные решения стали частью CodeLearnML:

- [CodeMirror](https://github.com/codemirror/dev) — редактор кода и подсветка синтаксиса.
- [Judge0 CE](https://github.com/judge0/judge0) — изолированное выполнение пользовательского кода.
- [FalkorDB](https://github.com/FalkorDB/FalkorDB) — графовое хранилище памяти.

Лицензии и условия использования перечислены в [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
