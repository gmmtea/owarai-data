import Database from "better-sqlite3";
let _db: any = null;
const db = () => (_db ??= new (Database as any)("data/awards.sqlite", { readonly: true }));

// 大会一覧・Map・名称取得
export function listCompetitions(): { key: string; name: string; sort_order: number | null }[] {
  return db().prepare(`
    SELECT key, name, sort_order
    FROM competitions
    ORDER BY sort_order IS NULL, sort_order, key
  `).all();
}

export function competitionMap(): Record<string, string> {
  const rows = listCompetitions();
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.name;
  return map;
}

export function competitionOrder(): string[] {
  // listCompetitions() は ORDER BY sort_order IS NULL, sort_order, key で並ぶので、
  // そのまま key の配列にして返す
  return listCompetitions().map(c => c.key);
}

export function competitionName(key: string): string | null {
  const row = db().prepare(`select name from competitions where key=? limit 1`).get(key) as { name: string } | undefined;
  return row?.name ?? null;
}

// ナビ用
export function listEditionParams() {
  const rows = db().prepare(`
    select c.key as comp, e.year
    from editions e join competitions c on c.id=e.competition_id
    order by c.key, e.year
  `).all() as { comp: string; year: number }[];
  return rows.map(r => ({ comp: r.comp, year: String(r.year) }));
}

// final_results の追加列一覧（id,edition_id,comedian_id,rank を除外）
function finalResultExtraColumns(): string[] {
  const info = db().prepare(`pragma table_info('final_results')`).all() as { name: string }[];
  const base = new Set(["id","edition_id","comedian_id","rank","rank_sort"]);
  return info.map(i=>i.name).filter(n => !base.has(n));
}

// 大会×年の表
export function getEditionTable(comp: string, year: number) {
  const ed = db().prepare(`
    select e.id as edition_id, e.year, c.name as competition_name
    from editions e join competitions c on c.id=e.competition_id
    where c.key=? and e.year=?`).get(comp, year) as any;
  if (!ed) return null;

  const extras = finalResultExtraColumns();
  const selectExtras = extras.map(k => `fr."${k}" as "${k}"`).join(", ");
  const sql = `
    select fr.rank, fr.rank_sort, co.id as comedian_id, co.name
      ${selectExtras ? ","+selectExtras : ""}
    from final_results fr
    join comedians co on co.id=fr.comedian_id
    where fr.edition_id=?
    order by CAST(fr.rank_sort AS INTEGER) asc, co.name asc
  `;
  const rows = db().prepare(sql).all(ed.edition_id) as any[];

  const used = extras.filter(k => rows.some(r => r[k] !== null && String(r[k] ?? "").trim() !== ""));
  return { edition: { year: ed.year, competition_name: ed.competition_name }, extraKeys: used, rows };
}

// 大会ページ（年ごとの表の配列）
export function getCompetitionYearTables(comp: string) {
  const years = db().prepare(`
    select e.year from editions e
    join competitions c on c.id=e.competition_id
    where c.key=?
    order by e.year desc
  `).all(comp) as { year:number }[];
  return years.map(y => ({ year: y.year, table: getEditionTable(comp, y.year)! }));
}

// 芸人ID一覧（登場者のみ）
export function listTargetComedianIds() {
  const rows = db().prepare(`
    select distinct co.id
    from comedians co
    where exists (select 1 from final_results fr where fr.comedian_id=co.id)
    order by co.name
  `).all() as { id:string }[];
  return rows.map(r => r.id);
}

// 芸人の素データ（id, name, reading）を取得
export function listComediansAll(): { id: string; name: string; reading: string | null }[] {
  // 並びはページ側で調整するので素のまま返す（DBコラレーションを気にしないため）
  return db().prepare(`SELECT id, name, reading FROM comedians`).all();
}

// 芸人ページ：大会ごとに「年の縦表」
export function getComedianTables(comedianId: string) {
  const co = db().prepare(`select id, name, reading from comedians where id=?`).get(comedianId) as any;
  if (!co) return null;
  const extras = finalResultExtraColumns();
  const selectExtras = extras.length
    ? ", " + extras.map(k => `fr."${k}" as "${k}"`).join(", ")
    : "";

  const sql = `
    select
      e.year,
      c.key  as comp,
      c.name as competition_name,
      fr.rank,
      fr.rank_sort,
      co.name
      ${selectExtras}
    from final_results fr
    join editions e     on e.id = fr.edition_id
    join competitions c on c.id = e.competition_id
    join comedians  co  on co.id = fr.comedian_id
    where fr.comedian_id = ?
    order by
      (c.sort_order is null),  -- nullは後ろへ
      c.sort_order,            -- 昇順で並べる
      c.key,                   -- 同順番ならkeyで安定化
      e.year desc              -- 各大会内は年の降順
  `;
  const rows = db().prepare(sql).all(comedianId) as any[];

  // 大会ごとに、実際に埋まっている追加列だけを出す
  const byComp: Record<string, { competition_name:string, extraKeys:string[], rows:any[] }> = {};
  for (const r of rows) {
    const grp = (byComp[r.comp] ??= { competition_name: r.competition_name, extraKeys: [], rows: [] });
    grp.rows.push(r);
  }
  for (const k of Object.keys(byComp)) {
    const used = extras.filter(col => byComp[k].rows.some(r => r[col] !== null && String(r[col] ?? "").trim() !== ""));
    byComp[k].extraKeys = used;
  }
  return { comedian: co, byComp };
}

// そのエディションの席並び（ヘッダに使う）
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

// ラウンド別：行=芸人、列=席（審査員）の得点と合計
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
    SELECT fr.comedian_id, co.name AS comedian_name, fr.rank_sort,
           js.seat_no, js.score
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
    ORDER BY CAST(fr.rank_sort AS INTEGER) ASC, co.name ASC
  `).all(round_no, ed.eid, round_no) as Array<{
    comedian_id:string; comedian_name:string; rank_sort:number;
    seat_no:number|null; score:number|null;
  }>;

  // 横持ち化
  type Row = { comedian_id:string; comedian_name:string; rank_sort:number; bySeat: Record<number, number|null>; total:number|null };
  const byId = new Map<string, Row>();
  for (const r of rows) {
    let row = byId.get(r.comedian_id);
    if (!row) {
      row = { comedian_id:r.comedian_id, comedian_name:r.comedian_name, rank_sort:r.rank_sort, bySeat:{}, total:null };
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
