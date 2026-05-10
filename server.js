#!/usr/bin/env node
'use strict';

const http = require('http');
const { spawn } = require('child_process');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const MASTER_API_KEY = process.env.MASTER_API_KEY || '';
const KIRO_API_KEY = process.env.KIRO_API_KEY || '';
const KIRO_CLI = process.env.KIRO_CLI || '/root/.local/bin/kiro-cli';
const DEFAULT_KIRO_MODEL = process.env.KIRO_MODEL || 'auto';
const KIRO_TRUST_TOOLS = process.env.KIRO_TRUST_TOOLS || '';
const KIRO_WORKDIR = process.env.KIRO_WORKDIR || '';
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 300000);
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 2 * 1024 * 1024);

const MODEL_MAP = new Map([
  ['claude-opus-4-7', 'auto'],
  ['claude-opus-4.7', 'auto'],
  ['claude-opus-4-6', 'auto'],
  ['claude-opus-4.6', 'auto'],
  ['claude-sonnet-4-6', 'auto'],
  ['claude-sonnet-4.6', 'auto'],
  ['claude-sonnet-4-5', 'auto'],
  ['claude-sonnet-4.5', 'auto'],
  ['claude-haiku-4-5', 'auto'],
  ['claude-haiku-4.5', 'auto'],
  ['auto', 'auto'],
]);

function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function sendError(res, status, type, message) {
  sendJson(res, status, {
    type: 'error',
    error: { type, message },
  });
}

function constantTimeEqual(a, b) {
  if (!a || !b) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function requireAuth(req, res) {
  if (!MASTER_API_KEY) {
    sendError(res, 500, 'configuration_error', 'MASTER_API_KEY is not configured');
    return false;
  }

  const auth = req.headers.authorization || '';
  const bearerToken = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
  const token = bearerToken || req.headers['x-api-key'] || '';
  if (!constantTimeEqual(token, MASTER_API_KEY)) {
    sendError(res, 401, 'authentication_error', 'Invalid API key');
    return false;
  }
  return true;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(Object.assign(new Error('Invalid JSON body'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((part) => {
      if (!part) return '';
      if (typeof part === 'string') return part;
      if (part.type === 'text') return part.text || '';
      if (part.type === 'image') return '[Image input omitted: Kiro CLI proxy currently supports text only]';
      if (part.type === 'tool_result') return `[Tool result]\n${part.content || ''}`;
      return `[Unsupported content block: ${part.type || 'unknown'}]`;
    })
    .filter(Boolean)
    .join('\n');
}

function buildPrompt(body) {
  const parts = [];

  const system = textFromContent(body.system);
  if (system) {
    parts.push(`System instructions:\n${system}`);
  }

  if (Array.isArray(body.tools) && body.tools.length > 0) {
    const toolNames = body.tools
      .map((tool) => tool && tool.name)
      .filter(Boolean)
      .join(', ');
    if (toolNames) {
      parts.push(
        `Client declared tools (${toolNames}), but this Kiro CLI proxy cannot execute tool calls. ` +
          'Answer with normal text only and do not request tool use.'
      );
    }
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw Object.assign(new Error('messages must be a non-empty array'), { status: 400 });
  }

  for (const message of body.messages) {
    const role = message.role === 'assistant' ? 'Assistant' : 'User';
    const text = textFromContent(message.content);
    if (text) parts.push(`${role}:\n${text}`);
  }

  parts.push('Assistant:');
  return parts.join('\n\n');
}

function stripAnsi(text) {
  const cleaned = text
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, '')
    .replace(/^\s*WARNING: Failed to retrieve MCP settings; MCP functionality disabled\s*/m, '')
    .replace(/\n\s*\S?\s*Credits:.*$/m, '')
    .trim();

  return cleaned.replace(/^>\s?/, '').trim();
}

function resolveKiroModel(model) {
  if (!model) return DEFAULT_KIRO_MODEL;
  return MODEL_MAP.get(model) || model;
}

function buildKiroArgs(prompt, kiroModel) {
  const args = ['chat', '--model', kiroModel, '--no-interactive'];

  if (KIRO_TRUST_TOOLS === '*') {
    args.push('--trust-all-tools');
  } else if (KIRO_TRUST_TOOLS) {
    args.push(`--trust-tools=${KIRO_TRUST_TOOLS}`);
  }

  args.push(prompt);
  return args;
}

function runKiro(prompt, kiroModel) {
  return new Promise((resolve, reject) => {
    if (!KIRO_API_KEY) {
      reject(Object.assign(new Error('KIRO_API_KEY is not configured'), { status: 500 }));
      return;
    }

    const child = spawn(KIRO_CLI, buildKiroArgs(prompt, kiroModel), {
      cwd: KIRO_WORKDIR || undefined,
      env: {
        ...process.env,
        KIRO_API_KEY,
        NO_COLOR: '1',
        KIRO_LOG_NO_COLOR: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(Object.assign(new Error('Kiro CLI request timed out'), { status: 504 }));
    }, REQUEST_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(Object.assign(err, { status: 502 }));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const detail = stripAnsi(stderr || stdout) || `kiro-cli exited with code ${code}`;
        reject(Object.assign(new Error(detail), { status: 502 }));
        return;
      }
      resolve(stripAnsi(stdout));
    });
  });
}

function anthropicResponse(model, text) {
  return {
    id: `msg_${crypto.randomBytes(12).toString('hex')}`,
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
    },
  };
}

function sendSse(res, model, text) {
  const id = `msg_${crypto.randomBytes(12).toString('hex')}`;
  const writeEvent = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });

  writeEvent('message_start', {
    type: 'message_start',
    message: {
      id,
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  });
  writeEvent('content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  });
  writeEvent('content_block_delta', {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text },
  });
  writeEvent('content_block_stop', {
    type: 'content_block_stop',
    index: 0,
  });
  writeEvent('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 0 },
  });
  writeEvent('message_stop', { type: 'message_stop' });
  res.end();
}

async function handleMessages(req, res) {
  if (!requireAuth(req, res)) return;

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendError(res, err.status || 400, 'invalid_request_error', err.message);
    return;
  }

  let prompt;
  try {
    prompt = buildPrompt(body);
  } catch (err) {
    sendError(res, err.status || 400, 'invalid_request_error', err.message);
    return;
  }

  const requestedModel = body.model || 'claude-opus-4-7';
  const kiroModel = resolveKiroModel(requestedModel);

  try {
    const text = await runKiro(prompt, kiroModel);
    if (body.stream) {
      sendSse(res, requestedModel, text);
    } else {
      sendJson(res, 200, anthropicResponse(requestedModel, text));
    }
  } catch (err) {
    sendError(res, err.status || 502, 'api_error', err.message);
  }
}

function handleModels(req, res) {
  if (!requireAuth(req, res)) return;
  sendJson(res, 200, {
    data: [
      { id: 'claude-opus-4-7', type: 'model', display_name: 'Kiro Claude Opus 4.7' },
      { id: 'claude-opus-4-6', type: 'model', display_name: 'Kiro Claude Opus 4.6' },
      { id: 'claude-sonnet-4-6', type: 'model', display_name: 'Kiro Claude Sonnet 4.6' },
      { id: 'auto', type: 'model', display_name: 'Kiro Auto' },
    ],
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/v1/models') {
    handleModels(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/v1/messages') {
    handleMessages(req, res);
    return;
  }

  sendError(res, 404, 'not_found_error', 'Not found');
});

server.listen(PORT, HOST, () => {
  console.log(`kiro-anthropic-proxy listening on http://${HOST}:${PORT}`);
});
