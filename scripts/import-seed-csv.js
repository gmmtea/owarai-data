// 使い方:
//  追記・修正のみ:  node scripts/import-seed-csv.js
//  完全同期:        node scripts/import-seed-csv.js --reset
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { parse } from "csv-parse/sync";
import crypto from "node:crypto";

const RESET = process.argv.includes("--reset");
const DB_PATH = "data/awards.sqlite";
const DIR = "seed_csv";

const canon = (s) => (s ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
const makeId = (name, number /* number | null */) => {
  const left  = canon(name);
  const right = (number == null || number === "") ? "" : `_${String(Number(number))}`;
  const base  = `${left}${right}`;
  // 接頭辞なし（先頭20桁hex = 80bit）
  return crypto.createHash("sha256").update(base, "utf8").digest("hex").slice(0, 20);
};
const isSafeCol = (name) => /^[a-z0-9_]+$/.test(name);

// 文字列rank→並び替え数値
function computeRankSort(rankRaw) {
  // 全角→半角、空白（半角/全角）除去
  const r = String(rankRaw ?? "")
    .normalize("NFKC")
    .replace(/[ \t\u3000]/g, "")
    .trim();
  if (r === "" || r.toLowerCase() === "null") return 99999;
  if (r === "優勝") return 1;
  if (r === "準優勝") return 2;
  if (r === "ベスト4") return 3;
  if (r === "決勝進出")   return 12;
  if (r === "ベスト8") return 12;
  if (r === "ファーストステージ敗退")   return 12;
  if (r === "準決勝進出")   return 50;
  if (r === "準々決勝進出") return 100;
  if (r === "3回戦進出")    return 500;
  if (r === "2回戦進出") return 1000;
  if (r === "1回戦敗退") return 5000;

  // "2位" など → 数字だけ拾う
  const m = r.match(/(\d+)/);
  return m ? Number(m[1]) : 99999;
}

const readCsv = (name) => {
  const p = path.join(DIR, name);
  if (!fs.existsSync(p)) return [];
  return parse(fs.readFileSync(p, "utf8"), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
};

// CSV読み込み
const competitions = readCsv("competitions.csv");   // key,name
const editions     = readCsv("editions.csv");       // comp,year
const comedians    = readCsv("comedians.csv");      // name,number
const results      = readCsv("final_results.csv");  // comp,year,comedian_name,rank, ...

fs.mkdirSync("data", { recursive: true });
const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

// --reset: 既存テーブルをDROP
if (RESET) {
  db.exec(`
    PRAGMA foreign_keys=OFF;
    DROP TABLE IF EXISTS final_results;
    DROP TABLE IF EXISTS comedians;
    DROP TABLE IF EXISTS editions;
    DROP TABLE IF EXISTS competitions;
    PRAGMA foreign_keys=ON;
  `);
}

// DDL（DROP後に必ず作る）
db.exec(`
-- 大会
 CREATE TABLE IF NOT EXISTS competitions (
   id   INTEGER PRIMARY KEY,
   key  TEXT UNIQUE NOT NULL,  -- 'm1' | 'koc' | 'r1'
   name TEXT NOT NULL,
   sort_order INTEGER
 );

-- 大会×年
CREATE TABLE IF NOT EXISTS editions (
  id              INTEGER PRIMARY KEY,
  competition_id  INTEGER NOT NULL REFERENCES competitions(id),
  year            INTEGER NOT NULL,
  UNIQUE (competition_id, year)
);

-- 芸人（(name,number)から決定的ID=TEXT主キー）
CREATE TABLE IF NOT EXISTS comedians (
  id   TEXT PRIMARY KEY,          -- 例: '3f9a3d...'
  name TEXT NOT NULL,
  number INTEGER,                          -- 重複時のみ 2,3,...
  UNIQUE (name, number)
);
CREATE INDEX IF NOT EXISTS idx_co_name_num ON comedians(name, number);

-- 決勝結果
CREATE TABLE IF NOT EXISTS final_results (
  id           INTEGER PRIMARY KEY,
  edition_id   INTEGER NOT NULL REFERENCES editions(id),
  comedian_id  TEXT    NOT NULL REFERENCES comedians(id),
  rank         TEXT    NOT NULL,
  rank_sort    INTEGER,
  UNIQUE (edition_id, comedian_id)
);

CREATE INDEX IF NOT EXISTS idx_fr_edition_rank ON final_results(edition_id, rank);
`);

// rank_sort が無ければ追加
const frInfo = db.prepare(`PRAGMA table_info('final_results')`).all();
const hasRankSort = frInfo.some((c) => c.name === "rank_sort");
if (!hasRankSort) {
  db.exec(`ALTER TABLE final_results ADD COLUMN rank_sort INTEGER`);
}
// 並び替え用インデックス
db.exec(`CREATE INDEX IF NOT EXISTS idx_fr_edition_ranksort ON final_results(edition_id, rank_sort)`);

// comedians（CSVにある分を先に登録）
const upsertCo = db.prepare(`
  INSERT INTO comedians (id, name, number)
  VALUES (?, ?, ?)
  ON CONFLICT(name, number) DO NOTHING
`);

// 1) マスタ投入（トランザクション）
db.transaction(() => {
  // competitions
  const upsertComp = db.prepare(`
    INSERT INTO competitions (key, name, sort_order) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      name       = excluded.name,
      sort_order = excluded.sort_order
  `);
  for (const r of competitions) {
    const so = r.sort_order === "" || r.sort_order == null ? null : Number(r.sort_order);
    upsertComp.run(r.key, r.name, so);
  }

  // editions
  const upsertEd = db.prepare(`
    INSERT INTO editions (competition_id, year)
    SELECT c.id, ? FROM competitions c WHERE c.key=?
    ON CONFLICT(competition_id, year) DO NOTHING
  `);
  for (const r of editions) upsertEd.run(Number(r.year), r.comp);

  // 初期投入（CSVのcomedians.csvがあれば）
  for (const r of comedians) {
    const name = canon(r.name);
    const num  = (r.number === "" || r.number == null) ? null : Number(r.number);
    const id   = makeId(name, num);
    upsertCo.run(id, name, num);
  }
})();

// 2) final_results の「増分列」をCSVヘッダから自動追加
const baseKeys = new Set(["comp", "year", "comedian_name", "comedian_number", "rank", "rank_sort"]);
const header = results[0] ? Object.keys(results[0]) : [];
const extraCols = header.filter((h) => !baseKeys.has(h));
for (const col of extraCols) {
  if (!isSafeCol(col)) throw new Error(`列名が不正です: ${col}（英小文字・数字・_ のみ）`);
}
// 既存列
const tableInfo = db.prepare(`PRAGMA table_info('final_results')`).all();
const existingCols = new Set(tableInfo.map((t) => t.name));
// 型推定
const inferType = (name) => {
  const vals = results.map((r) => r[name]).filter((v) => v !== undefined && String(v).trim() !== "");
  const allInt = vals.length > 0 && vals.every((v) => /^-?\d+$/.test(String(v)));
  const allNum = vals.length > 0 && vals.every((v) => /^-?\d+(\.\d+)?$/.test(String(v)));
  if (allInt) return "INTEGER";
  if (allNum) return "REAL";
  return "TEXT";
};
// 無い列だけ追加
for (const col of extraCols) {
  if (!existingCols.has(col)) {
    const t = inferType(col);
    db.exec(`ALTER TABLE final_results ADD COLUMN "${col}" ${t}`);
  }
}

// 3) final_results をUPSERT（動的列対応・不足芸人は自動作成）
const getEd = db.prepare(`
  SELECT e.id AS id
  FROM editions e JOIN competitions c ON c.id = e.competition_id
  WHERE c.key = ? AND e.year = ? LIMIT 1
`);
const getCoByNameNum = db.prepare(`
  SELECT id FROM comedians WHERE name = ? AND ((number IS NULL AND ? IS NULL) OR number = ?) LIMIT 1
`);
const hasNullNumber = db.prepare(`SELECT 1 FROM comedians WHERE name=? AND number IS NULL LIMIT 1`);
const maxNumber     = db.prepare(`SELECT MAX(number) AS n FROM comedians WHERE name=? AND number IS NOT NULL`);
const getCoByNameNoteLegacy = db.prepare(`
  SELECT id FROM comedians WHERE name = ?
  ORDER BY number IS NOT NULL, number  -- number 指定がある行を優先的に避ける（=NULLが先）
  LIMIT 1
`);
const insertWithAutoNumber = (name) => {
  // name で NULL 番が空いていれば NULL を使う。既に居れば max+1 を使う（2から始まる想定）
  const nullExists = hasNullNumber.get(name);
  const next = nullExists ? (maxNumber.get(name)?.n ?? 1) + 1 : null;
  const id   = makeId(name, next);
  upsertCo.run(id, name, next);
  return getCoByNameNum.get(name, next, next);
};
const insCo = db.prepare(`
  INSERT INTO comedians (id, name, number) VALUES (?, ?, ?)
  ON CONFLICT(name, number) DO NOTHING
`);

// 挿入列の配列（rank + 追加列）
const insertCols = ["edition_id", "comedian_id", "rank", "rank_sort", ...extraCols];
const namedCols   = insertCols.map(c => `"${c}"`).join(",");
const namedValues = insertCols.map(c => `@${c}`).join(",");
const updateSet = ["rank", "rank_sort", ...extraCols]
  .map(c => `"${c}" = excluded."${c}"`)
  .join(", ");
const stmt = db.prepare(`
  INSERT INTO final_results (${namedCols})
  VALUES (${namedValues})
  ON CONFLICT(edition_id, comedian_id) DO UPDATE SET ${updateSet}
`);

const toNullable = (x) => {
  if (x === undefined || x === null) return null;
  const s = String(x).trim();
  return s === "" ? null : s;
};

db.transaction(() => {
  for (const r of results) {
    const ed = getEd.get(r.comp, Number(r.year));
    if (!ed) throw new Error(`edition not found: ${r.comp} ${r.year}`);

    // 芸人が未登録でもCSVの行から自動作成
    const name = canon(r.comedian_name);
    const numberFromCsv = ("comedian_number" in r && r.comedian_number !== "" && r.comedian_number != null)
      ? Number(r.comedian_number) : null;
    let co = null;
    if (numberFromCsv != null) {
      co = getCoByNameNum.get(name, numberFromCsv, numberFromCsv);
      if (!co) { const id = makeId(name, numberFromCsv); upsertCo.run(id, name, numberFromCsv); co = getCoByNameNum.get(name, numberFromCsv, numberFromCsv); }
    } else {
      // number 指定が無いとき：
      //  1) (name, NULL) が未使用ならそれを作る
      //  2) 既に使用済なら max(number)+1 を自動採番
      co = getCoByNameNum.get(name, null, null);
      if (!co) { co = insertWithAutoNumber(name); }
    }

    const rankText = String(r.rank);
    const rankSort = computeRankSort(rankText);

    const params = {
      edition_id: ed.id,
      comedian_id: co.id,
      rank: rankText,
      rank_sort: rankSort,
    };
    for (const k of extraCols) params[k] = toNullable(r[k]);

    stmt.run(params);
  }
})();

db.close();
console.log(`OK: CSV imported ${RESET ? "(reset)" : "(upsert)"} & columns synced`);
