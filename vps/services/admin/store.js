import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDataRoot } from '../vision/store.js';

let database;
function db() {
  if (database) return database;
  database = new DatabaseSync(path.join(getDataRoot(), 'admin.db'));
  database.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, description TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT '#c7927d', created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS assignments (kind TEXT NOT NULL, record_id TEXT NOT NULL, category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE, PRIMARY KEY(kind, record_id));
    CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS audit_created ON audit(created_at DESC);`);
  const columns = database.prepare('PRAGMA table_info(categories)').all().map(column => column.name);
  if (!columns.includes('parent_id')) database.exec('ALTER TABLE categories ADD COLUMN parent_id TEXT REFERENCES categories(id) ON DELETE SET NULL');
  if (!columns.includes('library_type')) database.exec('ALTER TABLE categories ADD COLUMN library_type TEXT');
  const insert = database.prepare('INSERT OR IGNORE INTO categories (id,name,description,color,created_at,parent_id,library_type) VALUES (?,?,?,?,?,NULL,?)');
  for (const [id,name,type] of [['schools','Schools & Universities','institution'],['tests','Tests & Qualifications','exam_board'],['professional','Professional Exams','professional_body'],['other','Other Materials','other']]) {
    insert.run(id,name,'','#c7927d',new Date().toISOString(),type);
  }
  return database;
}
const mainGroups = new Set(['schools','tests','professional','other']);
export function categories() {
  return db().prepare(`SELECT c.*, (SELECT count(*) FROM assignments a WHERE a.category_id=c.id) AS item_count FROM categories c ORDER BY name`).all().map(category => ({...category, main_group:mainGroups.has(category.id)}));
}
export function categoryIdsUnder(id) {
  const all=categories(), result=new Set([id]);
  let changed=true;
  while(changed){changed=false;for(const category of all)if(category.parent_id&&result.has(category.parent_id)&&!result.has(category.id)){result.add(category.id);changed=true;}}
  return result;
}
export function categoryType(id) {
  const all=categories(), seen=new Set();
  let category=all.find(item=>item.id===id);
  while(category){if(seen.has(category.id))return null;seen.add(category.id);if(category.library_type)return category.library_type;category=all.find(item=>item.id===category.parent_id);}
  return null;
}
export function defaultLibraryCategory(type) {
  return ['university','polytechnic','college','school'].includes(type)?'schools':type==='exam_board'?'tests':type==='professional_body'?'professional':'other';
}
export function saveCategory(id, input) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  const color = input.color || '#c7927d';
  if (!name || name.length > 80 || description.length > 1000 || !/^#[0-9a-f]{6}$/i.test(color)) throw Object.assign(new Error('Enter a category name (up to 80 characters) and a valid color.'), { status: 400 });
  const current=id?db().prepare('SELECT * FROM categories WHERE id=?').get(id):null;
  if (id && !current) throw Object.assign(new Error('Category not found.'), { status: 404 });
  const parentId=input.parentId===undefined?(current?.parent_id||null):(input.parentId||null);
  const libraryType=parentId?null:(input.libraryType===undefined?(current?.library_type||null):(input.libraryType||null));
  if(parentId&&typeof parentId!=='string')throw Object.assign(new Error('Choose a valid parent category.'),{status:400});
  if(libraryType&&!['institution','exam_board','professional_body','other'].includes(libraryType))throw Object.assign(new Error('Choose a valid main library group.'),{status:400});
  if(parentId&&!db().prepare('SELECT id FROM categories WHERE id=?').get(parentId))throw Object.assign(new Error('Parent category not found.'),{status:400});
  if(id&&parentId&&categoryIdsUnder(id).has(parentId))throw Object.assign(new Error('A category cannot be moved inside itself or its subcategories.'),{status:400});
  if(mainGroups.has(id)&&(parentId||libraryType!==current.library_type))throw Object.assign(new Error('Main library groups cannot be nested or change their classification.'),{status:400});
  const recordId = id || randomUUID();
  try {
    if (id) db().prepare('UPDATE categories SET name=?, description=?, color=?, parent_id=?, library_type=? WHERE id=?').run(name, description, color, parentId, libraryType, id);
    else db().prepare('INSERT INTO categories (id,name,description,color,created_at,parent_id,library_type) VALUES (?, ?, ?, ?, ?, ?, ?)').run(recordId, name, description, color, new Date().toISOString(), parentId, libraryType);
  } catch (error) {
    if (error.message.includes('UNIQUE')) throw Object.assign(new Error('A category with that name already exists.'), { status: 409 });
    throw error;
  }
  return categories().find(category => category.id === recordId);
}
export function deleteCategory(id) {
  if(mainGroups.has(id))throw Object.assign(new Error('Keep the main library group. You can rename it or add subcategories.'),{status:400});
  const current=db().prepare('SELECT * FROM categories WHERE id=?').get(id);
  if(!current)throw Object.assign(new Error('Category not found.'),{status:404});
  db().exec('BEGIN');
  try{
    db().prepare('UPDATE categories SET parent_id=?, library_type=COALESCE(library_type,?) WHERE parent_id=?').run(current.parent_id, current.parent_id?null:current.library_type, id);
    const result=db().prepare('DELETE FROM categories WHERE id=?').run(id);db().exec('COMMIT');return result;
  }catch(error){db().exec('ROLLBACK');throw error;}
}
export function assignmentMap(kind) { return Object.fromEntries(db().prepare('SELECT record_id, category_id FROM assignments WHERE kind=?').all(kind).map(row => [row.record_id, row.category_id])); }
export function assignCategory(kind, id, categoryId) {
  if (!categoryId) { db().prepare('DELETE FROM assignments WHERE kind=? AND record_id=?').run(kind, id); return; }
  if (!db().prepare('SELECT id FROM categories WHERE id=?').get(categoryId)) throw Object.assign(new Error('Category not found.'), { status: 400 });
  db().prepare('INSERT INTO assignments VALUES (?, ?, ?) ON CONFLICT(kind, record_id) DO UPDATE SET category_id=excluded.category_id').run(kind, id, categoryId);
}
export function audit(actor, action, target) { db().prepare('INSERT INTO audit VALUES (?, ?, ?, ?, ?)').run(randomUUID(), actor, action, String(target), new Date().toISOString()); }
export function listAudit(offset, limit) {
  return { items: db().prepare('SELECT * FROM audit ORDER BY created_at DESC, id LIMIT ? OFFSET ?').all(limit, offset), total: db().prepare('SELECT count(*) AS count FROM audit').get().count };
}
export function closeAdminStore() { database?.close(); database = null; }
