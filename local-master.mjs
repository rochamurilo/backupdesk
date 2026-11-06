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
  try{db.prepare('INSERT INTO devices(id,name,owner,token,installed_at) VALUES(?,?,?,?,?)').run(id,hostname()+' (Master local)',owner.id,token,new Date().toISOString());db.prepare("INSERT OR REPLACE INTO settings(name,value) VALUES('local_master_device',?)").run(id);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}
  device=db.prepare('SELECT * FROM devices WHERE id=?').get(id);
 }
 return device;
}

export function prepareLocalClient(db,config){
 db.exec('CREATE TABLE IF NOT EXISTS settings(name TEXT PRIMARY KEY,value TEXT)');
 const saved=db.prepare("SELECT value FROM settings WHERE name='local_master_device'").get();
 if(saved&&saved.value!==config.device_id)throw Error('A identidade local existente difere do instalador. Os dados foram preservados.');
 let user=db.prepare("SELECT id FROM users WHERE name='@local-client' AND role='client'").get();
 if(!user){const result=db.prepare('INSERT INTO users(name,password,role) VALUES(?,?,?)').run('@local-client',randomBytes(48).toString('hex'),'client');user={id:Number(result.lastInsertRowid)}}
 const existing=db.prepare('SELECT * FROM devices WHERE id=?').get(config.device_id);
 if(existing&&(existing.token!==config.token||existing.installation_id&&existing.installation_id!==config.installation_id))throw Error('A identificação desta instalação foi alterada.');
 db.prepare('INSERT INTO devices(id,name,owner,token,installed_at,installation_id,enrollment_pending) VALUES(?,?,?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET name=excluded.name,owner=excluded.owner').run(config.device_id,config.name,user.id,config.token,config.installed_at||null,config.installation_id);
 db.prepare("INSERT OR REPLACE INTO settings(name,value) VALUES('local_master_device',?)").run(config.device_id);
 return db.prepare('SELECT * FROM devices WHERE id=?').get(config.device_id);
}
