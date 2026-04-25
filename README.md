# НейроХудожник API CLI

Командная строка `na` для НейроХудожник API Gateway: запуск генераций, управление балансом, просмотр активности, отладка из терминала. Двойного использования — одинаково удобна для людей и для LLM-агентов через shell.

```bash
npm install -g @neuroartist/cli
na auth login
na run nano-banana-pro -i prompt="кот в очках" -o ./out
```

## Установка

### npm (рекомендовано — нужен Node 20+)

```bash
npm install -g @neuroartist/cli
na --version
```

### Curl-installer (без Node, единый бинарник)

```bash
curl -fsSL https://raw.githubusercontent.com/CroissanStudioDev/neuroartist-api-cli/main/install.sh | sh
```

Скрипт детектит ОС/арку, качает соответствующий `.tar.gz` из последнего релиза, распаковывает в `~/.neuroartist/bin/na`, прописывает PATH в `.zshrc`/`.bashrc`/`config.fish` и снимает macOS quarantine.

Опции:

```bash
# Конкретная версия
curl -fsSL https://raw.githubusercontent.com/CroissanStudioDev/neuroartist-api-cli/main/install.sh | sh -s -- v0.2.0

# Кастомный install dir
curl -fsSL https://raw.githubusercontent.com/CroissanStudioDev/neuroartist-api-cli/main/install.sh | NEUROARTIST_INSTALL=/opt/na sh
```

После установки — `na update` для самообновления.

### Windows

Качай `.zip` из последнего релиза:
https://github.com/CroissanStudioDev/neuroartist-api-cli/releases/latest

Распакуй и положи `na.exe` в любую папку из `PATH`.

### Из исходников (для разработки)

```bash
git clone https://github.com/CroissanStudioDev/neuroartist-api-cli.git
cd neuroartist-api-cli
bun install
bun run dev auth login           # прямой запуск
bun link                         # сделать `na` глобально доступным
```

## Quick start

```bash
# 1. Авторизация (вставь API-ключ na_live_…)
na auth login

# 2. Проверь себя
na auth whoami
na balance

# 3. Каталог моделей
na models list --search banana --limit 10
na models schema nano-banana-pro

# 4. Запусти генерацию и сохрани результат
na run nano-banana-pro -i prompt="кот в очках" -o ./out

# 5. Async-режим (для медленных моделей)
na queue submit some-video-model -i prompt="..."
na queue stream some-video-model <requestId>
na queue result some-video-model <requestId> -o ./out
```

## Конфигурация

Конфиг в `~/.config/neuroartist/config.json` (уважает `XDG_CONFIG_HOME`), права `0600`:

```json
{
  "defaultProfile": "default",
  "profiles": {
    "default": {
      "apiKey": "na_live_...",
      "baseUrl": "https://api.neuroartist.ru"
    },
    "staging": {
      "apiKey": "na_live_...",
      "baseUrl": "https://staging.neuroartist.ru"
    }
  }
}
```

### Приоритет источников ключа и URL

1. CLI-флаги: `--profile`, `--base-url`
2. Env: `NEUROARTIST_API_KEY`, `NEUROARTIST_API_URL`, `NEUROARTIST_PROFILE`
3. Конфиг-файл (профиль)
4. Default base URL: `https://api.neuroartist.ru`

### Несколько окружений

```bash
na --profile staging auth login --base-url https://staging.neuroartist.ru
na --profile staging balance
```

## Команды

```
na auth login                    Сохранить API-ключ (interactive paste)
na auth logout                   Удалить ключ для текущего профиля
na auth whoami                   Информация о текущем ключе
na auth status                   Список профилей

na models list                   Каталог (без auth)
na models get <id>               Детали модели
na models schema <id>            JSON-схема входов/выходов
na models estimate <id> -i …     Оценка стоимости

na run <model> -i k=v -o ./out   Sync-генерация + скачивание ассетов
na run <model> --no-wait         Только submit, без ожидания

na queue submit <model> -i …     Поставить в очередь
na queue status <model> <id>     Текущий статус
na queue result <model> <id>     Финальный результат
na queue stream <model> <id>     SSE прогресс в реальном времени
na queue cancel <model> <id>     Отменить

na balance                       Текущий баланс
na usage summary                 Агрегаты по окнам (5h/24h/7d/30d)
na usage by-model -w 24h         Расход по моделям
na usage by-key   -w 24h         Расход по API-ключам
na activity --limit 20           Последние генерации

na doctor                        Self-check (config + /health + /me)
na update [--check]              Self-update standalone-бинарника
na completion bash|zsh|fish      Shell completion script
na commands [--json]             Машинно-читаемое дерево всех команд
```

## Передача входных данных

Флаг `-i, --input` повторяемый. Тип значения определяется автоматически:

```bash
-i prompt="кот"                  string
-i num_steps=20                  number
-i enabled=true                  boolean
-i image=@./photo.png            файл → data:image/png;base64,…
-i config=@./body.json           JSON-файл → объект
-i 'styles=["a","b"]'            JSON-литерал
-i nested.field=42               вложенный объект
```

Альтернатива — целиком JSON-файл:

```bash
na run some-model --input-file ./body.json
```

## Глобальные флаги

```
--profile <name>      Профиль из конфига
--base-url <url>      Override gateway URL
--json                Принудительно JSON envelope (auto в pipe / non-TTY / NEUROARTIST_JSON=1)
--debug               HTTP traffic в stderr
-q, --quiet           Заглушить informational-сообщения
-y, --yes             Non-interactive (никогда не спрашивает)
-v, --version         Версия
```

## Output формат

- В TTY — pretty (таблицы, цвета, единицы)
- В pipe / `--json` / `NEUROARTIST_JSON=1` / `CI=true` — JSON envelope
- `stdout` — данные. `stderr` — прогресс/ошибки/info. Безопасно пайпить
- `NO_COLOR=1` honored

```bash
na models list --json | jq '.data.items[] | select(.priceRub < 50) | .modelId'
na balance --json | jq -r .data.balance
```

## Agent-friendly контракт

`na` спроектирован для использования и людьми из терминала, и LLM-агентами через shell.

### Стабильный JSON envelope (`schemaVersion: 1`)

**Успех:**

```json
{
  "ok": true,
  "schemaVersion": 1,
  "command": "balance",
  "data": { "userId": "...", "balance": 1234 },
  "next_actions": [
    { "command": "na usage summary", "description": "Inspect spend" },
    { "command": "na activity", "description": "Last generations" }
  ]
}
```

**Ошибка:**

```json
{
  "ok": false,
  "schemaVersion": 1,
  "command": "balance",
  "error": {
    "code": "no_api_key",
    "message": "API key not configured…",
    "retryable": false,
    "hint": "Run `na auth login` or set NEUROARTIST_API_KEY.",
    "httpStatus": 401
  },
  "next_actions": [...]
}
```

### Granular exit codes

| Код | Когда |
|---|---|
| `0` | Успех |
| `1` | Generic / unknown error |
| `2` | Usage / argument / 4xx (кроме 401/403/409/429) |
| `3` | Auth / permission (401, 403, no_api_key) |
| `4` | Retryable / transient (429, 5xx, network, timeout) |
| `5` | Conflict (409) |

```bash
na queue submit fooz -i prompt="..." --json
case $? in
  0) echo "ok" ;;
  3) na auth login ;;
  4) sleep 2 && retry ;;
  5) echo "duplicate" ;;
esac
```

### Self-discovery — `na commands --json`

Машинно-читаемое дерево всех команд, аргументов и флагов. Агенту достаточно одного вызова, чтобы узнать контракт целиком, без скрейпинга `--help`:

```bash
na commands --json | jq '.data[] | select(.name | startswith("na queue"))'
```

### NDJSON streaming

`na queue stream <model> <id> --json` отдаёт **одну JSON-строку на каждый event** (NDJSON, как `kubectl get -w -o json`):

```bash
na queue stream fooz $REQ --json | while read -r line; do
  stage=$(echo "$line" | jq -r '.stage // .status')
  [[ "$stage" == "completed" ]] && break
done
```

### Принципы (что считаем гарантией)

1. **stdout** = данные (всегда машинно-парсятся в `--json`). **stderr** = логи / прогресс. Безопасно пайпить.
2. **Wait > poll** — `na run --wait` (default) блокируется до завершения; агенту не нужно крутить status в цикле.
3. **`--yes` / `CI=true`** — никогда не блокируется на интерактивных prompt'ах.
4. **`-q, --quiet`** — для скриптов, заглушает все non-data сообщения.
5. **Named параметры** — для опций; агенты не путают порядок.
6. **`--debug`** — печатает HTTP traffic в stderr, не загрязняет stdout.
7. **Идемпотентность** — `na auth login --token X` и `na auth logout` идемпотентны. `na queue submit` — нет (создаёт новый requestId), агент должен учитывать.

### Что не ломаем без bump'а `schemaVersion`

- Поля envelope: `ok`, `schemaVersion`, `command`, `data`, `error`, `next_actions`, `warnings`
- Семантика exit codes 0/2/3/4/5
- Имена команд (`na auth login`, `na run`, `na queue submit`, …)

Меняем — новый `schemaVersion` или новые опциональные поля. Строгая стабильность — обещание.

## Shell completion

```bash
# bash
echo 'eval "$(na completion bash)"' >> ~/.bashrc

# zsh — eval inline
echo 'eval "$(na completion zsh)"' >> ~/.zshrc

# zsh — function file (быстрее старт)
na completion zsh > "${fpath[1]}/_na"

# fish
na completion fish > ~/.config/fish/completions/na.fish
```

После установки: `na <TAB>` дополняет subcommand (`auth`, `models`, …), `na auth <TAB>` — child (`login`, `logout`, `whoami`, `status`).

## Архитектура

```
src/
├── index.ts              entry, регистрация команд, error-handling
├── version.ts
├── config.ts             ~/.config/neuroartist/config.json + chmod 0600
├── client.ts             fetch-обёртка с auth, ApiError, CliError
├── envelope.ts           JSON envelope + exit-code mapping
├── sse.ts                SSE-парсер для /progress/stream
├── inputs.ts             -i key=val парсер с @file и dotted-path
├── download.ts           collectUrls + downloadUrls для ассетов
├── output.ts             pretty/json/table рендереры
└── commands/
    ├── auth.ts           login / logout / whoami / status
    ├── models.ts         list / get / schema / estimate
    ├── balance.ts        текущий баланс
    ├── run.ts            sync run с --wait + asset download
    ├── queue.ts          submit / status / result / stream / cancel
    ├── usage.ts          summary / by-model / by-key + activity
    ├── doctor.ts         диагностика конфига + connectivity
    ├── update.ts         self-update standalone-бинарника
    ├── completion.ts     bash / zsh / fish completion-скрипты
    └── commands.ts       машинно-читаемое дерево команд
```

Стек: Bun + TypeScript + commander + @clack/prompts + kleur.

## Разработка

```bash
bun run dev <subcmd>             # прямой запуск (bun run src/index.ts)
bun run typecheck                # tsc --noEmit
bun run check                    # ultracite check (без правок)
bun run fix                      # ultracite fix (auto-fix)
bun run build                    # JS-бандл для npm (Node ≥20)
bun run build:bin                # standalone бинарник для текущей платформы
bun run build:all                # все 5 платформ
bun test                         # все тесты (~2s)
bun run test:unit                # только unit
bun run test:integration         # только integration
```

### Lint stack

`biome.jsonc` extends `ultracite/biome/core` — strict-режим. Локальные overrides только для CLI-специфики:

- `noConsole: off` — CLI пишет в stdout/stderr намеренно
- `noProcessEnv: off` — env-vars часть контракта CLI

### Pre-commit hook

`husky 9 + lint-staged 15`. Активируются автоматически при `bun install`:

- `.husky/pre-commit` → `bunx lint-staged`
- `lint-staged` запускает `ultracite fix` на staged `.ts/.tsx/biome.jsonc/package.json`

### Тесты

```
tests/
├── helpers/
│   ├── mock-gateway.ts    Bun.serve mock со всеми public + auth-routes
│   ├── temp-config.ts     изолированный XDG_CONFIG_HOME per-test
│   └── run-cli.ts         спавн bun run src/index.ts subprocess
├── unit/                  pure functions: parseInputs, parseSse, collectUrls,
│                          envelope/exit codes, config
└── integration/           CLI flow через subprocess + mock gateway:
                           auth, balance, models, run + queue, completion,
                           commands self-discovery, exit codes на 401/429/500
```

83 теста, ~2s локально, ~3s в CI.

### CI

`.github/workflows/ci.yml`:

- **`lint-and-build`** на каждый push/PR — install → lint → typecheck → `bun test` → smoke-compile
- **`create-release`** + **`release-binaries`** на тег `v*` — матрица 5 платформ (linux/darwin/windows × x64/arm64), сборка через `bun build --compile`, упаковка `.tar.gz`/`.zip`, аплоад в GitHub Release

### Релиз новой версии

1. Bump `version` в `package.json` + `src/version.ts` (синхронно)
2. `bun run check && bun run typecheck && bun test`
3. `git commit -m "release: vX.Y.Z (...)"` + `git push`
4. `npm publish`
5. `git tag -a vX.Y.Z -m "..." && git push origin vX.Y.Z` → CI собирает Release artifacts

## Известные ограничения

- `na keys list/create/revoke` пока не реализовано: соответствующие endpoint'ы шлюза (`/me/keys`) требуют session-cookie и недоступны через API-ключ. Управление ключами — через web UI.
- Аплоад больших файлов (`POST /me/uploads`) пока не обёрнут — для image-to-image задавай URL входа через `-i image=https://…` или встраивай локальный файл через `@./file.png` (data URL).
- Device-flow login — на будущее (требует поддержки на стороне backend).

## Лицензия

BSD-3-Clause — см. [LICENSE](./LICENSE).

Использовать, форкать и модифицировать можно свободно, в том числе коммерчески. При распространении нужно сохранить копирайт-нотис. Имена «Neuroartist» / «НейроХудожник» нельзя использовать для продвижения форков и производных продуктов без письменного разрешения.
