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
  assert.ok(prompt.includes('Blend the facts naturally into your coaching. Never label sentences as "Fact", "Opinion", or "Recommendation".'), 'Facts should be blended naturally into the coaching.');
  assert.ok(prompt.includes('Base every conclusion on evidence from the trading journal.'), 'Every conclusion must be evidence-based.');
  assert.ok(prompt.includes('Match the strength of the language to the strength of the evidence.'), 'Language strength should scale with evidence strength.');
  assert.ok(prompt.includes('A single mistake should receive a gentle suggestion.'), 'A single mistake gets a gentle suggestion, not a warning.');
  assert.ok(prompt.includes('A repeated pattern should receive a clear warning.'), 'A repeated pattern gets a clear warning.');
  assert.ok(prompt.includes('A long-term, statistically proven weakness should receive a firm recommendation to change.'), 'A proven long-term weakness gets a firm recommendation.');
  assert.ok(prompt.includes('Do not recommend stopping or avoiding a setup, session, or trading style from one day or one short WTD sample alone.'), 'Short-term samples should not trigger stop/avoid recommendations.');
  assert.ok(prompt.includes('Short-term poor performance should be described as something to watch, review, or be more selective with.'), 'Short-term weakness should be framed cautiously.');
  assert.ok(prompt.includes('Strong recommendations to stop or avoid require a meaningful repeated pattern supported by enough data.'), 'Strong stop/avoid recommendations should require enough repeated evidence.');
  assert.ok(prompt.includes('Recognize good decisions, even when the trade loses.'), 'Good decisions should be credited even on losing trades.');
  assert.ok(prompt.includes('Never exaggerate or invent certainty.'), 'The coach must never overstate certainty.');
  assert.ok(prompt.includes('Every string field must be concise and no more than 1 sentence.'), 'Every string field should be capped at one concise sentence.');
  assert.ok(prompt.includes('strengths and prescription must each contain exactly 3 short items.'), 'Strengths and prescription should keep the target three-item structure.');
  assert.ok(prompt.includes('Each array item must be one short sentence.'), 'Array items should be short one-sentence items.');
  assert.ok(prompt.includes('Focus on improving the next trade, not criticizing the last one.'), 'The focus should be forward-looking, not blame-focused.');
  assert.ok(prompt.includes('Best Trade and Worst Trade must consider process and execution, not only P&L.'), 'Best/Worst Trade should consider execution, not only P&L.');
  assert.ok(prompt.includes('Describe Best Trade and Worst Trade as best/worst by available data unless notes, grade, or tradeManagement clearly support a stronger conclusion.'), 'Best/Worst Trade should not overstate available evidence.');
  assert.ok(prompt.includes('Do not call a trade high-quality or poor-quality from P&L alone.'), 'Best/Worst Trade should not infer quality from P&L alone.');
  assert.ok(prompt.includes('Do not infer execution quality without supporting journal data.'), 'Best/Worst Trade should not infer execution quality without journal evidence.');
  assert.ok(prompt.includes('If the trade data is not enough to support a clear Best Trade or Worst Trade, say that instead of inventing one.'), 'Best/Worst Trade should acknowledge unclear data.');
  assert.ok(prompt.includes('If protection data is missing or unavailable, say "no documented protection data".'), 'Missing protection data should be described accurately.');
  assert.ok(prompt.includes('Do not treat missing protected fields as confirmed 0% protected behavior.'), 'Missing protected fields should not be treated as confirmed behavior.');
  assert.ok(prompt.includes('Use notes, emotion, tradeManagement, closeReason, and lossReason only when those fields are present to inform behavior and discipline analysis.'), 'Behavior analysis should use existing journal context only when present.');
  assert.ok(prompt.includes('Psychology Review must use only supported evidence from the trade data. If the data is insufficient, say so clearly.'), 'Psychology Review should be evidence-based and clear when data is insufficient.');
  assert.ok(prompt.includes('Do not infer focus, emotion, or discipline from session performance alone.'), 'Psychology Review should not infer mindset from session performance alone.');
  assert.ok(prompt.includes('Follow this report structure: Overall Grade, Biggest Strength, Biggest Weakness, Best Trade, Worst Trade, Risk Review, Psychology Review, Three Things Done Well, Three Improvements, Goal for Tomorrow, Quote of the Day.'), 'Prompt should request the Aug 7 report structure.');
  assert.ok(prompt.includes('Keep language simple, calm, direct, neutral, and professional.'), 'Prompt should keep the report language calm and professional.');
  assert.ok(prompt.includes('Process and discipline matter more than P&L alone.'), 'Prompt should prioritize process and discipline.');
  assert.ok(prompt.includes('Overall Grade Scoring'), 'Prompt should include explicit Overall Grade scoring guidance.');
  assert.ok(prompt.includes('Grade the trading process first, then the financial result.'), 'Overall Grade should prioritize process before outcome.');
  assert.ok(prompt.includes('Risk control, selectivity, rule-following, execution, and behavior matter more than net P&L.'), 'Overall Grade should weigh process factors more than net P&L.');
  assert.ok(prompt.includes('A profitable day with poor process, weak discipline, oversized risk, or broken rules can receive a low grade.'), 'Profitable bad-process days can receive low grades.');
  assert.ok(prompt.includes('A losing day with strong discipline, clean execution, controlled risk, and good rule-following can receive a high grade.'), 'Losing disciplined days can receive high grades.');
  assert.ok(prompt.includes('Do not reward profit that came from bad habits, and do not punish a controlled loss when the trader followed the plan.'), 'Prompt should separate good process from P&L outcome.');
  assert.ok(prompt.includes('Goal/quote style example: "The goal isn\'t to trade more. It\'s to need fewer trades."'), 'Prompt should include the requested calm goal/quote style example.');
  assert.ok(prompt.includes('Tomorrow\'s Focus must always be one practical behavior goal based on the clearest issue from that day\'s data. Keep it short and specific. Never make it primarily a profit target.'), 'Tomorrow focus guidance should be behavior-based and specific.');

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
  assert.ok(prompt.includes('"scoreExplanation": "string"'), 'The score explanation field must be unchanged.');
  assert.ok(prompt.includes('"diagnosis": "string"'), 'The diagnosis field must be unchanged.');
  assert.ok(prompt.includes('"biggestStrength": "Short plain-language summary using only supported trade data"'), 'The biggestStrength field should be present.');
  assert.ok(prompt.includes('"biggestWeakness": "Short plain-language summary using only supported trade data"'), 'The biggestWeakness field should be present.');
  assert.ok(prompt.includes('"bestTrade": "Short plain-language summary using only available trade data"'), 'The bestTrade field should be present.');
  assert.ok(prompt.includes('"worstTrade": "Short plain-language summary using only available trade data"'), 'The worstTrade field should be present.');
  assert.ok(prompt.includes('"riskReview": "Short plain-language risk review using only supported trade data, or a clear insufficient-data statement"'), 'The riskReview field should be present.');
  assert.ok(prompt.includes('"psychologyReview": "Short plain-language behavior and discipline review using only supported trade data, or a clear insufficient-data statement"'), 'The psychologyReview field should be present.');
  assert.ok(prompt.includes('"strengths": ["Exactly 3 short items, one short sentence each"]'), 'The strengths field should require exactly 3 short items.');
  assert.ok(prompt.includes('"weaknesses": ["Maximum 3 concise bullet points"]'), 'The weaknesses field must be unchanged.');
  assert.ok(prompt.includes('"prescription": ["Exactly 3 short items, one short sentence each"]'), 'The prescription field should require exactly 3 short items.');
  assert.ok(prompt.includes('"tomorrowsFocus": "One sentence starting with \'Tomorrow,\' followed by exactly one practical behavior goal based on the clearest issue from that day\'s data. Keep it short and specific. Do not make it primarily a profit target."'), 'The tomorrow focus field should require one behavior goal.');
  assert.ok(prompt.includes('"quoteOfDay": "One short original coaching line connected to today\'s main lesson. Keep it simple and memorable. No clichés, fake inspiration, or unsupported claims."'), 'The quoteOfDay field should require an original lesson-linked line.');
});
