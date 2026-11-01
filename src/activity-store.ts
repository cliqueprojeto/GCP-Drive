import {DatabaseSync} from 'node:sqlite';
import type {Activity} from './contracts.ts';
export const ACTIVITY_RETENTION_MS=7*24*60*60*1000;
/** A local seven-day journal. Paging does not change when new transfers arrive. */
export class ActivityStore{
  private db:DatabaseSync;
  constructor(file:string,now=Date.now()){
    this.db=new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS activity(id INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,message TEXT NOT NULL,level TEXT NOT NULL,account_id TEXT,path TEXT,kind TEXT,event_key TEXT UNIQUE) STRICT;
      CREATE INDEX IF NOT EXISTS activity_at ON activity(at);`);
    this.prune(now);
  }
  add(item:Activity,eventKey?:string){
    this.db.prepare('INSERT OR IGNORE INTO activity(at,message,level,account_id,path,kind,event_key) VALUES(?,?,?,?,?,?,?)').run(item.at,item.message,item.level,item.accountId??null,item.path??null,item.kind??null,eventKey??null);
  }
  page(before?:string,limit=200):{items:Activity[];cursor?:string}{
    const rows=this.db.prepare('SELECT id,at,message,level,account_id,path,kind FROM activity WHERE id<? ORDER BY id DESC LIMIT ?').all(before?Number(before):Number.MAX_SAFE_INTEGER,limit+1);
    const items:Activity[]=rows.slice(0,limit).map(row=>({id:String(row.id),at:String(row.at),message:String(row.message),level:row.level==='error'?'error':'info',...(row.account_id?{accountId:String(row.account_id)}:{}),...(typeof row.path==='string'?{path:row.path}:{}),...(row.kind==='file'||row.kind==='folder'?{kind:row.kind}:{})}));
    return{items,...(rows.length>limit?{cursor:items.at(-1)!.id}:{})};
  }
  prune(now=Date.now()){this.db.prepare('DELETE FROM activity WHERE at<?').run(new Date(now-ACTIVITY_RETENTION_MS).toISOString());}
  clear(){this.db.exec('DELETE FROM activity');}
  close(){this.db.close();}
}
