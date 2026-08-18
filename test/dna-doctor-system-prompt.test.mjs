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
  assert.ok(prompt.includes('Profitability is the objective. Risk management keeps the trader alive long enough to achieve it.'), 'Prompt should use the profitability-first philosophy.');
  assert.ok(prompt.includes('Overall Grade Scoring'), 'Prompt should include explicit Overall Grade scoring guidance.');
  assert.ok(prompt.includes('Grade the quality of trading performance, not the absolute number of dollars earned.'), 'Overall Grade should judge performance quality, not absolute dollars.');
  assert.ok(prompt.includes('A small-position trader can have an excellent day with small dollar profit, and a large-position trader can make large dollars while trading badly.'), 'Small dollar profit should not imply weak trading quality.');
  assert.ok(prompt.includes('First ask: are we making money consistently? Judge primarily from Net P/L and Profit Factor.'), 'Doctor should judge primarily from Net P/L and Profit Factor.');
  assert.ok(prompt.includes('Never judge a trading metric as good or bad in isolation; evaluate how Net P/L, Profit Factor, Win Rate, Average Winner, Average Loser, Biggest Winner, Biggest Loser, trade count, and setup or market state performance combine to affect realized profitability and account risk.'), 'Trading metrics should be judged together.');
  assert.ok(prompt.includes('Profit Factor is especially important because it already captures the relationship between gross profits and gross losses.'), 'Profit Factor should anchor combined win/loss evaluation.');
  assert.ok(prompt.includes('Average Loser greater than Average Winner, low Average Winner, high Win Rate, large recorded risk, Protected %, trail-stop use, and defensive management are not automatically good or bad by themselves.'), 'Individual metrics should not be judged in isolation.');
  assert.ok(prompt.includes('Do not require Average Winner to exceed Average Loser, and do not call Average Loser greater than Average Winner a weakness unless the combined Win Rate, Profit Factor, and realized results show that it is damaging profitability.'), 'Average Loser greater than Average Winner should require combined-data evidence before criticism.');
  assert.ok(prompt.includes('A high-win-rate system can be excellent with smaller average winners than average losers.'), 'High-win-rate systems may work with smaller winners.');
  assert.ok(prompt.includes('Net P/L direction matters, but absolute dollar size must not determine trading quality unless account-capital or position-size context supports that conclusion.'), 'Absolute P/L size should not drive trading quality.');
  assert.ok(prompt.includes('Do not call positive P/L tiny, negligible, too small, or not meaningful only because the dollar amount is numerically small.'), 'Positive P/L should not be dismissed as tiny without context.');
  assert.ok(prompt.includes('Do not downgrade a profitable period because the trader used small position sizes, and do not infer the strategy cannot scale from absolute dollar P/L.'), 'Small position size should not downgrade a profitable period.');
  assert.ok(prompt.includes('A profitable trading style with many small winners is acceptable when Net P/L and Profit Factor show that it works.'), 'Many small winners should be acceptable when profitability metrics work.');
  assert.ok(prompt.includes('For a period with positive Net P/L, very strong Profit Factor, high Win Rate, and controlled realized losses, recognize the period as strong.'), 'Strong profitable periods should be recognized.');
  assert.ok(prompt.includes('Biggest Issue / Observation must identify a material problem demonstrated by the combined data; do not select a metric just because it is the least attractive number.'), 'Biggest Issue / Observation should not pick the weakest-looking isolated metric.');
  assert.ok(prompt.includes('If no material issue is demonstrated, say "No major issue identified in this sample."'), 'Biggest Issue / Observation should allow no major issue.');
  assert.ok(prompt.includes('A neutral observation may follow, but it must not be presented as a failure or reason to change the trading method.'), 'Neutral observations should not be framed as failures.');
  assert.ok(prompt.includes('Biggest Weakness must be supported by meaningful evidence from the combined realized results.'), 'Biggest Weakness should require combined realized evidence.');
  assert.ok(prompt.includes('If Net P/L is positive, Profit Factor is strong, realized losses are controlled, and no repeated damaging behavior is evident, say no major weakness is evident in this sample.'), 'Biggest Weakness should allow no major weakness when combined data is strong.');
  assert.ok(prompt.includes('Risk management matters when realized losses, sizing behavior, drawdown, or repeated exposure protects or threatens the ability to stay profitable.'), 'Risk should be tied to realized danger and profitability.');
  assert.ok(prompt.includes('Do not automatically reward lower risk, more protected trades, smaller position sizes, or defensive trade management.'), 'Defensive behavior should not be automatically rewarded.');
  assert.ok(prompt.includes('Recommendations must solve a demonstrated problem; if performance is strong, valid recommendations include repeating what worked, maintaining execution, collecting more data, or monitoring a supported weaker setup before changing it.'), 'Recommendations should not manufacture optimization.');
  assert.ok(prompt.includes('Do not recommend increasing average winners, reducing average losers, holding trades longer, higher targets, tighter stops, wider stops, more protection, mandatory stops, smaller or larger size, different exits, or increasing R unless the combined realized data shows the change is needed.'), 'Management changes should require combined realized evidence.');
  assert.ok(prompt.includes('Do not make Return % a primary Doctor metric.'), 'Return % should not be a primary Doctor metric.');
  assert.equal(prompt.includes('Capital Efficiency'), false, 'Capital Efficiency should not appear in the Doctor system prompt.');
  assert.equal(prompt.includes('CE '), false, 'CE should not appear in the Doctor system prompt.');
  assert.ok(prompt.includes('Risk Review'), 'Prompt should include Risk Review guidance.');
  assert.ok(prompt.includes('Flag abnormally large realized losses, losses disproportionate to normal winners, dangerous increases in position size or risk, and behavior that materially threatens the account.'), 'Risk Review should flag account-threatening realized risk.');
  assert.ok(prompt.includes('Distinguish potential risk from realized loss. A large recorded risk may be something to watch, but do not call it account-threatening unless actual losses, sizing behavior, drawdown, or repeated exposure supports that conclusion.'), 'Risk Review should separate theoretical risk from realized danger.');
  assert.ok(prompt.includes('Do not compare Average Winner to Average Risk as a measure of trading quality, and do not infer fragile profits only because recorded risk is larger than Average Winner.'), 'Average Winner should not be judged against Average Risk as quality.');
  assert.ok(prompt.includes('Do not recommend tighter stops, more protected trades, smaller position sizes, or more defensive management unless realized losses or repeated dangerous sizing show it is needed.'), 'Risk recommendations should require realized loss or repeated dangerous sizing evidence.');
  assert.ok(prompt.includes('Goal/quote style example: "The goal isn\'t to trade more. It\'s to need fewer trades."'), 'Prompt should include the requested calm goal/quote style example.');
  assert.ok(prompt.includes('Tomorrow\'s Focus must always be one practical behavior goal based on the clearest lesson or demonstrated issue from that day\'s data. If no material problem is shown, the goal can be to repeat the process that produced the strong results. Keep it short and specific. Never make it primarily a profit target.'), 'Tomorrow focus guidance should support repeating strong process when no material problem is shown.');

  // Old brief style instruction should be fully replaced, not left alongside the new one.
  assert.equal(prompt.includes('Write in professional language. Be direct and specific. Avoid generic advice.'), false, 'The old one-line style instruction should be removed, not just supplemented.');
  assert.equal(prompt.includes('Process and discipline matter more than P&L alone.'), false, 'The old process-first philosophy should be replaced.');
  assert.equal(prompt.includes('Grade the trading process first, then the financial result.'), false, 'Old process-first grading should be removed.');
  assert.equal(prompt.includes('Risk control, selectivity, rule-following, execution, and behavior matter more than net P&L.'), false, 'Old risk-first grading should be removed.');
  assert.equal(prompt.includes('Average R is diagnostic only.'), false, 'Average R should no longer be part of Doctor assessment.');
  assert.equal(prompt.includes('Average R:'), false, 'Average R should not appear as a Doctor stat.');
  assert.equal(prompt.includes('Average R may be present'), false, 'Average R should not appear in Doctor assessment instructions.');
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
  assert.ok(prompt.includes('"biggestWeakness": "Short plain-language weakness or neutral observation using only supported trade data; use \'No major weakness identified in this sample.\' when no material weakness is shown"'), 'The biggestWeakness field should allow no major weakness.');
  assert.ok(prompt.includes('"bestTrade": "Short plain-language summary using only available trade data"'), 'The bestTrade field should be present.');
  assert.ok(prompt.includes('"worstTrade": "Short plain-language summary using only available trade data"'), 'The worstTrade field should be present.');
  assert.ok(prompt.includes('"riskReview": "Short plain-language risk review using only supported trade data, or a clear insufficient-data statement"'), 'The riskReview field should be present.');
  assert.ok(prompt.includes('"psychologyReview": "Short plain-language behavior and discipline review using only supported trade data, or a clear insufficient-data statement"'), 'The psychologyReview field should be present.');
  assert.ok(prompt.includes('"strengths": ["Exactly 3 short items, one short sentence each"]'), 'The strengths field should require exactly 3 short items.');
  assert.ok(prompt.includes('"weaknesses": ["Maximum 3 concise issue or observation items; use \'No major issue identified in this sample.\' when no material issue is shown"]'), 'The weaknesses field should allow no major issue.');
  assert.ok(prompt.includes('"prescription": ["Exactly 3 short items, one short sentence each"]'), 'The prescription field should require exactly 3 short items.');
  assert.ok(prompt.includes('"tomorrowsFocus": "One sentence starting with \'Tomorrow,\' followed by exactly one practical behavior goal based on the clearest lesson or demonstrated issue from that day\'s data. If no material problem is shown, the goal can be to repeat the process that produced the strong results. Keep it short and specific. Do not make it primarily a profit target."'), 'The tomorrow focus field should allow repeating strong process.');
  assert.ok(prompt.includes('"quoteOfDay": "One short original coaching line connected to today\'s main lesson. Keep it simple and memorable. No clichés, fake inspiration, or unsupported claims."'), 'The quoteOfDay field should require an original lesson-linked line.');
});
