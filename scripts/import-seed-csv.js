// 使い方:
//   通常:   node scripts/import-seed-csv.js              ← 既定が“完全同期（reset）”
//   例外時: node scripts/import-seed-csv.js --no-reset   ← 何もせず安全終了（保守用）
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { parse } from "csv-parse/sync";
import crypto from "node:crypto";

/* ============================= 基本設定 ============================= */
const NO_RESET = process.argv.includes("--no-reset");     // 例外運用のみ
const DIR      = "seed_csv";                              // CSV置き場
const DB_PATH  = "data/awards.sqlite";                    // 本番ファイル
const TMP_PATH = "data/awards.tmp.sqlite";                // 一時ファイル

if (NO_RESET) {
  console.log("SKIP: --no-reset 指定のためDB差し替えは行いません。");
  process.exit(0);
}

fs.mkdirSync("data", { recursive: true });

/* ============================= ユーティリティ ============================= */
// 文字正規化: NFKC + 余分な空白の圧縮
const canon = (s) => (s ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");

// (name, number) から決定的ID（sha256先頭20hex=80bit）
const makeId = (name, number /* number|null */) => {
  const left  = canon(name);
  const right = (number == null || number === "") ? "" : `_${String(Number(number))}`;
  const base  = `${left}${right}`;
  return crypto.createHash("sha256").update(base, "utf8").digest("hex").slice(0, 20);
};

// judges用のID（名前のみで決定）
const makeJudgeId = (name) =>
  crypto.createHash("sha256").update(canon(name), "utf8").digest("hex").slice(0, 20);

// 列名バリデーション（final_resultsの動的列）
const isSafeCol = (name) => /^[a-z0-9_]+$/.test(name);

// CSVローダ（無ければ空配列）
const readCsv = (name) => {
  const p = path.join(DIR, name);
  if (!fs.existsSync(p)) return [];
  return parse(fs.readFileSync(p, "utf8"), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
};

// かな判定（ひら/カナ＋長音・中点・空白）
const reKanaOnly = /^[\p{sc=Hiragana}\p{sc=Katakana}ー・\s]+$/u;
const isKanaOnly = (s) => reKanaOnly.test(canon(s));
// カタカナ→ひらがな
const toHiragana = (s) => s.replace(/[\u30A1-\u30F6]/g, ch =>
  String.fromCharCode(ch.charCodeAt(0) - 0x60)
);
// 読みの正規化（ひらがな寄せ）
const normalizeReading = (s) => {
  if (s == null) return null;
  const t = canon(String(s));
  if (t === "") return null;
  return toHiragana(t);
};

// 文字列rank→並び替え数値（rank_sort）
function computeRankSort(rankRaw) {
  const r = String(rankRaw ?? "")
    .normalize("NFKC")
    .replace(/[ \t\u3000]/g, "")
    .trim();
  if (r === "" || r.toLowerCase() === "null") return 99999;
  if (r === "優勝") return 1;
  if (r === "準優勝") return 2;
  if (r === "ベスト4") return 3;
  if (r === "決勝進出") return 12;
  if (r === "ベスト8") return 12;
  if (r === "ファーストステージ敗退") return 12;
  if (r === "準決勝進出") return 50;
  if (r === "準々決勝進出") return 100;
  if (r === "3回戦進出") return 500;
  if (r === "2回戦進出") return 1000;
  if (r === "1回戦敗退") return 5000;
  const m = r.match(/(\d+)/);
  return m ? Number(m[1]) : 99999;
}

const toNullable = (x) => {
  if (x === undefined || x === null) return null;
  const s = String(x).trim();
  return s === "" ? null : s;
};

/* ============================= CSV 読み込み ============================= */
// 空でも進む。空なら該当テーブルは0件で終わるだけ。
const competitions       = readCsv("competitions.csv");     // key,name,sort_order?
const editions           = readCsv("editions.csv");         // comp,year,title,seq_no,final_date,short_label
const comediansCsv       = readCsv("comedians.csv");        // name,number,reading?
const results            = readCsv("final_results.csv");    // comp,year,comedian_name,rank,...(動的列)
const judgesCsv          = readCsv("judges.csv");           // name
const editionJudgesCsv   = readCsv("edition_judges.csv");   // comp,year,seat_no,judge_name
const judgeScoresCsv     = readCsv("judge_scores.csv");     // comp,year,round_no,comedian_name,comedian_number,seat_no,score

/* ============================= final_results の動的列定義 ============================= */
// 既知の基本キー以外の列を追加列として採用（型はヘッダ値から簡易推定）
const BASE_KEYS = new Set(["comp","year","comedian_name","comedian_number","rank","rank_sort"]);
const header = results[0] ? Object.keys(results[0]) : [];
const extraCols = header.filter(h => !BASE_KEYS.has(h));
for (const col of extraCols) {
  if (!isSafeCol(col)) {
    throw new Error(`列名が不正です: ${col}（英小文字・数字・_ のみ）`);
  }
}
// 簡易型推定
const inferType = (name) => {
  const vals = results.map(r => r[name]).filter(v => v !== undefined && String(v).trim() !== "");
  const allInt = vals.length > 0 && vals.every(v => /^-?\d+$/.test(String(v)));
  const allNum = vals.length > 0 && vals.every(v => /^-?\d+(\.\d+)?$/.test(String(v)));
  if (allInt) return "INTEGER";
  if (allNum) return "REAL";
  return "TEXT";
};

/* ============================= 一時DBへ全投入 ============================= */
if (fs.existsSync(TMP_PATH)) fs.rmSync(TMP_PATH);
const db = new Database(TMP_PATH);
// 差し替え方式なのでWALは不要。速度と一貫性のバランスを取る。
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = DELETE");
db.pragma("synchronous = NORMAL");

db.transaction(() => {
  /* ---------- DDL（毎回ゼロから作成） ---------- */
  db.exec(`
    -- 大会
    CREATE TABLE competitions (
      id          INTEGER PRIMARY KEY,
      key         TEXT UNIQUE NOT NULL,    -- 'm1' | 'koc' | 'r1' 等
      name        TEXT NOT NULL,
      sort_order  INTEGER
    );

    -- 大会×年
    CREATE TABLE editions (
      id              INTEGER PRIMARY KEY,
      competition_id  INTEGER NOT NULL REFERENCES competitions(id),
      year            INTEGER,            -- 互換用
      title           TEXT,
      seq_no          INTEGER,
      final_date      TEXT,               -- 'YYYY-MM-DD'
      short_label     TEXT,
      UNIQUE (competition_id, year)
    );
    CREATE INDEX idx_editions_comp_seq  ON editions(competition_id, seq_no);
    CREATE INDEX idx_editions_comp_date ON editions(competition_id, final_date);

    -- 芸人（(name,number)の複合ユニーク → TEXT主キー）
    CREATE TABLE comedians (
      id      TEXT PRIMARY KEY,
      name    TEXT NOT NULL,
      number  INTEGER,
      reading TEXT,                       -- ひらがな
      UNIQUE (name, number)
    );
    CREATE INDEX idx_co_name_num ON comedians(name, number);
  `);

  // final_results は動的列を含めてDDLを生成
  const extraDDL = extraCols.map(c => `"${c}" ${inferType(c)}`).join(",\n      ");
  db.exec(`
    CREATE TABLE final_results (
      id           INTEGER PRIMARY KEY,
      edition_id   INTEGER NOT NULL REFERENCES editions(id),
      comedian_id  TEXT    NOT NULL REFERENCES comedians(id),
      rank         TEXT    NOT NULL,
      rank_sort    INTEGER,
      ${extraDDL || "-- no extra columns"}
      ${extraDDL ? "," : ""}
      UNIQUE (edition_id, comedian_id)
    );
    CREATE INDEX idx_fr_edition_rank     ON final_results(edition_id, rank);
    CREATE INDEX idx_fr_edition_ranksort ON final_results(edition_id, rank_sort);
  `);

  db.exec(`
    -- 審査員
    CREATE TABLE judges (
      id    TEXT PRIMARY KEY,
      name  TEXT UNIQUE NOT NULL
    );

    -- 席配置
    CREATE TABLE edition_judges (
      edition_id INTEGER NOT NULL REFERENCES editions(id),
      seat_no    INTEGER NOT NULL,
      judge_id   TEXT    NOT NULL REFERENCES judges(id),
      PRIMARY KEY (edition_id, seat_no)
    );

    -- 個票
    CREATE TABLE judge_scores (
      edition_id  INTEGER NOT NULL REFERENCES editions(id),
      round_no    INTEGER NOT NULL,
      comedian_id TEXT    NOT NULL REFERENCES comedians(id),
      seat_no     INTEGER NOT NULL,
      score       REAL    NOT NULL,
      PRIMARY KEY (edition_id, round_no, comedian_id, seat_no)
    );
    CREATE INDEX idx_js_edition_round ON judge_scores(edition_id, round_no);
  `);

  /* ---------- 参照用の簡易SELECT ---------- */
  const selCompByKey = db.prepare(`SELECT id FROM competitions WHERE key=? LIMIT 1`);
  const selEdByCompYear = db.prepare(`
    SELECT e.id AS id
    FROM editions e JOIN competitions c ON c.id=e.competition_id
    WHERE c.key=? AND e.year=? LIMIT 1
  `);
  const selCoByNameNum = db.prepare(`
    SELECT id FROM comedians WHERE name=? AND ((number IS NULL AND ? IS NULL) OR number=?) LIMIT 1
  `);
  const hasNullNumber = db.prepare(`SELECT 1 FROM comedians WHERE name=? AND number IS NULL LIMIT 1`);
  const maxNumber     = db.prepare(`SELECT MAX(number) AS n FROM comedians WHERE name=? AND number IS NOT NULL`);

  /* ---------- INSERT系の準備 ---------- */
  const insComp = db.prepare(`
    INSERT INTO competitions(key, name, sort_order) VALUES (?, ?, ?)
  `);
  const insEd = db.prepare(`
    INSERT INTO editions(competition_id, year, title, seq_no, final_date, short_label)
    SELECT c.id, @year, @title, @seq, @date, @label FROM competitions c WHERE c.key=@comp
  `);
  const insCo = db.prepare(`
    INSERT INTO comedians(id, name, number, reading) VALUES (?, ?, ?, ?)
    ON CONFLICT(name, number) DO NOTHING
  `);
  const insFR = (() => {
    const cols = ["edition_id","comedian_id","rank","rank_sort", ...extraCols];
    const names = cols.map(c => `"${c}"`).join(",");
    const params = cols.map(c => `@${c}`).join(",");
    return db.prepare(`INSERT INTO final_results(${names}) VALUES(${params})
                       ON CONFLICT(edition_id, comedian_id) DO UPDATE SET
                         rank=excluded.rank, rank_sort=excluded.rank_sort${extraCols.map(c=>`, "${c}"=excluded."${c}"`).join("")}`);
  })();
  const insJudge = db.prepare(`INSERT INTO judges(id, name) VALUES (?, ?) ON CONFLICT(name) DO NOTHING`);
  const insEdJudge = db.prepare(`
    INSERT INTO edition_judges(edition_id, seat_no, judge_id)
    VALUES (?, ?, ?)
    ON CONFLICT(edition_id, seat_no) DO UPDATE SET judge_id=excluded.judge_id
  `);
  const insJudgeScore = db.prepare(`
    INSERT INTO judge_scores(edition_id, round_no, comedian_id, seat_no, score)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(edition_id, round_no, comedian_id, seat_no) DO UPDATE SET score=excluded.score
  `);

  /* ---------- データ投入（順に依存関係を満たす） ---------- */
  // competitions
  for (const r of competitions) {
    const so = (r.sort_order ?? "") === "" ? null : Number(r.sort_order);
    insComp.run(r.key, r.name, so);
  }

  // editions
  for (const r of editions) {
    const y   = (r.year ?? "") === "" ? null : Number(r.year);
    const seq = (r.seq_no ?? "") === "" ? null : Number(r.seq_no);
    const dt  = (r.final_date ?? "").trim() || null;
    const lab = (r.short_label ?? "").trim() || null;
    const ttl = (r.title ?? "").trim() || null;
    insEd.run({ comp:r.comp, year:y, title:ttl, seq, date:dt, label:lab });
  }

  // comedians（初期マスタ）
  for (const r of comediansCsv) {
    const name = canon(r.name);
    const num  = (r.number === "" || r.number == null) ? null : Number(r.number);
    const id   = makeId(name, num);
    const readingCsv = normalizeReading(r.reading);
    const readingGuess = (!readingCsv && isKanaOnly(name)) ? toHiragana(name) : readingCsv;
    insCo.run(id, name, num, readingGuess ?? null);
  }

  // final_results
  for (const r of results) {
    const ed = selEdByCompYear.get(r.comp, Number(r.year));
    if (!ed) throw new Error(`edition not found: ${r.comp} ${r.year}`);

    const name = canon(r.comedian_name);
    const numberFromCsv = ("comedian_number" in r && r.comedian_number !== "" && r.comedian_number != null)
      ? Number(r.comedian_number) : null;

    // 芸人ID解決（なければ自動作成: NULL番が空いていればNULL、埋まっていればmax+1）
    let coRow = selCoByNameNum.get(name, numberFromCsv, numberFromCsv);
    if (!coRow) {
      const nullExists = hasNullNumber.get(name);
      const next = (numberFromCsv != null) ? numberFromCsv
                 : nullExists ? (maxNumber.get(name)?.n ?? 1) + 1
                 : null;
      const id = makeId(name, next);
      const guess = isKanaOnly(name) ? toHiragana(name) : null;
      insCo.run(id, name, next, guess);
      coRow = selCoByNameNum.get(name, next, next);
    }
    const rankText = String(r.rank);
    const rankSort = computeRankSort(rankText);

    const params = { edition_id: ed.id, comedian_id: coRow.id, rank: rankText, rank_sort: rankSort };
    for (const k of extraCols) params[k] = toNullable(r[k]);
    insFR.run(params);
  }

  // judges
  for (const r of judgesCsv) {
    const name = canon(r.name);
    if (!name) continue;
    const id = makeJudgeId(name);
    insJudge.run(id, name);
  }

  // edition_judges
  for (const r of editionJudgesCsv) {
    const ed = selEdByCompYear.get(r.comp, Number(r.year));
    if (!ed) throw new Error(`edition not found: ${r.comp} ${r.year}`);
    const seatNo = Number(r.seat_no);
    const jname  = canon(r.judge_name);
    if (!jname || !Number.isFinite(seatNo)) continue;
    const jid = makeJudgeId(jname);
    insJudge.run(jid, jname);                 // 無ければ入る、あればNO-OP
    insEdJudge.run(ed.id, seatNo, jid);
  }

  // judge_scores
  for (const r of judgeScoresCsv) {
    const ed = selEdByCompYear.get(r.comp, Number(r.year));
    if (!ed) throw new Error(`edition not found: ${r.comp} ${r.year}`);

    const roundNo = Number(r.round_no);
    const seatNo  = Number(r.seat_no);
    if (!Number.isFinite(roundNo) || !Number.isFinite(seatNo)) continue;

    const name = canon(r.comedian_name);
    const numberFromCsv = ("comedian_number" in r && r.comedian_number !== "" && r.comedian_number != null)
      ? Number(r.comedian_number) : null;

    let co = selCoByNameNum.get(name, numberFromCsv, numberFromCsv);
    if (!co) {
      const nullExists = hasNullNumber.get(name);
      const next = (numberFromCsv != null) ? numberFromCsv
                 : nullExists ? (maxNumber.get(name)?.n ?? 1) + 1
                 : null;
      const id = makeId(name, next);
      insCo.run(id, name, next, null);
      co = selCoByNameNum.get(name, next, next);
    }

    const scoreRaw = String(r.score ?? "").trim();
    if (scoreRaw === "") continue;
    const score = Number(scoreRaw);
    if (!Number.isFinite(score)) continue;

    insJudgeScore.run(ed.id, roundNo, co.id, seatNo, score);
  }
})();

/* ============================= 差し替え（原子的） ============================= */
db.close();

try {
  // POSIXではrenameは原子的に上書きされる（同一FS前提）
  // 既存DBが無くても問題なし
  fs.renameSync(TMP_PATH, DB_PATH);
  console.log("OK: CSV imported (reset default) → awards.sqlite replaced");
} catch (e) {
  // 失敗時は一時DBを残さない
  try { if (fs.existsSync(TMP_PATH)) fs.rmSync(TMP_PATH); } catch {}
  throw e;
}
