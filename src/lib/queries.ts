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
      c.name          AS competition_name,
      COALESCE(c.semifinal_label, '準決勝進出組')     AS semifinal_label,
      COALESCE(c.quarterfinal_label, '準々決勝進出組') AS quarterfinal_label
    FROM editions e
    JOIN competitions c ON c.id = e.competition_id
    WHERE c.key = ? AND e.year = ?
    LIMIT 1
  `).get(comp, year) as {
    edition_id: number; year: number; title: string|null; final_date: string|null;
    short_label: string|null; competition_name: string; semifinal_label: string; quarterfinal_label: string;
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
      co.kind         AS co_kind,
      co.birth_year   AS co_birth_year,
      co.birth_month  AS co_birth_month,
      co.birth_day    AS co_birth_day,
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
      semifinal_label: ed.semifinal_label,
      quarterfinal_label: ed.quarterfinal_label,
    },
    columns,  // ← ラベル/クラス/改行フラグ込み
    rows
  };
}

// lib/queries.ts の末尾付近などに追加

type EditionBirthRow = {
  person_id: string;
  person_name: string;
  person_reading: string | null;
  birth_year: number | null;
  birth_month: number | null;
  birth_day: number | null;
  birth_date_raw: string | null;
  unit_id: string | null;
  unit_name: string | null;
};

type EditionFormationRow = {
  unit_id: string;
  unit_name: string;
  unit_reading: string | null;
  birth_year: number | null;
  birth_month: number | null;
  birth_day: number | null;
  birth_date_raw: string | null;
};

type EditionBirthAndFormationTables = {
  birthdayRows: EditionBirthRow[];
  formationRows: EditionFormationRow[];
  hasUnitFinalist: boolean;
};

function normalizeDateSortKey(
  y: number | null,
  m: number | null,
  d: number | null
): [number, number, number, number] {
  const has = y !== null || m !== null || d !== null;
  return [
    has ? 0 : 1,         // 日付ありを先に
    y ?? 9999,
    m ?? 99,
    d ?? 99,
  ];
}

/**
 * 決勝進出者の「誕生日テーブル」「結成日テーブル」用データを返す
 */
export function getEditionBirthAndFormationTables(
  compKey: string,
  year: number
): EditionBirthAndFormationTables {
  // 対象 edition を取得（エラーは getEditionTable と同様の扱いに合わせてください）
  const editionRow = db()
    .prepare(
      `
      SELECT e.id AS edition_id
      FROM editions e
      JOIN competitions c ON c.id = e.competition_id
      WHERE c.key = ? AND e.year = ?
      LIMIT 1
    `
    )
    .get(compKey, year) as { edition_id?: number } | undefined;

  if (!editionRow || !editionRow.edition_id) {
    return { birthdayRows: [], formationRows: [], hasUnitFinalist: false };
  }
  const editionId = editionRow.edition_id;

  // 1) 決勝進出ユニット（結成日テーブル用）
  const formationRaw = db()
    .prepare(
      `
      SELECT DISTINCT
        root.id            AS unit_id,
        root.name          AS unit_name,
        root.reading       AS unit_reading,
        root.birth_year    AS birth_year,
        root.birth_month   AS birth_month,
        root.birth_day     AS birth_day,
        root.birth_date    AS birth_date_raw
      FROM final_results fr
      JOIN comedians co_final
        ON co_final.id = fr.comedian_id
      JOIN comedians root
        ON root.id = COALESCE(co_final.canonical_id, co_final.id)
      WHERE fr.edition_id = ?
        AND CAST(fr.rank_sort AS INTEGER) <= 40
        AND root.kind = 'unit'
    `
    )
    .all(editionId) as EditionFormationRow[];

  // 2) 決勝進出ユニットのメンバー（誕生日テーブル用）
  const memberBirthRaw = db()
    .prepare(
      `
      SELECT DISTINCT
        p_root.id          AS person_id,
        p_root.name        AS person_name,
        p_root.reading     AS person_reading,
        p_root.birth_year  AS birth_year,
        p_root.birth_month AS birth_month,
        p_root.birth_day   AS birth_day,
        p_root.birth_date  AS birth_date_raw,
        u_root.id          AS unit_id,
        u_root.name        AS unit_name
      FROM final_results fr
      JOIN comedians u_final
        ON u_final.id = fr.comedian_id
      JOIN comedians u_root
        ON u_root.id = COALESCE(u_final.canonical_id, u_final.id)
      JOIN memberships m
        ON m.unit_id = u_root.id
      JOIN comedians p_root
        ON p_root.id = m.person_id
      WHERE fr.edition_id = ?
        AND CAST(fr.rank_sort AS INTEGER) <= 40
        AND u_root.kind = 'unit'
        AND p_root.kind = 'person'
    `
    )
    .all(editionId) as EditionBirthRow[];

  // 3) 決勝進出しているピン（ユニットに属さない分も含める）
  const pinBirthRaw = db()
    .prepare(
      `
      SELECT DISTINCT
        p_root.id          AS person_id,
        p_root.name        AS person_name,
        p_root.reading     AS person_reading,
        p_root.birth_year  AS birth_year,
        p_root.birth_month AS birth_month,
        p_root.birth_day   AS birth_day,
        p_root.birth_date  AS birth_date_raw
      FROM final_results fr
      JOIN comedians p_final
        ON p_final.id = fr.comedian_id
      JOIN comedians p_root
        ON p_root.id = COALESCE(p_final.canonical_id, p_final.id)
      WHERE fr.edition_id = ?
        AND CAST(fr.rank_sort AS INTEGER) <= 40
        AND p_root.kind = 'person'
    `
    )
    .all(editionId) as Omit<
    EditionBirthRow,
    "unit_id" | "unit_name"
  >[];

  // memberBirthRaw の person_id を集合化（ユニット所属者）
  const memberPersonIds = new Set<string>(
    memberBirthRaw.map((r) => r.person_id)
  );

  // ピンで決勝に出ているが、上の「ユニット所属者リスト」に入っていない人だけ追加
  const pinOnlyRows: EditionBirthRow[] = pinBirthRaw
    .filter((r) => !memberPersonIds.has(r.person_id))
    .map((r) => ({
      ...r,
      unit_id: null,
      unit_name: null,
    }));

  // 誕生日テーブル用の行を結合
  const birthdayRows: EditionBirthRow[] = [...memberBirthRaw, ...pinOnlyRows];

  // ソート
  birthdayRows.sort((a, b) => {
    const ka = normalizeDateSortKey(a.birth_year, a.birth_month, a.birth_day);
    const kb = normalizeDateSortKey(b.birth_year, b.birth_month, b.birth_day);
    const cmpKey =
      ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2] || ka[3] - kb[3];
    if (cmpKey !== 0) return cmpKey;

    const aName = a.person_reading ?? a.person_name;
    const bName = b.person_reading ?? b.person_name;
    return String(aName).localeCompare(String(bName), "ja");
  });

  formationRaw.sort((a, b) => {
    const ka = normalizeDateSortKey(a.birth_year, a.birth_month, a.birth_day);
    const kb = normalizeDateSortKey(b.birth_year, b.birth_month, b.birth_day);
    const cmpKey =
      ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2] || ka[3] - kb[3];
    if (cmpKey !== 0) return cmpKey;

    const aName = a.unit_reading ?? a.unit_name;
    const bName = b.unit_reading ?? b.unit_name;
    return String(aName).localeCompare(String(bName), "ja");
  });

  const hasUnitFinalist = formationRaw.length > 0;

  return {
    birthdayRows,
    formationRows: formationRaw,
    hasUnitFinalist,
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
export type CoCanonicalRow = {
  id: string;
  name: string;
  reading: string | null;
  kind: "unit" | "person";
  m1_rank_sort: number | null;
  koc_rank_sort: number | null;
  r1_rank_sort: number | null;
};

// 芸人一覧用（birth_date付き）
type CoCanonicalRowWithBirthDate = CoCanonicalRow & {
  birth_date: string | null;
  birth_year: number | null;
  birth_month: number | null;
  birth_day: number | null;
};

// 代表だけ（一覧用既定）
export function listComediansCanonicalOnly(): CoCanonicalRow[] {
  return db().prepare(`
    SELECT
      c.id,
      c.name,
      c.reading,
      c.kind,
      m1.best_rank_sort  AS m1_rank_sort,
      koc.best_rank_sort AS koc_rank_sort,
      r1.best_rank_sort  AS r1_rank_sort
    FROM comedians c
    -- M-1 の最高成績
    LEFT JOIN (
      SELECT
        fr.comedian_id,
        MIN(fr.rank_sort) AS best_rank_sort
      FROM final_results fr
      JOIN editions e      ON e.id = fr.edition_id
      JOIN competitions co ON co.id = e.competition_id
      WHERE co.key = 'm1'
      GROUP BY fr.comedian_id
    ) AS m1
      ON m1.comedian_id = c.id
    -- KOC の最高成績
    LEFT JOIN (
      SELECT
        fr.comedian_id,
        MIN(fr.rank_sort) AS best_rank_sort
      FROM final_results fr
      JOIN editions e      ON e.id = fr.edition_id
      JOIN competitions co ON co.id = e.competition_id
      WHERE co.key = 'koc'
      GROUP BY fr.comedian_id
    ) AS koc
      ON koc.comedian_id = c.id
    -- R-1 の最高成績
    LEFT JOIN (
      SELECT
        fr.comedian_id,
        MIN(fr.rank_sort) AS best_rank_sort
      FROM final_results fr
      JOIN editions e      ON e.id = fr.edition_id
      JOIN competitions co ON co.id = e.competition_id
      WHERE co.key = 'r1'
      GROUP BY fr.comedian_id
    ) AS r1
      ON r1.comedian_id = c.id
    WHERE
      c.canonical_id IS NULL
    ORDER BY COALESCE(c.reading, c.name)
  `).all() as CoCanonicalRow[];
}

// 芸人一覧の「進出経験」フィルタ用：
// 本人 + 直接の所属関係（person→所属ユニット / unit→所属メンバー）の記録も含めた最良(rank_sort最小)を返す
export function listComediansCanonicalOnlyWithRelatedRanks(): CoCanonicalRow[] {
  const BIG = 99999999;

  const rows = db().prepare(`
    WITH canon AS (
      SELECT id AS raw_id, COALESCE(canonical_id, id) AS canon_id
      FROM comedians
    ),
    fr_best AS (
      SELECT
        can.canon_id AS canon_id,
        comp.key     AS comp_key,
        MIN(fr.rank_sort) AS best_rank_sort
      FROM final_results fr
      JOIN canon can        ON can.raw_id = fr.comedian_id
      JOIN editions e       ON e.id = fr.edition_id
      JOIN competitions comp ON comp.id = e.competition_id
      GROUP BY can.canon_id, comp.key
    ),
    rel AS (
      SELECT
        c.id AS base_id,
        CASE
          WHEN c.kind = 'person' THEN ucan.canon_id
          WHEN c.kind = 'unit'   THEN pcan.canon_id
          ELSE NULL
        END AS rel_canon_id
      FROM comedians c
      JOIN memberships m
      JOIN canon pcan ON pcan.raw_id = m.person_id
      JOIN canon ucan ON ucan.raw_id = m.unit_id
      WHERE c.canonical_id IS NULL
        AND (
          (c.kind = 'person' AND pcan.canon_id = c.id)
          OR
          (c.kind = 'unit'   AND ucan.canon_id = c.id)
        )
    ),
    ids AS (
      SELECT c.id AS base_id, c.id AS canon_id
      FROM comedians c
      WHERE c.canonical_id IS NULL
      UNION ALL
      SELECT base_id, rel_canon_id
      FROM rel
      WHERE rel_canon_id IS NOT NULL
    )
    SELECT
      c.id,
      c.name,
      c.reading,
      c.kind,

      COALESCE((
        SELECT MIN(b.best_rank_sort)
        FROM ids i
        JOIN fr_best b ON b.canon_id = i.canon_id
        WHERE i.base_id = c.id AND b.comp_key = 'm1'
      ), :BIG) AS m1_rank_sort,

      COALESCE((
        SELECT MIN(b.best_rank_sort)
        FROM ids i
        JOIN fr_best b ON b.canon_id = i.canon_id
        WHERE i.base_id = c.id AND b.comp_key = 'koc'
      ), :BIG) AS koc_rank_sort,

      COALESCE((
        SELECT MIN(b.best_rank_sort)
        FROM ids i
        JOIN fr_best b ON b.canon_id = i.canon_id
        WHERE i.base_id = c.id AND b.comp_key = 'r1'
      ), :BIG) AS r1_rank_sort

    FROM comedians c
    WHERE c.canonical_id IS NULL
    ORDER BY COALESCE(c.reading, c.name)
  `).all({ BIG }) as any[];

  return rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    reading: r.reading,
    kind: r.kind,
    m1_rank_sort: r.m1_rank_sort === BIG ? null : r.m1_rank_sort,
    koc_rank_sort: r.koc_rank_sort === BIG ? null : r.koc_rank_sort,
    r1_rank_sort: r.r1_rank_sort === BIG ? null : r.r1_rank_sort,
  })) as CoCanonicalRow[];
}

// 芸人一覧の「進出経験」フィルタ用（birth_date付き）：
// 本人 + 直接の所属関係（person→所属ユニット / unit→所属メンバー）の記録も含めた最良(rank_sort最小)を返す
export function listComediansCanonicalOnlyWithRelatedRanksAndBirthDate(): CoCanonicalRowWithBirthDate[] {
  const BIG = 99999999;

  const rows = db().prepare(`
    WITH canon AS (
      SELECT id AS raw_id, COALESCE(canonical_id, id) AS canon_id
      FROM comedians
    ),
    fr_best AS (
      SELECT
        can.canon_id AS canon_id,
        comp.key     AS comp_key,
        MIN(fr.rank_sort) AS best_rank_sort
      FROM final_results fr
      JOIN canon can        ON can.raw_id = fr.comedian_id
      JOIN editions e       ON e.id = fr.edition_id
      JOIN competitions comp ON comp.id = e.competition_id
      GROUP BY can.canon_id, comp.key
    ),
    rel AS (
      SELECT
        c.id AS base_id,
        CASE
          WHEN c.kind = 'person' THEN ucan.canon_id
          WHEN c.kind = 'unit'   THEN pcan.canon_id
          ELSE NULL
        END AS rel_canon_id
      FROM comedians c
      JOIN memberships m
      JOIN canon pcan ON pcan.raw_id = m.person_id
      JOIN canon ucan ON ucan.raw_id = m.unit_id
      WHERE c.canonical_id IS NULL
        AND (
          (c.kind = 'person' AND pcan.canon_id = c.id)
          OR
          (c.kind = 'unit'   AND ucan.canon_id = c.id)
        )
    ),
    ids AS (
      SELECT c.id AS base_id, c.id AS canon_id
      FROM comedians c
      WHERE c.canonical_id IS NULL
      UNION ALL
      SELECT base_id, rel_canon_id
      FROM rel
      WHERE rel_canon_id IS NOT NULL
    )
    SELECT
      c.id,
      c.name,
      c.reading,
      c.kind,
      c.birth_date,
      c.birth_year,
      c.birth_month,
      c.birth_day,

      COALESCE((
        SELECT MIN(b.best_rank_sort)
        FROM ids i
        JOIN fr_best b ON b.canon_id = i.canon_id
        WHERE i.base_id = c.id AND b.comp_key = 'm1'
      ), :BIG) AS m1_rank_sort,

      COALESCE((
        SELECT MIN(b.best_rank_sort)
        FROM ids i
        JOIN fr_best b ON b.canon_id = i.canon_id
        WHERE i.base_id = c.id AND b.comp_key = 'koc'
      ), :BIG) AS koc_rank_sort,

      COALESCE((
        SELECT MIN(b.best_rank_sort)
        FROM ids i
        JOIN fr_best b ON b.canon_id = i.canon_id
        WHERE i.base_id = c.id AND b.comp_key = 'r1'
      ), :BIG) AS r1_rank_sort

    FROM comedians c
    WHERE c.canonical_id IS NULL
    ORDER BY COALESCE(c.reading, c.name)
  `).all({ BIG }) as any[];

  return rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    reading: r.reading,
    kind: r.kind,
    birth_date: r.birth_date,
    birth_year: r.birth_year,
    birth_month: r.birth_month,
    birth_day: r.birth_day,
    m1_rank_sort: r.m1_rank_sort === BIG ? null : r.m1_rank_sort,
    koc_rank_sort: r.koc_rank_sort === BIG ? null : r.koc_rank_sort,
    r1_rank_sort: r.r1_rank_sort === BIG ? null : r.r1_rank_sort,
  })) as CoCanonicalRowWithBirthDate[];
}

// 芸人一覧用（birth_date付き）
export function listComediansCanonicalOnlyWithBirthDate(): CoCanonicalRowWithBirthDate[] {
  return db().prepare(`
    SELECT
      c.id,
      c.name,
      c.reading,
      c.kind,
      c.birth_date,
      c.birth_year,
      c.birth_month,
      c.birth_day,
      m1.best_rank_sort  AS m1_rank_sort,
      koc.best_rank_sort AS koc_rank_sort,
      r1.best_rank_sort  AS r1_rank_sort
    FROM comedians c
    -- M-1 の最高成績
    LEFT JOIN (
      SELECT
        fr.comedian_id,
        MIN(fr.rank_sort) AS best_rank_sort
      FROM final_results fr
      JOIN editions e      ON e.id = fr.edition_id
      JOIN competitions co ON co.id = e.competition_id
      WHERE co.key = 'm1'
      GROUP BY fr.comedian_id
    ) AS m1
      ON m1.comedian_id = c.id
    -- KOC の最高成績
    LEFT JOIN (
      SELECT
        fr.comedian_id,
        MIN(fr.rank_sort) AS best_rank_sort
      FROM final_results fr
      JOIN editions e      ON e.id = fr.edition_id
      JOIN competitions co ON co.id = e.competition_id
      WHERE co.key = 'koc'
      GROUP BY fr.comedian_id
    ) AS koc
      ON koc.comedian_id = c.id
    -- R-1 の最高成績
    LEFT JOIN (
      SELECT
        fr.comedian_id,
        MIN(fr.rank_sort) AS best_rank_sort
      FROM final_results fr
      JOIN editions e      ON e.id = fr.edition_id
      JOIN competitions co ON co.id = e.competition_id
      WHERE co.key = 'r1'
      GROUP BY fr.comedian_id
    ) AS r1
      ON r1.comedian_id = c.id
    WHERE
      c.canonical_id IS NULL
    ORDER BY COALESCE(c.reading, c.name)
  `).all() as CoCanonicalRowWithBirthDate[];
}

/* 芸人ページ：大会ごとに年の縦表（追加列の選定は大会年ごとに実データベース準拠） */
export function getComedianTables(comedianId: string) {
  const me = db().prepare(`
    SELECT id, name, note, reading, COALESCE(canonical_id, id) AS root_id
    FROM comedians WHERE id=?
  `).get(comedianId) as any;
  if (!me) return null;

  // 同じ root に属する全ID（代表＋別名）
  const ids = db().prepare(`
    SELECT id FROM comedians WHERE COALESCE(canonical_id, id)=?
  `).all(me.root_id) as {id:string}[];
  const idList = ids.map(x => x.id);

  // 代表の素データを見出しに使う
  const co = db().prepare(`
    SELECT
      id,
      name,
      reading,
      NULLIF(TRIM(note), '') AS note,
      kind,
      m1_url,
      birth_date,
      birth_year
    FROM comedians
    WHERE id=?
    LIMIT 1
  `).get(me.root_id) as {
    id:string; name:string; reading:string|null; note:string|null; kind:'person'|'unit'|null; m1_url:string|null;
    birth_date:string|null; birth_year:number|null;
  } | undefined;

  if (!co) return null;

  // 全記録（当時名で出す。名義ラベルとリンク先=代表IDも付与）
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

/* 芸人ページ：年ごとに縦表（同年内で全大会の列メタをユニオン） */
export function getComedianTablesByYear(comedianId: string) {
  const me = db().prepare(`
    SELECT id, COALESCE(canonical_id, id) AS root_id
    FROM comedians WHERE id=?
  `).get(comedianId) as { id:string; root_id:string } | undefined;
  if (!me) return null;

  // 同じ root に属する全ID（代表＋別名）
  const ids = db().prepare(`
    SELECT id FROM comedians WHERE COALESCE(canonical_id, id)=?
  `).all(me.root_id) as {id:string}[];
  const idList = ids.map(x => x.id);

  // 見出し用（代表）
  const co = db().prepare(`
    SELECT
      id, name, reading, NULLIF(TRIM(note), '') AS note, kind, m1_url
    FROM comedians
    WHERE id=?
    LIMIT 1
  `).get(me.root_id) as {
    id:string; name:string; reading:string|null; note:string|null; kind:'person'|'unit'|null; m1_url:string|null
  } | undefined;
  if (!co) return null;

  // まず全行を取得（同じSQLだが ORDER は年→大会の順に）
  const rows = db().prepare(`
    SELECT
      e.id   AS edition_id,
      e.year,
      e.short_label,
      e.final_date,
      COALESCE(CAST(STRFTIME('%Y%m%d', e.final_date) AS INTEGER), 0) AS final_sort,
      c.key  AS comp,
      c.name AS competition_name,
      c.sort_order AS comp_sort_order,
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
    ORDER BY (e.year IS NULL), e.year DESC, (c.sort_order IS NULL), c.sort_order, c.key
  `).all(...idList) as Array<{
    edition_id:number; year:number|null; short_label:string|null;
    final_date:string|null; final_sort:number;
    comp:string; competition_name:string; comp_sort_order:number|null;
    rank:string; rank_sort:number;
    comedian_id:string; comedian_name:string; link_id:string; alias_label:string;
  }>;

  type ColumnMeta = {
    key: string;
    label?: string | null;
    pref_order?: number | null;
    is_multiline?: 0 | 1 | null;
    col_class?: string | null;
    related_key?: string | null;
  };

  // 同一年に含まれる edition の列メタをユニオン
  const unionColumns = (colsArrays: ColumnMeta[][]): ColumnMeta[] => {
    const seen = new Set<string>();
    const out: ColumnMeta[] = [];
    for (const arr of colsArrays) {
      for (const c of arr) {
        if (seen.has(c.key)) continue;
        seen.add(c.key);
        out.push(c);
      }
    }
    out.sort((a, b) => {
      const ap = a.pref_order ?? 9_999_999;
      const bp = b.pref_order ?? 9_999_999;
      return ap !== bp ? ap - bp : String(a.key).localeCompare(String(b.key));
    });
    return out;
  };

  const isNonEmptyString = (v: unknown) => (typeof v === "string" ? v.trim() !== "" : v != null);

  const columnIsVisible = (c: ColumnMeta, rows: any[]) => {
    for (const r of rows) {
      if (c.key === "first_order") {
        const v = r[c.key];
        if (v !== null && v !== undefined && String(v).trim() !== "") return true;
        continue;
      }
      if (c.related_key) {
        const text = r[c.key];
        const url  = r[c.related_key];
        if (isNonEmptyString(text) || isNonEmptyString(url)) return true;
        continue;
      }
      if (isNonEmptyString(r[c.key])) return true;
    }
    return false;
  };

  // edition_id ごとに、その芸人の追加列＋関連動画列を取り出すヘルパ（既存関数と同形）
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

  // 年ごとに集約
  const byYearMap = new Map<number|null, {
    year:number|null;
    short_labels:Set<string|null>;
    rows:any[];
    columns: ColumnMeta[];    // ユニオン前は空、最後に決定
    showAlias:boolean;
    _colsBucket: ColumnMeta[][];
  }>();

  for (const r of rows) {
    let y = byYearMap.get(r.year);
    if (!y) {
      y = { year: r.year, short_labels: new Set(), rows: [], columns: [], showAlias:false, _colsBucket: [] };
      byYearMap.set(r.year, y);
    }
    y.short_labels.add(r.short_label);

    const { cols, extra } = loadExtrasForEditionRow(r.edition_id, r.comedian_id);
    restoreMultilineInRow(extra, cols);
    y._colsBucket.push(cols);

    // 年ビューでは1列目に大会名を出すので comp 情報を保持
    y.rows.push({
      ...r,
      ...extra,
    });

    if (!y.showAlias) {
      y.showAlias = typeof r.alias_label === "string" && r.alias_label.trim() !== "";
    }
  }

  const toSortNum = (s: string | null | undefined): number => {
    if (!s) return 0;
    // 許容: 2024-7-7 / 2024-07-07 / 2024/7/7 / 2024/07/07
    const m = String(s).match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (!m) return 0;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (!y || !mo || !d) return 0;
    return y * 10000 + mo * 100 + d; // 例: 2024-7-7 → 20240707
  };

  // rows を byYearMap に詰め終わった後、ソート前に実行
  for (const y of byYearMap.values()) {
    for (const r of y.rows) {
      if (typeof r.final_sort !== 'number' || r.final_sort === 0) {
        r.final_sort = toSortNum(r.final_date);
      }
    }
  }

  const byYear = Array.from(byYearMap.values())
    .map(y => {
      const columns = unionColumns(y._colsBucket);
      const vis = columns.filter(c => columnIsVisible(c, y.rows));
      // 表示順：同年内で大会→順位→読み順（既存と整合）
      y.rows.sort((a:any, b:any) => {
        const af = typeof a.final_sort === 'number' ? a.final_sort : 0;
        const bf = typeof b.final_sort === 'number' ? b.final_sort : 0;
        if (af !== bf) return bf - af; // 降順。0は自然に末尾側へ

        // タイブレーク：大会ソート順 → 順位 → 読み/名前
        const ao = a.comp_sort_order ?? 9_999_999;
        const bo = b.comp_sort_order ?? 9_999_999;
        if (ao !== bo) return ao - bo;

        const ars = a.rank_sort ?? 9_999_999;
        const brs = b.rank_sort ?? 9_999_999;
        if (ars !== brs) return ars - brs;

        const ax = (a.comedian_reading ?? a.comedian_name) as string;
        const bx = (b.comedian_reading ?? b.comedian_name) as string;
        return ax.localeCompare(bx, 'ja');
      });

      return {
        year: y.year,
        short_label: Array.from(y.short_labels).find(v => v != null) ?? null,
        columns: vis,
        rows: y.rows,
        showAlias: y.showAlias,
      };
    })
    // 年降順、null は末尾
    .sort((a, b) => (a.year == null ? 1 : b.year == null ? -1 : b.year - a.year));

  return { comedian: co, byYear };
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
        WHEN 3 THEN CAST(fr.third_order  AS INTEGER)
        ELSE NULL
      END AS order_no,
      CASE ? WHEN 1 THEN fr.first_group ELSE NULL END AS group_name,
      js.match_no,
      js.seat_no,
      js.score
    FROM final_results fr
    JOIN comedians co ON co.id=fr.comedian_id
    LEFT JOIN judge_scores js
      ON js.edition_id=fr.edition_id
     AND js.stage='main'
     AND js.value_kind='score'
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
  `).all(round_no, round_no, round_no, ed.eid, round_no) as Array<{
    comedian_id:string;
    comedian_name:string;
    comedian_reading:string|null;
    rank_sort:number;
    order_no:number|null;
    group_name:string|null;
    match_no:number|null;
    seat_no:number|null;
    score:number|null;
  }>;

  type Row = {
    comedian_id:string;
    comedian_name:string;
    comedian_reading:string|null;
    rank_sort:number;
    order_no:number|null;
    group_name:string|null;
    match_no:number|null;
    bySeat: Record<number, number|null>;
    total:number|null
  };

  const byId = new Map<string, Row>();
  for (const r of rows) {
    const key = `${r.comedian_id}::${r.match_no ?? 0}`;
    let row = byId.get(key);
    if (!row) {
      row = {
        comedian_id:r.comedian_id,
        comedian_name:r.comedian_name,
        comedian_reading:r.comedian_reading ?? null,
        rank_sort:r.rank_sort,
        order_no:r.order_no,
        group_name:r.group_name ?? null,
        match_no:r.match_no ?? null,
        bySeat:{}, total:null
      };
      byId.set(key, row);
    }
    if (r.seat_no != null) row.bySeat[r.seat_no] = r.score;
  }
  const out = Array.from(byId.values());
  for (const row of out) {
    const vals = seats.map(s => row.bySeat[s.seat_no]).filter(v => typeof v === "number") as number[];
    row.total = vals.length ? vals.reduce((a,b)=>a+b,0) : null;
  }

  // ❶ 投票モード判定（合計の最大が 5 以下）
  const maxTotal = out.reduce((m, r) => (typeof r.total === "number" && r.total > m ? r.total : m), 0);
  const mode: "vote" | "score" = (maxTotal <= 30) ? "vote" : "score";

  // ❷ ブロック分割（1本目のみ有効）
  let groups: Array<{ label: string; rows: Row[] }> = [];
  if (round_no === 1) {
    const map = new Map<string, Row[]>();
    for (const r of out) {
      const key = r.group_name ?? ""; // 空キー=ブロックなし
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    // 空キー（ブロックなし）は除外、名前順で安定化
    groups = Array.from(map.entries())
      .filter(([k]) => k !== "")
      .map(([k, rs]) => ({ label: k, rows: rs }));
    groups.sort((a,b) => a.label.localeCompare(b.label, "ja"));
  }

  return { seats, rows: out, mode, groups };
}

export function getRevivalAudiencePercentMatches(comp: string, year: number) {
  const ed = db().prepare(`
    SELECT e.id AS eid
    FROM editions e JOIN competitions c ON c.id=e.competition_id
    WHERE c.key=? AND e.year=? LIMIT 1
  `).get(comp, year) as { eid:number } | undefined;
  if (!ed) return null;

  const rows = db().prepare(`
    SELECT
      js.group_name,
      js.match_no,
      js.order_no,
      js.score AS percent,
      co.id   AS comedian_id,
      co.name AS comedian_name,
      co.reading AS comedian_reading
    FROM judge_scores js
    JOIN comedians co ON co.id=js.comedian_id
    WHERE js.edition_id=?
      AND js.stage='revival_audience'
      AND js.value_kind='percent'
    ORDER BY
      js.group_name ASC,
      js.match_no   ASC,
      js.order_no   ASC,
      (co.reading IS NULL), co.reading ASC, co.name ASC
  `).all(ed.eid) as Array<{
    group_name: string | null;
    match_no: number;
    order_no: number | null;
    percent: number;
    comedian_id: string;
    comedian_name: string;
    comedian_reading: string | null;
  }>;

  type Side = { comedian_id:string; comedian_name:string; percent:number; order_no:number };
  type Match = { match_no:number; left:Side; right:Side };

  const groupMap = new Map<string, Map<number, Side[]>>();

  for (const r of rows) {
    const g = (r.group_name ?? "").trim();
    if (g === "") continue;

    if (r.match_no == null) continue;
    if (r.order_no == null) continue;

    if (!groupMap.has(g)) groupMap.set(g, new Map());
    const byMatch = groupMap.get(g)!;
    if (!byMatch.has(r.match_no)) byMatch.set(r.match_no, []);
    byMatch.get(r.match_no)!.push({
      comedian_id: r.comedian_id,
      comedian_name: r.comedian_name,
      percent: r.percent,
      order_no: r.order_no
    });
  }

  const groups = Array.from(groupMap.entries())
    .sort(([a],[b]) => a.localeCompare(b))
    .map(([label, byMatch]) => {
      const matches: Match[] = Array.from(byMatch.entries())
        .sort(([a],[b]) => a - b)
        .flatMap(([match_no, sides]) => {
          if (sides.length !== 2) return [];
          const [s1, s2] = sides[0].order_no <= sides[1].order_no ? [sides[0], sides[1]] : [sides[1], sides[0]];
          return [{ match_no, left: s1, right: s2 }];
        });
      return { label, matches };
    });

  return { groups };
}

export function getRevivalFinalVotes(comp: string, year: number) {
  const ed = db().prepare(`
    SELECT e.id AS eid
    FROM editions e
    JOIN competitions c ON c.id = e.competition_id
    WHERE c.key = ? AND e.year = ?
    LIMIT 1
  `).get(comp, year) as { eid: number } | undefined;

  if (!ed) return null;

  const rows = db().prepare(`
    SELECT
      js.match_no,
      js.group_name,
      js.score AS votes,
      co.id   AS comedian_id,
      co.name AS comedian_name
    FROM judge_scores js
    JOIN comedians co ON co.id = js.comedian_id
    WHERE js.edition_id = ?
      AND js.stage = 'revival_final'
      AND js.value_kind = 'vote'
      AND js.round_no = 0
      AND js.seat_no = 0
    ORDER BY js.match_no ASC, js.score DESC, co.name ASC
  `).all(ed.eid) as Array<{
    match_no: number;
    group_name: string | null;
    votes: number;
    comedian_id: string;
    comedian_name: string;
  }>;

  if (rows.length === 0) return null;

  const byMatch = new Map<number, typeof rows>();
  for (const r of rows) {
    const k = r.match_no ?? 0;
    if (!byMatch.has(k)) byMatch.set(k, []);
    byMatch.get(k)!.push(r);
  }

  const ballots = Array.from(byMatch.entries())
    .sort(([a], [b]) => a - b)
    .map(([matchNo, rs]) => {
      const normalized = rs.map((x) => ({
        match_no: x.match_no,
        group_name: x.group_name,
        votes: Number.isFinite(x.votes) ? Math.round(x.votes) : 0,
        comedian_id: x.comedian_id,
        comedian_name: x.comedian_name,
      }));

      const maxVotes = Math.max(...normalized.map((x) => x.votes));
      const winners = normalized.filter((x) => x.votes === maxVotes).map((x) => x.comedian_id);

      return {
        match_no: matchNo,
        rows: normalized,
        max_votes: maxVotes,
        winner_ids: winners, // 同率なら複数
      };
    });

  return { ballots };
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

/* 芸人リスト項目型 */
export type CoListItem = {
  id: string;
  link_id: string;
  name: string;
  reading: string | null;
  kind: 'person' | 'unit' | null;
  m1_min_rank_sort: number | null;   // 例: 1, 2, 4, 50, 100, 500... / null
  koc_min_rank_sort: number | null;
  r1_min_rank_sort: number | null;
};

// 代表IDを1回解決
const selRootId = db().prepare(`
  SELECT COALESCE(canonical_id, id) AS rid FROM comedians WHERE id=? LIMIT 1
`);

/* 所属メンバー情報 */
export function getUnitMembers(unitId: string): CoListItem[] {
  return db().prepare(`
    SELECT co.id,
           COALESCE(co.canonical_id, co.id) AS link_id,
           co.name, co.reading, co.kind
    FROM memberships m
    JOIN comedians co ON co.id = m.person_id
    WHERE m.unit_id = ?
    ORDER BY COALESCE(co.reading, co.name)
  `).all(unitId) as CoListItem[];
}

/* 所属ユニット情報 */
export function getPersonUnits(personId: string): CoListItem[] {
  return db().prepare(`
    SELECT u.id,
           COALESCE(u.canonical_id, u.id) AS link_id,
           u.name, u.reading, u.kind
    FROM memberships m
    JOIN comedians u ON u.id = m.unit_id
    WHERE m.person_id = ?
    ORDER BY COALESCE(u.reading, u.name)
  `).all(personId) as CoListItem[];
}

/* 関連ユニット情報（同じメンバーを持つ別ユニット） */
export function getRelatedUnitsForUnit(unitId: string): CoListItem[] {
  return db().prepare(`
    SELECT DISTINCT
      c2.id               AS id,
      c2.id               AS link_id,          -- 代表へリンク
      c2.name             AS name,
      c2.reading          AS reading,
      c2.kind             AS kind
    FROM memberships m1                          -- 対象ユニットのメンバー
    JOIN memberships m2 ON m2.person_id = m1.person_id   -- そのメンバーが所属する別ユニット
    JOIN comedians u   ON u.id  = m2.unit_id
    JOIN comedians c2  ON c2.id = COALESCE(u.canonical_id, u.id) -- canonical へ正規化
    WHERE m1.unit_id = ?
      AND m2.unit_id <> ?
    ORDER BY COALESCE(c2.reading, c2.name)
  `).all(unitId, unitId) as CoListItem[];
}

/* 関連メンバー情報（同じユニットに所属する別メンバー） */
export function getRelatedMembersForPerson(personId: string): CoListItem[] {
  return db().prepare(`
    SELECT DISTINCT
      c2.id               AS id,
      c2.id               AS link_id,
      c2.name             AS name,
      c2.reading          AS reading,
      c2.kind             AS kind
    FROM memberships mu                           -- 対象の人→所属ユニット
    JOIN memberships mo ON mo.unit_id = mu.unit_id -- 同じユニットのメンバー
    JOIN comedians p   ON p.id  = mo.person_id
    JOIN comedians c2  ON c2.id = COALESCE(p.canonical_id, p.id)
    WHERE mu.person_id = ?
      AND mo.person_id <> ?
    ORDER BY COALESCE(c2.reading, c2.name)
  `).all(personId, personId) as CoListItem[];
}

/* ============================= 更新履歴 ============================= */
export type UpdateRow = {
  date: string;    // 'YYYY-MM-DD'
  content: string; // プレーンテキスト（改行は "\\n" で保存されている想定）
};

function unescapeUpdateContent(content: string): string {
  // CSV側要件：「改行する場合は "\\n"」
  return String(content ?? "").replace(/\\n/g, "\n");
}

export function listUpdates(limit?: number): UpdateRow[] {
  const lim = (limit == null) ? null : Math.max(0, Math.trunc(limit));
  const rows = (lim == null)
    ? db().prepare(`
        SELECT date, content
        FROM updates
        ORDER BY date DESC
      `).all()
    : db().prepare(`
        SELECT date, content
        FROM updates
        ORDER BY date DESC
        LIMIT ?
      `).all(lim);

  return (rows as any[]).map((r) => ({
    date: String(r.date),
    content: unescapeUpdateContent(String(r.content ?? "")),
  }));
}

export function listLatestUpdates(): UpdateRow[] {
  return listUpdates(3);
}

/* 今日誕生日の芸人 */
export function listTodaysBirthdayComedians(): CoCanonicalRowWithBirthDate[] {
  // 日本時間（JST = UTC+9）で今日の日付を取得
  const now = new Date();
  const japanTime = new Date(now.getTime() + (9 * 60 * 60 * 1000)); // UTC+9時間
  const month = String(japanTime.getMonth() + 1).padStart(2, '0');
  const day = String(japanTime.getDate()).padStart(2, '0');
  
  return db().prepare(`
    SELECT
      c.id,
      c.name,
      c.reading,
      c.kind,
      c.birth_date,
      c.birth_year,
      c.birth_month,
      c.birth_day,
      m1.best_rank_sort  AS m1_rank_sort,
      koc.best_rank_sort AS koc_rank_sort,
      r1.best_rank_sort  AS r1_rank_sort
    FROM comedians c
    -- M-1 の最高成績
    LEFT JOIN (
      SELECT fr.comedian_id, MIN(fr.rank_sort) AS best_rank_sort
      FROM final_results fr
      JOIN editions e ON fr.edition_id = e.id
      JOIN competitions comp ON e.competition_id = comp.id
      WHERE comp.key = 'm1'
      GROUP BY fr.comedian_id
    ) m1 ON c.id = m1.comedian_id
    -- KOC の最高成績
    LEFT JOIN (
      SELECT fr.comedian_id, MIN(fr.rank_sort) AS best_rank_sort
      FROM final_results fr
      JOIN editions e ON fr.edition_id = e.id
      JOIN competitions comp ON e.competition_id = comp.id
      WHERE comp.key = 'koc'
      GROUP BY fr.comedian_id
    ) koc ON c.id = koc.comedian_id
    -- R-1 の最高成績
    LEFT JOIN (
      SELECT fr.comedian_id, MIN(fr.rank_sort) AS best_rank_sort
      FROM final_results fr
      JOIN editions e ON fr.edition_id = e.id
      JOIN competitions comp ON e.competition_id = comp.id
      WHERE comp.key = 'r1'
      GROUP BY fr.comedian_id
    ) r1 ON c.id = r1.comedian_id
    WHERE c.canonical_id IS NULL
    AND c.kind = 'person'
    AND c.birth_date IS NOT NULL
    AND (
      (c.birth_date LIKE '%年${month}月${day}日')
      OR (c.birth_date LIKE '%年${Number(month)}月${Number(day)}日')
    )
    ORDER BY c.birth_year DESC, c.birth_month DESC, c.birth_day DESC, c.name
  `).all() as CoCanonicalRowWithBirthDate[];
}

/* 各大会の優勝者を取得 */
export function getEditionWinners(comp: string, year: number): string[] {
  const rows = db().prepare(`
    SELECT c.name
    FROM final_results fr
    JOIN editions e ON fr.edition_id = e.id
    JOIN competitions comp ON e.competition_id = comp.id
    JOIN comedians c ON fr.comedian_id = c.id
    WHERE comp.key = ? AND e.year = ? AND fr.rank = '優勝'
    ORDER BY c.name
  `).all(comp, year) as Array<{ name: string }>;
  
  return rows.map(row => row.name);
}

/* 結成年の範囲を取得（ユニットのみ） */
export function getFormationYearRange(): { min: number; max: number } {
  const result = db().prepare(`
    SELECT MIN(birth_year) as min_year, MAX(birth_year) as max_year
    FROM comedians
    WHERE birth_year IS NOT NULL AND kind = 'unit' AND canonical_id IS NULL
  `).get() as { min_year: number; max_year: number };
  
  return {
    min: result.min_year || 1950,
    max: result.max_year || new Date().getFullYear()
  };
}
