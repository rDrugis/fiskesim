// Fangstlogg: konto og synk mot Supabase (brukernavn + passord), lagret lokalt først.
// URL og «publishable»-nøkkelen er laget for å ligge åpent i nettsiden; tilgangsreglene i databasen
// (supabase/schema.sql) sørger for at hver bruker bare ser sitt eget.
export const SUPA = { url: 'https://kzyqoyzbeefzxurvaigr.supabase.co', key: 'sb_publishable_XzJRIfoWVFw_9_l0otpf5A_dR9n_-1E' };

const LS_SESSION = 'fiskesim.konto', LS_LOG = 'fiskesim.fangst';
// Supabase vil ha en e-postadresse: brukernavnet gjøres om til en intern adresse som aldri får e-post
export const userEmail = (u) => `${u}@brukere.fiskesim.app`;
export const cleanUser = (u) => String(u || '').trim().toLowerCase();
export const validUser = (u) => /^[a-z0-9_.-]{2,24}$/.test(u);

const ls = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* privat modus */ } } };

async function call(path, { method = 'GET', body, token, prefer } = {}) {
  const h = { apikey: SUPA.key, 'Content-Type': 'application/json' };
  if (token) h.Authorization = 'Bearer ' + token;
  if (prefer) h.Prefer = prefer;
  const r = await fetch(SUPA.url + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text(); let j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) { j = txt; }
  if (!r.ok) { const e = new Error((j && (j.msg || j.message || j.error_description || j.error)) || ('HTTP ' + r.status)); e.status = r.status; e.body = j; throw e; }
  return j;
}

const norErr = (e) => {
  const m = String(e && e.message || e);
  if (/invalid login|invalid_grant|Invalid login credentials/i.test(m)) return 'Feil brukernavn eller passord';
  if (/already registered|already exists|User already/i.test(m)) return 'Brukernavnet er tatt';
  if (/password.*(6|short|least)/i.test(m)) return 'Passordet må ha minst 6 tegn';
  if (/email.*not confirmed/i.test(m)) return 'Kontoen er ikke bekreftet (e-postbekreftelse er slått på i Supabase)';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Ingen nettforbindelse – fangsten er lagret på enheten og sendes senere';
  return m;
};

export class Cloud {
  constructor() { this.s = ls.get(LS_SESSION, null); this.log = ls.get(LS_LOG, []); this.listeners = new Set(); this.syncing = false; }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const f of this.listeners) f(); }
  get user() { return this.s && this.s.username; }
  save() { ls.set(LS_LOG, this.log); this.emit(); }

  async session() {
    if (!this.s) return null;
    if (Date.now() / 1000 < this.s.expires_at - 60) return this.s;
    try { this.setSession(await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: this.s.refresh_token } }), this.s.username); }
    catch (e) { if (e.status === 400 || e.status === 401) { this.s = null; ls.set(LS_SESSION, null); this.emit(); } throw e; }
    return this.s;
  }
  setSession(j, username) {
    this.s = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600), username, uid: j.user && j.user.id };
    ls.set(LS_SESSION, this.s); this.emit();
  }
  async login(u, pw) {
    u = cleanUser(u); if (!validUser(u)) throw new Error('Brukernavn: 2–24 tegn, bare a–z, 0–9, punktum, bindestrek og understrek');
    try { this.setSession(await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: userEmail(u), password: pw } }), u); }
    catch (e) { throw new Error(norErr(e)); }
    await this.sync().catch(() => {});
  }
  async register(u, pw) {
    u = cleanUser(u); if (!validUser(u)) throw new Error('Brukernavn: 2–24 tegn, bare a–z, 0–9, punktum, bindestrek og understrek');
    if (String(pw).length < 6) throw new Error('Passordet må ha minst 6 tegn');
    let j; try { j = await call('/auth/v1/signup', { method: 'POST', body: { email: userEmail(u), password: pw, data: { username: u } } }); }
    catch (e) { throw new Error(norErr(e)); }
    if (!j.access_token) throw new Error('Kontoen ble laget, men e-postbekreftelse er slått på i Supabase – slå den av, så virker innlogging');
    this.setSession(j, u); await this.sync().catch(() => {});
  }
  logout() { this.s = null; ls.set(LS_SESSION, null); this.emit(); }

  // ---- fangstene ----
  add(c) { c.client_id = c.client_id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()); c.dirty = true; this.log.unshift(c); this.sort(); this.save(); this.sync().catch(() => {}); return c; }
  update(id, patch) { const c = this.log.find((x) => x.client_id === id); if (!c) return; Object.assign(c, patch, { dirty: true }); this.sort(); this.save(); this.sync().catch(() => {}); }
  remove(id) { const c = this.log.find((x) => x.client_id === id); if (!c) return; c.deleted = true; c.dirty = true; this.save(); this.sync().catch(() => {}); }
  sort() { this.log.sort((a, b) => (b.caught_at > a.caught_at ? 1 : -1)); }
  list() { return this.log.filter((c) => !c.deleted); }

  // send det som ikke er sendt, og hent det som ligger på kontoen (annen enhet)
  async sync() {
    if (!this.s || this.syncing) return; this.syncing = true; this.emit();
    try {
      const s = await this.session(); if (!s) return;
      const del = this.log.filter((c) => c.dirty && c.deleted), up = this.log.filter((c) => c.dirty && !c.deleted);
      for (const c of del) { await call(`/rest/v1/catches?client_id=eq.${encodeURIComponent(c.client_id)}`, { method: 'DELETE', token: s.access_token }); }
      if (up.length) await call('/rest/v1/catches?on_conflict=user_id,client_id', { method: 'POST', token: s.access_token, prefer: 'resolution=merge-duplicates,return=minimal', body: up.map(toRow) });
      this.log = this.log.filter((c) => !(c.dirty && c.deleted)); for (const c of up) c.dirty = false;
      const rows = await call(`/rest/v1/catches?select=*&user_id=eq.${s.uid}&order=caught_at.desc&limit=5000`, { token: s.access_token });
      const have = new Map(this.log.map((c) => [c.client_id, c]));
      for (const r of rows) { const c = fromRow(r), o = have.get(c.client_id); if (!o) this.log.push(c); else if (!o.dirty) Object.assign(o, c); }
      this.sort(); ls.set(LS_LOG, this.log); this.lastSync = Date.now(); this.err = null;
    } catch (e) { this.err = norErr(e); throw e; } finally { this.syncing = false; this.emit(); }
  }
  get pending() { return this.log.filter((c) => c.dirty).length; }
}

const COLS = ['client_id', 'caught_at', 'species', 'count', 'weight_kg', 'length_cm', 'released', 'no_catch', 'effort_min', 'lon', 'lat', 'depth_m', 'gear', 'bait', 'note'];
function toRow(c) { const r = {}; for (const k of COLS) r[k] = c[k] === '' || c[k] === undefined ? null : c[k]; r.algo = c.algo || null; // alle rader må ha samme felter når de sendes samlet r.count = c.no_catch ? 0 : (c.count || 1); r.released = !!c.released; r.no_catch = !!c.no_catch; r.updated_at = new Date().toISOString(); return r; }
function fromRow(r) { const c = {}; for (const k of COLS) c[k] = r[k]; if (r.algo) c.algo = r.algo; c.weight_kg = r.weight_kg == null ? null : +r.weight_kg; c.length_cm = r.length_cm == null ? null : +r.length_cm; c.depth_m = r.depth_m == null ? null : +r.depth_m; c.dirty = false; return c; }
