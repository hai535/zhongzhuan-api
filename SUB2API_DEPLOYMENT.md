# Sub2API Deployment Notes

This project can be used as an Anthropic-compatible upstream for Sub2API.

## Topology

```text
Claude-compatible client
  -> Sub2API /v1/messages
  -> Kiro Anthropic Proxy /v1/messages
  -> kiro-cli chat --no-interactive
  -> Kiro backend
```

## Kiro Proxy

Create `.env` next to `server.js`:

```bash
PORT=8787
HOST=0.0.0.0
MASTER_API_KEY=change-this-inbound-key
KIRO_API_KEY=ksk_xxx
KIRO_MODEL=claude-opus-4.7
KIRO_CLI=/root/.local/bin/kiro-cli
REQUEST_TIMEOUT_MS=300000
```

Start manually:

```bash
./start.sh
```

Or install the systemd example:

```bash
cp kiro-anthropic-proxy.service.example /etc/systemd/system/kiro-anthropic-proxy.service
systemctl daemon-reload
systemctl enable --now kiro-anthropic-proxy.service
```

If Node is installed through nvm, `start.sh` will source `$HOME/.nvm/nvm.sh`
when `npm` is not already on `PATH`.

## Sub2API Docker

For Linux Docker deployments, the Sub2API container needs a route back to the
host where this proxy listens:

```yaml
services:
  sub2api:
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

If you deploy with docker-compose v1, avoid shell interpolation in the Redis
`command:` field. The local deployment uses an explicit argument list:

```yaml
services:
  redis:
    command:
      - redis-server
      - --save
      - "60"
      - "1"
      - --appendonly
      - "yes"
      - --appendfsync
      - everysec
```

The exact local Sub2API diff is also saved in
`sub2api-docker-compose.local.patch`.

Then configure the upstream account in Sub2API:

```json
{
  "name": "kiro-claude-opus-4.7",
  "platform": "anthropic",
  "type": "apikey",
  "credentials": {
    "api_key": "change-this-inbound-key",
    "base_url": "http://host.docker.internal:8787"
  },
  "extra": {
    "anthropic_passthrough": true
  },
  "concurrency": 1,
  "priority": 1
}
```

Use model `claude-opus-4-7` from clients. The proxy maps it to Kiro model
`claude-opus-4.7`.

## Validation

Direct proxy test:

```bash
curl -sS http://127.0.0.1:8787/v1/messages \
  -H "x-api-key: $MASTER_API_KEY" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"claude-opus-4-7","max_tokens":32,"messages":[{"role":"user","content":"Reply with exactly OK"}]}'
```

Sub2API test:

```bash
curl -sS http://127.0.0.1:8080/v1/messages \
  -H "x-api-key: $SUB2API_USER_KEY" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"claude-opus-4-7","max_tokens":32,"messages":[{"role":"user","content":"Reply with exactly OK"}]}'
```

If Sub2API is in standard mode and the user has no balance, requests can fail
with `INSUFFICIENT_BALANCE`. For a private internal deployment, `RUN_MODE=simple`
disables billing and quota checks.

## Caveats

- This is not a native Kiro HTTP API. Each request spawns `kiro-cli`.
- `stream: true` returns Anthropic-compatible SSE only after Kiro finishes.
- Tool use is rejected by the proxy.
- Token usage fields are placeholders.

## Claude Code Permissions Note

As of 2026-05-10, the local Claude Code configuration under `/root` has no
MCP/tool permissions granted: `allowedTools` is empty and `mcpServers` is empty
in `/root/.claude.json`. Do not assume Claude can update GitHub or use MCP
connectors from that environment unless its permissions are configured first.
