#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { compact, JevClient } from '../dist/index.js';

const execFileAsync = promisify(execFile);
const COMPACT_TOOL_NAME = 'fast_jev_compaction_compact';
const EVALUATE_TOOL_NAME = 'jev_evaluate';
const PROTOCOL_VERSION = '2024-11-05';

const compactToolDefinition = {
  name: COMPACT_TOOL_NAME,
  description:
    'Compact a supplied transcript with Jev. User and assistant text stays verbatim; stale tool calls can be removed and stale tool results can be truncated. This sends task text and tool inputs to the configured external Jev provider.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['messages', 'confirmExternalTransmission'],
    properties: {
      messages: {
        type: 'array',
        description: 'Transcript messages in fast-jev-compaction Message shape.',
        items: { type: 'object' },
      },
      confirmExternalTransmission: {
        type: 'boolean',
        description:
          'Must be true only after the user has authorised sending this transcript to the configured external Jev provider.',
      },
      goal: { type: 'string' },
      model: { type: 'string' },
      keepThreshold: { type: 'number' },
      preserveRecentMessages: { type: 'integer', minimum: 0 },
      maxStateTokens: { type: 'number', exclusiveMinimum: 0 },
      maxRequestTokens: { type: 'number', exclusiveMinimum: 0 },
      truncateHeadChars: { type: 'integer', minimum: 0 },
    },
  },
};

const evaluateToolDefinition = {
  name: EVALUATE_TOOL_NAME,
  description:
    'Evaluate JSON-serialisable state with Jev using typed noul, choice, or score questions. Useful for consistent triage, classification, scoring, and workflow decisions.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['state', 'questions', 'confirmExternalTransmission'],
    properties: {
      state: {
        description: 'The text or JSON object Jev should evaluate.',
      },
      questions: {
        type: 'object',
        minProperties: 1,
        description: 'Named Jev questions using noul, choice, or score types.',
        additionalProperties: {
          type: 'object',
          required: ['type', 'instructions'],
          properties: {
            type: { type: 'string', enum: ['noul', 'choice', 'score'] },
            instructions: { type: 'string', minLength: 1 },
            criteria: {},
          },
        },
      },
      confirmExternalTransmission: {
        type: 'boolean',
        description:
          'Must be true only after the user has authorised sending this state to the configured external Jev provider.',
      },
      model: { type: 'string' },
    },
  },
};

let cachedCloudflareAuth;

async function wranglerJson(args) {
  const command = process.env.FAST_JEV_WRANGLER_COMMAND || 'npx';
  const prefix = command.endsWith('wrangler') ? [] : ['--yes', 'wrangler'];
  const { stdout } = await execFileAsync(command, [...prefix, ...args, '--json'], {
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function resolveCloudflareAuth() {
  if (cachedCloudflareAuth) return cachedCloudflareAuth;
  let apiKey = process.env.CLOUDFLARE_API_TOKEN;
  let accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!apiKey) {
    const auth = await wranglerJson(['auth', 'token']);
    if (typeof auth.token === 'string' && auth.token) apiKey = auth.token;
  }
  if (!accountId) {
    const identity = await wranglerJson(['whoami']);
    const accounts = Array.isArray(identity.accounts) ? identity.accounts : [];
    if (accounts.length === 1 && typeof accounts[0]?.id === 'string') {
      accountId = accounts[0].id;
    } else if (accounts.length > 1) {
      throw new Error('CLOUDFLARE_ACCOUNT_ID is required when Wrangler has multiple accounts');
    }
  }
  if (!apiKey) throw new Error('Cloudflare authentication is unavailable');
  if (!accountId) throw new Error('CLOUDFLARE_ACCOUNT_ID is not configured');
  cachedCloudflareAuth = { apiKey, accountId };
  return cachedCloudflareAuth;
}

async function createClient(model) {
  const provider = process.env.FAST_JEV_PROVIDER || 'cloudflare';
  if (provider === 'typesafe') {
    if (!process.env.TYPESAFE_API_KEY) throw new Error('TYPESAFE_API_KEY is not configured');
    return new JevClient({
      provider,
      model,
      baseUrl: process.env.FAST_JEV_BASE_URL,
    });
  }
  if (provider !== 'cloudflare') throw new Error(`Unsupported FAST_JEV_PROVIDER: ${provider}`);
  const auth = await resolveCloudflareAuth();
  return new JevClient({
    provider,
    apiKey: auth.apiKey,
    accountId: auth.accountId,
    model,
    baseUrl: process.env.FAST_JEV_BASE_URL,
  });
}

let input = Buffer.alloc(0);

function send(message) {
  const body = JSON.stringify(message);
  const length = Buffer.byteLength(body, 'utf8');
  process.stdout.write(`Content-Length: ${length}\r\n\r\n${body}`);
}

function sendResult(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function safeError(error) {
  if (error instanceof Error) return error.message.slice(0, 500);
  return String(error).slice(0, 500);
}

function assertMessages(messages) {
  if (!Array.isArray(messages)) throw new Error('messages must be an array');
  for (const [index, message] of messages.entries()) {
    if (!message || typeof message !== 'object') {
      throw new Error(`messages[${index}] must be an object`);
    }
    if (message.role !== 'user' && message.role !== 'assistant') {
      throw new Error(`messages[${index}].role must be user or assistant`);
    }
    if (typeof message.text !== 'string' || !Array.isArray(message.toolUses)) {
      throw new Error(`messages[${index}] must contain text and toolUses`);
    }
    for (const [toolIndex, tool] of message.toolUses.entries()) {
      if (
        !tool ||
        typeof tool !== 'object' ||
        typeof tool.tool_use_id !== 'string' ||
        typeof tool.tool !== 'string' ||
        !tool.input ||
        typeof tool.input !== 'object'
      ) {
        throw new Error(`messages[${index}].toolUses[${toolIndex}] is invalid`);
      }
    }
    if (message.toolResults !== undefined && !Array.isArray(message.toolResults)) {
      throw new Error(`messages[${index}].toolResults must be an array`);
    }
  }
}

async function callTool(name, argumentsValue) {
  if (!argumentsValue || typeof argumentsValue !== 'object') {
    throw new Error('tool arguments are required');
  }
  if (argumentsValue.confirmExternalTransmission !== true) {
    throw new Error(
      'set confirmExternalTransmission=true only after the user authorises sending this data to the configured external Jev provider',
    );
  }
  const client = await createClient(argumentsValue.model);
  if (name === EVALUATE_TOOL_NAME) {
    if (argumentsValue.state === undefined) throw new Error('state is required');
    if (
      !argumentsValue.questions ||
      typeof argumentsValue.questions !== 'object' ||
      Array.isArray(argumentsValue.questions)
    ) {
      throw new Error('questions must be an object');
    }
    return client.ask(argumentsValue.state, argumentsValue.questions);
  }
  assertMessages(argumentsValue.messages);

  const options = {};
  for (const key of [
    'goal',
    'keepThreshold',
    'preserveRecentMessages',
    'maxStateTokens',
    'maxRequestTokens',
    'truncateHeadChars',
  ]) {
    if (argumentsValue[key] !== undefined) options[key] = argumentsValue[key];
  }
  return compact(argumentsValue.messages, client, options);
}

async function handle(message) {
  if (!message || typeof message !== 'object') return;
  const { id, method, params = {} } = message;

  if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
    return;
  }
  if (method === 'ping') {
    if (id !== undefined) sendResult(id, {});
    return;
  }
  if (method === 'initialize') {
    sendResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'fast-jev-compaction', version: '0.3.0-codex' },
    });
    return;
  }
  if (method === 'tools/list') {
    sendResult(id, { tools: [evaluateToolDefinition, compactToolDefinition] });
    return;
  }
  if (method === 'tools/call') {
    if (params.name !== COMPACT_TOOL_NAME && params.name !== EVALUATE_TOOL_NAME) {
      sendError(id, -32602, `unknown tool: ${String(params.name)}`);
      return;
    }
    try {
      const result = await callTool(params.name, params.arguments);
      const text = JSON.stringify(result);
      sendResult(id, {
        content: [{ type: 'text', text }],
        structuredContent: result,
      });
    } catch (error) {
      sendResult(id, {
        isError: true,
        content: [{ type: 'text', text: safeError(error) }],
      });
    }
    return;
  }
  if (id !== undefined) sendError(id, -32601, `method not found: ${String(method)}`);
}

function drain() {
  while (true) {
    const headerEnd = input.indexOf('\r\n\r\n');
    if (headerEnd < 0) return;
    const header = input.subarray(0, headerEnd).toString('utf8');
    const match = header.match(/^Content-Length:\s*(\d+)\s*$/im);
    if (!match) {
      input = input.subarray(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    if (input.length < bodyStart + length) return;
    const body = input.subarray(bodyStart, bodyStart + length).toString('utf8');
    input = input.subarray(bodyStart + length);
    let message;
    try {
      message = JSON.parse(body);
    } catch {
      sendError(null, -32700, 'invalid JSON');
      continue;
    }
    void handle(message).catch((error) => {
      if (message && message.id !== undefined) sendError(message.id, -32603, safeError(error));
    });
  }
}

process.stdin.on('data', (chunk) => {
  input = Buffer.concat([input, chunk]);
  drain();
});
process.stdin.on('end', () => process.exit(0));
