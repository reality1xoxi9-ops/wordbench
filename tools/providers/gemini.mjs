// Gemini (Google). Docs: ai.google.dev/api/generate-content (checked 2026-10).
// Note: the Gemini API is not available in every region; see the official list of supported regions.
import { fetchRetry } from './http.mjs';

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

export const name = 'gemini';
export const model = MODEL;
export async function generate(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('нет секрета GEMINI_API_KEY');
  const res = await fetchRetry(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      // JSON mode; the item schema itself is checked by validate.mjs
      generationConfig: { responseMimeType: 'application/json', temperature: 0.8 }
    })
  }, { label: 'Gemini' });
  const data = await res.json();
  const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
  const text = (parts || []).map(p => p.text || '').join('');
  if (!text) throw new Error('Gemini вернул пустой ответ' + (data.promptFeedback ? ' (' + JSON.stringify(data.promptFeedback) + ')' : ''));
  return text;
}
