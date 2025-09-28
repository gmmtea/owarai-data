import Database from "better-sqlite3";

// ビルド時のみ使用（読み取り専用）
let _db: any = null;

export function db() {
  if (!_db) {
    _db = new Database("data/awards.sqlite", { readonly: true });
  }
  return _db;
}
