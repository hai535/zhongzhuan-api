# Kiro Anthropic Proxy

Minimal Anthropic-compatible adapter for Kiro CLI headless mode.

It accepts `POST /v1/messages`, validates an inbound bearer key, calls:

```bash
kiro-cli chat --model claude-opus-4.7 --no-interactive "$PROMPT"
```

and wraps the output as an Anthropic message response.

## Run

```bash
cd /root/kiro-anthropic-proxy
export MASTER_API_KEY="your-inbound-master-key"
export KIRO_API_KEY="ksk_xxx"
export KIRO_MODEL="claude-opus-4.7"
npm start
```

## Client Env

```json
{
  "env": {
    "ANTHROPIC_API_KEY": "your-inbound-master-key",
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:8787",
    "ANTHROPIC_MODEL": "claude-opus-4-7"
  }
}
```

## Test

```bash
curl -sS http://127.0.0.1:8787/v1/messages \
  -H "Authorization: Bearer $MASTER_API_KEY" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-opus-4-7",
    "max_tokens": 32,
    "messages": [{"role": "user", "content": "Reply with exactly OK"}]
  }'
```

## Supported

- `POST /v1/messages`
- `GET /v1/models`
- `GET /health`
- non-streaming responses
- fake SSE for `stream: true` after the full Kiro response is ready
- text content blocks
- basic model mapping such as `claude-opus-4-7` -> `claude-opus-4.7`

## Not Supported

- native Anthropic tool use
- true token streaming from Kiro CLI
- accurate Anthropic usage token accounting
- image inputs
- long-lived Kiro sessions
