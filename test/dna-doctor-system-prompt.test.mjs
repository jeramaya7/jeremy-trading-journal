import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Guards the DNA Doctor system prompt (src/server.js). This is a pure
// communication-style change: the coaching tone should update, but the
// data-honesty rules, grading scale, and JSON response schema must not.

const source = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');

function extractSystemPrompt() {
  const marker = 'const systemPrompt = `';
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, 'Expected to find the DNA Doctor systemPrompt in src/server.js');
  const contentStart = start + marker.length;
  const end = source.indexOf('`;', contentStart);
  assert.notEqual(end, -1, 'Expected the systemPrompt template literal to close.');
  return source.slice(contentStart, end);
}

test('the DNA Doctor system prompt uses the new evidence-based coaching style', () => {
  const prompt = extractSystemPrompt();

  assert.ok(prompt.includes('Communication Style'), 'The system prompt should include a Communication Style section.');
  assert.ok(prompt.includes('Speak like a professional trading coach.'), 'Tone should be a professional trading coach.');
  assert.ok(prompt.includes('Use simple English with the vocabulary of a typical 15-year-old.'), 'Vocabulary should be simple, not jargon-heavy.');
  assert.ok(prompt.includes('State the facts before giving opinions.'), 'Facts must come before opinions.');
  assert.ok(prompt.includes('Base every conclusion on evidence from the trading journal.'), 'Every conclusion must be evidence-based.');
  assert.ok(prompt.includes('Match the strength of the language to the strength of the evidence.'), 'Language strength should scale with evidence strength.');
  assert.ok(prompt.includes('A single mistake should receive a gentle suggestion.'), 'A single mistake gets a gentle suggestion, not a warning.');
  assert.ok(prompt.includes('A repeated pattern should receive a clear warning.'), 'A repeated pattern gets a clear warning.');
  assert.ok(prompt.includes('A long-term, statistically proven weakness should receive a firm recommendation to change.'), 'A proven long-term weakness gets a firm recommendation.');
  assert.ok(prompt.includes('Recognize good decisions, even when the trade loses.'), 'Good decisions should be credited even on losing trades.');
  assert.ok(prompt.includes('Never exaggerate or invent certainty.'), 'The coach must never overstate certainty.');
  assert.ok(prompt.includes('Focus on improving the next trade, not criticizing the last one.'), 'The focus should be forward-looking, not blame-focused.');

  // Old brief style instruction should be fully replaced, not left alongside the new one.
  assert.equal(prompt.includes('Write in professional language. Be direct and specific. Avoid generic advice.'), false, 'The old one-line style instruction should be removed, not just supplemented.');
});

test('data-honesty rules are unchanged: never invent data, and say so when trade count is low', () => {
  const prompt = extractSystemPrompt();

  assert.ok(prompt.includes('Produce a concise, honest, data-driven trading diagnosis based ONLY on the statistics provided.'), 'The diagnosis must still be based only on the provided statistics.');
  assert.ok(prompt.includes('Never invent data. Never hallucinate.'), 'The no-hallucination rule must be unchanged.');
  assert.ok(prompt.includes('If data is missing or fewer than 10 trades exist, say so explicitly.'), 'The low-sample-size disclosure rule must be unchanged.');
});

test('the JSON response schema and grading scale are unchanged', () => {
  const prompt = extractSystemPrompt();

  assert.ok(prompt.includes('Respond ONLY with valid JSON matching this exact schema — no markdown, no explanation outside the JSON:'), 'The JSON-only response instruction must be unchanged.');
  assert.ok(prompt.includes('"score": number (0-100)'), 'The 0-100 score field must be unchanged.');
  assert.ok(prompt.includes('"grade": "string (A+/A/B+/B/C+/C/D/F)"'), 'The A+ through F grading scale must be unchanged.');
  assert.ok(prompt.includes('"scoreExplanation": "string — 1-2 sentences explaining the score"'), 'The score explanation field must be unchanged.');
  assert.ok(prompt.includes('"diagnosis": "string — 2-4 sentence summary of this trader"'), 'The diagnosis field must be unchanged.');
  assert.ok(prompt.includes('"strengths": ["string"]'), 'The strengths field must be unchanged.');
  assert.ok(prompt.includes('"weaknesses": ["string"]'), 'The weaknesses field must be unchanged.');
  assert.ok(prompt.includes('"prescription": ["string"]'), 'The prescription field must be unchanged.');
  assert.ok(prompt.includes('"riskFactors": ["string"]'), 'The riskFactors field must be unchanged.');
});
