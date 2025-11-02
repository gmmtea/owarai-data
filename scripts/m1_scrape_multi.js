// Node.js 18+ を想定（fetch/Promise.allSettled/Intl など標準）
//
// 収集: コンビ名・結成日・所属・メンバー(名前/読み/生年月日/出身)
// 入力: ラウンドURL一覧（1行1URL）
// 出力: CSV(1行=1メンバー) 追記モード。

import fs from "fs/promises";
import { createReadStream, createWriteStream } from "fs";
import readline from "readline";
import path from "path";
import url from "url";
import * as cheerio from "cheerio";
import { chromium } from "playwright";
import { parse as parseCsv } from "csv-parse/sync";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

function argval(name, def = undefined) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
function argflag(name) {
  return process.argv.includes(name);
}

const INFILE = argval("--infile");
const OUT_CSV = argval("--out-csv", "m1_all.csv");
const THROTTLE_MS = Number(argval("--throttle-ms", "400"));
const DEBUG = argflag("--debug");
const DUMP_DIR = argval("--dump-dir", "");
const DEBUG_SAMPLE = Number(argval("--debug-sample", "5")); // サンプル表示件数
const NO_BLOCK = argflag("--no-block"); // リソース遮断を一時OFFに

if (!INFILE) {
  console.error("使用法: node m1_scrape_multi.js --infile round_urls.txt [--out-csv out.csv] [--throttle-ms 400]");
  process.exit(1);
}

const reSp = /\s+/g;
const z2 = (s) => (s ?? "").toString().replace(reSp, " ").trim();
const zTrim = (s) => (s ?? "").toString().trim(); // 原文尊重用（内部の連続空白を保持）
const reKanaOnly = /^[\p{sc=Hiragana}\p{sc=Katakana}ー・･\s]+$/u;
const reCombiCtx = /(結成|所属|事務所)/;
const rePersonCtx = /(名前|氏名|本名|生年月日|出身|出身地|プロフィール|メンバー)/;
const nameHeaderSelectors = [
  ".p-combi__title", ".p-combi__head", ".p-combi__name",
  ".combi-title", ".combi-name", ".unit-name",
  "header h1", "h1", "h2"
];

const COMBI_HEAD_SELECTORS = [
  ".p-combi__title",
  ".p-combi__head",
  ".p-combi__name",
  ".combi-title",
  ".combi-name",
  ".unit-name",
  "main h1",
  "h1",
  "h2",
];

/**
 * 見出しブロック内だけからコンビ名と読み（ひらがな）を取得
 * - ruby>rt 最優先
 * - 次に「kana/yomi/ruby/furigana/data-kana」系
 * - 見つからなければ読みは空（推測なし）
 */
function extractCombiTitleAndReading($) {
  const norm = (s) => (s ?? "").toString().replace(/\s+/g, " ").trim();

  // 1) 見出し候補（旧/新テンプレ両対応へ増補）
  const HEAD_WIDE = [
    // 新しめ
    ".p-combi__title", ".p-combi__head",
    // 旧系
    "#contents h1", "#container h1",
    ".combi-title", ".combi-head", ".combi-header",
    // 汎用
    ".p-combi__name", ".combi-name", ".unit-name",
    "main h1", "h1", "h2",
  ];
  let head = null;
  for (const sel of HEAD_WIDE) {
    const el = $(sel).first();
    if (el.length) { head = el; break; }
  }
  if (!head) return { title: "", reading_hira: "" };

  // 2) タイトル抽出（子要素を消さずに“名前っぽい要素”を優先抽出）
  const NAME_PREF = head.find(
    'h1, .p-combi__name, .combi-name, .unit-name, [class*="name"]'
  ).first();
  let title = "";
  if (NAME_PREF.length) {
    title = norm(NAME_PREF.text());
  }
  if (!title) {
    // 子要素から「読み系」だけを除去してテキスト化（名前を含む要素は残す）
    const clone = head.clone();
    clone.find('rt, [class*="kana"], [class*="yomi"], [class*="ruby"], [class*="furigana"]').remove();
    const t = norm(clone.text());
    if (t) title = t;
  }
  // 最後の保険：それでも空なら素のテキスト
  if (!title) title = norm(head.text());

  // 3) 読み抽出（“見出しの近傍のみ”。ページ全体は見ない）
  //    対象スコープ: head自身 → 近い親コンテナ → 前後の隣接兄弟（最大2つ）
  const scopeCandidates = [];
  scopeCandidates.push(head);
  const parent = head.closest('header, .p-combi__head, .p-combi__title, .combi-head, .combi-title, .unit-name').first();
  if (parent.length) scopeCandidates.push(parent);
  const up1 = head.parent();
  if (up1 && up1.length) scopeCandidates.push(up1);
  const prev1 = head.prev(); if (prev1.length) scopeCandidates.push(prev1);
  const next1 = head.next(); if (next1.length) scopeCandidates.push(next1);
  const prev2 = prev1.prev ? prev1.prev() : $(); if (prev2.length) scopeCandidates.push(prev2);
  const next2 = next1.next ? next1.next() : $(); if (next2.length) scopeCandidates.push(next2);

  let reading = "";
  for (const sc of scopeCandidates) {
    if (reading) break;
    // 優先1: ruby>rt / rt
    const rt = sc.find("ruby rt, rt").first();
    if (rt.length) { reading = norm(rt.text()); break; }
    // 優先2: data-* / classベース（kana/yomi/furigana/ruby）
    const kn = sc.find(
      '[data-kana],[data-yomi],[data-furigana],' +
      '[class*="kana"],[class*="yomi"],[class*="furigana"],[class*="ruby"],' +
      '[aria-label],[alt]'
    ).filter((_, el) => {
      const $el = $(el);
      const t = ($el.attr('data-kana') || $el.attr('data-yomi') || $el.attr('data-furigana') ||
                 $el.attr('aria-label') || $el.attr('alt') || $el.text() || "").trim();
      return /[ァ-ヶー]/.test(t);
    }).first();
    if (kn.length) {
      reading = norm(kn.attr("data-kana") || kn.attr("data-yomi") || kn.attr("data-furigana") || kn.text());
      break;
    }
    // 優先3: 見出しテキストの末尾が「後置カタカナ」の並記（例: "天才ピアニスト テンサイピアニスト"）
    const txt = norm(sc.text());
    const m = txt.match(/^(?<base>.+?)\s+(?<kana>[ァ-ヶー･・\u3000 ]+)$/);
    if (m && m.groups?.kana) {
      // タイトルと基部の乖離が大きくない場合のみ採用（誤爆抑止）
      const base = norm(m.groups.base);
      if (!title || base.includes(title) || title.includes(base)) {
        reading = m.groups.kana;
        // タイトルが「名称＋カタカナ」だった場合は基部に補正
        if (title && title.includes(reading)) title = base;
        break;
      }
    }
  }

  const stripSymbolsForReading = (s) =>
    (s ?? "")
      .replace(/[・･·\u30FB\uFF65]/g, "")   // 中黒類
      .replace(/[\u0020\u00A0\u3000]/g, ""); // 半/不換/全角スペース
  const reading_hira = reading ? toHiragana(stripSymbolsForReading(reading)) : "";
  return { title, reading_hira };
}

// コンビ名クリーニング（余計な装飾語の除去。文字幅やかな種別は変更しない）
function cleanTitleLikeName(s) {
  let t = (s || "").replace(/\s+/g, " ").trim();
  t = t
    .replace(/COMBI\s*コンビ情報/gi, "")
    .replace(/コンビ情報/gi, "")
    .replace(/プロフィール/gi, "")
    .replace(/M-1グランプリ/gi, "")
    .replace(/\s*\|\s*COMBI/gi, "")
    .replace(/\s*\|\s*公式サイト/gi, "")
    .replace(/^\|\s*|\s*\|$/g, "");
  // 記号の余白整形
  t = t.replace(/\s*[-|｜]\s*/g, " ").trim();
  return t;
}

// ラウンド名の冗長語を落として要旨だけ残す
function cleanRoundTitle(s) {
  let t = (s || "").replace(/\s+/g, " ").trim();
  t = t
    .replace(/M-1グランプリ/gi, "")
    .replace(/(スケジュール|日程|詳細|アーカイブ|会場情報|結果)/gi, "")
    .replace(/[│｜|・]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  t = t.replace(/(詳細|公式サイト)$/i, "").trim();
  return t;
}

// 読みだけ ひらがな 化（他項目は一切変換しない）
function toHiragana(src = "") {
  if (!src) return src;
  const half2fullMap = {
    'ｱ':'ア','ｲ':'イ','ｳ':'ウ','ｴ':'エ','ｵ':'オ','ｶ':'カ','ｷ':'キ','ｸ':'ク','ｹ':'ケ','ｺ':'コ',
    'ｻ':'サ','ｼ':'シ','ｽ':'ス','ｾ':'セ','ｿ':'ソ','ﾀ':'タ','ﾁ':'チ','ﾂ':'ツ','ﾃ':'テ','ﾄ':'ト',
    'ﾅ':'ナ','ﾆ':'ニ','ﾇ':'ヌ','ﾈ':'ネ','ﾉ':'ノ','ﾊ':'ハ','ﾋ':'ヒ','ﾌ':'フ','ﾍ':'ヘ','ﾎ':'ホ',
    'ﾏ':'マ','ﾐ':'ミ','ﾑ':'ム','ﾒ':'メ','ﾓ':'モ','ﾔ':'ヤ','ﾕ':'ユ','ﾖ':'ヨ',
    'ﾗ':'ラ','ﾘ':'リ','ﾙ':'ル','ﾚ':'レ','ﾛ':'ロ','ﾜ':'ワ','ｦ':'ヲ','ﾝ':'ン',
    'ｧ':'ァ','ｨ':'ィ','ｩ':'ゥ','ｪ':'ェ','ｫ':'ォ','ｯ':'ッ','ｬ':'ャ','ｭ':'ュ','ｮ':'ョ',
    'ﾞ':'゛','ﾟ':'゜','ｰ':'ー'
  };
  let s = Array.from(src).map(ch => half2fullMap[ch] ?? ch).join("");
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (code >= 0x30A1 && code <= 0x30F6) out += String.fromCodePoint(code - 0x60);
    else out += ch;
  }
  return out;
}

// 2019以前のコンビURL正規化: /combi/detail.html?id=648 → https://www.m-1gp.com/combi/648.html
function normalizeCombiUrl(u) {
  try {
    const x = new URL(u, "https://www.m-1gp.com/");
    const idParam = x.searchParams.get("id");
    if (/^\/combi\/detail\.html$/i.test(x.pathname) && idParam && /^\d+$/.test(idParam)) {
      return `https://www.m-1gp.com/combi/${idParam}.html`;
    }
    const m = x.pathname.match(/\/combi\/(\d+)\.html$/i);
    if (m) return `https://www.m-1gp.com/combi/${m[1]}.html`;
    // それ以外はそのまま（2020+の /archive/... 構造など）
    return x.toString();
  } catch {
    return u;
  }
}

async function readRoundUrls(p) {
  const rl = readline.createInterface({ input: createReadStream(p), crlfDelay: Infinity });
  const out = [];
  const seen = new Set();
  for await (const line of rl) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

// 既存CSVを読み込み、重複スキップ集合を作る（ラウンドURL×正規化コンビURL）
async function loadExistingCanon(csvPath) {
  try {
    const txt = await fs.readFile(csvPath, "utf-8");
    const recs = parseCsv(txt, { columns: true, skip_empty_lines: true });
    const canonSet = new Set();          // 既存CSVに出現済みの canonUrl
    const nameByCanon = new Map();       // canonUrl -> combi name（最後に見たもの）
    for (const r of recs) {
      const srcUrl = (r["ソースURL"] ?? "").trim();
      if (!srcUrl) continue;
      const canon = normalizeCombiUrl(srcUrl).trim();
      if (canon) {
        canonSet.add(canon);
        const combiName = (r["コンビ名"] ?? "").trim();
        if (combiName) nameByCanon.set(canon, combiName);
        // 既存CSVにおける充足状況を記録（名前/読みが埋まっているか）
        const reading = (r["コンビ名読み"] ?? "").trim();
        if (!globalThis.__existingMeta) globalThis.__existingMeta = new Map();
        const prev = globalThis.__existingMeta.get(canon) || { hasName:false, hasReading:false };
        globalThis.__existingMeta.set(canon, {
          hasName: prev.hasName || !!combiName,
          hasReading: prev.hasReading || !!reading,
        });
      }
    }
    return { canonSet, exists: true, nameByCanon };
  } catch {
    return { canonSet: new Set(), exists: false, nameByCanon: new Map() };
  }
}

async function fetchRenderedHTML(page, targetUrl, { waitMs = 3000, clickCookie = true, waitForSelector = null } = {}) {
  const resp = await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 60_000 });
  if (DEBUG) {
    console.log(`[DBG] goto: ${targetUrl} -> status=${resp?.status?.()} url=${page.url()}`);
  }
  if (clickCookie) {
    try {
      const btns = [/同意/i, /同意する/i, /Accept/i, /OK/i, /同意して/i, /同意して閉じる/i];
      for (const rx of btns) {
        const el = page.getByRole("button", { name: rx });
        if (await el.count().catch(() => 0)) {
          await el.first().click({ timeout: 1500 }).catch(() => {});
          break;
        }
      }
    } catch {}
  }
  if (waitForSelector) {
    try {
      await page.waitForSelector(waitForSelector, { timeout: 10_000 });
      if (DEBUG) console.log(`[DBG] waitForSelector OK: ${waitForSelector}`);
    } catch (e) {
      if (DEBUG) console.log(`[DBG] waitForSelector TIMEOUT: ${waitForSelector}`);
    }
  }
  await page.waitForTimeout(waitMs);
  const html = await page.content();
  return html;
}

function absoluteUrl(base, href) {
  try { return new URL(href, base).toString(); } catch { return null; }
}

// 本文(main)内から「コンビ詳細URL」のみを機械的に収集（画像見出しでもOK）
function findCombiLinks(roundHtml, baseUrl) {
  const $ = cheerio.load(roundHtml);
  // main が無いケースがあるので body/コンテンツ系IDも候補に
  const scope =
    $("main").length ? $("main") :
    $("#container").length ? $("#container") :
    $("#contents").length ? $("#contents") :
    $("body");

  const raw = $.root().html() || "";
  // ① 下部「芸人一覧/コンビ一覧…」の手前でカットオフ
  const cutoffRe = /(芸人一覧|コンビ一覧|参加芸人一覧|全コンビ|全芸人)/;
  const cutoffPos = raw.search(cutoffRe); // -1 ならカットなし

  const anchors = scope.find("a[href]").toArray();
  const urls = [];
  const seen = new Set();
  let combiAll = 0, combiIndexPhp = 0, combiAccepted = 0;
  let cutByCutoff = 0, cutByContext = 0;
  const samples = [];

  // 直近のtable見出し語彙
  const thWords = /(出演順|エントリー|コンビ名|メンバー|所属)/;
  // 文脈語彙（周辺テキスト）
  const ctxWords = /(出場者|出演者|本日の出場|本日の出演|出演順|出場組|出演組)/;

  for (const a of anchors) {
    const href = ($(a).attr("href") || "").trim();
    if (!href) continue;
    const isCombi = /\/combi\//i.test(href);
    if (isCombi) combiAll++;
    if (!isCombi) continue;
    if (/\/combi\/index\.php$/i.test(href)) { combiIndexPhp++; continue; }

    const okPattern =
      /\/combi\/\d+\.html(\?.*)?$/i.test(href) ||
      /\/combi\/detail\.html\?(?:.*&)?id=\d+(?:&.*)?$/i.test(href);
    if (!okPattern) continue;

    // 位置ベース: このhrefがHTML中で出る最初の位置
    const firstIdx = raw.indexOf(href);
    const beforeCutoff = (cutoffPos === -1) || (firstIdx !== -1 && firstIdx < cutoffPos);
    if (!beforeCutoff) { cutByCutoff++; continue; }

    // テーブル見出しor近傍文脈のどちらかを満たすこと
    let contextOK = false;
    // a要素の直近tableに見出し語があるか
    const table = $(a).closest("table");
    if (table.length) {
      const thText = z2(table.text());
      if (thWords.test(thText)) contextOK = true;
    }
    // 近傍テキスト（±2000文字）に文脈語彙があるか
    if (!contextOK && firstIdx !== -1) {
      const left = Math.max(0, firstIdx - 2000);
      const right = Math.min(raw.length, firstIdx + 2000);
      const around = raw.slice(left, right);
      if (ctxWords.test(around)) contextOK = true;
    }
    if (!contextOK) { cutByContext++; continue; }

    const abs = absoluteUrl(baseUrl, href);
    if (!abs) continue;
    const canon = normalizeCombiUrl(abs);
    if (!seen.has(canon)) { seen.add(canon); urls.push(canon); combiAccepted++; }
    if (samples.length < DEBUG_SAMPLE) samples.push({ href, abs, canon, idx:firstIdx });
  }

  // anchorで拾えない場合、フォールバック（ただしカットオフ以降は拾わない）
  if (urls.length === 0) {
    const re1 = /\/combi\/(\d+)\.html/gi;
    const re2 = /\/combi\/detail\.html\?[^"'<>]*?\bid=(\d+)/gi;
    let m; const found = new Set();
    while ((m = re1.exec(raw)) !== null) {
      if (cutoffPos !== -1 && re1.lastIndex > cutoffPos) break;
      found.add(m[1]);
    }
    while ((m = re2.exec(raw)) !== null) {
      if (cutoffPos !== -1 && re2.lastIndex > cutoffPos) break;
      found.add(m[1]);
    }
    for (const id of found) {
      const canon = `https://www.m-1gp.com/combi/${id}.html`;
      if (!seen.has(canon)) { seen.add(canon); urls.push(canon); }
    }
    if (DEBUG) console.log(`[DBG] regex fallback ids: ${Array.from(found).slice(0, DEBUG_SAMPLE).join(", ") || "(none)"}`);
  }

  if (DEBUG) {
    console.log(`[DBG] combi links (pre): raw=${combiAll}, excluded index.php=${combiIndexPhp}`);
    console.log(`[DBG] combi links (filters): cutByCutoff=${cutByCutoff}, cutByContext=${cutByContext}, accepted=${combiAccepted}`);
    for (const s of samples) console.log(`[DBG] sample: href=${s.href} -> canon=${s.canon} @${s.idx}`);
  }
  return urls;
}

function safeExtractByLabel($, rx) {
  // dl/dt/dd
  for (const dl of $("dl").toArray()) {
    const dts = $(dl).find("dt");
    const dds = $(dl).find("dd");
    const len = Math.min(dts.length, dds.length);
    for (let i = 0; i < len; i++) {
      const dt = z2($(dts[i]).text());
      if (rx.test(dt)) return z2($(dds[i]).text());
    }
  }
  // table/th/td
  for (const table of $("table").toArray()) {
    for (const tr of $(table).find("tr").toArray()) {
      const th = $(tr).find("th,td").first();
      const tds = $(tr).find("td");
      if (th.length && rx.test(z2(th.text())) && tds.length) {
        return z2(Array.from(tds).map(td => $(td).text()).join(" "));
      }
    }
  }
  return "";
}

function parseMemberBlock($, root) {
  const member = { name: "", reading: "", birthday: "", birthplace: "" };
  const pairs = [];

  // dl
  $(root).find("dl").each((_, dl) => {
    const dts = $(dl).find("dt");
    const dds = $(dl).find("dd");
    const len = Math.min(dts.length, dds.length);
    for (let i = 0; i < len; i++) {
      pairs.push([z2($(dts[i]).text()), z2($(dds[i]).text())]);
    }
  });

  // table
  $(root).find("table").each((_, table) => {
    $(table).find("tr").each((__, tr) => {
      const th = $(tr).find("th,td").first();
      const tds = $(tr).find("td");
      if (th.length && tds.length) {
        const key = z2(th.text());
        const val = z2(Array.from(tds).map(td => $(td).text()).join(" "));
        pairs.push([key, val]);
      }
    });
  });

  // 「名前：〜」など直書き
  $(root).find("div,p,li,span").each((_, el) => {
    const txt = z2($(el).text());
    const m = txt.match(/^(名前|読み|よみ|フリガナ|ふりがな|生年月日|出身|出身地)\s*[:：]\s*(.+)$/);
    if (m) pairs.push([m[1], z2(m[2])]);
  });

  for (const [k, v] of pairs) {
    if (/^(名前)$/.test(k)) member.name = zTrim(v); // 原文尊重（内部空白保持）
    else if (/^(読み|よみ|フリガナ|ふりがな)$/.test(k)) member.reading = toHiragana(v);
    else if (/^(生年月日)$/.test(k)) member.birthday = v;
    else if (/^(出身|出身地)$/.test(k)) member.birthplace = v;
  }

  if (!member.name) {
    const cand = $(root).find("h3,h4,strong,.name,.member-name").first();
    if (cand.length) member.name = zTrim(cand.text());
  }

  return member;
}

function parseCombiPage(html, sourceUrl) {
  const $ = cheerio.load(html);
  const data = { combi_name: "", combi_reading_hira: "", formed_on: "", agency: "", members: [], source_url: sourceUrl };

  const { title, reading_hira } = extractCombiTitleAndReading($);
  data.combi_name = title;
  data.combi_reading_hira = reading_hira;

  // フォールバック: 見出しでタイトルが空のときだけ meta を参照
  if (!data.combi_name) {
    const meta = ($('meta[property="og:title"]').attr("content") || $("title").text() || "").trim();
    if (meta) data.combi_name = cleanTitleLikeName(meta);
  }

  data.formed_on = safeExtractByLabel($, /(結成日|結成)/);
  data.agency    = safeExtractByLabel($, /(所属|事務所)/);

  // メンバー領域候補
  const memberRoots = [];
  $("[class]").each((_, el) => {
    const cls = ($(el).attr("class") || "").toLowerCase();
    if (cls.includes("member")) memberRoots.push(el);
  });
  if (memberRoots.length === 0) {
    $("section,div").each((_, sec) => {
      const head = z2($(sec).text()).slice(0, 200);
      if (/(メンバー|プロフィール|メンバープロフィール|メンバー紹介)/.test(head)) memberRoots.push(sec);
    });
  }
  if (memberRoots.length === 0) {
    $("article,div,li").each((_, card) => {
      const txt = z2($(card).text());
      if (/(名前|生年月日|出身|出身地)/.test(txt)) memberRoots.push(card);
    });
  }

  for (const root of memberRoots) {
    const m = parseMemberBlock($, root);
    if (m.name || m.reading || m.birthday || m.birthplace) data.members.push(m);
  }

  // 重複除去
  const uniq = [];
  const seen = new Set();
  for (const m of data.members) {
    const key = [m.name||"", m.reading||"", m.birthday||"", m.birthplace||""].join("||");
    if (!seen.has(key) && (m.name || m.reading || m.birthday || m.birthplace)) {
      seen.add(key); uniq.push(m);
    }
  }
  data.members = uniq;

  return data;
}

function parseRoundTitle(html) {
  const $ = cheerio.load(html);
  // ① main直下のh1優先（グロナビ汚染を避ける）
  for (const sel of ["#contents h1", "#container h1", "main h1", ".l-main h1", ".p-schedule__title", ".page-title", "h1", ".ttl", ".title"]) {
    const el = $(sel).first();
    if (el.length) {
      const v = cleanRoundTitle(z2(el.text()));
      if (DEBUG) console.log(`[DBG] round title from "${sel}": ${JSON.stringify(v)}`);
      if (v) return v;
    }
  }
  // ② og:title（ページ設計により“一覧”寄りの語が混ざることがあるため優先度を下げる）
  const meta = $('meta[property="og:title"]').attr("content");
  if (meta) {
    const v = cleanRoundTitle(meta);
    if (DEBUG) console.log(`[DBG] round title from og:title: ${JSON.stringify(v)}`);
    if (v) return v;
  }
  const v = cleanRoundTitle(z2($("title").text()));
  if (DEBUG) console.log(`[DBG] round title from <title>: ${JSON.stringify(v)}`);
  return v;
}

function toCSVLine(row, headers) {
  const esc = (s) => {
    const t = (s ?? "").toString();
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return headers.map((h) => esc(row[h])).join(",") + "\n";
}

function sleep(ms, jitter = 0) {
  const delta = Math.floor((Math.random() * 2 - 1) * jitter);
  return new Promise(r => setTimeout(r, Math.max(0, ms + delta)));
}

async function main() {
  const roundUrls = await readRoundUrls(path.resolve(__dirname, INFILE));

  const headers = ["ラウンドURL","ラウンド名","コンビ名","コンビ名読み","結成日","所属","名前","読み","生年月日","出身","ソースURL"];
  const csvPath = path.resolve(__dirname, OUT_CSV);

  // 既存CSVから重複（ラウンドURL×正規化コンビURL）をロード
  const { canonSet: existingCanon, exists: csvExisted, nameByCanon } = await loadExistingCanon(csvPath);

  // 追記ストリームを用意（ファイルが無い/空ならヘッダを書いてから開始）
  let needHeader = true;
  try { const st = await fs.stat(csvPath); needHeader = st.size === 0; } catch { needHeader = true; }
  const ws = createWriteStream(csvPath, { flags: "a", encoding: "utf-8" });
  if (!csvExisted || needHeader) ws.write(headers.join(",") + "\n");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    // 実ブラウザ寄り（Chrome on Mac）
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    locale: "ja-JP",
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();

  const combiCache = new Map(); // URL(正規化前後どちらでも) -> parsedData
  const writtenByCanon = new Set(); // 同一実行内で出力済みのcanonUrl集合

  // 中断時もファイルが壊れないようにflush/close
  const graceful = async () => {
    try { ws.end(); } catch {}
    try { await context.close(); } catch {}
    try { await browser.close(); } catch {}
    process.exit(0);
  };
  process.on("SIGINT", graceful);
  process.on("SIGTERM", graceful);

  try {
    for (let idx = 0; idx < roundUrls.length; idx++) {
      const roundUrl = roundUrls[idx];
      let roundHtml = "";
      try {
        roundHtml = await fetchRenderedHTML(page, roundUrl, {
          waitMs: 3500, clickCookie: true,
          // 本文のコンビリンクが現れるまで待つ（JS挿入対策）
          waitForSelector: [
            'a[href*="/combi/"]',
            'a[href*="combi/detail.html?id="]',
            'h1'
          ].join(', ')
        });
        if (DEBUG && DUMP_DIR) {
          const fp = path.resolve(DUMP_DIR, `round_${idx+1}.html`);
          await fs.mkdir(DUMP_DIR, { recursive: true }).catch(()=>{});
          await fs.writeFile(fp, roundHtml, "utf-8");
          console.log(`[DBG] dumped round HTML: ${fp}`);
          try {
            const sp = path.resolve(DUMP_DIR, `round_${idx+1}.png`);
            await page.screenshot({ path: sp, fullPage: true });
            console.log(`[DBG] screenshot: ${sp}`);
          } catch {}
        }
      } catch (e) {
        console.warn(`[WARN] ラウンド取得失敗: ${roundUrl} :: ${e}`);
        continue;
      }

      const roundTitle = parseRoundTitle(roundHtml);
      // JSタブ式に対応: 出場者/出演者系の要素を順にクリックして再収集
      if (DEBUG) console.log("[DBG] try activate performer tabs/buttons...");
      const clickSelectors = [
        'text=/出場者(一覧)?/i',
        'text=/出演者(一覧)?/i',
        'text=/本日の出場(者)?/i',
        'role=tab[name=/出場者|出演者/i]',
        'button:has-text("出場者")',
        'a:has-text("出場者")',
      ];
      for (const sel of clickSelectors) {
        try {
          await page.locator(sel).first().click({ timeout: 1000 });
          await page.waitForTimeout(500);
        } catch {}
      }
      // クリック後の最新HTMLで再パース
      roundHtml = await page.content();

      const combiUrls = findCombiLinks(roundHtml, roundUrl);
      const uniqCombiUrls = Array.from(new Set(combiUrls));

      console.log(`[INFO] ${idx + 1}/${roundUrls.length} ラウンド: ${roundTitle || roundUrl} / コンビURL数: ${uniqCombiUrls.length}`);
      if (DEBUG && uniqCombiUrls.length === 0) {
        console.log(`[DBG] NO COMBI LINKS FOUND on: ${roundUrl}`);
      }

      for (const rawUrl of uniqCombiUrls) {
        // 2019以前の形式を正規化（同一とみなす）
        const canonUrl = normalizeCombiUrl(rawUrl);
        const pairKey = `${roundUrl}||${canonUrl}`;

        let meta = (globalThis.__existingMeta && globalThis.__existingMeta.get(canonUrl)) || { hasName:false, hasReading:false };
        // 既存CSVに“コンビ名”があるだけでスキップ（読みは問わない）
        if (existingCanon.has(canonUrl) && meta.hasName) {
          const combiDisp = (nameByCanon.get(canonUrl) || "(name-unknown)").trim();
          console.log(`[INFO] COMBI CSV-SKIP: ${combiDisp} :: ${canonUrl}`);
          continue;
        }

        try {
          let data, from = "FETCH";
          // ランタイム内の重複もスキップ（API呼び出し削減）
          if (combiCache.has(canonUrl)) {
            data = combiCache.get(canonUrl);
            from = "CACHE";
          } else {
            const html = await fetchRenderedHTML(page, rawUrl, { waitMs: 2000, clickCookie: false });
            data = parseCombiPage(html, rawUrl);
            combiCache.set(canonUrl, data);
            if (DEBUG && DUMP_DIR) {
              const fpc = path.resolve(DUMP_DIR, `combi_${encodeURIComponent(canonUrl)}.html`);
              await fs.writeFile(fpc, html, "utf-8").catch(()=>{});
              console.log(`[DBG] dumped combi HTML: ${fpc}`);
            }
          }

          // 同一実行中に同じコンビURL（canon）が既にCSVへ書かれていれば、以後は書かない
          if (from === "CACHE" && writtenByCanon.has(canonUrl)) {
            const combiDisp = nameByCanon.get(canonUrl) || data.combi_name || "(name-unknown)";
            console.log(`[INFO] COMBI CACHE-SKIP: 実行内重複 (コンビ="${combiDisp}", URL=${canonUrl})`);
            continue;
          }

          const displayName = data.combi_name?.trim() ? data.combi_name : `(name-missing) ${canonUrl.split('/').pop()}`;
          console.log(`[INFO] COMBI ${from}: ${displayName} :: ${canonUrl}`);

          if (displayName && displayName !== "(name-missing)") {
            nameByCanon.set(canonUrl, displayName);
          }

          // 行を即時追記（中断してもここまでが残る）
          const rows = [];
          if (data.members && data.members.length) {
            for (const m of data.members) {
              rows.push({
                "ラウンドURL": roundUrl,
                "ラウンド名": roundTitle,
                "コンビ名": data.combi_name,
                "コンビ名読み": data.combi_reading_hira || "",
                "結成日": data.formed_on,
                "所属": data.agency,
                "名前": m.name || "",
                "読み": m.reading || "",
                "生年月日": m.birthday || "",
                "出身": m.birthplace || "",
                "ソースURL": data.source_url,
              });
            }
          } else {
            rows.push({
              "ラウンドURL": roundUrl,
              "ラウンド名": roundTitle,
              "コンビ名": data.combi_name,
              "コンビ名読み": data.combi_reading_hira || "",
              "結成日": data.formed_on,
              "所属": data.agency,
              "名前": "",
              "読み": "",
              "生年月日": "",
              "出身": "",
              "ソースURL": data.source_url,
            });
          }

          for (const r of rows) ws.write(toCSVLine(r, headers));
          existingCanon.add(canonUrl);
          writtenByCanon.add(canonUrl);   // 実行内スキップ用（コンビURL単位）
          // メタ更新（次のスキップログにコンビ名を出せるように）
          const combiNameNow = data.combi_name?.trim() || "";
          if (combiNameNow) nameByCanon.set(canonUrl, combiNameNow);

          // 充足状況を更新（今回の取得結果に基づき書き戻す）
          if (!globalThis.__existingMeta) globalThis.__existingMeta = new Map();
          const prev = globalThis.__existingMeta.get(canonUrl) || { hasName:false, hasReading:false };
          globalThis.__existingMeta.set(canonUrl, {
            hasName: prev.hasName || !!(data.combi_name && data.combi_name.trim()),
            hasReading: prev.hasReading || !!(data.combi_reading_hira && data.combi_reading_hira.trim()),
          });

          await sleep(THROTTLE_MS, Math.min(THROTTLE_MS, 500));
        } catch (e) {
          console.warn(`[WARN] コンビ取得失敗: ${rawUrl} :: ${e}`);
        }
      }
    }
  } finally {
    ws.end();
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  console.log(`[OK] CSV: ${OUT_CSV} に追記しました`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
