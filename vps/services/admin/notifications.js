import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { getDataRoot } from '../vision/store.js';
import { sessionOwnerKey } from '../auth/middleware.js';
import * as reminders from '../reminders/store.js';
import { pushConfiguration, sendPush } from '../reminders/delivery.js';

let database, running = false;
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
function db() {
  if (database) return database;
  fs.mkdirSync(getDataRoot(), { recursive: true });
  database = new DatabaseSync(path.join(getDataRoot(), 'admin-notifications.db'));
  database.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS campaigns(id TEXT PRIMARY KEY,actor TEXT NOT NULL,message TEXT NOT NULL,audience TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,expires_at INTEGER NOT NULL,sent_at TEXT);
    CREATE TABLE IF NOT EXISTS recipients(campaign_id TEXT NOT NULL REFERENCES campaigns(id),user_id TEXT NOT NULL,read_at TEXT,push_status TEXT NOT NULL DEFAULT 'pending',push_sent INTEGER NOT NULL DEFAULT 0,push_failed INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(campaign_id,user_id));
    CREATE INDEX IF NOT EXISTS inbox_user ON recipients(user_id,campaign_id);
    CREATE TABLE IF NOT EXISTS images(id TEXT PRIMARY KEY,actor TEXT NOT NULL,created_at TEXT NOT NULL);`);
  // A process interruption must never automatically duplicate a push.
  database.prepare("UPDATE recipients SET push_status='interrupted' WHERE push_status='sending'").run();
  return database;
}
export function imagePath(id) { return /^[a-f0-9-]{36}$/.test(id || '') && db().prepare('SELECT id FROM images WHERE id=?').get(id) ? path.join(getDataRoot(), 'admin-notification-images', `${id}.webp`) : null; }
export async function saveImage(buffer, actor) {
  const id = randomUUID(), dir = path.join(getDataRoot(), 'admin-notification-images');
  let image;
  try {
    const source = sharp(buffer, { limitInputPixels: 25000000, animated: false });
    const metadata = await source.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format)) fail('Choose a JPEG, PNG, or WebP image.');
    image = await source.rotate().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  } catch { fail('Choose a valid JPEG, PNG, or WebP image, up to 25 megapixels.'); }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.webp`), image, { mode: 0o644 });
  db().prepare('INSERT INTO images VALUES(?,?,?)').run(id, actor, new Date().toISOString());
  return { id, path: `/api/reminders/images/${id}`, bytes: image.length };
}
export function validateMessage(input) {
  const title = typeof input?.title === 'string' ? input.title.trim() : '', body = typeof input?.body === 'string' ? input.body.trim() : '';
  if (!title || title.length > 100 || !body || body.length > 1000) fail('Enter a title up to 100 characters and a message up to 1000 characters.');
  const deepLink = input.deepLink || '/?inbox=1';
  if (typeof deepLink !== 'string' || deepLink.length > 500 || !deepLink.startsWith('/') || deepLink.startsWith('//') || /[\\\s\x00-\x1f]/.test(deepLink)) fail('Use a PastQ page path beginning with /.');
  if(!['/','/library','/history','/profile'].includes(new URL(deepLink,'https://pastq.invalid').pathname))fail('Choose /, /library, /history, /profile, or /?inbox=1 as the destination.');
  const imageId = input.imageId || null;
  if (imageId && (typeof imageId !== 'string' || !imagePath(imageId))) fail('Upload the notification image again.');
  if (input.push !== undefined && typeof input.push !== 'boolean') fail('Choose a valid delivery option.');
  return { title, body, deepLink, imageId, push: Boolean(input.push) };
}
export function reachable(userId) {
  const owner = sessionOwnerKey(userId);
  return Boolean(owner && pushConfiguration() && reminders.readSettings(owner).enabled && reminders.subscriptions(owner).length);
}
export function previewCampaign(actor, message, selection, users) {
  const id = randomUUID(), now = Date.now();
  const pushEligible = message.push ? users.filter(user => reachable(user.id)).length : 0;
  db().exec('BEGIN IMMEDIATE');
  try {
    db().prepare("DELETE FROM recipients WHERE campaign_id IN(SELECT id FROM campaigns WHERE status='draft' AND expires_at<?)").run(now);
    db().prepare("DELETE FROM campaigns WHERE status='draft' AND expires_at<?").run(now);
    db().prepare('INSERT INTO campaigns VALUES(?,?,?,?,?,?,?,NULL)').run(id, actor, JSON.stringify(message), JSON.stringify(selection), 'draft', new Date(now).toISOString(), now + 15 * 60000);
    const insert = db().prepare('INSERT INTO recipients(campaign_id,user_id) VALUES(?,?)');
    for (const user of users) insert.run(id, user.id);
    db().exec('COMMIT');
  } catch (error) { db().exec('ROLLBACK'); throw error; }
  return { id, recipients: users.length, pushEligible, inboxOnly: users.length - pushEligible, expiresAt: new Date(now + 15 * 60000).toISOString(), sample: users.slice(0, 10).map(({ id, name, email, school, exam }) => ({ id, name, email, school, exam })), message };
}
export function queueCampaign(id, actor) {
  const record = db().prepare('SELECT * FROM campaigns WHERE id=? AND actor=?').get(id, actor);
  if (!record) fail('Notification preview not found.', 404);
  if (record.status !== 'draft') return { id, status: record.status }; // Retry safely after a lost HTTP response.
  if (record.expires_at < Date.now()) fail('This audience preview expired. Review the audience again.', 409);
  if (!db().prepare('SELECT 1 FROM recipients WHERE campaign_id=? LIMIT 1').get(id)) fail('No students match this audience.');
  db().prepare("UPDATE campaigns SET status='queued',sent_at=? WHERE id=? AND status='draft'").run(new Date().toISOString(), id);
  return { id, status: 'queued' };
}
export function listCampaigns(offset = 0, limit = 20) {
  const items = db().prepare(`SELECT c.*,count(r.user_id) AS recipients, sum(CASE WHEN r.read_at IS NOT NULL THEN 1 ELSE 0 END) AS read,
    sum(r.push_sent) AS push_sent,sum(r.push_failed) AS push_failed,
    sum(CASE WHEN r.push_status='interrupted' THEN 1 ELSE 0 END) AS interrupted
    FROM campaigns c LEFT JOIN recipients r ON r.campaign_id=c.id WHERE c.status!='draft' GROUP BY c.id ORDER BY c.created_at DESC LIMIT ? OFFSET ?`).all(limit, offset);
  return { items: items.map(row => ({ ...row, message: JSON.parse(row.message), audience: JSON.parse(row.audience) })), total: db().prepare("SELECT count(*) AS n FROM campaigns WHERE status!='draft'").get().n };
}
export function campaignRecipients(id,offset=0,limit=20){
  const campaign=db().prepare("SELECT id,status,message,audience,sent_at FROM campaigns WHERE id=? AND status!='draft'").get(id);
  if(!campaign)fail('Notification not found.',404);
  return {campaign:{...campaign,message:JSON.parse(campaign.message),audience:JSON.parse(campaign.audience)},
    items:db().prepare('SELECT user_id,read_at,push_status,push_sent,push_failed FROM recipients WHERE campaign_id=? ORDER BY user_id LIMIT ? OFFSET ?').all(id,limit,offset),
    total:db().prepare('SELECT count(*) AS n FROM recipients WHERE campaign_id=?').get(id).n};
}
export function inbox(userId, offset = 0, limit = 20) {
  const items = db().prepare(`SELECT c.id,c.message,c.sent_at,r.read_at FROM recipients r JOIN campaigns c ON c.id=r.campaign_id WHERE r.user_id=? AND c.status!='draft' AND c.sent_at IS NOT NULL ORDER BY c.sent_at DESC,c.id LIMIT ? OFFSET ?`).all(userId, limit, offset);
  return { items: items.map(row => ({ id: row.id, ...JSON.parse(row.message), sent_at: row.sent_at, read_at: row.read_at })),
    total: db().prepare("SELECT count(*) AS n FROM recipients r JOIN campaigns c ON c.id=r.campaign_id WHERE r.user_id=? AND c.sent_at IS NOT NULL").get(userId).n,
    unread: db().prepare("SELECT count(*) AS n FROM recipients r JOIN campaigns c ON c.id=r.campaign_id WHERE r.user_id=? AND r.read_at IS NULL AND c.sent_at IS NOT NULL").get(userId).n };
}
export function markRead(userId, id) {
  const result = db().prepare("UPDATE recipients SET read_at=COALESCE(read_at,?) WHERE user_id=? AND campaign_id=? AND EXISTS(SELECT 1 FROM campaigns WHERE id=? AND sent_at IS NOT NULL)").run(new Date().toISOString(), userId, id, id);
  if (!result.changes) fail('Notification not found.', 404);
}
export function dataPage(table,userId,offset,limit){
  if(table==='admin_notification_campaigns'){
    const result=listCampaigns(offset,limit);return userId?{
      items:db().prepare("SELECT c.* FROM campaigns c JOIN recipients r ON r.campaign_id=c.id WHERE r.user_id=? AND c.sent_at IS NOT NULL ORDER BY c.sent_at DESC LIMIT ? OFFSET ?").all(userId,limit,offset).map(row=>({...row,message:JSON.parse(row.message),audience:JSON.parse(row.audience)})),
      total:db().prepare("SELECT count(*) AS n FROM campaigns c JOIN recipients r ON r.campaign_id=c.id WHERE r.user_id=? AND c.sent_at IS NOT NULL").get(userId).n
    }:result;
  }
  const where="c.sent_at IS NOT NULL"+(userId?' AND r.user_id=?':'');const params=userId?[userId]:[];
  return {items:db().prepare(`SELECT r.*,c.sent_at FROM recipients r JOIN campaigns c ON c.id=r.campaign_id WHERE ${where} ORDER BY c.sent_at DESC,r.user_id LIMIT ? OFFSET ?`).all(...params,limit,offset),
    total:db().prepare(`SELECT count(*) AS n FROM recipients r JOIN campaigns c ON c.id=r.campaign_id WHERE ${where}`).get(...params).n};
}
export async function dispatchCampaigns({ send = sendPush, origin = process.env.PUBLIC_API_URL || 'https://76.13.110.6.nip.io' } = {}) {
  if (running) return; running = true;
  try {
    const campaigns = db().prepare("SELECT * FROM campaigns WHERE status IN('queued','sending') ORDER BY created_at LIMIT 5").all();
    for (const campaign of campaigns) {
      db().prepare("UPDATE campaigns SET status='sending' WHERE id=?").run(campaign.id);
      const message = JSON.parse(campaign.message);
      const recipients = db().prepare("SELECT user_id FROM recipients WHERE campaign_id=? AND push_status='pending' LIMIT 100").all(campaign.id);
      for (let offset = 0; offset < recipients.length; offset += 5) await Promise.all(recipients.slice(offset, offset + 5).map(async ({ user_id }) => {
        const owner = sessionOwnerKey(user_id);
        if (!message.push || !reachable(user_id)) { db().prepare("UPDATE recipients SET push_status='skipped' WHERE campaign_id=? AND user_id=?").run(campaign.id, user_id); return; }
        db().prepare("UPDATE recipients SET push_status='sending' WHERE campaign_id=? AND user_id=?").run(campaign.id, user_id);
        let sent = 0, failed = 0;
        for (const device of reminders.subscriptions(owner)) {
          try { await send(device, { title: message.title, body: message.body, url: '/?inbox=1', tag: `pastq-${campaign.id}`, ...(message.imageId ? { image: `${origin.replace(/\/$/, '')}/api/reminders/images/${message.imageId}` } : {}) },{topic:createHash('sha256').update(campaign.id).digest('base64url').slice(0,32)}); sent++; }
          catch (error) { failed++; if ([404, 410].includes(error.statusCode)) reminders.removeSubscription(owner, device.id); }
        }
        db().prepare("UPDATE recipients SET push_status=?,push_sent=?,push_failed=? WHERE campaign_id=? AND user_id=?").run(failed ? 'failed' : 'sent', sent, failed, campaign.id, user_id);
      }));
      const pending = db().prepare("SELECT 1 FROM recipients WHERE campaign_id=? AND push_status='pending' LIMIT 1").get(campaign.id);
      if (!pending) db().prepare("UPDATE campaigns SET status='completed' WHERE id=?").run(campaign.id);
    }
  } finally { running = false; }
}
export function startCampaignScheduler() {
  const tick = () => { void dispatchCampaigns().catch(error => console.error('[admin-notifications]', error.message)); };
  const timer = setInterval(tick, 5000); timer.unref(); tick(); return () => clearInterval(timer);
}
export function closeNotificationStore() { database?.close(); database = undefined; }
