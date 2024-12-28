import { DB_PATH} from "./config.js";
import Database from 'better-sqlite3';

const db = new Database(DB_PATH);

export function addPositionToDb(sessionId, username, positionInstance) {
  try {
    db.prepare("insert into positions (session_id, position_id, username, position_data, opened_at) values (?,?,?,?,STRFTIME('%Y-%m-%dT%H:%M:%f', 'now'))")
      .run(sessionId, positionInstance.positionId, username, JSON.stringify({...positionInstance, ...{ timer:0 }}));
  }
  catch (e) {
    console.error(`${new Date().toISOString()}\t${sessionId}\t${positionInstance.positionId}\tError insert into db.positions: ${e.message}`);
  }
}

export function deletePositionFromDb(sessionId, positionInstance) {
  try {
    db.prepare('insert into positions_archive (session_id, position_id, username, position_data, opened_at, closed_at) ' +
      'select session_id, position_id, username, position_data, opened_at, STRFTIME(\'%Y-%m-%dT%H:%M:%S\', \'now\') AS closed_at from positions ' +
      'where session_id = ? and position_id = ?')
      .run(sessionId, positionInstance.positionId);

    db.prepare('delete from positions where session_id = ? and position_id = ?')
      .run(sessionId, positionInstance.positionId);
  } catch (e) {
    console.error(`${new Date().toISOString()}\t${sessionId}\t${positionInstance.positionId}\tError delete from db.positions: ${e.message}`);
  }
}

export function deleteAllPositionsFromDb(sessionId) {
  try {
    db.prepare('insert into positions_archive (session_id, position_id, username, position_data, opened_at, closed_at) ' +
      'select session_id, position_id, username, position_data, opened_at, STRFTIME(\'%Y-%m-%dT%H:%M:%S\', \'now\') AS closed_at from positions ' +
      'where session_id = ?')
      .run(sessionId);

    db.prepare('delete from positions where session_id = ?')
      .run(sessionId);
  } catch (e) {
    console.error(`${new Date().toISOString()}\t${sessionId}\t - \tError delete all from db.positions: ${e.message}`);
  }
}

export function selectAllPositionsFromDb() {
  let res = null;
  try {
    res = db.prepare('select * from positions').all();
  } catch (e) {
    console.error(`${new Date().toISOString()}\t - \t - \tError select all from db.positions: ${e.message}`);
  }
  return res;
}

export default db;