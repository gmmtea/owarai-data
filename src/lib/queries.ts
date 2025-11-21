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
      AND COALESCE(has_profile, 0) = 1
    ORDER BY COALESCE(reading, name)
  `).all();
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
      m1_url
    FROM comedians
    WHERE id=?
    LIMIT 1
  `).get(me.root_id) as {
    id:string; name:string; reading:string|null; note:string|null; kind:'person'|'unit'|null; m1_url:string|null
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
  `).all(round_no, round_no, round_no, ed.eid, round_no) as Array<{
    comedian_id:string;
    comedian_name:string;
    comedian_reading:string|null;
    rank_sort:number;
    order_no:number|null;
    group_name:string|null;
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
    bySeat: Record<number, number|null>;
    total:number|null
  };

  const byId = new Map<string, Row>();
  for (const r of rows) {
    let row = byId.get(r.comedian_id);
    if (!row) {
      row = {
        comedian_id:r.comedian_id,
        comedian_name:r.comedian_name,
        comedian_reading:r.comedian_reading ?? null,
        rank_sort:r.rank_sort,
        order_no:r.order_no,
        group_name:r.group_name ?? null,
        bySeat:{}, total:null
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
  has_profile?: 0 | 1;
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
           co.name, co.reading, co.kind,
           COALESCE(co.has_profile, 0) AS has_profile
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
           u.name, u.reading, u.kind,
           COALESCE(u.has_profile, 0) AS has_profile
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
      c2.kind             AS kind,
      COALESCE(c2.has_profile, 0) AS has_profile
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
      c2.kind             AS kind,
      COALESCE(c2.has_profile, 0) AS has_profile
    FROM memberships mu                           -- 対象の人→所属ユニット
    JOIN memberships mo ON mo.unit_id = mu.unit_id -- 同じユニットのメンバー
    JOIN comedians p   ON p.id  = mo.person_id
    JOIN comedians c2  ON c2.id = COALESCE(p.canonical_id, p.id)
    WHERE mu.person_id = ?
      AND mo.person_id <> ?
    ORDER BY COALESCE(c2.reading, c2.name)
  `).all(personId, personId) as CoListItem[];
}

/* プロフィールあり芸人ID一覧 */
export function listComedianIdsWithProfile(): string[] {
  return db().prepare(`
    SELECT id
    FROM comedians
    WHERE has_profile = 1
    ORDER BY reading IS NULL, reading, name
  `).all().map((r:any) => r.id);
}
