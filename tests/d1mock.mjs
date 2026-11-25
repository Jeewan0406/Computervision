// A small stand-in for Cloudflare D1 built on Node's SQLite, so the gateway's
// account code runs real SQL in tests (prepare/bind/first/all/run/batch).
import { DatabaseSync } from 'node:sqlite';

export function makeD1() {
  const db = new DatabaseSync(':memory:');
  const plain = (row) => (row ? { ...row } : null);
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => plain(db.prepare(sql).get(...args)),
    all: async () => ({ results: db.prepare(sql).all(...args).map(plain), success: true }),
    run: async () => {
      const r = db.prepare(sql).run(...args);
      return { success: true, meta: { changes: Number(r.changes) } };
    },
    exec: () => db.prepare(sql).run(...args),
  });
  return {
    raw: db,
    prepare: (sql) => stmt(sql),
    batch: async (list) => {
      db.exec('BEGIN');
      try {
        const out = list.map((s) => s.exec());
        db.exec('COMMIT');
        return out.map(() => ({ success: true }));
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
