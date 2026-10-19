// fetch with retries for rate limits and temporary server errors
export async function fetchRetry(url, opts, { tries = 4, label = 'request' } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    let res;
    try { res = await fetch(url, opts); }
    catch (e) { last = new Error(`${label}: сеть недоступна (${e.cause && e.cause.code || e.message})`); }
    if (res) {
      if (res.ok) return res;
      const body = (await res.text().catch(() => '')).slice(0, 300);
      last = new Error(`${label}: HTTP ${res.status} ${body}`);
      last.status = res.status;
      if (![429, 500, 502, 503, 504].includes(res.status)) throw last;
    }
    const wait = Math.min(60000, 4000 * 2 ** i);
    if (i < tries - 1) await new Promise(r => setTimeout(r, wait));
  }
  throw last;
}
