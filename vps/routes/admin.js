import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { requireAuthenticatedUser, requireAdmin } from '../services/auth/middleware.js';
import { rateLimit } from '../services/http/security.js';
import { listSessions, getSession, publicSession, getDataRoot } from '../services/vision/store.js';
import * as pages from '../services/vision/pageStore.js';
import { listBundles, getBundle, saveBundle, reclassifyBundle, getCatalog, slugify } from '../services/library/store.js';
import { withSessionLock } from '../services/vision/processor.js';
import { reviewedMaterial, reviewQuestions } from '../services/vision/reviewedMaterials.js';
import { saveReviewedMaterial } from '../services/vision/reviewedMaterialStore.js';
import { schedulerStats } from '../services/vision/scheduler.js';
import * as store from '../services/admin/store.js';
import { allAccounts, accountView, directory, validateFilters, matchesStudent, audience, buildTrend, clearAccountCache } from '../services/admin/students.js';
import * as notifications from '../services/admin/notifications.js';
import multer from 'multer';
import { pushConfiguration } from '../services/reminders/delivery.js';

const router = Router();
router.use(requireAuthenticatedUser, requireAdmin, rateLimit({ limit: 240, keyPrefix: 'admin' }));
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
const asyncRoute = handler => (req, res, next) => Promise.resolve().then(() => handler(req, res)).catch(next);
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const validId = id => { if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) fail('Invalid record ID.'); return id; };
const paging = req => ({ offset: Math.max(0, parseInt(req.query.offset) || 0), limit: Math.min(100, Math.max(1, parseInt(req.query.limit) || 20)) });
const actor = req => req.auth.user.id;
let service;
function cloud() {
  if (service) return service;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SERVICE_ROLE_KEY;
  if (!url || !key) fail('Add SUPABASE_SERVICE_ROLE_KEY to the API server to manage accounts and student data.', 503);
  service = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return service;
}
export const DATA_TABLES = {
  users: 'created_at', student_preferences: 'updated_at', practice_sessions: 'started_at', question_attempts: 'created_at',
  student_topic_mastery: 'updated_at', recommendation_impressions: 'created_at', learning_events: 'occurred_at',
  exam_sessions: 'created_at', notification_preferences: 'updated_at', notifications: 'sent_at', push_subscriptions: 'created_at',
  admin_notification_campaigns:'sent_at',admin_notification_inbox:'sent_at',
};
function uploadSummary(session, assignments = {}) {
  return { id: session.id, name: session.name, status: session.status, createdAt: session.createdAt, updatedAt: session.updatedAt,
    questionCount: session.questions?.length || 0, progress: session.progress, approvedAt: session.approvedAt,
    subjectHint: session.subjectHint, categoryId: assignments[session.id] || null, cost: session.cost?.usd || 0,
    attention: ['failed', 'paused', 'completed_with_errors'].includes(session.status) || (session.followUps || []).some(item => item.status !== 'resolved') };
}
function bundleSummary(bundle, assignments = {}) {
  return { id: bundle.id, name: bundle.title || bundle.name, questionCount: bundle.libraryStats?.questionCount ?? bundle.questions?.length ?? bundle.question_count ?? 0,
    organization: bundle.organization?.name || bundle.university, examType: bundle.examType, groupingStatus: bundle.groupingStatus,
    updatedAt: bundle.updated_at, categoryId: assignments[bundle.id] || store.defaultLibraryCategory(bundle.organization?.type), subjects: bundle.libraryStats?.subjects || [] };
}
function filteredPage(req, items) {
  const { offset, limit } = paging(req), query = String(req.query.q || '').toLowerCase();
  const includedCategories=req.query.category&&req.query.category!=='none'?store.categoryIdsUnder(String(req.query.category)):null;
  const filtered = items.filter(item => (!query || [item.name, item.id, item.organization, item.subjectHint].some(value => String(value || '').toLowerCase().includes(query))) &&
    (!req.query.status || (req.query.status === 'attention' ? item.attention : item.status === req.query.status)) &&
    (!req.query.category || (req.query.category === 'none' ? !item.categoryId : includedCategories.has(item.categoryId))));
  return { items: filtered.slice(offset, offset + limit), total: filtered.length, offset, limit };
}
router.get('/me', (req, res) => res.json({ user: { id: req.auth.user.id, email: req.auth.user.email, name: req.auth.user.user_metadata?.full_name }, admin: true }));
router.get('/overview', asyncRoute(async (req, res) => {
  const sessions = listSessions(), bundles = listBundles({ summaries: true });
  const assignments = store.assignmentMap('uploads');
  const uploads = sessions.map(s => uploadSummary(s, assignments));
  const warnings = [];
  const days = [7,14,30,90].includes(Number(req.query.days)) ? Number(req.query.days) : 14;
  let accounts = null, practices = null, signups = [], practiceRows = null;
  try {
    const client = cloud();
    const results = await Promise.all([
      allAccounts(client),
      client.from('exam_sessions').select('id', { count: 'exact', head: true }),
    ]);
    signups = results[0]; accounts = signups.length;
    if (results[1].error || results[1].count === null) warnings.push('Completed session totals unavailable. Check the saved exam history.');
    else practices = results[1].count;
    const start = new Date(Date.parse(new Date().toISOString().slice(0,10)) - (days - 1) * 86400000).toISOString();
    practiceRows = [];
    for (let offset = 0; ; offset += 1000) {
      const result = await client.from('exam_sessions').select('id,created_at').gte('created_at',start).order('id').range(offset,offset+999);
      if (result.error) { practiceRows = null; warnings.push('Completed session chart unavailable. Check the saved exam history.'); break; }
      practiceRows.push(...result.data.map(row=>({...row,started_at:row.created_at}))); if (result.data.length < 1000) break;
    }
  } catch (error) { warnings.push(error.message); }
  const trend = buildTrend(signups, sessions, practiceRows, days);
  res.json({ accounts, practices, uploads: sessions.length, bundles: bundles.length,
    questions: bundles.reduce((sum, bundle) => sum + bundleSummary(bundle).questionCount, 0),
    attention: uploads.filter(s => s.attention).length, categories: store.categories().length,
    recentUploads: uploads.slice(0, 5), trend: accounts === null ? trend.map(row=>({...row,signups:null})) : trend,
    days, timezone:'UTC', sources:{signups:'Supabase Auth accounts',uploads:'VPS uploads',practices:'Supabase saved exam history (exam_sessions)'}, warnings, updatedAt: new Date().toISOString() });
}));
router.get('/uploads', (req, res) => { const assignments = store.assignmentMap('uploads'); res.json(filteredPage(req, listSessions().map(s => uploadSummary(s, assignments)))); });
router.get('/uploads/:id', asyncRoute(async (req, res) => {
  const session = getSession(validId(req.params.id)); if (!session) fail('Upload not found.', 404);
  res.json({ ...publicSession(session), categoryId: store.assignmentMap('uploads')[session.id] || null,
    pages: pages.listPages(session.id).map(p => ({ id: p.id, index: p.index, filename: p.filename, status: p.status, source: p.source, hasImage: Boolean(p.imagePath), error: p.error })) });
}));
router.get('/uploads/:id/pages/:pageId/image', asyncRoute(async (req, res) => {
  const session = getSession(validId(req.params.id)), page = pages.getPage(validId(req.params.pageId));
  if (!session || !page || page.sessionId !== session.id || !page.imagePath || !fs.existsSync(page.imagePath)) fail('Original image is unavailable.', 404);
  const real = fs.realpathSync(page.imagePath), root = fs.realpathSync(getDataRoot());
  const relative = path.relative(root, real);
  if (relative.startsWith('..') || path.isAbsolute(relative)) fail('Image is outside upload storage.', 403);
  res.sendFile(real);
}));
router.patch('/uploads/:id', asyncRoute(async (req, res) => {
  const id = validId(req.params.id); if (!getSession(id)) fail('Upload not found.', 404);
  const { name, subjectHint, questions } = req.body || {};
  if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.length > 300)) fail('Enter a title up to 300 characters.');
  if (subjectHint !== undefined && (typeof subjectHint !== 'string' || subjectHint.length > 300)) fail('Invalid subject.');
  await withSessionLock(id, session => {
    if (questions !== undefined) session.questions = reviewQuestions(session, questions);
    if (name !== undefined) session.name = name.trim();
    if (subjectHint !== undefined) session.subjectHint = subjectHint.trim();
    session.updatedAt = Date.now();
    if (session.approvedAt && session.ownerKey) saveReviewedMaterial(session.ownerKey, reviewedMaterial(session));
  });
  store.audit(actor(req), 'Updated upload', id); res.json({ ok: true });
}));
router.get('/library', (req, res) => { const assignments = store.assignmentMap('library'); res.json(filteredPage(req, listBundles({ summaries: true }).map(b => bundleSummary(b, assignments)))); });
router.get('/library/:id', asyncRoute(async (req, res) => {
  const bundle = getBundle(validId(req.params.id)); if (!bundle) fail('Collection not found.', 404);
  const { questions = [], assets, ...metadata } = bundle;
  const { offset, limit } = paging(req), query = String(req.query.q || '').toLowerCase();
  const filtered = questions.filter(q => !query || String(q.question || '').toLowerCase().includes(query));
  res.json({ ...metadata, categoryId: store.assignmentMap('library')[bundle.id] || store.defaultLibraryCategory(bundle.organization?.type), questions: filtered.slice(offset, offset + limit), questionCount: questions.length, total: filtered.length });
}));
router.patch('/library/:id/questions/:questionId', asyncRoute(async (req, res) => {
  const bundle = getBundle(validId(req.params.id)); if (!bundle) fail('Collection not found.', 404);
  const question = bundle.questions.find(q => String(q.id) === req.params.questionId); if (!question) fail('Question not found.', 404);
  const [edited] = reviewQuestions({ status: 'completed', questions: [question] }, [{ ...question, ...req.body, id: question.id }]);
  Object.assign(question, edited, { answerSource: 'admin_review' }); saveBundle(bundle);
  // Keep the source extraction and the owner's saved review consistent.
  for (const id of bundle.sourceSessionIds || []) {
    if (!getSession(id)) continue;
    await withSessionLock(id, session => {
      const original = session.questions?.find(q => String(q.id) === String(question.id));
      if (original) {
        Object.assign(original, edited, { answerSource: 'admin_review' });
        if (session.approvedAt && session.ownerKey) saveReviewedMaterial(session.ownerKey, reviewedMaterial(session));
      }
    });
  }
  store.audit(actor(req), 'Edited library question', `${bundle.id}/${question.id}`); res.json({ ok: true });
}));
router.post('/library/:id/classification', asyncRoute(async (req, res) => {
  if (!req.body?.organization || typeof req.body.organization.name !== 'string' || req.body.organization.name.length > 200) fail('Enter an organization name.');
  const result = reclassifyBundle(validId(req.params.id), req.body); if (!result.ok) fail(result.error);
  store.audit(actor(req), 'Changed library classification', req.params.id); res.json(result);
}));
router.get('/catalog', (_req, res) => res.json(getCatalog()));
router.get('/categories', (_req, res) => {
  const categories=store.categories(), uploadAssignments=store.assignmentMap('uploads'), libraryAssignments=store.assignmentMap('library');
  const assigned=[...listSessions().map(session=>uploadAssignments[session.id]),...listBundles({summaries:true}).map(bundle=>libraryAssignments[bundle.id]||store.defaultLibraryCategory(bundle.organization?.type))];
  res.json({items:categories.map(category=>{const descendants=store.categoryIdsUnder(category.id);return {...category,item_count:assigned.filter(id=>id===category.id).length,total_count:assigned.filter(id=>descendants.has(id)).length};})});
});
router.post('/categories', asyncRoute(async (req, res) => { const item = store.saveCategory(null, req.body || {}); store.audit(actor(req), 'Created category', item.name); res.status(201).json(item); }));
router.patch('/categories/:id', asyncRoute(async (req, res) => { const item = store.saveCategory(req.params.id, req.body || {}); store.audit(actor(req), 'Updated category', item.name); res.json(item); }));
router.delete('/categories/:id', asyncRoute(async (req, res) => { store.deleteCategory(req.params.id); store.audit(actor(req), 'Deleted category', req.params.id); res.json({ ok: true }); }));
function movePlan(kind,id,body) {
  if (!['uploads', 'library'].includes(kind)) fail('Invalid content type.');
  const record=kind==='uploads'?getSession(validId(id)):getBundle(validId(id));
  if(!record)fail('Record not found.',404);
  const categoryId=body?.categoryId||null;
  if(categoryId&&typeof categoryId!=='string')fail('Choose a valid destination.');
  if(body.examName!==undefined&&(typeof body.examName!=='string'||body.examName.length>200))fail('Enter an exam name up to 200 characters.');
  if(categoryId&&!store.categories().some(category=>category.id===categoryId))fail('Category not found.');
  const type=kind==='library'&&categoryId?store.categoryType(categoryId):null;
  let classification=null;
  if(type){
    const name=body.organizationName||record.organization?.name||record.university||'';
    if(typeof name!=='string'||!name.trim()||name.length>200)fail('Enter the school, exam board, or professional body name for this library collection.');
    const currentType=record.organization?.type;
    const organizationType=type==='institution'?(['university','college','polytechnic','school'].includes(currentType)?currentType:'school'):type;
    const matching=getCatalog().organizations.find(organization=>organization.type===organizationType&&slugify(organization.name)===slugify(name));
    const organizationId=matching?.id||`${organizationType}-${slugify(name)}`;
    classification={organization:{...record.organization,id:organizationId,name:name.trim(),type:organizationType},exam:{...record.exam,name:body.examName??record.exam?.name??record.examType??null},publisher:{name:record.publisher||null},educationLevel:record.educationLevel,faculty:record.faculty,department:record.department,programme:record.programme,courseCode:record.courseCode};
  }
  return {kind,id,categoryId,classification};
}
function applyMove(plan) {
  if(plan.classification){const result=reclassifyBundle(plan.id,plan.classification);if(!result.ok)fail(result.error);}
  store.assignCategory(plan.kind,plan.id,plan.categoryId);
}
router.put('/assignments/:kind/:id', asyncRoute(async (req, res) => {
  const { kind, id } = req.params; if (!['uploads', 'library'].includes(kind)) fail('Invalid content type.');
  applyMove(movePlan(kind,id,req.body));store.audit(actor(req),'Moved material',`${kind}/${id}`);res.json({ok:true});
}));
router.post('/assignments',asyncRoute(async(req,res)=>{
  const records=req.body?.records;
  if(!Array.isArray(records)||!records.length||records.length>100)fail('Select between 1 and 100 materials.');
  const unique=new Set(records.map(record=>`${record?.kind}/${record?.id}`));if(unique.size!==records.length)fail('Select each material once.');
  const plans=records.map(record=>movePlan(record.kind,record.id,req.body));
  const moved=[];
  try{for(const plan of plans){applyMove(plan);moved.push(plan.id);store.audit(actor(req),'Moved material',`${plan.kind}/${plan.id}`);}}
  catch(error){return res.status(error.status||500).json({error:error.status?error.message:'The move stopped. Already moved records are listed.',moved});}
  res.json({ok:true,count:moved.length});
}));
router.get('/users', asyncRoute(async (req, res) => {
  const { offset, limit } = paging(req), filters = validateFilters(req.query);
  const users = await directory(cloud()), filtered = users.filter(user=>matchesStudent(user,filters)).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))||a.id.localeCompare(b.id));
  res.json({items:filtered.slice(offset,offset+limit),total:filtered.length,offset,limit,
    schools:[...new Set(users.map(user=>user.school).filter(Boolean))].sort(), exams:[...new Set(users.map(user=>user.exam).filter(Boolean))].sort()});
}));
router.get('/users/:id', asyncRoute(async (req, res) => {
  const { data, error } = await cloud().auth.admin.getUserById(validId(req.params.id)); if (error) throw error;
  const { user } = data;
  const profile = await cloud().from('users').select('*').eq('id', user.id).maybeSingle();
  const preferences = await cloud().from('student_preferences').select('*').eq('user_id',user.id).maybeSingle();
  const totals = await Promise.all(['practice_sessions','question_attempts','exam_sessions','learning_events'].map(async table=>{
    const {count,error}=await cloud().from(table).select('*',{count:'exact',head:true}).eq('user_id',user.id);
    return [table,{count:error?null:count,error:error?.message}];
  }));
  // Return account fields needed by admins, never provider identities or auth secrets.
  res.json({...accountView(user,profile.data),profileError:profile.error?.message,preferences:preferences.data,preferencesError:preferences.error?.message,
    learningTotals:Object.fromEntries(totals),notifications:notifications.inbox(user.id,0,10),pushReachable:notifications.reachable(user.id)});
}));
router.patch('/users/:id', asyncRoute(async (req, res) => {
  const id = validId(req.params.id), { full_name, banned } = req.body || {};
  if (banned !== undefined && typeof banned !== 'boolean') fail('Invalid account status.');
  if (banned === true && id === actor(req)) fail('You cannot suspend your own account.');
  if (full_name !== undefined && (typeof full_name !== 'string' || !full_name.trim() || full_name.length > 200)) fail('Enter a name up to 200 characters.');
  const changes = { ...(banned !== undefined ? { ban_duration: banned ? '876000h' : 'none' } : {}), ...(full_name !== undefined ? { user_metadata: { full_name: full_name.trim() } } : {}) };
  if (!Object.keys(changes).length) fail('No changes provided.');
  const { error } = await cloud().auth.admin.updateUserById(id, changes); if (error) throw error;
  clearAccountCache();
  let warning;
  if (full_name !== undefined) { const profile = await cloud().from('users').update({ full_name: full_name.trim() }).eq('id', id); warning = profile.error?.message; }
  store.audit(actor(req), banned === true ? 'Suspended account' : banned === false ? 'Restored account' : 'Updated account', id);
  res.json({ ok: true, warning });
}));
router.get('/data', (_req, res) => res.json({ tables: Object.keys(DATA_TABLES) }));
router.get('/data/:table', asyncRoute(async (req, res) => {
  const table = req.params.table, column = DATA_TABLES[table]; if (!column) fail('Unknown data table.', 404);
  const { offset, limit } = paging(req);
  if(table.startsWith('admin_notification_'))return res.json({...notifications.dataPage(table,req.query.userId?validId(String(req.query.userId)):null,offset,limit),offset,limit});
  // Device push credentials stay private even to the general data browser.
  const fields = table === 'push_subscriptions' ? 'id,user_id,platform,created_at,updated_at' : '*';
  let query = cloud().from(table).select(fields, { count: 'exact' }).order(column, { ascending: false }).range(offset, offset + limit - 1);
  if (req.query.userId) query = query.eq(table === 'users' ? 'id' : 'user_id', validId(String(req.query.userId)));
  const { data, count, error } = await query; if (error) fail(`Unable to read ${table}: ${error.message}`, 503);
  res.json({ items: data, total: count, offset, limit });
}));
router.get('/activity', (req, res) => { const { offset, limit } = paging(req); res.json(store.listAudit(offset, limit)); });
const imageUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1}});
router.post('/notifications/images',imageUpload.single('image'),asyncRoute(async(req,res)=>{
  if(!req.file)fail('Choose a notification image.');
  const image=await notifications.saveImage(req.file.buffer,actor(req));
  store.audit(actor(req),'Uploaded notification image',image.id);res.status(201).json(image);
}));
router.get('/notifications', (req,res)=>{const {offset,limit}=paging(req);res.json({...notifications.listCampaigns(offset,limit),pushConfigured:Boolean(pushConfiguration())});});
router.get('/notifications/:id',asyncRoute(async(req,res)=>{
  const {offset,limit}=paging(req), result=notifications.campaignRecipients(validId(req.params.id),offset,limit);
  const users=new Map((await directory(cloud())).map(user=>[user.id,user]));
  res.json({...result,offset,limit,items:result.items.map(row=>({...row,name:users.get(row.user_id)?.name,email:users.get(row.user_id)?.email,school:users.get(row.user_id)?.school,exam:users.get(row.user_id)?.exam}))});
}));
router.post('/notifications/preview',asyncRoute(async(req,res)=>{
  const message=notifications.validateMessage(req.body?.message),selection=req.body?.audience;
  const users=audience(await directory(cloud(),true),selection);
  res.status(201).json(notifications.previewCampaign(actor(req),message,selection,users));
}));
router.post('/notifications/:id/send',rateLimit({limit:10,keyPrefix:'admin-notifications-send'}),asyncRoute(async(req,res)=>{
  const result=notifications.queueCampaign(validId(req.params.id),actor(req));
  store.audit(actor(req),'Sent notification campaign',result.id);
  res.status(202).json(result);
}));
router.get('/system', (_req, res) => res.json({ scheduler: schedulerStats(), storage: 'Hostinger filesystem + SQLite', accountProvider: 'Supabase', serverTime: new Date().toISOString(), uptime: Math.floor(process.uptime()) }));
router.use((error, _req, res, _next) => {
  if(error.code==='LIMIT_FILE_SIZE')return res.status(413).json({error:'Choose an image smaller than 5 MB.'});
  if(error instanceof multer.MulterError)return res.status(400).json({error:'Choose one image using the image upload field.'});
  console.error('[admin]', error.message);
  res.status(error.status || 500).json({ error: error.status ? error.message : 'The admin request failed. Check the API server logs and configuration.' });
});
export default router;
