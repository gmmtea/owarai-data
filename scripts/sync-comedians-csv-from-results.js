#!/usr/bin/env node
/**
 * seed_csv/final_results.csv を元に、seed_csv/comedians.csv を同期・補完するツール。
 * - 既存(comedians.csv)に無い (name,number) を追加
 * - reading が未設定/空 かつ name が かな(ひら/カタ)のみ → 自動生成して埋める
 * - 記号（中黒・空白・括弧・ハイフン等）は reading 生成時に除去（長音「ー」は残す）
 *
 * 実行例: npm run data:sync:comedians
 */
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

const SEED_DIR = "seed_csv";
const CO_CSV   = path.join(SEED_DIR, "comedians.csv");
const FR_CSV   = path.join(SEED_DIR, "final_results.csv");

// -------- utils --------
const canon = (s) => (s ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");

// かな判定（ひらがな/カタカナ/長音/読点等の一部のみ許容）
const reKanaOnly = /^[\p{sc=Hiragana}\p{sc=Katakana}ー・･・\s]+$/u;
const isKanaOnly = (s) => reKanaOnly.test(canon(s));

// カタカナ → ひらがな
const toHiragana = (s) => s.replace(/[\u30A1-\u30F6]/g, (ch) =>
  String.fromCharCode(ch.charCodeAt(0) - 0x60)
);

// 読み用の記号除去（長音「ー」は残す）
const stripSymbolsForReading = (s) =>
  s
    // 中黒類・小中黒
    .replace(/[・･·\u30FB\uFF65]/g, "")
    // 全半角空白
    .replace(/[\u0020\u00A0\u3000]/g, "")
    // 括弧類
    .replace(/[()\[\]{}「」『』【】〈〉《》]/g, "")
    // 句読点やピリオド・カンマ・スラッシュ
    .replace(/[.,，．\/／]/g, "")
    // ハイフン/ダッシュ/アンダー（長音は残す）
    .replace(/[-_—–―]/g, "");

// 文字列 → null or trimmed
const toNullable = (x) => {
  if (x === undefined || x === null) return null;
  const s = String(x).trim();
  return s === "" ? null : s;
};

// CSV 読み書き
const readCsv = (file) => {
  if (!fs.existsSync(file)) return [];
  return parse(fs.readFileSync(file, "utf8"), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
};
const writeCsv = (file, rows, header) => {
  const csv = stringify(rows, { header: true, columns: header });
  fs.writeFileSync(file, csv, "utf8");
};

// -------- load --------
fs.mkdirSync(SEED_DIR, { recursive: true });

const coRows = readCsv(CO_CSV); // name, number, reading(任意)
const frRows = readCsv(FR_CSV); // comp,year,comedian_name,comedian_number,...

// 既存 comedians.csv を Map 化（key = `${name}||${number|null}`)
const keyOf = (name, number) => `${canon(name)}||${number === null ? "null" : Number(number)}`;

const existing = new Map();
for (const r of coRows) {
  const name = canon(r.name);
  const num  = r.number === "" || r.number == null ? null : Number(r.number);
  const reading = toNullable(r.reading);
  existing.set(keyOf(name, num), { name, number: num, reading });
}

// final_results の distinct (name, number) を走査
const seen = new Set();
let inserted = 0, readingUpdated = 0;

for (const r of frRows) {
  const name = canon(r.comedian_name);
  const num  = r.comedian_number === "" || r.comedian_number == null ? null : Number(r.comedian_number);
  const k = keyOf(name, num);
  if (seen.has(k)) continue;
  seen.add(k);

  const row = existing.get(k);
  if (!row) {
    // 追加作成
    let reading = null;
    if (isKanaOnly(name)) {
      const hira = toHiragana(name);
      reading = stripSymbolsForReading(hira);
      if (reading === "") reading = null;
    }
    existing.set(k, { name, number: num, reading });
    inserted++;
  } else {
    // 既存で reading が空なら自動補完を試みる
    if (!row.reading && isKanaOnly(row.name)) {
      const hira = toHiragana(row.name);
      let guess = stripSymbolsForReading(hira);
      if (guess === "") guess = null;
      if (guess) {
        row.reading = guess;
        readingUpdated++;
      }
    }
  }
}

// 出力（安定した順序：name 昇順 → number 昇順(null→先頭)）
const out = Array.from(existing.values()).sort((a, b) => {
  const na = a.name.localeCompare(b.name, "ja");
  if (na !== 0) return na;
  if (a.number === null && b.number !== null) return -1;
  if (a.number !== null && b.number === null) return 1;
  if (a.number === null && b.number === null) return 0;
  return Number(a.number) - Number(b.number);
});

// CSV ヘッダ: name,number,reading（既存に合わせる）
const header = ["name", "number", "reading"];
writeCsv(CO_CSV, out.map(r => ({
  name: r.name,
  number: r.number == null ? "" : String(r.number),
  reading: r.reading ?? "",
})), header);

console.log(`sync-comedians-csv: inserted=${inserted}, reading_filled=${readingUpdated}, total=${out.length}`);
