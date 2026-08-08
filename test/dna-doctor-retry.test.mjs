import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { createAppServer } from '../src/server.js';

function postJson(path, body) {
  const server = createAppServer({ openaiApiKey: 'test-key' });
  const handler = server.listeners('request')[0];
  const request = new EventEmitter();
  request.method = 'POST';
  request.url = path;
  request.headers = { host: '127.0.0.1' };
  request.socket = { encrypted: false };

  return new Promise((resolve, reject) => {
    const response = {
      statusCode: null,
      headers: {},
      setHeader(name, value) {
        this.headers[name] = value;
      },
      writeHead(statusCode) {
        this.statusCode = statusCode;
      },
      end(text = '') {
        resolve({
          statusCode: this.statusCode,
          body: JSON.parse(text),
        });
      },
    };

    Promise.resolve(handler(request, response)).catch(reject);
    queueMicrotask(() => {
      request.emit('data', Buffer.from(JSON.stringify(body)));
      request.emit('end');
    });
  });
}

function makeOpenAiResponse(text, overrides = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      status: 'completed',
      output: [{
        content: [{ type: 'output_text', text }],
      }],
      ...overrides,
    }),
  };
}

test('DNA Doctor retries exactly once when the first model response is invalid JSON', async () => {
  const originalFetch = globalThis.fetch;
  const fetchCalls = [];
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({ url, body: JSON.parse(options.body) });
    return fetchCalls.length === 1
      ? makeOpenAiResponse('{"score": 72')
      : makeOpenAiResponse('{"score":72,"grade":"B"}');
  };

  try {
    const result = await postJson('/api/dna-doctor', { tradeCount: 13, totalPnl: 9.6 });

    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body, { score: 72, grade: 'B' });
    assert.equal(fetchCalls.length, 2, 'Invalid JSON should trigger exactly one retry.');
    assert.deepEqual(fetchCalls[1].body.input[1], fetchCalls[0].body.input[1], 'Retry should reuse the exact same user payload prompt.');
    assert.equal(fetchCalls[1].body.model, fetchCalls[0].body.model, 'Retry should keep the same model.');
    assert.equal(fetchCalls[1].body.text.format.type, 'json_object', 'Retry should keep the same response format.');
    assert.ok(fetchCalls[1].body.input[0].content.includes('return valid JSON only'), 'Retry should add the stricter JSON-only instruction.');
    assert.ok(fetchCalls[1].body.input[0].content.includes('Match the existing schema exactly'), 'Retry should require the existing schema.');
    assert.ok(fetchCalls[1].body.input[0].content.includes('Do not include markdown or extra text'), 'Retry should ban markdown and extra text.');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('DNA Doctor preserves 502 behavior when the retry is also empty or invalid', async () => {
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  const fetchCalls = [];
  const diagnosticLogs = [];
  const incompleteSummaries = [];
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({ url, body: JSON.parse(options.body) });
    return makeOpenAiResponse('', {
      status: 'incomplete',
      incomplete_details: { reason: 'max_tokens' },
      usage: { input_tokens: 1200, output_tokens: 2048, total_tokens: 3248 },
      error: null,
      output: [{ type: 'message', status: 'incomplete', content: [] }],
    });
  };
  console.error = (...args) => {
    if (args[0] === '[DNA Doctor] OpenAI response diagnostic:') {
      diagnosticLogs.push(args[1]);
    }
  };
  console.warn = (...args) => {
    if (typeof args[0] === 'string' && args[0].startsWith('[DNA Doctor] Incomplete summary |')) {
      incompleteSummaries.push(args[0]);
    }
  };

  try {
    const result = await postJson('/api/dna-doctor', { tradeCount: 13, totalPnl: 9.6 });

    assert.equal(result.statusCode, 502);
    assert.equal(fetchCalls.length, 2, 'Empty model output should retry exactly once.');
    assert.match(result.body.error, /Claude returned invalid JSON: Unexpected end of JSON input/);
    assert.equal(result.body.rawResponse, '');
    assert.equal(incompleteSummaries.length, 2, 'Each incomplete response should log one readable summary line.');
    assert.equal(
      incompleteSummaries[0],
      '[DNA Doctor] Incomplete summary | status=incomplete | reason=max_tokens | inputTokens=1200 | outputTokens=2048 | totalTokens=3248 | outputLength=0 | attempt=1'
    );
    assert.equal(diagnosticLogs.length, 2, 'Each failed attempt should log safe response diagnostics.');
    assert.deepEqual(diagnosticLogs[0], {
      attempt: 1,
      failureReason: 'empty_output',
      httpStatus: null,
      responseStatus: 'incomplete',
      incompleteDetails: { reason: 'max_tokens' },
      usage: { input_tokens: 1200, output_tokens: 2048, total_tokens: 3248 },
      error: null,
      outputTextLength: 0,
      outputItemTypes: [{ type: 'message', status: 'incomplete', contentTypes: [] }],
    });
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
  }
});
