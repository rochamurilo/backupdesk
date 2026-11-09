export const stoppedError=()=>Object.assign(new Error('Backup interrompido pelo usuário.'),{code:'BACKUP_STOPPED'});
export function backupControl(db){
 db.exec('CREATE TABLE IF NOT EXISTS backup_stop_requests(id TEXT PRIMARY KEY,device TEXT NOT NULL,requested TEXT NOT NULL)');
 return {
  request(id,device){db.prepare('INSERT OR IGNORE INTO backup_stop_requests VALUES(?,?,?)').run(id,device,new Date().toISOString())},
  requested(id){return !!db.prepare('SELECT id FROM backup_stop_requests WHERE id=?').get(id)},
  forDevice(device){return db.prepare("SELECT s.id FROM backup_stop_requests s WHERE s.device=? AND (EXISTS(SELECT 1 FROM jobs j WHERE j.id=s.id AND j.status='running') OR EXISTS(SELECT 1 FROM runs r WHERE r.id=s.id AND r.status='running'))").all(device).map(r=>r.id)}
 };
}
