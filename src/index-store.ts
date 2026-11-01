import { DatabaseSync } from "node:sqlite";
import type { Entry } from "./contracts.ts";
export type SearchHit = {
  accountId: string;
  path: string;
  name: string;
  isDir: boolean;
  observedAt: string;
  size?:number;
  modified?:string;
};
/** Index of observed listings, never a claim that the cloud has been fully scanned. */
export class FileIndex {
  private db: DatabaseSync;
  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS files (id INTEGER PRIMARY KEY, account TEXT NOT NULL, parent TEXT NOT NULL, path TEXT NOT NULL, name TEXT NOT NULL, is_dir INTEGER NOT NULL, observed_at TEXT NOT NULL, UNIQUE(account,path)) STRICT;
      CREATE VIRTUAL TABLE IF NOT EXISTS names USING fts5(name, content='files', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
      CREATE TRIGGER IF NOT EXISTS files_insert AFTER INSERT ON files BEGIN INSERT INTO names(rowid,name) VALUES(new.id,new.name); END;
      CREATE TRIGGER IF NOT EXISTS files_delete AFTER DELETE ON files BEGIN INSERT INTO names(names,rowid,name) VALUES('delete',old.id,old.name); END;
      CREATE TRIGGER IF NOT EXISTS files_update AFTER UPDATE ON files BEGIN INSERT INTO names(names,rowid,name) VALUES('delete',old.id,old.name); INSERT INTO names(rowid,name) VALUES(new.id,new.name); END;`);
    const columns=new Set(this.db.prepare('PRAGMA table_info(files)').all().map(row=>String(row.name)));
    if(!columns.has('size'))this.db.exec('ALTER TABLE files ADD COLUMN size REAL');
    if(!columns.has('modified'))this.db.exec('ALTER TABLE files ADD COLUMN modified TEXT');
  }
  replaceFolder(
    accountId: string,
    folder: string,
    entries: Entry[],
    observedAt = new Date().toISOString(),
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const currentPaths = new Set(
        entries
          .filter((e) => e.IsDir)
          .map((e) => (folder ? `${folder}/${e.Path}` : e.Path)),
      );
      const oldDirectories = this.db
        .prepare(
          "SELECT path FROM files WHERE account=? AND parent=? AND is_dir=1",
        )
        .all(accountId, folder);
      for (const directory of oldDirectories)
        if (!currentPaths.has(String(directory.path))) {
          const oldPath = String(directory.path);
          this.db
            .prepare(
              "DELETE FROM files WHERE account=? AND (path=? OR substr(path,1,length(?)+1)=?||'/')",
            )
            .run(accountId, oldPath, oldPath, oldPath);
        }
      this.db
        .prepare("DELETE FROM files WHERE account=? AND parent=?")
        .run(accountId, folder);
      const insert = this.db.prepare(
        "INSERT INTO files(account,parent,path,name,is_dir,observed_at,size,modified) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(account,path) DO UPDATE SET name=excluded.name,is_dir=excluded.is_dir,parent=excluded.parent,observed_at=excluded.observed_at,size=excluded.size,modified=excluded.modified",
      );
      for (const entry of entries)
        insert.run(
          accountId,
          folder,
          folder ? `${folder}/${entry.Path}` : entry.Path,
          entry.Name,
          Number(entry.IsDir),
          observedAt,
          entry.Size,
          entry.ModTime,
        );
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  search(text: string, accountId: string): SearchHit[] {
    const tokens = text
      .normalize("NFKC")
      .match(/[\p{L}\p{N}]+/gu)
      ?.slice(0, 16);
    if (!tokens?.length) return [];
    const query = tokens.map((t) => `"${t}"*`).join(" AND ");
    return this.db
      .prepare(
        "SELECT f.account AS accountId,f.path,f.name,f.is_dir AS isDir,f.observed_at AS observedAt,f.size,f.modified FROM names JOIN files f ON f.id=names.rowid WHERE names MATCH ? AND f.account=? ORDER BY bm25(names),f.name LIMIT 100",
      )
      .all(query, accountId)
      .map((row) => ({
        accountId: String(row.accountId),
        path: String(row.path),
        name: String(row.name),
        isDir: Boolean(row.isDir),
        observedAt: String(row.observedAt),
        ...(typeof row.size==='number'?{size:row.size}:{}),
        ...(typeof row.modified==='string'&&row.modified?{modified:row.modified}:{}),
      }));
  }
  lookup(accountId:string,path:string):SearchHit|undefined{
    const row=this.db.prepare('SELECT account AS accountId,path,name,is_dir AS isDir,observed_at AS observedAt,size,modified FROM files WHERE account=? AND path=?').get(accountId,path);
    return row?{accountId:String(row.accountId),path:String(row.path),name:String(row.name),isDir:Boolean(row.isDir),observedAt:String(row.observedAt),...(typeof row.size==='number'?{size:row.size}:{}),...(typeof row.modified==='string'&&row.modified?{modified:row.modified}:{})}:undefined;
  }
  removeAccount(accountId: string) {
    this.db.prepare("DELETE FROM files WHERE account=?").run(accountId);
  }
  close() {
    this.db.close();
  }
}
