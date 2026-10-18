// Auth is the source of truth for signups and onboarding choices.
let cached, pending;
const invalid = message => { throw Object.assign(new Error(message), { status: 400 }); };
export async function allAccounts(client, fresh = false) {
  if (!fresh && cached && Date.now() - cached.at < 10000) return cached.users;
  if (pending) return pending;
  pending = (async () => {
    const users = [];
    for (let page = 1; ; page++) {
      const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw error;
      users.push(...data.users);
      if (data.users.length < 1000 || (Number.isFinite(data.total) && users.length >= data.total)) break;
    }
    const unique = [...new Map(users.map(user => [user.id, user])).values()];
    cached = { at: Date.now(), users: unique }; return unique;
  })().finally(() => { pending = null; });
  return pending;
}
export function clearAccountCache() { cached = null; }
export function accountView(user, profile = null) {
  const meta = user.user_metadata || {}, choice = meta.study_preferences;
  const focus = choice?.focus;
  const selected = focus && ['school', 'exam'].includes(focus.kind) && typeof focus.name === 'string' ? { kind: focus.kind, id: focus.id, name: focus.name } : null;
  return { id: user.id, email: user.email, name: meta.full_name || meta.name || profile?.full_name,
    created_at: user.created_at, last_sign_in_at: user.last_sign_in_at, email_confirmed_at: user.email_confirmed_at,
    banned_until: user.banned_until, providers: user.app_metadata?.providers || [],
    school: selected?.kind === 'school' ? selected.name : profile?.target_university || null,
    exam: selected?.kind === 'exam' ? selected.name : profile?.target_exam || null,
    undergraduate: typeof choice?.undergraduate === 'boolean' ? choice.undergraduate : typeof meta.is_undergraduate === 'boolean' ? meta.is_undergraduate : null,
    focus: selected, onboarding_complete: Boolean(choice?.completedAt || profile?.onboarding_complete),
    onboarding_completed_at: choice?.completedAt || null, profile };
}
export async function directory(client, fresh = false) {
  const users = await allAccounts(client, fresh), profiles = new Map();
  // Read every page rather than trusting the PostgREST default 1,000-row cap.
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.from('users').select('*').order('id').range(offset, offset + 999);
    if (error) throw Object.assign(new Error(`Student profiles unavailable: ${error.message}`), { status: 503 });
    for (const row of data || []) profiles.set(row.id, row);
    if (!data || data.length < 1000) break;
  }
  return users.map(user => accountView(user, profiles.get(user.id)));
}
export function validateFilters(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('Choose valid student conditions.');
  const out = {};
  for (const key of ['q', 'school', 'exam']) if (input[key]) {
    if (typeof input[key] !== 'string' || input[key].length > 200) invalid(`Invalid ${key} condition.`);
    out[key] = input[key].trim();
  }
  for (const [key, allowed] of Object.entries({ studentType: ['undergraduate', 'other', 'unknown'], status: ['confirmed', 'unconfirmed', 'suspended'], onboarding: ['complete', 'incomplete'] })) {
    if (input[key]) { if (!allowed.includes(input[key])) invalid(`Invalid ${key} condition.`); out[key] = input[key]; }
  }
  if (input.inactiveDays !== undefined && input.inactiveDays !== '') {
    const days = Number(input.inactiveDays); if (!Number.isInteger(days) || days < 1 || days > 3650) invalid('Inactive days must be between 1 and 3650.'); out.inactiveDays = days;
  }
  for (const key of ['joinedAfter', 'joinedBefore']) if (input[key]) {
    if (typeof input[key] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input[key]) || !Number.isFinite(Date.parse(input[key]))) invalid('Choose a valid signup date.'); out[key] = input[key];
  }
  if (out.joinedAfter && out.joinedBefore && out.joinedAfter > out.joinedBefore) invalid('The start date must come before the end date.');
  return out;
}
export function matchesStudent(user, filters, now = Date.now()) {
  const contains = (value, query) => String(value || '').toLowerCase().includes(query.toLowerCase());
  if (filters.q && ![user.id, user.email, user.name, user.school, user.exam].some(value => contains(value, filters.q))) return false;
  if (filters.school && user.school !== filters.school) return false;
  if (filters.exam && user.exam !== filters.exam) return false;
  if (filters.studentType && (filters.studentType === 'undergraduate' ? user.undergraduate !== true : filters.studentType === 'other' ? user.undergraduate !== false : user.undergraduate !== null)) return false;
  const suspended = Boolean(user.banned_until && Date.parse(user.banned_until) > now);
  if (filters.status && (filters.status === 'suspended' ? !suspended : suspended || (filters.status === 'confirmed' ? !user.email_confirmed_at : Boolean(user.email_confirmed_at)))) return false;
  if (filters.onboarding && Boolean(user.onboarding_complete) !== (filters.onboarding === 'complete')) return false;
  if (filters.inactiveDays && Date.parse(user.last_sign_in_at || user.created_at) > now - filters.inactiveDays * 86400000) return false;
  const day = String(user.created_at || '').slice(0, 10);
  if (filters.joinedAfter && day < filters.joinedAfter || filters.joinedBefore && day > filters.joinedBefore) return false;
  return true;
}
export function audience(users, input) {
  if (!['all', 'selected', 'conditions'].includes(input?.mode)) invalid('Choose all students, selected students, or conditions.');
  if (input.mode === 'selected') {
    if (!Array.isArray(input.userIds) || !input.userIds.length || input.userIds.length > 1000 || input.userIds.some(id => typeof id !== 'string')) invalid('Select between 1 and 1000 accounts.');
    const ids = new Set(input.userIds), known = new Set(users.map(user => user.id));
    if ([...ids].some(id => !known.has(id))) invalid('One of the selected accounts no longer exists. Refresh the audience.');
    return users.filter(user => ids.has(user.id));
  }
  const filters = input.mode === 'conditions' ? validateFilters(input.filters) : {};
  if (input.mode === 'conditions' && !Object.keys(filters).length) invalid('Add at least one condition or choose all students.');
  return users.filter(user => matchesStudent(user, filters));
}
export function buildTrend(accounts, uploads, practices, days = 14, now = Date.now()) {
  const today = new Date(now).toISOString().slice(0, 10), midnight = Date.parse(`${today}T00:00:00Z`);
  const rows = Array.from({ length: days }, (_, i) => ({ day: new Date(midnight - (days - 1 - i) * 86400000).toISOString().slice(0, 10), signups: 0, uploads: 0, practices: practices === null ? null : 0 }));
  const byDay = new Map(rows.map(row => [row.day, row]));
  for (const [key, values, field] of [['signups', accounts, 'created_at'], ['uploads', uploads, 'createdAt'], ['practices', practices || [], 'started_at']]) {
    for (const item of values) { const time = new Date(item[field]).getTime(); if (!Number.isFinite(time) || time > now) continue; const row = byDay.get(new Date(time).toISOString().slice(0, 10)); if (row) row[key]++; }
  }
  return rows;
}
