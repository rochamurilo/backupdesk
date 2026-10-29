import {hostname} from 'node:os';
import {randomBytes} from 'node:crypto';
export function prepareLocalMaster(db){
 db.exec('CREATE TABLE IF NOT EXISTS settings(name TEXT PRIMARY KEY,value TEXT)');
 const saved=db.prepare("SELECT value FROM settings WHERE name='local_master_device'").get();
 let device=saved?db.prepare('SELECT * FROM devices WHERE id=?').get(saved.value):null;
 if(!device){
  const owner=db.prepare("SELECT id FROM users WHERE role='master' ORDER BY id LIMIT 1").get();
  if(!owner)throw Error('Administrador master não encontrado');
  const id=randomBytes(32).toString('hex'),token=randomBytes(32).toString('hex');
  db.exec('BEGIN');
  try{db.prepare('INSERT INTO devices(id,name,owner,token) VALUES(?,?,?,?)').run(id,hostname()+' (Master local)',owner.id,token);db.prepare("INSERT OR REPLACE INTO settings(name,value) VALUES('local_master_device',?)").run(id);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}
  device=db.prepare('SELECT * FROM devices WHERE id=?').get(id);
 }
 return device;
}
