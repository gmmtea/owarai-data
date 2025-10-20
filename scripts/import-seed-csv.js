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

// かな判定（ひらがな or カタカナのみ）
const reKanaOnly = /^[\p{sc=Hiragana}\p{sc=Katakana}ー・\s]+$/u;
const isKanaOnly = (s) => reKanaOnly.test(canon(s));

// カタカナ→ひらがな（U+30A1〜U+30F6 → -0x60）
const toHiragana = (s) => s.replace(/[\u30A1-\u30F6]/g, ch =>
  String.fromCharCode(ch.charCodeAt(0) - 0x60)
);

// 読みの正規化：ひらがなに寄せつつトリム
const normalizeReading = (s) => {
  if (s == null) return null;
  const t = canon(String(s));
  if (t === "") return null;
  // カタカナならひらがなに
  return toHiragana(t);
};

// judge の決定的ID（名前のみで決定）
const makeJudgeId = (name) =>
  crypto.createHash("sha256").update(canon(name), "utf8").digest("hex").slice(0, 20);

// CSV読み込み
const competitions = readCsv("competitions.csv");   // key,name
const editions     = readCsv("editions.csv");       // comp,year,title,seq_no,final_date,short_label
const comedians    = readCsv("comedians.csv");      // name,number,reading(任意)
const results      = readCsv("final_results.csv");  // comp,year,comedian_name,rank, ...
const judgesCsv        = readCsv("judges.csv");          // name
const editionJudgesCsv = readCsv("edition_judges.csv");  // comp,year,seat_no,judge_name
const judgeScoresCsv   = readCsv("judge_scores.csv");    // comp,year,round_no,comedian_name,comedian_number,seat_no,score

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
    year            INTEGER,           -- 互換用（NULL許容にしておく）
    title           TEXT,              -- 例: "M-1グランプリ2025" / "第44回ABCお笑いグランプリ"
    seq_no          INTEGER,           -- 回数（不明ならNULL）
    final_date      TEXT,              -- "YYYY-MM-DD"（ISO8601文字列）
    short_label     TEXT,              -- 例: "2025" / "第44回"
    UNIQUE (competition_id, year)      -- 既存互換。year未入力の行は重複しないよう注意
  );
  CREATE INDEX IF NOT EXISTS idx_editions_comp_seq   ON editions(competition_id, seq_no);
  CREATE INDEX IF NOT EXISTS idx_editions_comp_date  ON editions(competition_id, final_date);

  -- 芸人（(name,number)から決定的ID=TEXT主キー）
  CREATE TABLE IF NOT EXISTS comedians (
    id      TEXT PRIMARY KEY,
    name    TEXT NOT NULL,
    number  INTEGER,
    reading TEXT,             -- ひらがな（null可）
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

  -- 審査員マスタ（将来の読み仮名や所属も足せる）
  CREATE TABLE IF NOT EXISTS judges (
    id      TEXT PRIMARY KEY,     -- 例: sha1(name)先頭など
    name    TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_judges_name ON judges(name);

  -- そのエディションの席配置（左から seat_no=1,2,...）
  CREATE TABLE IF NOT EXISTS edition_judges (
    edition_id INTEGER NOT NULL REFERENCES editions(id),
    seat_no    INTEGER NOT NULL,
    judge_id   TEXT    NOT NULL REFERENCES judges(id),
    PRIMARY KEY (edition_id, seat_no)
  );

  -- ラウンド別の個別得点（1本目=1, 2本目=2 を推奨）
  CREATE TABLE IF NOT EXISTS judge_scores (
    edition_id  INTEGER NOT NULL REFERENCES editions(id),
    round_no    INTEGER NOT NULL,               -- 1 | 2 | （将来3も可）
    comedian_id TEXT    NOT NULL REFERENCES comedians(id),
    seat_no     INTEGER NOT NULL,               -- edition_judges.seat_no に対応
    score       REAL    NOT NULL,               -- 小数対応（必要ならINTEGERでもOK）
    PRIMARY KEY (edition_id, round_no, comedian_id, seat_no)
  );
  CREATE INDEX IF NOT EXISTS idx_js_edition_round ON judge_scores(edition_id, round_no);
`);

// comedians.reading が無ければ追加（SQLite流の存在確認）
const coInfo = db.prepare(`PRAGMA table_info('comedians')`).all();
if (!coInfo.some(c => c.name === 'reading')) {
  db.exec(`ALTER TABLE comedians ADD COLUMN reading TEXT`);
}

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
  INSERT INTO comedians (id, name, number, reading)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(name, number) DO UPDATE SET
    reading = COALESCE(comedians.reading, excluded.reading)
`);

const upsertCoWithReading = db.prepare(`
  INSERT INTO comedians (id, name, number, reading)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(name, number) DO UPDATE SET
    reading = COALESCE(comedians.reading, excluded.reading)
`);

// 既存がNULLかつ名前がかなだけなら reading を補完
const fillReadingIfNull = db.prepare(`
  UPDATE comedians
     SET reading = ?
   WHERE id = ? AND (reading IS NULL OR TRIM(reading) = '')
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
    INSERT INTO editions (competition_id, year, title, seq_no, final_date, short_label)
    SELECT c.id, @year, @title, @seq, @date, @label
    FROM competitions c WHERE c.key=@comp
    ON CONFLICT(competition_id, year) DO UPDATE SET
      title       = COALESCE(excluded.title,       editions.title),
      seq_no      = COALESCE(excluded.seq_no,      editions.seq_no),
      final_date  = COALESCE(excluded.final_date,  editions.final_date),
      short_label = COALESCE(excluded.short_label, editions.short_label)
  `);

  for (const r of editions) {
    const y   = (r.year ?? "") === "" ? null : Number(r.year);
    const seq = (r.seq_no ?? "") === "" ? null : Number(r.seq_no);
    const dt  = (r.final_date ?? "").trim() || null;     // "YYYY-MM-DD" or null
    const lab = (r.short_label ?? "").trim() || null;
    const ttl = (r.title ?? "").trim() || null;

    upsertEd.run({
      comp:  r.comp,
      year:  y,
      title: ttl,
      seq:   seq,
      date:  dt,
      label: lab,
    });
  }

  // 初期投入（CSVのcomedians.csvがあれば）
  for (const r of comedians) {
    const name = canon(r.name);
    const num  = (r.number === "" || r.number == null) ? null : Number(r.number);
    const id   = makeId(name, num);
    // CSVのreadingがあれば採用。無ければ「名前がかなだけ」の時に自動推定
    const readingCsv   = normalizeReading(r.reading);
    const readingGuess = (!readingCsv && isKanaOnly(name)) ? toHiragana(name) : readingCsv;
    upsertCo.run(id, name, num, readingGuess ?? null);
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

// judges
const getJudgeByName = db.prepare(`SELECT id FROM judges WHERE name=? LIMIT 1`);
const upsertJudge = db.prepare(`
  INSERT INTO judges (id, name)
  VALUES (?, ?)
  ON CONFLICT(name) DO NOTHING
`);

// edition_judges
const upsertEditionJudge = db.prepare(`
  INSERT INTO edition_judges (edition_id, seat_no, judge_id)
  VALUES (?, ?, ?)
  ON CONFLICT(edition_id, seat_no) DO UPDATE SET judge_id=excluded.judge_id
`);

// judge_scores
const upsertJudgeScore = db.prepare(`
  INSERT INTO judge_scores (edition_id, round_no, comedian_id, seat_no, score)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(edition_id, round_no, comedian_id, seat_no) DO UPDATE SET score=excluded.score
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
      if (!co) {
        const id = makeId(name, numberFromCsv);
        const guess = isKanaOnly(name) ? toHiragana(name) : null;
        upsertCoWithReading.run(id, name, numberFromCsv, guess);
        co = getCoByNameNum.get(name, numberFromCsv, numberFromCsv);
      } else {
        // 既存が読み無しで、名前がかななら補完
        const guess = isKanaOnly(name) ? toHiragana(name) : null;
        if (guess) fillReadingIfNull.run(guess, co.id);
      }
    } else {
      // number 指定が無いとき：
      //  1) (name, NULL) が未使用ならそれを作る
      //  2) 既に使用済なら max(number)+1 を自動採番
      co = getCoByNameNum.get(name, null, null);
      if (!co) {
        // insertWithAutoNumber を reading 対応に差し替え
        const nullExists = hasNullNumber.get(name);
        const next = nullExists ? (maxNumber.get(name)?.n ?? 1) + 1 : null;
        const id   = makeId(name, next);
        const guess = isKanaOnly(name) ? toHiragana(name) : null;
        upsertCoWithReading.run(id, name, next, guess);
        co = getCoByNameNum.get(name, next, next);
      } else {
        const guess = isKanaOnly(name) ? toHiragana(name) : null;
        if (guess) fillReadingIfNull.run(guess, co.id);
      }
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

// === 1) judges.csv を反映（読みがあれば採用、無ければ保持優先） ===
db.transaction(() => {
  for (const r of judgesCsv) {
    const name = canon(r.name);
    if (!name) continue;
    const row = getJudgeByName.get(name);
    if (!row) {
      const id = makeJudgeId(name);
      upsertJudge.run(id, name);
    }
  }
})();

// === 2) edition_judges.csv（座席配置） ===
// comp/year → edition_id、judge_name → judge_id を解決して upsert
db.transaction(() => {
  for (const r of editionJudgesCsv) {
    const ed = getEd.get(r.comp, Number(r.year));
    if (!ed) throw new Error(`edition not found: ${r.comp} ${r.year}`);
    const seatNo = Number(r.seat_no);
    const jname = canon(r.judge_name);
    if (!jname || !Number.isFinite(seatNo)) continue;

    let j = getJudgeByName.get(jname);
    if (!j) {
      const id = makeJudgeId(jname);
      upsertJudge.run(id, jname);      // ← reading なし
      j = getJudgeByName.get(jname);
    }
    upsertEditionJudge.run(ed.id, seatNo, j.id);
  }
})();

// === 3) judge_scores.csv（個票） ===
// comp/year/round_no/comedian/seat_no を解決し、score を upsert
db.transaction(() => {
  for (const r of judgeScoresCsv) {
    const ed = getEd.get(r.comp, Number(r.year));
    if (!ed) throw new Error(`edition not found: ${r.comp} ${r.year}`);

    const roundNo = Number(r.round_no);
    const seatNo  = Number(r.seat_no);
    if (!Number.isFinite(roundNo) || !Number.isFinite(seatNo)) continue;

    // 芸人ID解決（既存の方法に合わせる）
    const name = canon(r.comedian_name);
    const numberFromCsv = ("comedian_number" in r && r.comedian_number !== "" && r.comedian_number != null)
      ? Number(r.comedian_number) : null;

    let co = null;
    if (numberFromCsv != null) {
      co = getCoByNameNum.get(name, numberFromCsv, numberFromCsv);
      if (!co) { const id = makeId(name, numberFromCsv); insCo.run(id, name, numberFromCsv); co = getCoByNameNum.get(name, numberFromCsv, numberFromCsv); }
    } else {
      co = getCoByNameNum.get(name, null, null);
      if (!co) {
        // 既存の自動採番ロジックと同等
        const nullExists = hasNullNumber.get(name);
        const next = nullExists ? (maxNumber.get(name)?.n ?? 1) + 1 : null;
        const id   = makeId(name, next);
        insCo.run(id, name, next);
        co = getCoByNameNum.get(name, next, next);
      }
    }

    // スコア
    const scoreRaw = String(r.score ?? "").trim();
    if (scoreRaw === "") continue;
    const score = Number(scoreRaw);
    if (!Number.isFinite(score)) continue;

    upsertJudgeScore.run(ed.id, roundNo, co.id, seatNo, score);
  }
})();

db.close();
console.log(`OK: CSV imported ${RESET ? "(reset)" : "(upsert)"} & columns synced`);
