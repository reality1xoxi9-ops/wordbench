// GigaChat (Sber). Docs: developers.sber.ru/docs/ru/gigachat/api/reference/rest/gigachat-api (checked 2026-10).
// Needs the Russian Trusted Root CA: the workflow passes it via NODE_EXTRA_CA_CERTS.
import { randomUUID } from 'node:crypto';
import { fetchRetry } from './http.mjs';

const OAUTH_URL = process.env.GIGACHAT_OAUTH_URL || 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
const BASE_URL = (process.env.GIGACHAT_BASE_URL || 'https://api.giga.chat/v1').replace(/\/$/, '');
const SCOPE = process.env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS';
const MODEL = process.env.GIGACHAT_MODEL || 'GigaChat-2';

let token = null, tokenExp = 0;
async function getToken() {
  if (token && Date.now() < tokenExp - 60000) return token;
  const key = process.env.GIGACHAT_AUTH_KEY;
  if (!key) throw new Error('нет секрета GIGACHAT_AUTH_KEY');
  const res = await fetchRetry(OAUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', RqUID: randomUUID(), Authorization: 'Basic ' + key.replace(/^Basic\s+/i, '').trim() },
    body: 'scope=' + encodeURIComponent(SCOPE)
  }, { label: 'GigaChat токен' });
  const data = await res.json();
  token = data.access_token;
  // expires_at is in milliseconds in current responses; accept seconds too
  tokenExp = data.expires_at > 1e12 ? data.expires_at : (data.expires_at || 0) * 1000 || Date.now() + 25 * 60000;
  if (!token) throw new Error('GigaChat не вернул токен');
  return token;
}

export const name = 'gigachat';
export const model = MODEL;
// structured output: response_format json_schema + strict (post-chat reference, 2026-10); turned off for
// the rest of the run if the model rejects it
let useSchema = process.env.GIGACHAT_JSON_SCHEMA !== 'off';
async function call(prompt, schema) {
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: 'You reply with valid JSON only.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.5,
    max_tokens: 6000
  };
  if (schema) body.response_format = { type: 'json_schema', schema, strict: true };
  return fetchRetry(BASE_URL + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + await getToken() },
    body: JSON.stringify(body)
  }, { label: 'GigaChat' });
}
export async function generate(prompt, opts = {}) {
  let res;
  try { res = await call(prompt, useSchema && opts.schema); }
  catch (e) {
    if (!(useSchema && opts.schema && [400, 422].includes(e.status))) throw e;
    console.log(`  GigaChat не принял response_format (${e.message.slice(0, 160)}), дальше без схемы`);
    useSchema = false;
    res = await call(prompt, null);
  }
  const data = await res.json();
  const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text) throw new Error('GigaChat вернул пустой ответ');
  return text;
}
