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

// (name, number) から決定的ID（sha256先頭20hex=80bit）
const makeId = (name, number) => {
  const left  = trimOnly(name);
  const right = (number == null || number === "") ? "" : `_${String(number)}`;
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
// 読みの厳格検証（“ひらがな”と“ー”のみ）
const reHiraLongOnly = /^[\p{sc=Hiragana}ー]+$/u;
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
  if (r === "ベスト16") return 50;
  if (r === "準々決勝進出") return 100;
  if (r === "ベスト32") return 100;
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

// ブロック名はユーザー定義の任意文字列を許可（NFKC＋trimのみ）
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

/* ============================= エラー収集ユーティリティ ============================= */
const errors = [];
function pushErr(file, line, code, message, record) {
  errors.push({ file, line, code, message, record });
}

function previewFor(file, record){
  if (!record || typeof record !== "object") return record;
  const pick = (obj, keys) =>
    Object.fromEntries(keys.filter(k => k in obj).map(k => [k, obj[k]]));
  switch (file) {
    case "comedians.csv":
      return pick(record, ["name","number","kind","reading","note","canonical_name","canonical_number"]);
    case "memberships.csv":
      return pick(record, ["unit_name","unit_number","person_name","person_number"]);
    case "final_results.csv":
      return pick(record, ["comp","year","comedian_name","comedian_number","rank"]);
    case "judge_scores.csv":
      return pick(record, ["comp","year","round_no","seat_no","comedian_name","comedian_number","score"]);
    default:
      return record;
  }
}

function printErrorsAndExit() {
  if (errors.length === 0) return;
  // ファイル別件数
  const byFile = new Map();
  for (const e of errors) byFile.set(e.file, (byFile.get(e.file) ?? 0) + 1);

  console.error("==== CSV Validation Errors ====");
  for (const [file, count] of [...byFile.entries()].sort()) {
    console.error(`- ${file}: ${count}件`);
  }
  console.error("---- 詳細 ----");
  for (const e of errors) {
    const head = `${e.file}: line ${e.line} [${e.code}]`;
    console.error(head);
    console.error(`  ${e.message}`);
    if (e.record) {
      const preview = previewFor(e.file, e.record);
      console.error(`  record: ${JSON.stringify(previewFor(e.file, e.record))}`);
    }
  }
  process.exit(1);
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
const BASE_KEYS = new Set([
  "comp","year",
  "comedian_name","comedian_note","comedian_number",
  "rank","rank_sort",
]);
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

/* ============================= プレフライト索引 ============================= */
function normIntOrNullLoose(v) {
  const s = String(v ?? "").trim();
  return s === "" ? null : (/^-?\d+$/.test(s) ? Number(s) : null);
}
function keyCo(name, number) { return `${String(name ?? "").trim()}||${number == null ? "" : String(number)}`; }

// comedians.csv を基準に存在とkind/読み等を引くインデックス
// ここで重複・空項目・読みの不正をチェック
const coIndex = new Map(); // key: name||number → { kind, row, line, hasCanonical, canonicalKey, selfKey }
const seenCoKeys = new Set();
for (let i = 0; i < comediansCsv.length; i++) {
  const r   = comediansCsv[i];
  const line = i + 2;
  const file = "comedians.csv";
  const nm  = String(r.name ?? "").trim();
  const num = normIntOrNullLoose(r.number);
  const kd  = normalizeKind(r.kind); // 'person' | 'unit' | null
  const rd  = String(r.reading ?? "").trim();
  const cName = String(r.canonical_name ?? "").trim();
  const cNum  = normIntOrNullLoose(r.canonical_number);
  if (!nm) {
    pushErr(file, line, "CO_NAME_EMPTY", "name が空です。", r);
    continue;
  }
  const k = keyCo(nm, num);
  if (seenCoKeys.has(k)) {
    pushErr(file, line, "CO_DUPLICATE",
      `同一 (name,number) が重複しています: name="${nm}", number=${num ?? "NULL"}`, r);
  } else {
    seenCoKeys.add(k);
  }
  // kind が空
  if (kd == null) {
    pushErr(file, line, "CO_KIND_EMPTY", "kind が空です（'person' または 'unit' を指定）。", r);
  }
  // 読みが空
  // if (!rd) {
  //   pushErr(file, line, "CO_READING_EMPTY", "reading が空です。ひらがなで記入してください。", r);
  // } else if (!reHiraLongOnly.test(rd)) {
  //   // 読みの厳格検証：ひらがな＋長音のみ
  //   pushErr(file, line, "CO_READING_INVALID",
  //     "reading に“ひらがな”と“ー”以外の文字が含まれています。", r);
  // }
  // orphan 用に必要最低限のプレビューを保持（元行全部でも可）
  const rowPreview = {
    name: nm, number: num, kind: kd ?? null, reading: rd || "",
    note: String(r.note ?? "").trim() || null,
    canonical_name: cName || null, canonical_number: cNum ?? null,
  };
  const selfKey = k;
  const canonicalKey = cName ? keyCo(cName, cNum) : selfKey;
  coIndex.set(k, {
    kind: kd ?? null,
    row: rowPreview,
    line,
    hasCanonical: Boolean(cName),
    canonicalKey,
    selfKey,
  });
}

/* ============================= プレフライト検証 ============================= */
// 参照状況の収集（要件：memberships または final_results のいずれにも出ない comedians を検出）
const usedByMembershipsOrFinal = new Set(); // keyCo(name,number)

// 直接参照された (name,number) キー群
const usedDirect = new Set();

// 1) memberships.csv
const msPairSeen = new Set(); // 重複 membership 検出用 (unit_key || '->' || person_key)
for (let i = 0; i < membershipsCsv.length; i++) {
  const r = membershipsCsv[i];
  const line = i + 2;
  const file = "memberships.csv";
  const uName = String(r.unit_name ?? "").trim();
  const uNum  = normIntOrNullLoose(r.unit_number);
  const pName = String(r.person_name ?? "").trim();
  const pNum  = normIntOrNullLoose(r.person_number);
  if (!uName || !pName) continue; // 空行様扱い
  usedDirect.add(keyCo(uName, uNum));
  usedDirect.add(keyCo(pName, pNum));

  const uk = keyCo(uName, uNum);
  const pk = keyCo(pName, pNum);
  const u = coIndex.get(uk);
  const p = coIndex.get(pk);
  if (!u) pushErr(file, line, "CO_NOT_FOUND_UNIT",
    `comedians.csv 未登録ユニット: name="${uName}", number=${uNum ?? "NULL"}`, r);
  if (!p) pushErr(file, line, "CO_NOT_FOUND_PERSON",
    `comedians.csv 未登録メンバー: name="${pName}", number=${pNum ?? "NULL"}`, r);
  if (u && u.kind !== "unit")
    pushErr(file, line, "KIND_MISMATCH_UNIT",
      `ユニット側kindが 'unit' ではありません（kind=${u.kind ?? "NULL"}）`, r);
  if (p && p.kind !== "person")
    pushErr(file, line, "KIND_MISMATCH_PERSON",
      `メンバー側kindが 'person' ではありません（kind=${p.kind ?? "NULL"}）`, r);
  if (u && p && uk === pk)
    pushErr(file, line, "SAME_ID",
      "unit と person が同一キー（name,number）です。入力を見直してください。", r);

  // 重複membershipの検出
  const pairKey = `${uk}->${pk}`;
  if (msPairSeen.has(pairKey)) {
    pushErr(file, line, "MS_DUP_REL",
      "同一の unit×person 関係が重複しています。", r);
  } else {
    msPairSeen.add(pairKey);
  }

  // 使用フラグ（memberships 参照）
  usedByMembershipsOrFinal.add(uk);
  usedByMembershipsOrFinal.add(pk);
}

// 2) final_results.csv
for (let i = 0; i < results.length; i++) {
  const r = results[i];
  const line = i + 2;
  const file = "final_results.csv";
  const name = String(r.comedian_name ?? "").trim();
  const num  = normIntOrNullLoose(r.comedian_number);
  if (!name) continue;
  usedDirect.add(keyCo(name, num));
  const co = coIndex.get(keyCo(name, num));
  if (!co) {
    pushErr(file, line, "CO_NOT_FOUND",
      `comedians.csv 未登録の芸人: name="${name}", number=${num ?? "NULL"}`, r);
  }
  // 使用フラグ（final_results 参照）
  usedByMembershipsOrFinal.add(keyCo(name, num));
}

// 3) judge_scores.csv
for (let i = 0; i < judgeScoresCsv.length; i++) {
  const r = judgeScoresCsv[i];
  const line = i + 2;
  const file = "judge_scores.csv";
  const name = String(r.comedian_name ?? "").trim();
  const num  = normIntOrNullLoose(r.comedian_number);
  if (!name) continue;
  usedDirect.add(keyCo(name, num));
  const co = coIndex.get(keyCo(name, num));
  if (!co) {
    pushErr(file, line, "CO_NOT_FOUND",
      `comedians.csv 未登録の芸人（個票）: name="${name}", number=${num ?? "NULL"}`, r);
  }
}

// 4) コメディアンの“未参照”検出（membershipsにもfinal_resultsにも出てこない）
// まず「どの canonical グループが使われたか」を計算
const usedGroupKeys = new Set(); // canonicalKey 単位
for (const [k, v] of coIndex.entries()) {
  if (usedDirect.has(k)) {
    // この“直接参照された行”が属する canonical グループを mark
    usedGroupKeys.add(v.canonicalKey);
  }
}

// 判定ルール：
// A) グループ未使用（canonicalKey 単位）→ CO_ORPHAN_GROUP
// B) グループは使用されているが、
//    その行が canonical 指定あり & 直接未使用 → CO_UNUSED_ALIAS
for (const [k, v] of coIndex.entries()) {
  const ln  = Number.isInteger(v.line) ? v.line : "-";
  const row = v.row || {};
  const groupUsed = usedGroupKeys.has(v.canonicalKey);
  const selfUsed  = usedDirect.has(v.selfKey);

  if (!groupUsed) {
    pushErr("comedians.csv", ln, "CO_ORPHAN_GROUP",
      "canonical グループとしても memberships/final_results のどこからも参照されていません。", row);
    continue;
  }
  if (v.hasCanonical && !selfUsed) {
    pushErr("comedians.csv", ln, "CO_UNUSED_ALIAS",
      "canonical を持つ別名行ですが、この行自体は参照されていません。", row);
  }
}

if (errors.length) {
  printErrorsAndExit();
}

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
      sort_order  INTEGER,
      semifinal_label    TEXT,
      quarterfinal_label TEXT
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

    -- 芸人（(name, number) の複合ユニーク → TEXT主キー）
    CREATE TABLE comedians (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      number      INTEGER,                                 -- NULL 許容（同名2組目以降に 1,2,...）
      note        TEXT,                                    -- 自由記述（ユニークには関与しない）
      reading     TEXT,                                    -- ひらがな
      kind        TEXT CHECK (kind IN ('person','unit')),  -- NULL許容
      birth_date  TEXT,                                    -- 個人向け 'YYYY-MM-DD'
      formed_date TEXT,                                    -- ユニット向け 'YYYY-MM-DD'
      canonical_id TEXT REFERENCES comedians(id),
      has_profile INTEGER NOT NULL DEFAULT 0,
      UNIQUE (name, number)
    );
    -- 「name × number」をユニークにする。ただし number=NULL は名前ごとに高々1件に制限
    CREATE UNIQUE INDEX idx_co_unique_name_number
      ON comedians(name, COALESCE(number, -1));
    CREATE INDEX idx_co_canonical ON comedians(canonical_id);

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
  const selCoByNameNumber = db.prepare(`
    SELECT id, kind FROM comedians
    WHERE name = ? AND ((number IS NULL AND ? IS NULL) OR number = ?)
    LIMIT 1
  `);
  function assertComedianExists(name, number, locLabel){
    const hit = selCoByNameNumber.get(name, number, number);
    if (!hit) {
      const numLabel = (number == null ? "NULL" : String(number));
      throw new Error(`${locLabel}: comedians.csv に未登録の芸人です → name="${name}", number=${numLabel}`);
    }
    return hit; // { id, kind }
  }

  /* ---------- INSERT系の準備 ---------- */
  const insComp = db.prepare(`
    INSERT INTO competitions(key, name, sort_order, semifinal_label, quarterfinal_label) VALUES (?, ?, ?, ?, ?)
  `);
  const insEd = db.prepare(`
    INSERT INTO editions(competition_id, year, title, seq_no, final_date, short_label)
    SELECT c.id, @year, @title, @seq, @date, @label FROM competitions c WHERE c.key=@comp
  `);
  const insCo = db.prepare(`
    INSERT INTO comedians (id, name, number, note, reading, kind, birth_date, formed_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(name, COALESCE(number, -1)) DO UPDATE SET
      note        = excluded.note,
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
    const semifinalLabel = toNullable(r.semifinal_label);
    const quarterfinalLabel = toNullable(r.quarterfinal_label);
    insComp.run(r.key, r.name, so, semifinalLabel, quarterfinalLabel);
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
    const number = normalizeIntOrNull(r.number);
    const note   = toNullable(r.note);
    const id     = makeId(name, number);
    const readingCsv = toNullable(trimOnly(r.reading));
    const reading = readingCsv ?? (isKanaOnly(name) ? toHiragana(name) : null);
    const kind = normalizeKind(r.kind);
    const birthDate  = toNullable(r.birth_date);
    const formedDate = toNullable(r.formed_date);
    insCo.run(id, name, number, note, reading ?? null, kind ?? null, birthDate ?? null, formedDate ?? null);
  }

  const selCoIdByNameNumber = db.prepare(`
    SELECT id FROM comedians WHERE name=? AND ((number IS NULL AND ? IS NULL) OR number=?)
  `);
  const updCanonical = db.prepare(`UPDATE comedians SET canonical_id=? WHERE id=?`);

  for (const r of comediansCsv) {
    const name   = trimOnly(r.name);
    const number = normalizeIntOrNull(r.number);
    const meId   = makeId(name, number);

    const cName = toNullable(trimOnly(r.canonical_name));
    const cNum = toNullable(trimOnly(r.canonical_number));
    if (cName) {
      const root = selCoIdByNameNumber.get(cName, cNum, cNum);
      if (!root) {
        throw new Error(`[canonical] 代表名が見つかりません: name="${cName}", number=${cNum ?? "NULL"}`);
      }
      if (root.id !== meId) {
        updCanonical.run(root.id, meId);
      }
    }
  }

  // --- canonical の健全性チェック（自己参照・多段参照・循環参照） ---
  // 表示用のラベル（name + [note]）
  const id2label = new Map();
  for (const r of db.prepare(`SELECT id, name, COALESCE(note,'') AS note FROM comedians`).all()) {
    id2label.set(r.id, r.note ? `${r.name} [${r.note}]` : r.name);
  }
  const label = (id) => (id ? (id2label.get(id) || String(id)) : "NULL");

  // 1) 自己参照: canonical_id = id
  const selfRefs = db.prepare(`
    SELECT id, name, note
    FROM comedians
    WHERE canonical_id = id
  `).all();

  // 2) 多段参照: 子→親→祖 になっている（親が代表ではない＝親にも canonical_id がある）
  const multiHops = db.prepare(`
    SELECT child.id AS child_id, child.name AS child_name, child.note AS child_note,
           parent.id AS parent_id, parent.name AS parent_name, parent.note AS parent_note,
           gp.id     AS gp_id,     gp.name     AS gp_name,     gp.note     AS gp_note
    FROM comedians child
    JOIN comedians parent ON parent.id = child.canonical_id
    JOIN comedians gp     ON gp.id     = parent.canonical_id
  `).all();

  // 3) 循環参照検出: JS で DFS（A→B→…→A）
  const canonicalPairs = db.prepare(`
    SELECT id, canonical_id FROM comedians WHERE canonical_id IS NOT NULL
  `).all();
  const nextMap = new Map(canonicalPairs.map(r => [r.id, r.canonical_id]));
  const visitedGlobal = new Set();
  const cycles = [];

  for (const [startId] of nextMap) {
    if (visitedGlobal.has(startId)) continue;
    const stack = [];
    const onStack = new Set();
    let cur = startId;
    while (cur && nextMap.has(cur)) {
      if (onStack.has(cur)) {
        // ループ発見: stack 内で cur から末尾まで
        const i = stack.indexOf(cur);
        const loop = stack.slice(i).concat(cur); // 終端に再度 cur を付けて分かりやすく
        cycles.push(loop.map(label).join(" -> "));
        break;
      }
      stack.push(cur);
      onStack.add(cur);
      visitedGlobal.add(cur);
      cur = nextMap.get(cur);
    }
  }

  if (selfRefs.length || multiHops.length || cycles.length) {
    let msg = "[canonical] 定義エラーを検出しました。CSVを修正してください。\n";

    if (selfRefs.length) {
      msg += "\n[自己参照]\n";
      for (const r of selfRefs) {
        msg += `  - ${r.name}${r.note ? ` [${r.note}]` : ""} が自身を canonical に指定しています\n`;
      }
      msg += "    * 対応: 当該行の canonical_* を空にしてください（代表＝canonical なし）。\n";
    }

    if (multiHops.length) {
      msg += "\n[多段参照（別名→別名→代表 等）]\n";
      for (const r of multiHops) {
        const child  = `${r.child_name}${r.child_note ? ` [${r.child_note}]` : ""}`;
        const parent = `${r.parent_name}${r.parent_note ? ` [${r.parent_note}]` : ""}`;
        const gp     = `${r.gp_name}${r.gp_note ? ` [${r.gp_note}]` : ""}`;
        msg += `  - ${child} → ${parent} → ${gp}\n`;
      }
      msg += "    * ルール: 別名は必ず“最終代表（canonical なし）”を **直接** 指してください。\n";
    }

    if (cycles.length) {
      msg += "\n[循環参照]\n";
      for (const chain of cycles) {
        msg += `  - ${chain}\n`;
      }
      msg += "    * 対応: ループ内の1件だけを代表（canonical 空）にし、残りはその代表を直接指してください。\n";
    }

    throw new Error(msg);
  }
  
  // 代表IDを取る小関数
  const rootIdOf = db.prepare(`
    SELECT COALESCE(canonical_id, id) AS rid, kind
    FROM comedians
    WHERE name=? AND ((note IS NULL AND ? IS NULL) OR note=?)
    LIMIT 1
  `);

  // memberships 投入
  for (const [i, r] of membershipsCsv.entries()) {
    const loc = `memberships.csv: line ${i+2}`; // ヘッダ分+1
    const uName = trimOnly(r.unit_name);
    const uNum  = normalizeIntOrNull(r.unit_number);
    const pName = trimOnly(r.person_name);
    const pNum  = normalizeIntOrNull(r.person_number);

    if (!uName || !pName) continue;

    // ユニット/個人とも comedians.csv 由来のDBに **存在必須**（なければ即エラー）
    const u = assertComedianExists(uName, uNum, loc); // {id, kind}
    const p = assertComedianExists(pName, pNum, loc); // {id, kind}

    // 代表IDへ正規化
    const uRoot = db.prepare(`SELECT COALESCE(canonical_id,id) AS rid, kind FROM comedians WHERE id=?`).get(u.id);
    const pRoot = db.prepare(`SELECT COALESCE(canonical_id,id) AS rid, kind FROM comedians WHERE id=?`).get(p.id);

    // 厳格チェック（kind 不備もエラーにする：自動補完しない）
    if (uRoot.kind !== "unit") {
      throw new Error(`${loc}: unit "${uName}"(note=${uNum ?? "NULL"}) は person です`);
    }
    if (pRoot.kind !== "person") {
      throw new Error(`${loc}: person "${pName}"(number=${pNum ?? "NULL"}) の kind が 'person' ではありません`);
    }
    if (uRoot.rid === pRoot.rid) {
      throw new Error(`${loc}: unit と person が同一ID（${uRoot.rid}）。入力を見直してください`);
    }

    // 代表IDで登録
    insMembership.run(uRoot.rid, pRoot.rid);
  }

  // final_results 用の number 抽出ヘルパ
  const pickNumber = (r) => {
    const n = (r.comedian_number ?? "").toString().trim();
    return n === "" ? null : normalizeIntOrNull(n);
  };

  // final_results（未登録はエラーで停止）
  for (const [i, r] of results.entries()) {
    const loc = `final_results.csv: line ${i+2}`;
    const ed = selEdByCompYear.get(r.comp, Number(r.year));
    if (!ed) throw new Error(`edition not found: ${r.comp} ${r.year}`);

    const name = trimOnly(r.comedian_name);
    const numFromCsv = pickNumber(r);

    // 芸人は comedians.csv に **存在必須**
    const coRow = assertComedianExists(name, numFromCsv, loc);

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

  // comedians の has_profile 更新（final_results に出ている代表グループ全員を 1）
  db.exec(`
    UPDATE comedians AS co
    SET has_profile = 1
    WHERE EXISTS (
      SELECT 1
      FROM final_results fr
      JOIN comedians cx ON cx.id = fr.comedian_id
      WHERE COALESCE(cx.canonical_id, cx.id) = COALESCE(co.canonical_id, co.id)
    )
  `);

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
  for (const [i, r] of judgeScoresCsv.entries()) {
    const ed = selEdByCompYear.get(r.comp, Number(r.year));
    if (!ed) throw new Error(`edition not found: ${r.comp} ${r.year}`);

    const roundNo = Number(r.round_no);
    const seatNo  = Number(r.seat_no);
    if (!Number.isFinite(roundNo) || !Number.isFinite(seatNo)) continue;

    const name = trimOnly(r.comedian_name);
    const numFromCsv = pickNumber(r);

    // 芸人は comedians.csv に **存在必須**
    const co = assertComedianExists(name, numFromCsv, `judge_scores.csv: line ${i+2}`);

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
const baseCols2 = new Set([
  "id","edition_id","comedian_id",
  "rank","rank_sort",
  "comedian_note","comedian_number",
]);
const infoCols2 = db.prepare(`PRAGMA table_info('final_results')`).all()
  .map(r => r.name)
  .filter(n => !baseCols2.has(n));

function autoMetaFor(key){
  const baseLabel = ({
    catchphrase:   "キャッチコピー",
    first_group:   "1本目ブロック名",
    first_order:   "1本目出順",
    first_result:  "1本目結果",
    first_title:   "1本目ネタ",
    first_movie:   "1本目動画",
    second_order:  "2本目出順",
    second_result: "2本目結果",
    second_title:  "2本目ネタ",
    second_movie:  "2本目動画",
    third_order:   "3本目出順",
    third_result:  "3本目結果",
    third_title:   "3本目ネタ",
    third_movie:   "3本目動画",
  }[key]) ?? key;
  const colClass =
    /_order$/.test(key)  ? "col-order"  :
    /_result$/.test(key) ? "col-result" :
    /_title$/.test(key)  ? "col-title"  :
    key === "catchphrase"? "col-catch"  : null;
  const isMovie  = /_movie$/.test(key) ? 1 : 0;
  const related  = (key === "first_title")  ? "first_movie"
                  : (key === "second_title") ? "second_movie"
                  : (key === "third_title")  ? "third_movie" : null;
  const pref     = ({
    catchphrase: 10,
    // first_group はUIに出さないので順序は適当でOK
    first_order: 20, first_result: 21, first_title: 22,
    second_order:30, second_result:31, second_title:32,
    third_order: 40, third_result: 41, third_title: 42,
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
const baseCols = new Set([
  "id","edition_id","comedian_id",
  "rank","rank_sort",
  "comedian_note","comedian_number",
]);
const infoCols = db.prepare(`PRAGMA table_info('final_results')`).all()
  .map(r => r.name)
  .filter(n => !baseCols.has(n));

for (const eid of editionIds) {
  for (const k of infoCols) {
    if (k === "first_group") continue;  // UIには出さない
    // 決勝（rank_sort <= 40）の行に限定して「実際に値が入っている列」だけ採用する
    const has = db.prepare(`
      SELECT 1
      FROM final_results
      WHERE edition_id=?
        AND CAST(rank_sort AS INTEGER) <= 40
        AND "${k}" IS NOT NULL
        AND CAST("${k}" AS TEXT) <> ''
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

// 簡易確認ログ
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
