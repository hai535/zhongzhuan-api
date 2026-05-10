# Kiro Anthropic Proxy

Minimal Anthropic-compatible adapter for Kiro CLI headless mode.

It accepts `POST /v1/messages`, validates an inbound key from either
`Authorization: Bearer ...` or `x-api-key`, calls:

```bash
kiro-cli chat --model auto --no-interactive "$PROMPT"
```

and wraps the output as an Anthropic message response.

## Run

```bash
cd /root/kiro-anthropic-proxy
export MASTER_API_KEY="your-inbound-master-key"
export KIRO_API_KEY="ksk_xxx"
export KIRO_MODEL="auto"
export KIRO_TRUST_TOOLS="fs_read,fs_write"
export KIRO_WORKDIR="/root"
npm start
```

`KIRO_TRUST_TOOLS` is passed to `kiro-cli chat --trust-tools=...`. Set it to
`fs_read,fs_write` to allow local file reads and writes, or `*` to pass
`--trust-all-tools`.

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

## Sub2API Upstream

Use this proxy as an Anthropic API-key upstream in Sub2API:

```json
{
  "name": "kiro-claude-opus-4.7",
  "platform": "anthropic",
  "type": "apikey",
  "credentials": {
    "api_key": "your-inbound-master-key",
    "base_url": "http://host.docker.internal:8787"
  },
  "extra": {
    "anthropic_passthrough": true
  },
  "concurrency": 1,
  "priority": 1
}
```

When Sub2API runs in Docker on Linux, add this to the Sub2API service so
`host.docker.internal` resolves to the host:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
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
- inbound auth via `Authorization: Bearer ...` or `x-api-key`
- basic model mapping such as `claude-opus-4-7` -> Kiro `auto`
- Kiro CLI local file access when `KIRO_TRUST_TOOLS` is configured

## Not Supported

- native Anthropic tool use executed by this proxy
- true token streaming from Kiro CLI
- accurate Anthropic usage token accounting
- image inputs
- long-lived Kiro sessions
