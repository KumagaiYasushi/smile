import type Database from 'better-sqlite3';
// Trusted setup CLI only. There is no HTTP endpoint for self-promotion.
export function bootstrapVerificationAdmin(db:Database.Database,userId:number){
 return db.transaction(()=>{
  const user=db.prepare('SELECT id,role,active FROM auth_users WHERE id=?').get(userId) as {id:number;role:string;active:number}|undefined;
  if(!user?.active)throw new Error('有効な検証用アカウントが必要です');
  if(user.role==='admin')return;
  const count=(db.prepare("SELECT count(*) n FROM auth_users WHERE role='admin' AND active=1").get() as {n:number}).n;
  if(count>=2)throw new Error('管理者は2名までです');
  db.prepare("UPDATE auth_users SET role='admin' WHERE id=?").run(user.id);
  db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(user.id);
  db.prepare('INSERT INTO auth_audit(actor_id,target_user_id,action,occurred_at) VALUES(NULL,?,?,?)').run(user.id,'verification_admin_bootstrap',Math.floor(Date.now()/1000));
 }).immediate();
}
