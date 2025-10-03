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

// 芸人ページ：大会ごとに「年の縦表」
export function getComedianTables(comedianId: string) {
  const co = db().prepare(`select id, name from comedians where id=?`).get(comedianId) as any;
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
