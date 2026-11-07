export function participantFormScript(endpoint:string,token:string){return `// Googleフォームのスクリプトエディタに貼り付け、項目名を実際のフォームと合わせてください。
const SMILE = ${JSON.stringify({endpoint,token,fields:{name:'氏名',email:'メールアドレス',role:'職種',phone:'電話番号',receipt_name:'領収書宛名'}},null,2)};
function setupSmile() {
  const form = FormApp.getActiveForm();
  if (!form) throw new Error('申込用Googleフォームのスクリプトエディタで実行してください');
  ScriptApp.getProjectTriggers().filter(t => ['submitSmile','retrySmile'].includes(t.getHandlerFunction())).forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('submitSmile').forForm(form).onFormSubmit().create();
  ScriptApp.newTrigger('retrySmile').timeBased().everyMinutes(5).create();
}
function submitSmile(e) {
  if (!e || !e.response) throw new Error('フォーム送信トリガーから実行します');
  const values = {};
  e.response.getItemResponses().forEach(r => { values[r.getItem().getTitle()] = String(r.getResponse()); });
  const f = SMILE.fields;
  const role = values[f.role] === '歯科衛生士' ? 'dental_hygienist' : values[f.role] === '歯科医師' ? 'dentist' : 'other';
  const payload = {response_id: FormApp.getActiveForm().getId() + ':' + e.response.getId(), name: values[f.name] || '', email: e.response.getRespondentEmail() || values[f.email] || '', role, phone: values[f.phone] || '', receipt_name: values[f.receipt_name] || ''};
  const key = 'SMILE_PENDING_' + e.response.getId();
  PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(payload));
  sendSmile(key,payload);
}
function sendSmile(key,payload) {
  const response = UrlFetchApp.fetch(SMILE.endpoint,{method:'post',contentType:'application/json',headers:{Authorization:'Bearer ' + SMILE.token},payload:JSON.stringify(payload),muteHttpExceptions:true});
  if(response.getResponseCode() >= 200 && response.getResponseCode() < 300) PropertiesService.getScriptProperties().deleteProperty(key);
  else throw new Error('申込連携に失敗しました。項目名・連携キー・アプリの設定を確認してください。HTTP ' + response.getResponseCode());
}
function retrySmile() {
  const lock = LockService.getScriptLock(); if(!lock.tryLock(1000)) return;
  try {
    const properties = PropertiesService.getScriptProperties(),values = properties.getProperties();
    Object.keys(values).filter(k => k.startsWith('SMILE_PENDING_')).slice(0,5).forEach(key => { try { sendSmile(key,JSON.parse(values[key])); } catch(e) { console.warn('未取込の申込があります。設定を確認してください'); } });
    const response=UrlFetchApp.fetch(SMILE.endpoint,{method:'post',contentType:'application/json',headers:{Authorization:'Bearer ' + SMILE.token},payload:JSON.stringify({action:'dispatch'}),muteHttpExceptions:true});
    if(response.getResponseCode() >= 400) console.warn('メール処理の設定をアプリで確認してください');
  } finally { lock.releaseLock(); }
}
`}
