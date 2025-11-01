// Node.js 18+ を想定（fetch/Promise.allSettled/Intl など標準）
//
// 収集項目：コンビ名・結成日・所属・メンバー(名前/読み/生年月日/出身)
// 入力：ラウンドURL一覧（1行1URL）
// 出力：CSV(1行=1メンバー) と JSON(1コンビ=1要素)

import fs from "fs/promises";
import { createReadStream } from "fs";
import readline from "readline";
import path from "path";
import url from "url";
import * as cheerio from "cheerio";
import { chromium } from "playwright";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

function argval(name, def = undefined) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const INFILE = argval("--infile");
const OUT_CSV = argval("--out-csv", "m1_all.csv");
const OUT_JSON = argval("--out-json", "m1_all.json");
const THROTTLE_MS = Number(argval("--throttle-ms", "600"));

if (!INFILE) {
  console.error("使用法: node m1_scrape_multi.js --infile round_urls.txt [--out-csv out.csv] [--out-json out.json] [--throttle-ms 600]");
  process.exit(1);
}

const reSp = /\s+/g;
const z2 = (s) => (s ?? "").toString().replace(reSp, " ").trim();

// 余計な接尾語・サイト名などを除去し、純粋なコンビ名に寄せる
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
    .replace(/(スケジュール|日程|詳細|アーカイブ)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  t = t.replace(/(詳細|公式サイト)$/i, "").trim();
  return t;
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

async function fetchRenderedHTML(browser, targetUrl, { waitMs = 3000, clickCookie = true, retries = 2, waitForSelector = null } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 60_000 });
      if (clickCookie) {
        try {
          // よくある文言パターン
          const btns = [
            /同意/i, /同意する/i, /Accept/i, /OK/i, /同意して/i, /同意して閉じる/i,
          ];
          for (const rx of btns) {
            const el = page.getByRole("button", { name: rx });
            if (await el.count().catch(() => 0)) {
              await el.first().click({ timeout: 1500 }).catch(() => {});
              break;
            }
          }
        } catch (_) {}
      }
      if (waitForSelector) {
        await page.waitForSelector(waitForSelector, { timeout: 10_000 }).catch(() => {});
      }
      await page.waitForTimeout(waitMs);
      const html = await page.content();
      await context.close();
      return html;
    } catch (e) {
      await context.close();
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 800));
        continue;
      }
      throw e;
    }
  }
  throw new Error("unreachable");
}

function absoluteUrl(base, href) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function findCombiLinks(roundHtml, baseUrl) {
  const $ = cheerio.load(roundHtml);
  const anchors = $("a[href]");
  const hrefs = new Set();

  anchors.each((_, a) => {
    const href = $(a).attr("href") ?? "";
    if (/\/combi\//.test(href)) {
      const u = absoluteUrl(baseUrl, href);
      if (u) hrefs.add(u);
    }
  });

  if (hrefs.size === 0) {
    anchors.each((_, a) => {
      const label = z2($(a).text());
      if (/(コンビ情報|プロフィール|詳細|詳)/.test(label)) {
        const u = absoluteUrl(baseUrl, $(a).attr("href"));
        if (u) hrefs.add(u);
      }
    });
  }

  if (hrefs.size === 0) {
    anchors.each((_, a) => {
      const u = absoluteUrl(baseUrl, $(a).attr("href"));
      if (u && u.includes("combi")) hrefs.add(u);
    });
  }

  return Array.from(hrefs);
}

function extractByLabel($, labelRx) {
  // dl/dt/dd
  $("dl").each((_, dl) => {
    const dts = $(dl).find("dt");
    const dds = $(dl).find("dd");
    const len = Math.min(dts.length, dds.length);
    for (let i = 0; i < len; i++) {
      const dt = z2($(dts[i]).text());
      if (labelRx.test(dt)) {
        const dd = z2($(dds[i]).text());
        if (dd) throw { value: dd }; // 例外で早期脱出（cheerioのeach内でreturnできないため）
      }
    }
  });

  // table/th/td
  $("table").each((_, table) => {
    $(table)
      .find("tr")
      .each((__, tr) => {
        const th = $(tr).find("th,td").first();
        const tds = $(tr).find("td");
        if (th.length && labelRx.test(z2(th.text())) && tds.length) {
          const val = z2(
            Array.from(tds)
              .map((td) => $(td).text())
              .join(" ")
          );
          if (val) throw { value: val };
        }
      });
  });

  return "";
}

function safeExtractByLabel($, rx) {
  try {
    const v = extractByLabel($, rx);
    return v ?? "";
  } catch (e) {
    if (e && typeof e === "object" && "value" in e) return e.value || "";
    return "";
  }
}

function parseMemberBlock($, root) {
  const member = { name: "", reading: "", birthday: "", birthplace: "" };
  const pairs = [];

  // dl
  $(root)
    .find("dl")
    .each((_, dl) => {
      const dts = $(dl).find("dt");
      const dds = $(dl).find("dd");
      const len = Math.min(dts.length, dds.length);
      for (let i = 0; i < len; i++) {
        pairs.push([z2($(dts[i]).text()), z2($(dds[i]).text())]);
      }
    });

  // table
  $(root)
    .find("table")
    .each((_, table) => {
      $(table)
        .find("tr")
        .each((__, tr) => {
          const th = $(tr).find("th,td").first();
          const tds = $(tr).find("td");
          if (th.length && tds.length) {
            const key = z2(th.text());
            const val = z2(
              Array.from(tds)
                .map((td) => $(td).text())
                .join(" ")
            );
            pairs.push([key, val]);
          }
        });
    });

  // 「名前：〜」などの直書き
  $(root)
    .find("div,p,li,span")
    .each((_, el) => {
      const txt = z2($(el).text());
      const m = txt.match(/^(名前|読み|よみ|フリガナ|ふりがな|生年月日|出身|出身地)\s*[:：]\s*(.+)$/);
      if (m) pairs.push([m[1], z2(m[2])]);
    });

  for (const [k, v] of pairs) {
    if (/^(名前)$/.test(k)) member.name = v;
    else if (/^(読み|よみ|フリガナ|ふりがな)$/.test(k)) member.reading = v;
    else if (/^(生年月日)$/.test(k)) member.birthday = v;
    else if (/^(出身|出身地)$/.test(k)) member.birthplace = v;
  }

  if (!member.name) {
    const cand = $(root).find("h3,h4,strong,.name,.member-name").first();
    if (cand.length) member.name = z2(cand.text());
  }

  return member;
}

function parseCombiPage(html, sourceUrl) {
  const $ = cheerio.load(html);
  const data = { combi_name: "", formed_on: "", agency: "", members: [], source_url: sourceUrl };

  // コンビ名：① og:title → ② 見出し → ③ <title> をクリーニングして採用
  let tMeta = $('meta[property="og:title"]').attr('content');
  if (tMeta) data.combi_name = cleanTitleLikeName(tMeta);
  if (!data.combi_name) {
    const nameSelectors = ["h1", "h2", ".combi-name", ".page-title", ".ttl", ".title", ".p-combi__title"];
    for (const sel of nameSelectors) {
      const el = $(sel).first();
      if (el.length) {
        const t = cleanTitleLikeName(z2(el.text()));
        if (t && t.length <= 100) { data.combi_name = t; break; }
      }
    }
  }
  if (!data.combi_name) {
    const t = cleanTitleLikeName(z2($("title").text()));
    if (t) data.combi_name = t;
  }

  data.formed_on = safeExtractByLabel($, /(結成日|結成)/);
  data.agency = safeExtractByLabel($, /(所属|事務所)/);

  // メンバー領域の候補
  const memberRoots = [];
  // classにmember
  $("[class]").each((_, el) => {
    const cls = ($(el).attr("class") || "").toLowerCase();
    if (cls.includes("member")) memberRoots.push(el);
  });
  // セクション見出し
  if (memberRoots.length === 0) {
    $("section,div").each((_, sec) => {
      const head = z2($(sec).text()).slice(0, 200);
      if (/(メンバー|プロフィール|メンバープロフィール|メンバー紹介)/.test(head)) {
        memberRoots.push(sec);
      }
    });
  }
  // ラベル語彙から推定
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

  // 重複・空行除去
  const uniq = [];
  const seen = new Set();
  for (const m of data.members) {
    const key = [m.name || "", m.reading || "", m.birthday || "", m.birthplace || ""].join("||");
    if (!seen.has(key) && (m.name || m.reading || m.birthday || m.birthplace)) {
      seen.add(key);
      uniq.push(m);
    }
  }
  data.members = uniq;

  return data;
}

function parseRoundTitle(html) {
  const $ = cheerio.load(html);
  // ① og:title
  let t = $('meta[property="og:title"]').attr('content');
  if (t) return cleanRoundTitle(t);
  // ② 見出し
  for (const sel of ["h1", ".page-title", ".ttl", ".title", ".p-schedule__title", "main h1", ".l-main h1"]) {
    const el = $(sel).first();
    if (el.length) return cleanRoundTitle(z2(el.text()));
  }
  // ③ <title>
  return cleanRoundTitle(z2($("title").text()));
}

function toCSV(rows) {
  const headers = ["ラウンドURL", "ラウンド名", "コンビ名", "結成日", "所属", "名前", "読み", "生年月日", "出身", "ソースURL"];
  const esc = (s) => {
    const t = (s ?? "").toString();
    if (/[",\n]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
    return t;
  };
  const lines = [headers.map(esc).join(",")];
  for (const r of rows) lines.push(headers.map((h) => esc(r[h])).join(","));
  return lines.join("\n");
}

async function main() {
  const roundUrls = await readRoundUrls(path.resolve(__dirname, INFILE));

  const browser = await chromium.launch({ headless: true });
  const allCombies = [];
  const csvRows = [];

  try {
    for (let idx = 0; idx < roundUrls.length; idx++) {
      const roundUrl = roundUrls[idx];
      let roundHtml = "";
      try {
        roundHtml = await fetchRenderedHTML(browser, roundUrl, {
          waitMs: 3500,
          clickCookie: true,
          // 安全な候補（いずれか存在すれば待機にかかる可能性UP）
          waitForSelector: ['.combi', '.p-entry', '.p-schedule', '.l-main', 'main'].join(', ')
        });
      } catch (e) {
        console.warn(`[WARN] ラウンド取得失敗: ${roundUrl} :: ${e}`);
        continue;
      }

      const roundTitle = parseRoundTitle(roundHtml);
      const combiUrls = findCombiLinks(roundHtml, roundUrl);
      const uniqCombiUrls = Array.from(new Set(combiUrls));

      console.log(`[INFO] ${idx + 1}/${roundUrls.length} ラウンド: ${roundTitle || roundUrl} / コンビURL数: ${uniqCombiUrls.length}`);

      for (const cu of uniqCombiUrls) {
        try {
          const html = await fetchRenderedHTML(browser, cu, { waitMs: 2000, clickCookie: false });
          const data = parseCombiPage(html, cu);
          data.round_url = roundUrl;
          data.round_title = roundTitle;
          allCombies.push(data);

          if (data.members.length) {
            for (const m of data.members) {
              csvRows.push({
                "ラウンドURL": roundUrl,
                "ラウンド名": roundTitle,
                "コンビ名": data.combi_name,
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
            csvRows.push({
              "ラウンドURL": roundUrl,
              "ラウンド名": roundTitle,
              "コンビ名": data.combi_name,
              "結成日": data.formed_on,
              "所属": data.agency,
              "名前": "",
              "読み": "",
              "生年月日": "",
              "出身": "",
              "ソースURL": data.source_url,
            });
          }

          await new Promise((r) => setTimeout(r, THROTTLE_MS));
        } catch (e) {
          console.warn(`[WARN] コンビ取得失敗: ${cu} :: ${e}`);
        }
      }
    }
  } finally {
    await browser.close();
  }

  await fs.writeFile(path.resolve(__dirname, OUT_JSON), JSON.stringify(allCombies, null, 2), "utf-8");
  await fs.writeFile(path.resolve(__dirname, OUT_CSV), toCSV(csvRows), "utf-8");

  console.log(`[OK] 総コンビ数: ${allCombies.length}`);
  console.log(`[OK] CSV: ${OUT_CSV}`);
  console.log(`[OK] JSON: ${OUT_JSON}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
