// gen-jurisdictions.mjs -- build data/jurisdictions/*.json, the rules corpus.
//
// Run: node test/gen-jurisdictions.mjs [firstYear] [lastYear]
//
// Three adapters, because one source cannot tell the whole truth:
//
//   CN  NateScarlet/holiday-cn -- transcribes the State Council notice. The
//       ONLY source that carries 调休 makeup workdays. A generic holiday API
//       would silently drop them and tell you a working Saturday is a weekend.
//   TW  ruyut/TaiwanCalendar   -- carries 補班 the same way.
//   *   date.nager.at v3       -- 200+ countries, and crucially `counties`,
//       which is regional granularity: Heilige Drei Könige is a holiday in
//       Bayern and not in Berlin, and that difference is the whole point.
//
// Output shape, one file per jurisdiction:
//   { code, name{}, weekend[], regions{}, sources[], years{ "2026": [day] } }
//   day = { d:"MM-DD", n:name, t:"rest"|"work", r?:[region codes] }
//
// `t:"work"` means a weekend the state turned into a working day. Any consumer
// that ignores it will be wrong about someone's Saturday.

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'data', 'jurisdictions');

const FIRST = Number(process.argv[2] || 2024);
const LAST = Number(process.argv[3] || 2027);

// Weekends that are not Saturday+Sunday. ISO weekday numbers, 1 = Monday.
// Getting this wrong makes every rest-day count wrong for a fifth of the world.
const WEEKEND = {
  AE: [6, 7], SA: [5, 6], EG: [5, 6], IL: [5, 6], JO: [5, 6], KW: [5, 6],
  QA: [5, 6], OM: [5, 6], BH: [5, 6], IQ: [5, 6], LY: [5, 6], SY: [5, 6],
  YE: [5, 6], MV: [5, 6], AF: [4, 5], BD: [5, 6], IR: [5], NP: [6],
  BN: [5, 7], DJ: [5, 6], SO: [5, 6],
};

const NAMES = {
  CN: { en: 'China', 'zh-Hans': '中国大陆', 'zh-Hant': '中國大陸' },
  TW: { en: 'Taiwan', 'zh-Hans': '台湾', 'zh-Hant': '臺灣' },
  HK: { en: 'Hong Kong', 'zh-Hans': '香港', 'zh-Hant': '香港' },
  MO: { en: 'Macau', 'zh-Hans': '澳门', 'zh-Hant': '澳門' },
  SG: { en: 'Singapore', 'zh-Hans': '新加坡', 'zh-Hant': '新加坡' },
  MY: { en: 'Malaysia', 'zh-Hans': '马来西亚', 'zh-Hant': '馬來西亞' },
  JP: { en: 'Japan', 'zh-Hans': '日本', 'zh-Hant': '日本' },
  KR: { en: 'South Korea', 'zh-Hans': '韩国', 'zh-Hant': '韓國' },
  US: { en: 'United States', 'zh-Hans': '美国', 'zh-Hant': '美國' },
  GB: { en: 'United Kingdom', 'zh-Hans': '英国', 'zh-Hant': '英國' },
  DE: { en: 'Germany', 'zh-Hans': '德国', 'zh-Hant': '德國' },
  FR: { en: 'France', 'zh-Hans': '法国', 'zh-Hant': '法國' },
  ES: { en: 'Spain', 'zh-Hans': '西班牙', 'zh-Hant': '西班牙' },
  IT: { en: 'Italy', 'zh-Hans': '意大利', 'zh-Hant': '義大利' },
  NL: { en: 'Netherlands', 'zh-Hans': '荷兰', 'zh-Hant': '荷蘭' },
  CH: { en: 'Switzerland', 'zh-Hans': '瑞士', 'zh-Hant': '瑞士' },
  AT: { en: 'Austria', 'zh-Hans': '奥地利', 'zh-Hant': '奧地利' },
  BE: { en: 'Belgium', 'zh-Hans': '比利时', 'zh-Hant': '比利時' },
  SE: { en: 'Sweden', 'zh-Hans': '瑞典', 'zh-Hant': '瑞典' },
  PL: { en: 'Poland', 'zh-Hans': '波兰', 'zh-Hant': '波蘭' },
  PT: { en: 'Portugal', 'zh-Hans': '葡萄牙', 'zh-Hant': '葡萄牙' },
  IE: { en: 'Ireland', 'zh-Hans': '爱尔兰', 'zh-Hant': '愛爾蘭' },
  DK: { en: 'Denmark', 'zh-Hans': '丹麦', 'zh-Hant': '丹麥' },
  NO: { en: 'Norway', 'zh-Hans': '挪威', 'zh-Hant': '挪威' },
  FI: { en: 'Finland', 'zh-Hans': '芬兰', 'zh-Hant': '芬蘭' },
  CZ: { en: 'Czechia', 'zh-Hans': '捷克', 'zh-Hant': '捷克' },
  GR: { en: 'Greece', 'zh-Hans': '希腊', 'zh-Hant': '希臘' },
  HU: { en: 'Hungary', 'zh-Hans': '匈牙利', 'zh-Hant': '匈牙利' },
  RO: { en: 'Romania', 'zh-Hans': '罗马尼亚', 'zh-Hant': '羅馬尼亞' },
  CA: { en: 'Canada', 'zh-Hans': '加拿大', 'zh-Hant': '加拿大' },
  AU: { en: 'Australia', 'zh-Hans': '澳大利亚', 'zh-Hant': '澳洲' },
  NZ: { en: 'New Zealand', 'zh-Hans': '新西兰', 'zh-Hant': '紐西蘭' },
  TH: { en: 'Thailand', 'zh-Hans': '泰国', 'zh-Hant': '泰國' },
  VN: { en: 'Vietnam', 'zh-Hans': '越南', 'zh-Hant': '越南' },
  ID: { en: 'Indonesia', 'zh-Hans': '印度尼西亚', 'zh-Hant': '印尼' },
  IN: { en: 'India', 'zh-Hans': '印度', 'zh-Hant': '印度' },
  AE: { en: 'United Arab Emirates', 'zh-Hans': '阿联酋', 'zh-Hant': '阿聯' },
  BR: { en: 'Brazil', 'zh-Hans': '巴西', 'zh-Hant': '巴西' },
  MX: { en: 'Mexico', 'zh-Hans': '墨西哥', 'zh-Hant': '墨西哥' },
  LU: { en: 'Luxembourg', 'zh-Hans': '卢森堡', 'zh-Hant': '盧森堡' },
  SK: { en: 'Slovakia', 'zh-Hans': '斯洛伐克', 'zh-Hant': '斯洛伐克' },
  SI: { en: 'Slovenia', 'zh-Hans': '斯洛文尼亚', 'zh-Hant': '斯洛維尼亞' },
  HR: { en: 'Croatia', 'zh-Hans': '克罗地亚', 'zh-Hant': '克羅埃西亞' },
  BG: { en: 'Bulgaria', 'zh-Hans': '保加利亚', 'zh-Hant': '保加利亞' },
  EE: { en: 'Estonia', 'zh-Hans': '爱沙尼亚', 'zh-Hant': '愛沙尼亞' },
  LV: { en: 'Latvia', 'zh-Hans': '拉脱维亚', 'zh-Hant': '拉脫維亞' },
  LT: { en: 'Lithuania', 'zh-Hans': '立陶宛', 'zh-Hant': '立陶宛' },
  IS: { en: 'Iceland', 'zh-Hans': '冰岛', 'zh-Hant': '冰島' },
  MT: { en: 'Malta', 'zh-Hans': '马耳他', 'zh-Hant': '馬爾他' },
  IL: { en: 'Israel', 'zh-Hans': '以色列', 'zh-Hant': '以色列' },
  SA: { en: 'Saudi Arabia', 'zh-Hans': '沙特阿拉伯', 'zh-Hant': '沙烏地阿拉伯' },
  EG: { en: 'Egypt', 'zh-Hans': '埃及', 'zh-Hant': '埃及' },
  QA: { en: 'Qatar', 'zh-Hans': '卡塔尔', 'zh-Hant': '卡達' },
  JO: { en: 'Jordan', 'zh-Hans': '约旦', 'zh-Hant': '約旦' },
  ZA: { en: 'South Africa', 'zh-Hans': '南非', 'zh-Hant': '南非' },
  CY: { en: 'Cyprus', 'zh-Hans': '塞浦路斯', 'zh-Hant': '賽普勒斯' },
};

const CODES = Object.keys(NAMES);

const j = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
};

// --- CN: the only source that carries 调休 -------------------------------
async function china() {
  const years = {}, sources = [];
  for (let y = FIRST; y <= LAST; y++) {
    let doc;
    try {
      doc = await j(`https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${y}.json`);
    } catch { continue; }
    if (!doc.days?.length) continue;
    years[y] = doc.days.map((d) => ({
      d: d.date.slice(5), n: d.name, t: d.isOffDay ? 'rest' : 'work',
    }));
    if (doc.papers?.[0]) sources.push(doc.papers[0]);
  }
  return { years, sources };
}

// --- TW: 補班 the same way ----------------------------------------------
async function taiwan() {
  const years = {}, sources = [];
  for (let y = FIRST; y <= LAST; y++) {
    let doc;
    try {
      doc = await j(`https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/${y}.json`);
    } catch { continue; }
    const days = [];
    for (const x of doc) {
      if (!x.description) continue;
      const d = `${x.date.slice(4, 6)}-${x.date.slice(6, 8)}`;
      days.push({ d, n: x.description, t: x.isHoliday ? 'rest' : 'work' });
    }
    if (days.length) years[y] = days;
    sources.push(`https://github.com/ruyut/TaiwanCalendar/blob/master/data/${y}.json`);
  }
  return { years, sources };
}

// --- everyone else: nager.at, with regional counties ---------------------
async function nager(code) {
  const years = {}, regions = {};
  for (let y = FIRST; y <= LAST; y++) {
    let doc;
    try { doc = await j(`https://date.nager.at/api/v3/PublicHolidays/${y}/${code}`); }
    catch { continue; }
    if (!doc?.length) continue;
    years[y] = doc.map((h) => {
      const day = { d: h.date.slice(5), n: h.localName || h.name, t: 'rest' };
      if (h.counties?.length) {
        day.r = h.counties;
        for (const c of h.counties) regions[c] ||= c;
      }
      return day;
    });
  }
  return { years, regions, sources: [`https://date.nager.at/api/v3/PublicHolidays/{year}/${code}`] };
}

// --- build ---------------------------------------------------------------
mkdirSync(OUT, { recursive: true });
const index = [];

for (const code of CODES) {
  process.stdout.write(`  ${code} ... `);
  let built;
  try {
    if (code === 'CN') built = await china();
    else if (code === 'TW') built = await taiwan();
    else built = await nager(code);
  } catch (err) {
    console.log(`FAILED (${err.message})`);
    continue;
  }
  const years = built.years || {};
  const covered = Object.keys(years).map(Number).sort((a, b) => a - b);
  if (!covered.length) { console.log('no data'); continue; }

  const doc = {
    code,
    name: NAMES[code],
    weekend: WEEKEND[code] || [6, 7],
    regions: built.regions && Object.keys(built.regions).length ? built.regions : undefined,
    sources: built.sources,
    coverage: { from: covered[0], to: covered[covered.length - 1] },
    years,
  };
  writeFileSync(join(OUT, `${code}.json`), JSON.stringify(doc, null, 1) + '\n', 'utf8');

  const makeup = covered.reduce((n, y) => n + years[y].filter((d) => d.t === 'work').length, 0);
  const regional = covered.reduce((n, y) => n + years[y].filter((d) => d.r).length, 0);
  index.push({
    code, name: NAMES[code], weekend: doc.weekend,
    coverage: doc.coverage,
    regions: doc.regions ? Object.keys(doc.regions).length : 0,
    makeupDays: makeup,
  });
  console.log(`${covered[0]}-${covered[covered.length - 1]}`
    + (makeup ? `, ${makeup} makeup workdays` : '')
    + (regional ? `, ${regional} regional` : ''));
}

index.sort((a, b) => a.code.localeCompare(b.code));
writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 1) + '\n', 'utf8');
console.log(`\nwrote ${index.length} jurisdictions to data/jurisdictions/`);
console.log(`  with makeup workdays: ${index.filter((i) => i.makeupDays).map((i) => i.code).join(', ')}`);
console.log(`  with regional rules:  ${index.filter((i) => i.regions).map((i) => `${i.code}(${i.regions})`).join(', ')}`);
