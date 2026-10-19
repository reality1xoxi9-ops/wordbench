// Test cases shared by the Node tests (node --test tools/tests/) and the browser page tools/tests/browser.html.
import { validateItems, wordInSentence, checkItem } from '../validate.mjs';
import { extractJSON, addToIndex, collectItems, packTitle, levelFor } from '../pack-core.mjs';

const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
const ok = (v, msg) => { if (!v) throw new Error(msg); };

export const good = (w = 'pour concrete', extra = {}) => Object.assign({
  w, tr: 'заливать бетон', pos: 'phr',
  ex: [{ en: 'They will pour concrete into the formwork on Monday.', ru: 'В понедельник они зальют бетон в опалубку.' },
       { en: 'The workers poured concrete for the new foundation.', ru: 'Рабочие залили бетон для нового фундамента.' }],
  note: 'обычно о фундаменте или перекрытиях'
}, extra);

export const cases = {
  'правильный элемент проходит'() {
    const r = validateItems([good()], []);
    eq(r.items.length, 1, 'items');
    eq(r.items[0].w, 'pour concrete', 'w');
  },
  'элемент без слова в примере отбрасывается'() {
    const r = validateItems([good('scaffolding', { pos: 'n' })], []);
    eq(r.items.length, 0, 'items');
    eq(r.reasons['слова нет в примере'], 1, 'reason');
  },
  'без кириллицы в переводе отбрасывается'() {
    eq(checkItem(good('pour concrete', { tr: 'pour concrete' }), new Set()).reason, 'в переводе нет кириллицы', 'tr');
    const bad = good();bad.ex = [{ en: bad.ex[0].en, ru: 'no russian here' }];
    eq(checkItem(bad, new Set()).reason, 'в переводе примера нет кириллицы', 'ex.ru');
  },
  'дубль внутри пакета отбрасывается'() {
    const r = validateItems([good(), good('Pour Concrete')], []);
    eq(r.items.length, 1, 'items');
    eq(r.reasons['дубль в пакете'], 1, 'reason');
  },
  'известное слово отбрасывается'() {
    const r = validateItems([good()], ['POUR CONCRETE']);
    eq(r.items.length, 0, 'items');
    eq(r.reasons['уже известно'], 1, 'reason');
  },
  'прочие правила: латиница, длина, часть речи, длина примера'() {
    eq(checkItem(good('бетон'), new Set()).reason, 'в слове не только латиница', 'latin');
    eq(checkItem(good('a'.repeat(41)), new Set()).reason, 'слово длиннее 40 символов', 'len');
    eq(checkItem(good('pour concrete', { pos: 'verb' }), new Set()).reason, 'неизвестная часть речи', 'pos');
    const short = good();short.ex = [{ en: 'Pour concrete now.', ru: 'Залей бетон.' }];
    eq(checkItem(short, new Set()).reason, 'пример короче 4 или длиннее 25 слов', 'short');
  },
  'формы слов распознаются'() {
    ok(wordInSentence('go', 'She went home early yesterday.'), 'went/go');
    ok(wordInSentence('build', 'They are building a new bridge.'), 'building/build');
    ok(wordInSentence('give up', 'He gave up smoking last year.'), 'phrasal gave up');
    ok(wordInSentence('look forward to', 'I am looking forward to the trip.'), 'look forward to');
    ok(wordInSentence('city', 'Many cities have new parks.'), 'cities');
    ok(wordInSentence('stop', 'The work stopped at noon.'), 'stopped');
    ok(wordInSentence('make', 'We are making progress.'), 'making');
    ok(wordInSentence('load-bearing wall', 'Never remove load-bearing walls.'), 'hyphen');
    ok(wordInSentence('to build', 'They built it fast.'), 'to + verb');
    ok(!wordInSentence('build', 'They designed a bridge.'), 'negative');
  },
  'JSON из ответа модели извлекается'() {
    eq(extractJSON('```json\n{"items":[{"w":"x"}]}\n```').items.length, 1, 'fenced');
    eq(extractJSON('Here you go: [{"w":"x"},{"w":"y"}]').items.length, 2, 'bare array');
  },
  'индекс не получает дублей'() {
    const idx = { v: 1, packs: [] };
    ok(addToIndex(idx, { id: 'a', created: '2026-10-20' }, '2026-10-20'), 'first add');
    ok(!addToIndex(idx, { id: 'a', created: '2026-10-20' }, '2026-10-20'), 'second add');
    eq(idx.packs.length, 1, 'count');
  },
  'название и чередование уровней'() {
    eq(packTitle('Строительство', 'B1', '2026-10-20'), 'Строительство · B1 · 20 окт', 'title');
    ok(levelFor('2026-10-19', ['B1', 'B2']) !== levelFor('2026-10-26', ['B1', 'B2']), 'weeks alternate');
  },
  async 'повтор запроса, если прошло меньше 70%'() {
    let calls = 0;
    const answers = [
      JSON.stringify({ items: [good(), good('scaffolding', { pos: 'n' })] }),
      JSON.stringify({ items: [good('pour concrete'), good('pour', { pos: 'v' })] })
    ];
    // n=2 needs 2 valid items: the first answer gives 1, the second adds 1 (its duplicate is dropped)
    const r = await collectItems({ generate: async () => answers[Math.min(calls++, 1)], n: 2, description: 'x', level: 'B1', known: [] });
    eq(r.attempts, 2, 'attempts');
    eq(r.items.map(x => x.w), ['pour concrete', 'pour'], 'items');
  },
  async 'мало слов после повторов — ошибка'() {
    const r = await collectItems({ generate: async () => '{"items":[]}', n: 20, description: 'x', level: 'B1', known: [] });
    eq(r.attempts, 3, 'attempts');
    ok(r.error, 'error');
  }
};
