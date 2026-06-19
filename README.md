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

## Prerequisites

- [QoderWork](https://qoder.com) desktop app installed and **logged in**
- Node.js >= 18

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

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/status` | QoderWork login status & config |
| GET | `/v1/models` | List available models |
| GET | `/v1/models/:model` | Get model details |
| POST | `/v1/chat/completions` | Chat completion (streaming & non-streaming) |

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
| `GATEWAY_API_KEY` | — | API key for gateway authentication |
| `QODER_STORAGE_DIR` | `%APPDATA%\QoderWork` | QoderWork data directory |
| `QODER_RESOURCE_DIR` | Auto-detected | QoderWork resources directory |
| `QODER_CLI_PATH` | Auto-detected | Path to qodercli.exe |

## Transport Modes

### Auto (default)
Tries Named Pipe first (if QoderWork is running), falls back to qodercli.exe subprocess.

### Pipe
Connects to a running QoderWork instance via Windows Named Pipe. Requires QoderWork desktop app to be running.

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

## Limitations

- Requires QoderWork to be installed and logged in
- Token limits are managed by QoderWork's backend (not configurable locally)
- Tool use results are returned as text content (not structured tool_calls)
- Image/video input requires model support (`is_vl` flag)

## License

MIT
