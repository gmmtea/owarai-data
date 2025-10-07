#!/usr/bin/env node
/**
 * scores_wide.csv（横持ち）を judge_scores.csv（縦持ち）に変換。
 * 入力の審査員列は seat_1, seat_2, ... 固定（左→右の席順）。
 *
 * 使い方:
 *   node scripts/convert-judge-scores-wide.js               // 既定パスで入出力
 *   node scripts/convert-judge-scores-wide.js input.csv     // 入力を指定
 *
 * 入力CSV 例:
 * comp,year,round_no,comedian_name,comedian_number,seat_1,seat_2,seat_3,seat_4,seat_5
 * m1,2018,1,和牛,,94,95,96,93,94
 * m1,2018,1,霜降り明星,,94,96,95,93,95
 */

import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

const SEED_DIR = "seed_csv";
const IN_PATH  = process.argv[2] || path.join(SEED_DIR, "scores_wide.csv");
const OUT_JS   = path.join(SEED_DIR, "judge_scores.csv");

const canon = (s) => (s ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
const toNullable = (x) => {
  if (x === undefined || x === null) return null;
  const s = String(x).trim();
  return s === "" ? null : s;
};

if (!fs.existsSync(IN_PATH)) {
  console.error(`Input not found: ${IN_PATH}`);
  process.exit(1);
}
const rows = parse(fs.readFileSync(IN_PATH, "utf8"), {
  columns: true,
  skip_empty_lines: true,
  trim: true,
});

// 必須列チェック
const REQUIRED = ["comp", "year", "round_no", "comedian_name", "comedian_number"];
for (const col of REQUIRED) {
  if (!rows.length || !(col in rows[0])) {
    console.error(`Missing required column: ${col}`);
    process.exit(1);
  }
}

// seat_* 列を抽出（seat_1..seat_N）
const headers = Object.keys(rows[0]);
const seatCols = headers
  .filter(h => /^seat_\d+$/i.test(h))
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));

if (seatCols.length === 0) {
  console.error("No seat_* columns found (e.g., seat_1, seat_2, ...).");
  process.exit(1);
}

// judge_scores.csv をロング化
const jsRows = [];
for (const r of rows) {
  const comp = canon(r.comp);
  const year = Number(r.year);
  const round_no = Number(r.round_no);
  const comedian_name = canon(r.comedian_name);
  const comedian_number = toNullable(r.comedian_number) == null ? "" : String(Number(r.comedian_number));

  seatCols.forEach((col) => {
    const seatNo = Number(col.match(/\d+/)[0]); // seat_3 → 3
    const raw = toNullable(r[col]);
    if (raw == null) return; // 空セルはスキップ
    const score = Number(String(raw).replace(/[^\d.]/g, "")); // "94点" なども許容
    if (!Number.isFinite(score)) return;
    jsRows.push({
      comp,
      year,
      round_no,
      comedian_name,
      comedian_number,
      seat_no: seatNo,
      score
    });
  });
}

// 安定順（comp,year,round,comedian,seat）
jsRows.sort((a, b) =>
  a.comp.localeCompare(b.comp) ||
  a.year - b.year ||
  a.round_no - b.round_no ||
  a.comedian_name.localeCompare(b.comedian_name, "ja") ||
  a.seat_no - b.seat_no
);

// 出力
fs.mkdirSync(SEED_DIR, { recursive: true });
fs.writeFileSync(OUT_JS, stringify(jsRows, {
  header: true,
  columns: ["comp","year","round_no","comedian_name","comedian_number","seat_no","score"]
}), "utf8");

console.log(`OK: wrote ${OUT_JS} (${jsRows.length} rows) from ${IN_PATH}`);
