import type Database from 'better-sqlite3';

// Rebuild only the parent table, keeping its name in every child foreign key.
// Foreign keys must be disabled outside the transaction to avoid cascading deletes.
export function allowOtherEvents(db:Database.Database) {
  const constraint=/CHECK\s*\(\s*event_type\s+IN\s*\([^)]*\)\s*\)/i;
  const schema=()=> (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='seminars'").get() as {sql:string}).sql;
  if(!constraint.test(schema())||constraint.exec(schema())![0].includes("'OTHER'"))return;
  const foreignKeys=db.pragma('foreign_keys',{simple:true});
  db.pragma('foreign_keys=OFF');
  try{db.transaction(()=>{
    const current=schema();if(constraint.exec(current)?.[0].includes("'OTHER'"))return;
    const dependents=db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='seminars' AND type IN ('index','trigger') AND sql IS NOT NULL").all() as {sql:string}[];
    const sequence=(db.prepare("SELECT seq FROM sqlite_sequence WHERE name='seminars'").get() as {seq:number}|undefined)?.seq??0;
    const create=current.replace(/^(CREATE TABLE(?: IF NOT EXISTS)?\s+)(?:"seminars"|`seminars`|\[seminars\]|seminars)(\s*\()/i,'$1seminars_other_migration$2').replace(constraint,"CHECK(event_type IN ('BASIC_COURSE','LECTURE','SEMINAR','OTHER'))");
    if(create===current||!create.includes('seminars_other_migration'))throw new Error('Event type migration schema is unsupported');
    const columns=(db.prepare('PRAGMA table_info(seminars)').all() as {name:string}[]).map(column=>`"${column.name.replaceAll('"','""')}"`).join(',');
    db.exec(create);
    db.exec(`INSERT INTO seminars_other_migration(${columns}) SELECT ${columns} FROM seminars`);
    db.exec('DROP TABLE seminars;ALTER TABLE seminars_other_migration RENAME TO seminars');
    for(const dependent of dependents)db.exec(dependent.sql);
    db.prepare("UPDATE sqlite_sequence SET seq=max(seq,?) WHERE name='seminars'").run(sequence);
    if(db.prepare('PRAGMA foreign_key_check(seminars)').all().length)throw new Error('Event type migration failed its reference check');
  }).immediate();}finally{db.pragma(`foreign_keys=${foreignKeys?1:0}`);}
}
