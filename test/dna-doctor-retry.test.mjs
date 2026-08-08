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

function makeOpenAiResponse(text) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      status: 'completed',
      output: [{
        content: [{ type: 'output_text', text }],
      }],
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
  const fetchCalls = [];
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({ url, body: JSON.parse(options.body) });
    return makeOpenAiResponse('');
  };

  try {
    const result = await postJson('/api/dna-doctor', { tradeCount: 13, totalPnl: 9.6 });

    assert.equal(result.statusCode, 502);
    assert.equal(fetchCalls.length, 2, 'Empty model output should retry exactly once.');
    assert.match(result.body.error, /Claude returned invalid JSON: Unexpected end of JSON input/);
    assert.equal(result.body.rawResponse, '');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
