#!/usr/bin/env node
/**
 * seed_csv/final_results.csv を元に、seed_csv/comedians.csv を同期・補完するツール。
 * - 既存(comedians.csv)に無い (name,note) を追加
 * - reading が未設定/空 かつ name が かな(ひら/カタ)のみ → 自動生成して埋める
 * - NFKC正規化や空白圧縮は行わない（基本は trim のみ）
 * - kind / birth_date / formed_date をサポート（なければ空で出力）
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

// ===== utils =====
const trimOnly = (s) => (s ?? "").toString().trim();

// かな判定（ひらがな/カタカナ/長音/読点等の一部のみ許容）
const reKanaOnly = /^[\p{sc=Hiragana}\p{sc=Katakana}ー・･・\s]+$/u;
const isKanaOnly = (s) => reKanaOnly.test(trimOnly(s));

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

// ===== load =====
fs.mkdirSync(SEED_DIR, { recursive: true });

const coRows = readCsv(CO_CSV); // name, note, reading, kind?, birth_date?, formed_date?
const frRows = readCsv(FR_CSV); // comp,year,comedian_name,comedian_note,...

// 既存 comedians.csv を Map 化（key = `${name}||${note|null}`）
// ※ 正規化はしない。trim のみでキー化。
const keyOf = (name, note) =>
  `${trimOnly(name)}||${note === null ? "null" : note}`;

const normNote = (v) => {
  const s = trimOnly(v);
  return s === "" ? null : s;
};

// 出力配列（既存の順を維持）
const outRows = [...coRows];

// 既存キー -> 配列インデックス＋現行値
const existing = new Map();
for (let i = 0; i < coRows.length; i++) {
  const r           = coRows[i] ?? {};
  const name        = trimOnly(r.name);
  const note        = normNote(r.note);
  const reading     = toNullable(r.reading);
  const kind        = toNullable(r.kind);
  const birth_date  = toNullable(r.birth_date);
  const formed_date = toNullable(r.formed_date);
  existing.set(keyOf(name, note), {
    index: i, name, note: note, reading, kind, birth_date, formed_date
  });
}

// final_results の distinct (name, note) を走査
const seen = new Set();
let inserted = 0, readingUpdated = 0;

for (const r of frRows) {
  const name = trimOnly(r.comedian_name);
  const note = normNote(r.comedian_note ?? r.comedian_number);
  if (!name) continue;

  const k = keyOf(name, note);
  if (seen.has(k)) continue;
  seen.add(k);

  const row = existing.get(k);
  if (!row) {
    // reading を自動補完（かな名のみ）
    let reading = null;
    if (isKanaOnly(name)) {
      const hira = toHiragana(name);
      let guess = stripSymbolsForReading(hira);
      if (guess === "") guess = null;
      reading = guess;
    }
    const newIndex = outRows.length;
    outRows.push({
      name,
      note: note == null ? "" : note,
      reading: reading ?? "",
      kind: "",          // 追加列は空で出力（入力者が埋めやすいように）
      birth_date: "",
      formed_date: ""
    });
    existing.set(k, {
      index: newIndex,
      name, note: note, reading, kind: null, birth_date: null, formed_date: null
    });
    inserted++;
  } else {
    // 既存で reading が空なら自動補完を試みる（かな名のみ）
    if (!row.reading && isKanaOnly(row.name)) {
      const hira = toHiragana(row.name);
      let guess = stripSymbolsForReading(hira);
      if (guess) {
        row.reading = guess; // Map側のメモ
        // 実体（配列）も更新
        const i = row.index;
        if (i != null && outRows[i]) {
          outRows[i] = {
            ...outRows[i],
            reading: guess
          };
        }
        readingUpdated++;
      }
    }
  }
}

// ヘッダは固定（既存ファイルに列が無くても追加）
const header = ["name", "note", "reading", "kind", "birth_date", "formed_date"];

// 既存行に足りない列を追加（空文字で揃える）
for (let i = 0; i < outRows.length; i++) {
  const r = outRows[i] ?? {};
  for (const col of header) {
    if (!(col in r)) r[col] = "";
  }
}

writeCsv(CO_CSV, outRows, header);

console.log(`sync-comedians-csv: inserted=${inserted}, reading_filled=${readingUpdated}, total=${outRows.length}`);

// ============ 表記揺れ候補の警告（台帳は変更しない） ============
(function warnForSpellingVariants() {
  // 1) ユーティリティ（このブロックだけで完結）
  const toHiragana = (s) => s.replace(/[\u30A1-\u30F6]/g, ch =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60)
  );
  // 「ゆるいキー」: NFKC→トリム→カタカナ→ひらがな→空白/一部記号の除去→全角半角の差吸収
  const fuzzyKey = (raw) => {
    const s0 = String(raw ?? "").normalize("NFKC").trim();
    const s1 = toHiragana(s0);
    // 空白/中黒/小中黒/括弧/句読点/スラッシュ/ハイフン類/アンダーは落とす
    const s2 = s1
      .replace(/[\s\u3000]/g, "")
      .replace(/[・･·\u30FB\uFF65]/g, "")
      .replace(/[()\[\]{}「」『』【】〈〉《》]/g, "")
      .replace(/[.,，．\/／]/g, "")
      .replace(/[-_—–―]/g, "");
    return s2;
  };
  // ふつうのレーベンシュタイン距離（小さな比較なので十分速い）
  function levenshtein(a, b) {
    const s = String(a), t = String(b);
    const m = s.length, n = t.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const dp = new Array(n + 1);
    for (let j = 0; j <= n; j++) dp[j] = j;
    for (let i = 1; i <= m; i++) {
      let prev = dp[0];
      dp[0] = i;
      for (let j = 1; j <= n; j++) {
        const tmp = dp[j];
        dp[j] = Math.min(
          dp[j] + 1,                  // 削除
          dp[j - 1] + 1,              // 挿入
          prev + (s[i - 1] === t[j - 1] ? 0 : 1) // 置換
        );
        prev = tmp;
      }
    }
    return dp[n];
  }

  // 2) チェック対象データ（同期後の outRows を使用）
  //    note は "" を null 相当に
  const canonNote = (v) => (v === "" || v == null ? null : String(v).trim());
  const rows = outRows.map(r => ({
    name: r.name,
    note: canonNote(r.note),
  }));

  // 3) 強い候補: fuzzyKey が同じなのに raw name が複数（note も同じグループ内で比較）
  const collisions = []; // { note, key, names:Set<string> }
  {
    // map[note] -> map[fuzzy] -> Set<raw>
    const byNote = new Map();
    for (const r of rows) {
      const note = r.note === null ? "null" : String(r.note);
      const f = fuzzyKey(r.name);
      if (!byNote.has(note)) byNote.set(note, new Map());
      const bucket = byNote.get(note);
      if (!bucket.has(f)) bucket.set(f, new Set());
      bucket.get(f).add(r.name);
    }
    for (const [note, mp] of byNote) {
      for (const [f, set] of mp) {
        if (set.size >= 2) {
          collisions.push({ note: note, key: f, names: Array.from(set) });
        }
      }
    }
  }

  // 4) 弱い候補: 同じ note 内で、NFKC+trim した文字列の編集距離が 1 以下の組
  const nearPairs = []; // { note, a, b, dist }
  {
    const byNote = new Map();
    for (const r of rows) {
      const note = r.note === null ? "null" : String(r.note);
      if (!byNote.has(note)) byNote.set(note, []);
      byNote.get(note).push(r.name);
    }
    for (const [note, names] of byNote) {
      // ユニーク化（同名重複は無視）
      const uniq = Array.from(new Set(names));
      for (let i = 0; i < uniq.length; i++) {
        for (let j = i + 1; j < uniq.length; j++) {
          const a = uniq[i].normalize("NFKC").trim();
          const b = uniq[j].normalize("NFKC").trim();
          // まったく同じならスキップ（ここは “近い” 判定なので）
          if (a === b) continue;
          const d = levenshtein(a, b);
          if (d <= 1) nearPairs.push({ note: note, a: uniq[i], b: uniq[j], dist: d });
        }
      }
    }
  }

  // 5) 出力
  if (collisions.length === 0 && nearPairs.length === 0) {
    console.log("dupe-check: no spelling-variant candidates.");
    return;
  }
  console.warn("===== spelling-variant candidates (please review comedians.csv) =====");

  if (collisions.length) {
    console.warn("[strong] same fuzzy key within same (name,note) group:");
    for (const c of collisions) {
      const noteLabel = c.note === "null" ? "(note: null)" : `(note: ${c.note})`;
      console.warn(`  - ${noteLabel}  key="${c.key}"  ->  ${c.names.join(" / ")}`);
    }
  }

  if (nearPairs.length) {
    console.warn("[weak ] small edit distance (<=1) within same note:");
    for (const p of nearPairs) {
      const noteLabel = p.note === "null" ? "(note: null)" : `(note: ${p.note})`;
      console.warn(`  - ${noteLabel}  "${p.a}"  ~  "${p.b}"  (dist=${p.dist})`);
    }
  }
})();
