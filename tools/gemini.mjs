// Gemini (Google). Docs: ai.google.dev/api/generate-content (checked 2026-10).
// Note: the Gemini API is not available in every region; see the official list of supported regions.
import { fetchRetry } from './http.mjs';

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

export const name = 'gemini';
export const model = MODEL;
export async function generate(prompt, opts = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('нет секрета GEMINI_API_KEY');
  const res = await fetchRetry(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      // JSON mode with a schema (responseJsonSchema); items are still checked by validate.mjs
      generationConfig: Object.assign({ responseMimeType: 'application/json', temperature: 0.8 }, opts.schema ? { responseJsonSchema: opts.schema } : {})
    })
  }, { label: 'Gemini' });
  const data = await res.json();
  const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
  const text = (parts || []).map(p => p.text || '').join('');
  if (!text) throw new Error('Gemini вернул пустой ответ' + (data.promptFeedback ? ' (' + JSON.stringify(data.promptFeedback) + ')' : ''));
  return text;
}
