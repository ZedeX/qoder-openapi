# qoder-openapi

OpenAI-compatible API gateway for [QoderWork](https://qoder.com) — expose Qwen LLM capabilities as standard OpenAI API endpoints.

## Features

- **OpenAI-compatible API** — Drop-in replacement for OpenAI API (`/v1/chat/completions`, `/v1/models`)
- **Streaming support** — SSE streaming via `stream: true`
- **Multiple models** — `qwork-auto`, `qwork-ultimate`, `qmodel_latest` (Qwen3.7-Max)
- **Dual transport** — Auto-detect Named Pipe (connected mode) or qodercli.exe (standalone mode)
- **Tool use / MCP** — Supports QoderWork's MCP tool calling protocol
- **Vision support** — Image input via `is_vl` flag (model-dependent)
- **Reasoning mode** — Extended thinking via `is_reasoning` flag
- **Web Portal** — Built-in dashboard at `/portal.html` showing account, pipe status, usage, models, sessions, skills, agents and MCP servers
- **Web Console** — Built-in chat UI at `/` (index.html) with session management and message logging
- **Upstream error surfacing** — Detects QoderWork FORBIDDEN/UNAUTHORIZED errors and forwards proper HTTP status (403/401) instead of generic 502
- **Log rotation** — Automatic log file rotation (default 10 MB, 5 historical files)
- **Async persistence** — Debounced async writes for sessions and message logs to avoid blocking the event loop
- **Timing-safe API key check** — Uses `crypto.timingSafeEqual` to prevent timing attacks

## Prerequisites

- [QoderWork](https://qoder.com) desktop app installed and **logged in**
- Node.js >= 18
- A valid QoderWork subscription (even the "free" `qmodel_latest` model requires an active subscription)

## Quick Start

```bash
# Install dependencies
npm install

# Start the gateway
npm start

# Or use the batch file (Windows)
start.bat
```

The gateway runs on `http://localhost:9680` by default.

- Web Console: http://localhost:9680/
- Portal Dashboard: http://localhost:9680/portal.html

## API Endpoints

### OpenAI-compatible

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/status` | QoderWork login status & config |
| GET | `/v1/models` | List available models (with CLI fallback) |
| GET | `/v1/models/:model` | Get model details |
| POST | `/v1/chat/completions` | Chat completion (streaming & non-streaming) |

### QoderWork Capability API (requires `GATEWAY_API_KEY` if set)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/qoder/pipe-status` | Named pipe connectivity status |
| GET | `/api/qoder/account` | Account info (username, email, CLI version) |
| GET | `/api/qoder/usage` | Usage / quota (used, total, remaining, expiry) |
| GET | `/api/qoder/models` | Real models from CLI (with stderr warnings) |
| GET | `/api/qoder/data-policy` | Data policy settings |
| GET | `/api/qoder/access` | QoderWork access check |
| GET | `/api/qoder/skills` | List available skills |
| GET | `/api/qoder/agents` | List available agents |
| GET | `/api/qoder/mcp` | List MCP servers |
| GET | `/api/qoder/plugins` | List plugins |
| GET | `/api/qoder/config` | Get config value (query: `?key=...`) |
| GET | `/api/qoder/sessions` | List local QoderWork sessions |
| POST | `/api/qoder/commit` | Generate commit message (body: `{ cwd }`) |
| POST | `/api/qoder/wiki` | Generate wiki (body: `{ cwd }`) |
| POST | `/api/qoder/feedback` | Submit feedback (body: `{ ... }`) |

### Session Management (built-in web console sessions)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sessions` | List console sessions |
| POST | `/api/sessions` | Create a session |
| GET | `/api/sessions/:id` | Get a session (with messages) |
| PUT | `/api/sessions/:id` | Update session (title/model) |
| DELETE | `/api/sessions/:id` | Delete a session |
| POST | `/api/sessions/:id/messages` | Append a message |
| DELETE | `/api/sessions` | Clear all sessions |

### Message Logs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/logs` | Paginated message logs (query: `?limit=&offset=`) |
| GET | `/api/logs/:id` | Full log entry |
| DELETE | `/api/logs` | Clear in-memory logs |

## Usage Examples

### Python (OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:9680/v1", api_key="any")

# Non-streaming
response = client.chat.completions.create(
    model="qwork-auto",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)

# Streaming
for chunk in client.chat.completions.create(
    model="qwork-ultimate",
    messages=[{"role": "user", "content": "Explain quantum computing"}],
    stream=True
):
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")
```

### Node.js (OpenAI SDK)

```javascript
const { OpenAI } = require("openai");

const client = new OpenAI({ baseURL: "http://localhost:9680/v1", apiKey: "any" });

const response = await client.chat.completions.create({
  model: "qwork-auto",
  messages: [{ role: "user", content: "Hello!" }],
});
console.log(response.choices[0].message.content);
```

### cURL

```bash
# List models
curl http://localhost:9680/v1/models

# Chat completion
curl -X POST http://localhost:9680/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"qwork-auto","messages":[{"role":"user","content":"Hello!"}]}'

# Streaming
curl -X POST http://localhost:9680/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"qwork-auto","messages":[{"role":"user","content":"Hello!"}],"stream":true}'
```

### Claude Code / Cline / Other Agents

Set the API base URL to `http://localhost:9680/v1` and use any API key.

## Supported Models

| Model Key | Name | Description | Vision | Reasoning |
|-----------|------|-------------|--------|-----------|
| `qwork-auto` | Standard | Smart and efficient for everyday tasks | ✅ | ❌ |
| `qwork-ultimate` | Premium | Peak performance for complex tasks | ✅ | ✅ |
| `qmodel_latest` | Qwen3.7-Max | The most powerful Qwen model | ✅ | ✅ |
| `safety` | Enterprise | Qwen model for security compliance | ✅ | ❌ |
| `q35model_preview` | Qwen3.6-Plus | Qwen dogfooding preview | ✅ | ✅ |

> **Note**: Vision and reasoning capabilities depend on the underlying Qwen model. The gateway passes through whatever the model supports.

## Configuration

Configuration is managed via `config.js` or environment variables:

| Env Variable | Default | Description |
|---|---|---|
| `PORT` | `9680` | Gateway server port |
| `QODER_TRANSPORT_MODE` | `auto` | Transport mode: `auto`, `pipe`, `subprocess` |
| `QODER_CHAT_PIPE` | `//./pipe/qoderwork-chat` | Named Pipe endpoint |
| `QODER_ACCESS_TOKEN` | — | Override access token |
| `GATEWAY_API_KEY` | — | API key for gateway authentication (protects `/api/*`) |
| `GATEWAY_LOG_MAX_BYTES` | `10485760` (10 MB) | Log file size before rotation |
| `GATEWAY_LOG_MAX_FILES` | `5` | Max historical log files to keep |
| `GATEWAY_REQUEST_TIMEOUT` | `1800000` (30 min) | Request timeout in ms |
| `QODER_CONFIG_DIR` | `~/.qoder` | Qoder CLI config directory |
| `QODER_STORAGE_DIR` | `%APPDATA%\QoderWork` | QoderWork data directory |
| `QODER_RESOURCE_DIR` | Auto-detected | QoderWork resources directory |
| `QODER_CLI_PATH` | Auto-detected | Path to qodercli.exe |

## Transport Modes

### Auto (default)

Tries Named Pipe first (if QoderWork is running, with 30s cache + 5s connect timeout), falls back to qodercli.exe subprocess.

### Pipe

Connects to a running QoderWork instance via Windows Named Pipe. Requires QoderWork desktop app to be running. The `withPipeClient` helper performs:
1. `checkPipeConnectable()` pre-check (30s cache)
2. `client.connect()` wrapped in a 5s `Promise.race` timeout (avoids permanent blocking when the pipe is half-open)

### Subprocess

Spawns `qodercli.exe` as a subprocess. Works standalone but requires QoderWork login credentials.

## Architecture

```
┌─────────────┐     OpenAI API      ┌──────────────┐     SDK/CLI      ┌──────────────┐
│  Your App   │ ──────────────────► │ qoder-openapi│ ───────────────► │  QoderWork   │
│  / Agent    │ ◄────────────────── │  (Gateway)   │ ◄─────────────── │  LLM (Qwen)  │
└─────────────┘   OpenAI Response   └──────────────┘   SDK Messages   └──────────────┘
```

The gateway translates between OpenAI API format and QoderWork's SDK protocol:
- **Request**: OpenAI `messages[]` → SDK `prompt` string
- **Response**: SDK `stream_event` → OpenAI `chat.completion.chunk` (streaming) or `chat.completion` (non-streaming)
- **Errors**: QoderWork FORBIDDEN/UNAUTHORIZED errors are detected via `detectQoderError()` and surfaced as the correct HTTP status (403/401) instead of a generic 502. In streaming mode, an extra `_qoder_type: 'error'` SSE event is emitted before the finish chunk.

## Upstream Error Handling

When QoderWork's server rejects a request (e.g. account subscription issue), the CLI emits a synthetic assistant message containing `Qoder API error: FORBIDDEN - {"code":"112","message":"{\"pricingUrl\":\"https://qoder.com/pricing?client=qoder\"}"}`. The gateway's `converter.detectQoderError()` parses this and maps it to:

| Upstream | HTTP Status | Code | Notes |
|---|---|---|---|
| `FORBIDDEN` + code `112` | `403` | `forbidden` | Subscription required (even for `qmodel_latest`) |
| `FORBIDDEN` (other) | `403` | `upstream_forbidden` | Generic forbidden |
| `UNAUTHORIZED` | `401` | `upstream_unauthorized` | Auth required |
| Other | `502` | `upstream_error` | Generic upstream error |

> **Note**: Even the "free" `qmodel_latest` model requires an active QoderWork subscription. If you see `[上游错误 403 forbidden]`, visit https://qoder.com/pricing?client=qoder to check your account.

## Limitations

- Requires QoderWork to be installed and logged in
- Requires an active QoderWork subscription (FORBIDDEN code 112 will be returned otherwise)
- Token limits are managed by QoderWork's backend (not configurable locally)
- Tool use results are returned as text content (not structured tool_calls)
- Image/video input requires model support (`is_vl` flag)
- Browser page switching during SSE streaming causes `net::ERR_ABORTED` errors — avoid switching tabs while waiting for a response

## License

MIT
