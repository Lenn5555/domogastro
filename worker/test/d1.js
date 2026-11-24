import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

// Kleine Nachbildung von Cloudflare D1 auf SQLite (nur was der Newsletter braucht)
export function d1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  const umbau = (sql) => sql.replace(/\?(\d+)/g, (_, n) => `?${n}`);
  return {
    roh: db,
    prepare(sql) {
      let werte = [];
      const st = () => db.prepare(umbau(sql));
      return {
        bind(...w) { werte = w; return this; },
        async first() { return st().get(...werte) ?? null; },
        async all() { return { results: st().all(...werte) }; },
        async run() { const r = st().run(...werte); return { meta: { changes: r.changes, last_row_id: r.lastInsertRowid } }; },
      };
    },
  };
}

