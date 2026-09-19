#!/usr/bin/env node

import { compact, JevClient } from '../dist/index.js';

const TOOL_NAME = 'fast_jev_compaction_compact';
const PROTOCOL_VERSION = '2024-11-05';

const toolDefinition = {
  name: TOOL_NAME,
  description:
    'Compact a supplied transcript with TypeSafe Jev. User and assistant text stays verbatim; stale tool calls can be removed and stale tool results can be truncated. This sends task text and tool inputs to the configured external Jev endpoint.',
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
          'Must be true only after the user has authorised sending this transcript to TypeSafe Jev.',
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

async function callTool(argumentsValue) {
  if (!argumentsValue || typeof argumentsValue !== 'object') {
    throw new Error('tool arguments are required');
  }
  if (argumentsValue.confirmExternalTransmission !== true) {
    throw new Error(
      'set confirmExternalTransmission=true only after the user authorises sending this transcript to TypeSafe Jev',
    );
  }
  if (!process.env.TYPESAFE_API_KEY) {
    throw new Error('TYPESAFE_API_KEY is not configured');
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
  const client = new JevClient({
    model: argumentsValue.model,
    baseUrl: process.env.FAST_JEV_BASE_URL,
  });
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
    sendResult(id, { tools: [toolDefinition] });
    return;
  }
  if (method === 'tools/call') {
    if (params.name !== TOOL_NAME) {
      sendError(id, -32602, `unknown tool: ${String(params.name)}`);
      return;
    }
    try {
      const result = await callTool(params.arguments);
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
