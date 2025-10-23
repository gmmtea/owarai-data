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
const trimOnly = (s) => (s ?? "").toString().trim();

// (name, note) から決定的ID（sha256先頭20hex=80bit）
const makeId = (name, note) => {
  const left  = trimOnly(name);
  const right = (note == null || note === "") ? "" : `_${trimOnly(String(note))}`;
  const base  = `${left}${right}`;
  return crypto.createHash("sha256").update(base, "utf8").digest("hex").slice(0, 20);
};

// judges用のID（名前のみで決定）
const makeJudgeId = (name) =>
  crypto.createHash("sha256").update(trimOnly(name), "utf8").digest("hex").slice(0, 20);

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
const isKanaOnly = (s) => reKanaOnly.test(trimOnly(s));
// カタカナ→ひらがな
const toHiragana = (s) => s.replace(/[\u30A1-\u30F6]/g, ch =>
  String.fromCharCode(ch.charCodeAt(0) - 0x60)
);
// 読みの正規化（ひらがな寄せ）
const normalizeReading = (s) => {
  if (s == null) return null;
  const t = trimOnly(String(s));
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
  if (r === "マイナビ賞") return 2;
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

// グループ名はユーザー定義の任意文字列を許可（NFKC＋trimのみ）
function normalizeIntOrNull(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (!/^-?\d+$/.test(s)) {
    console.warn(`[warn] first_order 非整数を検出: "${s}" → null にします`);
    return null;
  }
  return Math.trunc(Number(s));
}

// kind 正準化ヘルパ（1文字略記対応）
function normalizeKind(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (s === "p" || s === "person") return "person";
  if (s === "u" || s === "unit")   return "unit";
  return null; // 不明はNULLで取り込む（後から補完可）
}

/* ============================= CSV 読み込み ============================= */
// 空でも進む。空なら該当テーブルは0件で終わるだけ。
const competitions       = readCsv("competitions.csv");     // key,name,sort_order?
const editions           = readCsv("editions.csv");         // comp,year,title,seq_no,final_date,short_label
const comediansCsv       = readCsv("comedians.csv");        // name,note,reading?
const results            = readCsv("final_results.csv");    // comp,year,comedian_name,rank,...(動的列)
const judgesCsv          = readCsv("judges.csv");           // name
const editionJudgesCsv   = readCsv("edition_judges.csv");   // comp,year,seat_no,judge_name
const judgeScoresCsv     = readCsv("judge_scores.csv");     // comp,year,round_no,comedian_name,comedian_note,seat_no,score
const membershipsCsv     = readCsv("memberships.csv");      // unit_name,unit_note,person_name,person_note

/* ============================= final_results の動的列定義 ============================= */
// 既知の基本キー以外の列を追加列として採用（型はヘッダ値から簡易推定）
const BASE_KEYS = new Set(["comp","year","comedian_name","comedian_note","rank","rank_sort"]);
const header = results[0] ? Object.keys(results[0]) : [];
let extraCols = header.filter(h => !BASE_KEYS.has(h));

// 列順を調整：first_group を first_order の直前に移動
{
  const io = extraCols.indexOf("first_order");
  const ig = extraCols.indexOf("first_group");
  if (io !== -1 && ig !== -1 && ig > io) {
    extraCols.splice(ig, 1);
    extraCols.splice(io, 0, "first_group");
  }
}

for (const col of extraCols) {
  if (!isSafeCol(col)) {
    throw new Error(`列名が不正です: ${col}（英小文字・数字・_ のみ）`);
  }
}
// 簡易型推定
const inferType = (name) => {
  if (/_order$/.test(name)) return "INTEGER";
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

    -- 芸人（(name,note)の複合ユニーク → TEXT主キー）
    CREATE TABLE comedians (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      note        TEXT,
      reading     TEXT,                                    -- ひらがな
      kind        TEXT CHECK (kind IN ('person','unit')),  -- NULL許容
      birth_date  TEXT,                                    -- 個人向け 'YYYY-MM-DD'
      formed_date TEXT,                                    -- ユニット向け 'YYYY-MM-DD'
      UNIQUE (name, note)
    );
    CREATE INDEX idx_co_name_note ON comedians(name, note);

    -- 芸人のユニット所属関係
    CREATE TABLE memberships (
      unit_id   TEXT NOT NULL REFERENCES comedians(id),
      person_id TEXT NOT NULL REFERENCES comedians(id),
      PRIMARY KEY (unit_id, person_id)
    );
    CREATE INDEX idx_memberships_person ON memberships(person_id);
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
  const selCoByNameNote = db.prepare(`
    SELECT id, kind FROM comedians
    WHERE name=? AND ((note IS NULL AND ? IS NULL) OR note=?)
    LIMIT 1
  `);

  /* ---------- INSERT系の準備 ---------- */
  const insComp = db.prepare(`
    INSERT INTO competitions(key, name, sort_order) VALUES (?, ?, ?)
  `);
  const insEd = db.prepare(`
    INSERT INTO editions(competition_id, year, title, seq_no, final_date, short_label)
    SELECT c.id, @year, @title, @seq, @date, @label FROM competitions c WHERE c.key=@comp
  `);
  const insCo = db.prepare(`
    INSERT INTO comedians (id, name, note, reading, kind, birth_date, formed_date)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(name, note) DO UPDATE SET
      reading     = COALESCE(comedians.reading,     excluded.reading),
      kind        = COALESCE(comedians.kind,        excluded.kind),
      birth_date  = COALESCE(comedians.birth_date,  excluded.birth_date),
      formed_date = COALESCE(comedians.formed_date, excluded.formed_date)
  `);
  const insMembership = db.prepare(`
    INSERT INTO memberships(unit_id, person_id)
    VALUES (?, ?)
    ON CONFLICT(unit_id, person_id) DO NOTHING
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
    const name = trimOnly(r.name);
    const note = toNullable(trimOnly(r.note));
    const id   = makeId(name, note);
    const readingCsv = toNullable(trimOnly(r.reading));
    const reading = readingCsv ?? (isKanaOnly(name) ? toHiragana(name) : null);
    const kind = normalizeKind(r.kind);
    const birthDate  = toNullable(r.birth_date);
    const formedDate = toNullable(r.formed_date);
    insCo.run(id, name, note, reading ?? null, kind ?? null, birthDate ?? null, formedDate ?? null);
  }

  // memberships 投入
  for (const r of membershipsCsv) {
    const uName = String(r.unit_name ?? "").trim();
    const uNote  = (r.unit_note === "" || r.unit_note == null) ? null : String(r.unit_note).trim();
    const pName = String(r.person_name ?? "").trim();
    const pNote  = (r.person_note === "" || r.person_note == null) ? null : String(r.person_note).trim();

    if (!uName || !pName) continue;

    // ユニット側を解決（なければ作成：kind='unit' で）
    let u = selCoByNameNote.get(uName, uNote, uNote); // => { id, kind } | undefined
    if (!u) {
      const uid = makeId(uName, uNote);
      insCo.run(uid, uName, uNote, /*reading*/ null, /*kind*/ "unit", /*birth*/ null, /*formed*/ null);
      u = selCoByNameNote.get(uName, uNote, uNote);
    } else if (u.kind == null) {
      db.prepare(`UPDATE comedians SET kind='unit' WHERE id=? AND kind IS NULL`).run(u.id);
      u.kind = "unit";
    }

    // 個人側を解決（なければ作成：kind='person' で）
    let p = selCoByNameNote.get(pName, pNote, pNote);
    if (!p) {
      const pid = makeId(pName, pNote);
      insCo.run(pid, pName, pNote, /*reading*/ null, /*kind*/ "person", /*birth*/ null, /*formed*/ null);
      p = selCoByNameNote.get(pName, pNote, pNote);
    } else if (p.kind == null) {
      db.prepare(`UPDATE comedians SET kind='person' WHERE id=? AND kind IS NULL`).run(p.id);
      p.kind = "person";
    }

    // 厳格チェック（要件どおり：不整合ならエラーで止める）
    if (u.kind === "person") {
      throw new Error(`memberships: unit "${uName}"(note=${uNote ?? "NULL"}) が person になっています`);
    }
    if (p.kind === "unit") {
      throw new Error(`memberships: person "${pName}"(note=${pNote ?? "NULL"}) が unit になっています`);
    }

    // 登録
    insMembership.run(u.id, p.id);
  }

  // final_results 用の note 抽出ヘルパ
  const pickNote = (r) => {
    const n = r.comedian_note ?? r.comedian_number ?? null;
    return n == null || String(n).trim()==="" ? null : String(n).trim();
  };

  // final_results
  for (const r of results) {
    const ed = selEdByCompYear.get(r.comp, Number(r.year));
    if (!ed) throw new Error(`edition not found: ${r.comp} ${r.year}`);

    const name = trimOnly(r.comedian_name);
    const noteFromCsv = pickNote(r);

    // 芸人ID解決（なければ自動作成: NULL番が空いていればNULL、埋まっていればmax+1）
    let coRow = selCoByNameNote.get(name, noteFromCsv, noteFromCsv);
    if (!coRow) {
      const id = makeId(name, noteFromCsv);
      const guess = isKanaOnly(name) ? toHiragana(name) : null; // 任意：読み推定を入れる場合
      insCo.run(id, name, noteFromCsv, /*reading*/ guess ?? null, /*kind*/ null, /*birth*/ null, /*formed*/ null);
      coRow = selCoByNameNote.get(name, noteFromCsv, noteFromCsv);
    }
    const rankText = String(r.rank);
    const rankSort = computeRankSort(rankText);

    // --- 1本目: CSVは分離済みを想定。軽い正規化のみ ---
    const first_group = toNullable(trimOnly(r.first_group));
    const first_order = normalizeIntOrNull(r.first_order);

    const params = {
      edition_id: ed.id,
      comedian_id: coRow.id,
      rank: rankText,
      rank_sort: rankSort,
      first_group,
    };
    for (const k of extraCols) if (k !== "first_group") params[k] = toNullable(r[k]);

    // first_order は「番」を除去した数値で上書き（DBは数値のみを持つ）
    if ("first_order" in r) params["first_order"] = first_order;

    insFR.run(params);
  }

  // judges
  for (const r of judgesCsv) {
    const name = trimOnly(r.name);
    if (!name) continue;
    const id = makeJudgeId(name);
    insJudge.run(id, name);
  }

  // edition_judges
  for (const r of editionJudgesCsv) {
    const ed = selEdByCompYear.get(r.comp, Number(r.year));
    if (!ed) throw new Error(`edition not found: ${r.comp} ${r.year}`);
    const seatNo = Number(r.seat_no);
    const jname  = trimOnly(r.judge_name);
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

    const name = trimOnly(r.comedian_name);
    const noteFromCsv = pickNote(r);

    let co = selCoByNameNote.get(name, noteFromCsv, noteFromCsv);
    if (!co) {
      const id = makeId(name, noteFromCsv);
      insCo.run(id, name, noteFromCsv, /*reading*/ null, /*kind*/ null, /*birth*/ null, /*formed*/ null);
      co = selCoByNameNote.get(name, noteFromCsv, noteFromCsv);
    }

    const scoreRaw = String(r.score ?? "").trim();
    if (scoreRaw === "") continue;
    const score = Number(scoreRaw);
    if (!Number.isFinite(score)) continue;

    insJudgeScore.run(ed.id, roundNo, co.id, seatNo, score);
  }
})();

// --- ここからは“別フェーズ”：メタ表・使用列・ビュー（巻き戻しの影響を切り離す） ---
// 1) メタテーブル
db.exec(`
  CREATE TABLE IF NOT EXISTS columns_meta (
    key          TEXT PRIMARY KEY,
    label        TEXT,
    pref_order   INTEGER,
    is_multiline INTEGER DEFAULT 0,
    col_class    TEXT,
    is_movie     INTEGER DEFAULT 0,
    related_key  TEXT
  );
`);

// final_results の列一覧（ベース列は除外）
const baseCols2 = new Set(["id","edition_id","comedian_id","rank","rank_sort"]);
const infoCols2 = db.prepare(`PRAGMA table_info('final_results')`).all()
  .map(r => r.name)
  .filter(n => !baseCols2.has(n));

function autoMetaFor(key){
  const baseLabel = ({
    catchphrase:   "キャッチコピー",
    first_group:   "1本目グループ名",
    first_order:   "1本目出順",
    first_result:  "1本目結果",
    first_title:   "1本目ネタ",
    second_order:  "2本目出順",
    second_result: "2本目結果",
    second_title:  "2本目ネタ",
    first_movie:   "1本目動画",
    second_movie:  "2本目動画",
  }[key]) ?? key;
  const colClass =
    /_order$/.test(key)  ? "col-order"  :
    /_result$/.test(key) ? "col-result" :
    /_title$/.test(key)  ? "col-title"  :
    key === "catchphrase"? "col-catch"  : null;
  const isMovie  = /_movie$/.test(key) ? 1 : 0;
  const related  = (key === "first_title")  ? "first_movie"
                  : (key === "second_title") ? "second_movie" : null;
  const pref     = ({
    catchphrase: 10,
    // first_group はUIに出さないので順序は適当でOK
    first_order: 20, first_result: 21, first_title: 22,
    second_order:30, second_result:31, second_title:32,
  }[key]) ?? null;
  const multi    = key === "catchphrase" ? 1 : 0;
  return { label:baseLabel, pref, multi, colClass, isMovie, related };
}

// columns_meta へUPSERT投入
const insMeta = db.prepare(`
  INSERT INTO columns_meta(key,label,pref_order,is_multiline,col_class,is_movie,related_key)
  VALUES (@key,@label,@pref,@multi,@class,@movie,@related)
  ON CONFLICT(key) DO UPDATE SET
    label=excluded.label,
    pref_order=excluded.pref_order,
    is_multiline=excluded.is_multiline,
    col_class=excluded.col_class,
    is_movie=excluded.is_movie,
    related_key=excluded.related_key
`);
for (const k of infoCols2) {
  const m = autoMetaFor(k);
  insMeta.run({
    key: k,
    label: m.label,
    pref: m.pref,
    multi: m.multi,
    class: m.colClass ?? null,
    movie: m.isMovie,
    related: m.related ?? null,
  });
}

// 2) 使用列（その年で実際に値が入っている列だけ）
db.exec(`
  CREATE TABLE IF NOT EXISTS edition_used_columns (
    edition_id INTEGER NOT NULL,
    col_key    TEXT    NOT NULL,
    PRIMARY KEY (edition_id, col_key)
  );
`);
db.exec(`DELETE FROM edition_used_columns`);

const editionIds = db.prepare(`SELECT id FROM editions`).all().map(r=>r.id);
const insertUsed = db.prepare(`INSERT INTO edition_used_columns(edition_id,col_key) VALUES (?,?)`);

// final_results の列一覧（ベース列は除外）
const baseCols = new Set(["id","edition_id","comedian_id","rank","rank_sort"]);
const infoCols = db.prepare(`PRAGMA table_info('final_results')`).all()
  .map(r => r.name)
  .filter(n => !baseCols.has(n));

for (const eid of editionIds) {
  for (const k of infoCols) {
    if (k === "first_group") continue;  // UIには出さない
    const has = db.prepare(`
      SELECT 1
      FROM final_results
      WHERE edition_id=? AND "${k}" IS NOT NULL AND CAST("${k}" AS TEXT) <> ''
      LIMIT 1
    `).get(eid);
    if (has) insertUsed.run(eid, k);
  }
}

// 3) ビュー（存在すれば作り直し）
db.exec(`DROP VIEW IF EXISTS view_edition_final_rows;`);
db.exec(`DROP VIEW IF EXISTS view_competition_years;`);
db.exec(`
  CREATE VIEW view_edition_final_rows AS
  SELECT
    fr.edition_id,
    e.year,
    c.name  AS competition_name,
    co.id   AS comedian_id,
    co.name AS comedian_name,
    fr.rank,
    fr.rank_sort
  FROM final_results fr
  JOIN editions e     ON e.id=fr.edition_id
  JOIN competitions c ON c.id=e.competition_id
  JOIN comedians  co  ON co.id=fr.comedian_id;

  CREATE VIEW view_competition_years AS
  SELECT c.key AS comp, e.year, e.short_label
  FROM editions e JOIN competitions c ON c.id=e.competition_id
  ORDER BY c.key, e.year;
`);

// （任意）簡易確認ログ
const check = db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('columns_meta','edition_used_columns')`).get();
console.log(`post-build objects: ${check.n} (expect 2)`);


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
