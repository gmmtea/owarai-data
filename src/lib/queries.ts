import Database from "better-sqlite3";
let _db: any = null;
const db = () => (_db ??= new (Database as any)("data/awards.sqlite", { readonly: true }));

// final_results に first_group 列があるか（ビルド時に1回評価される想定）
const hasFirstGroup: boolean = !!db().prepare(
  `SELECT 1 FROM pragma_table_info('final_results') WHERE name='first_group'`
).get();

// --- multiline列の \n 復元ユーティリティ ------------------------------
// columns: [{ key, is_multiline, ... }, ...] に従い、row[key] の "\\n" → 実改行("\n")
function restoreMultilineInRow(
  row: Record<string, unknown>,
  columns: Array<{ key: string; is_multiline: 0 | 1 }>
) {
  for (const c of columns) {
    if (c.is_multiline === 1) {
      const v = row[c.key];
      if (typeof v === "string") {
        row[c.key] = v.replace(/\\n/g, "\n");
      }
    }
  }
}

/* 基本: 大会メタ */
export function listCompetitions(): { key: string; name: string; sort_order: number | null }[] {
  return db().prepare(`
    SELECT key, name, sort_order
    FROM competitions
    ORDER BY sort_order IS NULL, sort_order, key
  `).all();
}
export function competitionName(key: string): string | null {
  const row = db().prepare(`SELECT name FROM competitions WHERE key=? LIMIT 1`).get(key) as { name: string } | undefined;
  return row?.name ?? null;
}

/* ナビ: comp/year/short_label */
export function listEditionParams() {
  return db().prepare(`
    SELECT comp, year, short_label FROM view_competition_years
  `).all() as { comp: string; year: number | null; short_label: string | null }[];
}

/* 追加列メタ（その年で実際に使われる列だけ、動画列は除外） */
function listUsedColumnsWithMeta(edition_id: number) {
  return db().prepare(`
    SELECT m.key, m.label, m.pref_order, m.is_multiline, m.col_class, m.is_movie, m.related_key
    FROM edition_used_columns u
    JOIN columns_meta m ON m.key=u.col_key
    WHERE u.edition_id=?
      AND COALESCE(m.is_movie,0)=0
    ORDER BY (m.pref_order IS NULL), m.pref_order, m.key
  `).all(edition_id) as Array<{
    key: string; label: string | null; pref_order: number | null;
    is_multiline: 0|1; col_class: string | null; is_movie: 0|1|null; related_key: string | null;
  }>;
}

/* 年テーブル（追加列は edition_used_columns × columns_meta で決定） */
export function getEditionTable(comp: string, year: number) {
  const ed = db().prepare(`
    SELECT
      e.id            AS edition_id,
      e.year,
      e.title,
      e.final_date,
      e.short_label,
      c.name          AS competition_name
    FROM editions e
    JOIN competitions c ON c.id = e.competition_id
    WHERE c.key = ? AND e.year = ?
    LIMIT 1
  `).get(comp, year) as {
    edition_id: number; year: number; title: string|null; final_date: string|null;
    short_label: string|null; competition_name: string;
  } | undefined;

  if (!ed) return null;

  const columns = listUsedColumnsWithMeta(ed.edition_id);
  // 表示しないが行データに含めたい「隠し列」
  //  - 動画列
  //  - first_group（表示しないが first_order と合成表示に使う）
  const hiddenMovieKeys = Array.from(new Set(
    columns.map(c => c.related_key).filter(Boolean) as string[]
  ));
  const hiddenKeys = [
    ...hiddenMovieKeys,
    ...(hasFirstGroup ? ["first_group"] : [])
  ]; // first_groupは表示しないが使う

  const selectExtra = [
    ...columns.map(c => `fr."${c.key}" AS "${c.key}"`),
    ...hiddenKeys.map(k => `fr."${k}" AS "${k}"`)
  ].join(", ");

  const orderByPieces = [
    `CAST(fr.rank_sort AS INTEGER) ASC`,
    ...(hasFirstGroup ? [
      `(fr.first_group IS NULL)`,
      `fr.first_group`,
    ] : []),
    `(fr.first_order IS NULL)`,
    `CAST(fr.first_order AS INTEGER) ASC`,
    `(co.reading IS NULL)`, `co.reading ASC`, `co.name ASC`,
  ];

  const rows = db().prepare(`
    SELECT
      fr.rank,
      fr.rank_sort,
      co.id   AS comedian_id,
      co.name AS name,           -- 表示は当時名
      co.reading,
      COALESCE(co.canonical_id, co.id) AS link_id,  -- ← リンク先は代表
      CASE
        WHEN co.canonical_id IS NOT NULL THEN '「' || co.name || '」として'
        ELSE ''
      END AS alias_label
      ${selectExtra ? ","+selectExtra : ""}
    FROM final_results fr
    JOIN comedians co ON co.id=fr.comedian_id
    WHERE fr.edition_id=?
    ORDER BY ${orderByPieces.join(", ")}
  `).all(ed.edition_id) as any[];

  // is_multiline=1 の列だけ \\n → \n に復元
  for (const r of rows) restoreMultilineInRow(r, columns);

  return {
    edition: {
      year: ed.year,
      title: ed.title,
      final_date: ed.final_date,
      short_label: ed.short_label,
      competition_name: ed.competition_name,
    },
    columns,  // ← ラベル/クラス/改行フラグ込み
    rows
  };
}

/* 大会ページ（年ごと） */
export function getCompetitionYearTables(comp: string) {
  const years = db().prepare(`
    SELECT e.year, e.short_label, e.id AS edition_id
    FROM editions e
    JOIN competitions c ON c.id=e.competition_id
    WHERE c.key=?
    ORDER BY e.year DESC
  `).all(comp) as { year:number|null; short_label:string|null; edition_id:number }[];

  return years.map(y => ({
    year: y.year,
    short_label: y.short_label,
    table: (y.year != null) ? getEditionTable(comp, y.year)! : null
  }));
}

/* 芸人ID一覧（登場者のみ） */
export function listTargetComedianIds() {
  const rows = db().prepare(`
    SELECT id
    FROM comedians
    WHERE canonical_id IS NULL
    ORDER BY name
  `).all() as { id:string }[];
  return rows.map(r => r.id);
}

/* 芸人素データ */
export function listComediansAll(): { id: string; name: string; reading: string | null }[] {
  return db().prepare(`SELECT id, name, reading FROM comedians`).all();
}

// 代表だけ（一覧用既定）
export function listComediansCanonicalOnly(): { id: string; name: string; reading: string | null }[] {
  return db().prepare(`
    SELECT id, name, reading
    FROM comedians
    WHERE canonical_id IS NULL
    ORDER BY COALESCE(reading, name)
  `).all();
}

/* 芸人ページ：大会ごとに年の縦表（追加列の選定は大会年ごとに実データベース準拠） */
export function getComedianTables(comedianId: string) {
  const me = db().prepare(`
    SELECT id, name, reading, COALESCE(canonical_id, id) AS root_id
    FROM comedians WHERE id=?
  `).get(comedianId) as any;
  if (!me) return null;

  // 同じ root に属する全ID（代表＋別名）
  const ids = db().prepare(`
    SELECT id FROM comedians WHERE COALESCE(canonical_id, id)=?
  `).all(me.root_id) as {id:string}[];
  const idList = ids.map(x => x.id);

  // 代表の素データを見出しに使う
  const co = db().prepare(`SELECT id, name, reading FROM comedians WHERE id=?`)
                 .get(me.root_id) as any;

  // 全戦績（当時名で出す。名義ラベルとリンク先=代表IDも付与）
  const rows = db().prepare(`
    SELECT
      e.id   AS edition_id,
      e.year,
      e.short_label,
      c.key  AS comp,
      c.name AS competition_name,
      fr.rank,
      fr.rank_sort,
      co.id   AS comedian_id,
      co.name AS comedian_name,
      COALESCE(co.canonical_id, co.id) AS link_id,
      CASE WHEN co.canonical_id IS NOT NULL
        THEN '「' || co.name || '」として'
        ELSE ''
      END AS alias_label
    FROM final_results fr
    JOIN editions e     ON e.id=fr.edition_id
    JOIN competitions c ON c.id=e.competition_id
    JOIN comedians  co  ON co.id=fr.comedian_id
    WHERE fr.comedian_id IN (${idList.map(()=>"?").join(",")})
    ORDER BY (c.sort_order IS NULL), c.sort_order, c.key, e.year DESC
  `).all(...idList) as any[];

  // 大会ごとにグループ化。各年の「使用列メタ」を付与しつつ、値を動的SELECTで埋める
  const byComp: Record<string, { competition_name:string, years: Array<{
    year:number|null; short_label:string|null; columns: ReturnType<typeof listUsedColumnsWithMeta>; rows:any[]
  }>}> = {};

  // edition_id ごとに、その芸人の追加列＋関連動画列を取り出すヘルパ
  function loadExtrasForEditionRow(edition_id:number, comedian_id:string) {
    const cols = listUsedColumnsWithMeta(edition_id);
    const hiddenMovieKeys = Array.from(new Set(
      cols.map(c => c.related_key).filter(Boolean) as string[]
    ));
    const hiddenKeys = [
      ...hiddenMovieKeys,
      ...(hasFirstGroup ? ["first_group"] : [])
    ];
    const selectExtra = [
      ...cols.map(c => `"${c.key}" AS "${c.key}"`),
      ...hiddenKeys.map(k => `"${k}" AS "${k}"`)
    ].join(", ");

    const sql = `
      SELECT ${selectExtra || "1"}
      FROM final_results
      WHERE edition_id=? AND comedian_id=?
      LIMIT 1
    `;
    const extra = selectExtra ? db().prepare(sql).get(edition_id, comedian_id) as any : {};

    return { cols, extra };
  }

  for (const r of rows) {
    const comp = r.comp as string;
    const grp = (byComp[comp] ??= { competition_name: r.competition_name, years: [] });
    let y = grp.years.find((yy) => yy.year === r.year);
    if (!y) {
      // 列メタを先に取りつつ、行の追加値も取得
      const { cols } = loadExtrasForEditionRow(r.edition_id, r.comedian_id);
      y = { year: r.year, short_label: r.short_label, columns: cols, rows: [] };
      grp.years.push(y);
    }
    // 行ごとの追加値（動画列含む）を読み込み
    const { extra } = loadExtrasForEditionRow(r.edition_id, r.comedian_id);

    // ★ is_multiline=1 の列だけ \\n → \n に復元（例: catchphrase）
    restoreMultilineInRow(extra, y.columns);

    y.rows.push({ ...r, ...extra });
  }
  return { comedian: co, byComp };
}

/* 審査員・個票 */
export function getEditionJudges(comp: string, year: number) {
  const ed = db().prepare(`
    SELECT e.id AS eid
    FROM editions e JOIN competitions c ON c.id=e.competition_id
    WHERE c.key=? AND e.year=? LIMIT 1
  `).get(comp, year) as { eid:number } | undefined;
  if (!ed) return [];

  return db().prepare(`
    SELECT ej.seat_no, j.name
    FROM edition_judges ej
    JOIN judges j ON j.id=ej.judge_id
    WHERE ej.edition_id=?
    ORDER BY ej.seat_no
  `).all(ed.eid) as { seat_no:number; name:string }[];
}

export function getJudgeScoreTable(comp: string, year: number, round_no: number) {
  const ed = db().prepare(`
    SELECT e.id AS eid
    FROM editions e JOIN competitions c ON c.id=e.competition_id
    WHERE c.key=? AND e.year=? LIMIT 1
  `).get(comp, year) as { eid:number } | undefined;
  if (!ed) return null;

  const seats = db().prepare(`
    SELECT ej.seat_no, j.name
    FROM edition_judges ej
    JOIN judges j ON j.id=ej.judge_id
    WHERE ej.edition_id=?
    ORDER BY ej.seat_no
  `).all(ed.eid) as { seat_no:number; name:string }[];

  const rows = db().prepare(`
    SELECT
      fr.comedian_id,
      co.name    AS comedian_name,
      co.reading AS comedian_reading,
      fr.rank_sort,
      CASE ?
        WHEN 1 THEN CAST(fr.first_order  AS INTEGER)
        WHEN 2 THEN CAST(fr.second_order AS INTEGER)
        ELSE NULL
      END AS order_no,
      js.seat_no,
      js.score
    FROM final_results fr
    JOIN comedians co ON co.id=fr.comedian_id
    LEFT JOIN judge_scores js
      ON js.edition_id=fr.edition_id
     AND js.round_no=?
     AND js.comedian_id=fr.comedian_id
    WHERE fr.edition_id=?
      AND EXISTS (
        SELECT 1 FROM judge_scores js2
        WHERE js2.edition_id = fr.edition_id
          AND js2.round_no   = ?
          AND js2.comedian_id= fr.comedian_id
      )
    ORDER BY
      (order_no IS NULL), order_no ASC,              -- 出順（未設定は後ろ）
      CAST(fr.rank_sort AS INTEGER) ASC,             -- 順位
      (co.reading IS NULL), co.reading ASC, co.name ASC  -- 読み→名前
  `).all(round_no, round_no, ed.eid, round_no) as Array<{
    comedian_id:string; comedian_name:string; comedian_reading:string|null;
    rank_sort:number; order_no:number|null; seat_no:number|null; score:number|null;
  }>;

  type Row = {
    comedian_id:string; comedian_name:string; comedian_reading:string|null;
    rank_sort:number; order_no:number|null; bySeat: Record<number, number|null>; total:number|null
  };
  const byId = new Map<string, Row>();
  for (const r of rows) {
    let row = byId.get(r.comedian_id);
    if (!row) {
      row = {
        comedian_id:r.comedian_id, comedian_name:r.comedian_name, comedian_reading:r.comedian_reading ?? null,
        rank_sort:r.rank_sort, order_no:r.order_no, bySeat:{}, total:null
      };
      byId.set(r.comedian_id, row);
    }
    if (r.seat_no != null) row.bySeat[r.seat_no] = r.score;
  }
  const out = Array.from(byId.values());
  for (const row of out) {
    const vals = seats.map(s => row.bySeat[s.seat_no]).filter(v => typeof v === "number") as number[];
    row.total = vals.length ? vals.reduce((a,b)=>a+b,0) : null;
  }
  return { seats, rows: out };
}

/* 年リスト（昇順） */
export function listEditionYears(comp: string): number[] {
  const rows = db().prepare(`
    SELECT e.year
    FROM editions e
    JOIN competitions c ON c.id=e.competition_id
    WHERE c.key=? AND e.year IS NOT NULL
    ORDER BY e.year ASC
  `).all(comp) as { year:number }[];
  return rows.map(r => r.year);
}

/* メンバーシップ情報 */
export function getUnitMembers(unitId: string) {
  return db().prepare(`
    SELECT co.id, co.name, co.reading, co.kind
    FROM memberships m
    JOIN comedians co ON co.id = m.person_id
    WHERE m.unit_id = ?
    ORDER BY COALESCE(co.reading, co.name)
  `).all(unitId);
}

/* 所属ユニット情報 */
export function getPersonUnits(personId: string) {
  return db().prepare(`
    SELECT u.id, u.name, u.reading, u.kind
    FROM memberships m
    JOIN comedians u ON u.id = m.unit_id
    WHERE m.person_id = ?
    ORDER BY COALESCE(u.reading, u.name)
  `).all(personId);
}
