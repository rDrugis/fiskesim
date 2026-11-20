// Båtskjermen: 3D-visning, instrumentlinje, snelle, ekkolodd, utstyr, fangst og «Test plassen».
import { Scene3D } from '../render/scene.js';
import { SonarView } from './sonarview.js';
import { Controls } from './input.js';
import { AudioFx } from './audio.js';
import { GearSheet } from './gear.js';
import { catchCardHTML, loadLog, saveLog, logHTML } from './catch.js';
import { helpHTML } from './help.js';
import { compass, dec, int, deg3, clock, dateShort, esc, lightWord } from './fmt.js';
import { fmtLat, fmtLon } from '../geo/proj.js';
import { saveSetup, buildTerrainAsync, NEAR } from '../app/loader.js';
import { techniqueFor } from '../sim/spottest.js';

const RATES = [1, 2, 5, 10, 20, 30];
const KN = 1 / 0.5144;

export class BoatScreen {
  constructor(root, ctx, { onExit }) {
    this.root = root; this.ctx = ctx; this.onExit = onExit;
    const s = (this.session = ctx.session);
    this.world = ctx.world; this.env = ctx.env;
    this.tripId = s.t;
    this.lamp = false;
    root.innerHTML = `
      <canvas id="view3d" tabindex="0" aria-label="Utsikt fra båten"></canvas>
      <div class="instr" role="status">
        <div class="cell"><small>Kurs</small><b data-f="hdg">–</b></div>
        <div class="cell"><small>Fart</small><b data-f="sog">–</b></div>
        <div class="cell opt2"><small>Posisjon</small><b data-f="pos" class="pos">–</b></div>
        <div class="cell"><small>Dybde</small><b data-f="dep">–</b></div>
        <div class="cell" data-c="wind"><small>Vind</small><b data-f="wind">–</b></div>
        <div class="cell opt" data-c="wave"><small>Bølger</small><b data-f="wave">–</b></div>
        <div class="cell opt" data-c="cur"><small>Strøm</small><b data-f="cur">–</b></div>
        <div class="cell" data-c="tide"><small>Tidevann</small><b data-f="tide">–</b></div>
        <div class="cell opt" data-c="sst"><small>Sjø</small><b data-f="sst">–</b></div>
        <button class="cell clockcell" data-a="rate" title="Spol fram (+ og −)"><small data-f="date">–</small><b data-f="clock">–</b></button>
        <div class="grow"></div>
        <div class="tools">
          <button class="btn" data-a="gear">Utstyr</button>
          <button class="btn" data-a="log">Fangst</button>
          <button class="btn" data-a="spot">Test plassen</button>
          <button class="btn ghost" data-a="sound" aria-pressed="true">Lyd</button>
          <button class="btn ghost" data-a="help">Hjelp</button>
          <button class="btn ghost" data-a="map">Kart</button>
        </div>
      </div>
      <div class="tipframe"><span>Stangtuppen</span></div>
      <div class="reelbox">
        <div><small>Snøre ute</small><b data-f="out">–</b></div>
        <div><small>Brems</small><b data-f="drag">–</b></div>
        <div><small>Spole</small><b data-f="spool">–</b></div>
        <div class="state" data-f="state"></div>
      </div>
      <div class="keys" data-keys>
        <span><kbd>Mellomrom</kbd>løft stanga</span><span><kbd>S</kbd>eller hjul: sveiv</span><span><kbd>F</kbd>frispole</span><span><kbd>T</kbd>tommel</span>
        <span><kbd>M</kbd>motor</span><span><kbd>G</kbd>utstyr</span><span><kbd>+</kbd>spol fram</span><span><kbd>H</kbd>all styring</span>
        <button class="btn ghost" data-a="hidekeys" style="grid-column:1/-1;justify-self:end;padding:2px 8px;font-size:12px">Skjul</button>
      </div>
      <div class="toasts" aria-live="polite"></div>
      <div class="sheet hidden" role="dialog" aria-modal="true"><div class="panel"><header><h2></h2><button class="btn ghost" data-a="close">Lukk</button></header><div class="body"></div></div></div>`;
    if (localStorage.getItem('fiskesim.keys') === 'skjul') root.querySelector('[data-keys]').classList.add('hidden');
    this.$ = (sel) => root.querySelector(sel);
    this.f = {}; root.querySelectorAll('[data-f]').forEach((el) => { this.f[el.dataset.f] = el; });
    this.canvas = this.$('#view3d');
    this.scene = new Scene3D(this.canvas);
    this.scene.build(this.world, s, ctx.near, new Date(s.t).getUTCMonth());
    ctx.farP.then((far) => { if (!this.dead) this.scene.setFar(far); }).catch(() => {});
    this.sonar = new SonarView(root, s.sonar);
    this.audio = new AudioFx();
    this.$('[data-a="sound"]').setAttribute('aria-pressed', String(this.audio.on));
    this.controls = new Controls(this.canvas, this.actions());
    root.addEventListener('click', (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) this.button(a, e); });
    const startAudio = () => { this.audio.start(); };
    window.addEventListener('pointerdown', startAudio, { once: true }); window.addEventListener('keydown', startAudio, { once: true });
    this.onResize = () => { const r = this.canvas.getBoundingClientRect(); this.scene.resize(Math.max(1, r.width), Math.max(1, r.height)); };
    window.addEventListener('resize', this.onResize); this.onResize();
    this.last = performance.now(); this.hudT = 0; this.recT = 0;
    this.log = loadLog();
    for (const n of ctx.notes || []) this.toast(n, 'warn', 12000);
    if (s.synthetic) this.toast('Du fisker i et oppdiktet testområde fordi kartdata ikke kunne hentes.', 'warn', 15000);
    this.raf = requestAnimationFrame((t) => this.loop(t));
    this.canvas.focus();
  }

  // Handlinger fra tastatur og mus
  actions() {
    const s = this.session, A = s.angler, B = s.boat;
    return {
      freeSpool: () => { if (A.line.broken || A.inHolder) return; A.free = !A.free; if (A.free) A.crank = 0; },
      holder: () => { A.inHolder = !A.inHolder; if (!A.inHolder && s.rate > 5) s.rate = 1; },
      rodGrab: () => { if (A.inHolder) { A.inHolder = false; if (s.rate > 5) s.rate = 1; } },
      rodRelease: () => { A.basePitch = Math.max(-0.3, Math.min(1.0, A.pitch)); A.target = null; },
      net: () => { if (!s.fish.hooked) return; if (!s.landable) { this.toast('Fisken er ikke ved båten ennå.', '', 2500); return; } s.land(false); },
      rebait: () => this.rebait(),
      cut: () => {
        if (A.line.broken) return;
        if (this.cutArm && performance.now() - this.cutArm < 2000) { s.cutLine(); this.cutArm = 0; }
        else { this.cutArm = performance.now(); this.toast('Trykk X en gang til for å kappe snøret.', '', 2000); }
      },
      motor: () => { B.motorOn = !B.motorOn; if (!B.motorOn) B.throttle = 0; else { B.anchor = null; } this.toast(B.motorOn ? 'Motoren går. Piltastene gir gass og styrer.' : 'Motoren er stoppet.', '', 2500); },
      anchor: () => this.toggleAnchor(),
      driftAnchor: () => { B.driftAnchor = !B.driftAnchor; this.toast(B.driftAnchor ? 'Drivankeret er ute. Baugen legger seg mot vinden og avdriften går ned.' : 'Drivankeret er tatt inn.', '', 3000); },
      camSit: () => { this.scene.mode = 'sitt'; this.scene.look.yaw = 0; },
      camStand: () => { this.scene.mode = 'stå'; this.scene.look.yaw = 0; },
      camBack: () => { this.scene.mode = 'bak'; this.scene.look.yaw = 0; },
      camCycle: () => { const m = ['sitt', 'stå', 'bak']; this.scene.mode = m[(m.indexOf(this.scene.mode) + 1) % 3]; this.scene.look.yaw = 0; },
      inset: () => { this.scene.showInset = !this.scene.showInset; },
      lamp: () => { this.lamp = !this.lamp; },
      sonarSize: (e) => { if (e.shiftKey) this.sonar.el.classList.toggle('hidden'); else this.sonar.toggleBig(); },
      gear: () => this.openGear(), help: () => this.openHelp(),
      pause: () => { if (!this.sheetOpen) { s.paused = !s.paused; this.updateHUD(true); } },
      escape: () => this.closeSheet(),
      dragDown: () => { A.dragKg = Math.max(0.5, A.dragKg - 0.5); A.setup.drag = A.dragKg; },
      dragUp: () => { A.dragKg = Math.min(A.reel.maxDrag, A.dragKg + 0.5); A.setup.drag = A.dragKg; },
      faster: () => this.setRate(+1), slower: () => this.setRate(-1),
      sound: () => this.button('sound'),
    };
  }

  button(a, e) {
    if (a === 'gear') this.openGear();
    else if (a === 'log') this.openLog();
    else if (a === 'spot') this.openSpotTest();
    else if (a === 'help') this.openHelp();
    else if (a === 'close') this.closeSheet();
    else if (a === 'rate') this.setRate(e?.shiftKey ? -1 : +1, true);
    else if (a === 'sound') { const on = this.audio.toggle(); this.$('[data-a="sound"]').setAttribute('aria-pressed', String(on)); }
    else if (a === 'hidekeys') { this.$('[data-keys]').classList.add('hidden'); localStorage.setItem('fiskesim.keys', 'skjul'); }
    else if (a === 'map') { if (confirm('Avslutte turen og gå tilbake til kartet? Fangsten ligger i loggen.')) this.exit(); }
  }

  setRate(dir, wrap = false) {
    const s = this.session;
    let i = RATES.indexOf(s.rate); if (i < 0) i = 0;
    i = wrap ? (i + dir + RATES.length) % RATES.length : Math.max(0, Math.min(RATES.length - 1, i + dir));
    if (RATES[i] > 1 && s.fish.hooked) { this.toast('Du har fisk på. Spoling er av til fisken er landet eller borte.', '', 3000); return; }
    s.rate = RATES[i];
    if (s.rate > 5) { s.angler.inHolder = true; s.angler.free = false; }
    this.updateHUD(true);
  }

  toggleAnchor() {
    const s = this.session, B = s.boat;
    if (B.anchor) { B.anchor = null; this.toast('Ankeret er tatt opp.', '', 2500); s.t += 60e3; return; }
    if (B.motorOn && Math.hypot(B.vx, B.vy) > 1) { this.toast('Stopp båten før du ankrer.', '', 2500); return; }
    const d = this.world.depthAt(B.x, B.y);
    if (d > 45) { this.toast(`For dypt til å ankre her (${int(d)} m). Med 100 m tau holder ankeret ikke dypere enn ca. 40 m.`, 'warn', 4000); return; }
    B.anchor = { x: B.x, y: B.y, rope: Math.min(100, Math.max(12, d * 3)) };
    B.motorOn = false; B.throttle = 0;
    this.toast(`Ankeret er ute på ${int(d)} m med ${int(B.anchor.rope)} m tau.`, '', 3000);
  }

  rebait() {
    const s = this.session, A = s.angler;
    if (A.line.broken) { s.retie(); this.toast('Ny rigg er knyttet på.', '', 2500); return; }
    if (!s.rigInBoat) { this.toast('Sveiv inn riggen til båten først.', '', 2500); return; }
    if (!A.hooks.some((h) => h.bait && h.bait !== 'ingen')) { this.toast('Riggen har ikke agn.', '', 2000); return; }
    A.rebait(); s.t += 45e3; this.toast('Nytt agn er på.', '', 2000);
  }

  // Ramme for ramme
  loop(now) {
    if (this.dead) return;
    this.raf = requestAnimationFrame((t) => this.loop(t));
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000)); this.last = now;
    const s = this.session;
    this.controls.enabled = !this.sheetOpen;
    if (!this.sheetOpen) this.controls.apply(dt, s, this.scene);
    if (s.rate > 5 && !s.angler.inHolder) s.angler.inHolder = true;
    s.budgetMs = 12;
    const hooked0 = !!s.fish.hooked;
    try { s.advance(dt); } catch (err) { console.error(err); this.toast('Feil i simuleringen: ' + err.message, 'warn', 6000); s.paused = true; }
    if (!hooked0 && s.fish.hooked && s.rate > 1) { s.rate = 1; this.updateHUD(true); }
    this.handleEvents();
    this.scene.frame(dt, s, { lamp: this.lamp });
    const ir = this.scene.insetRect, tf = this.$('.tipframe');
    if (ir) { tf.style.display = ''; tf.style.left = ir.x + 'px'; tf.style.top = ir.y + 'px'; tf.style.width = ir.w + 'px'; tf.style.height = ir.h + 'px'; } else tf.style.display = 'none';
    if (!s.paused) this.sonar.update(dt, s);
    this.audio.update(dt, s);
    this.hudT += dt; if (this.hudT > 0.15) { this.hudT = 0; this.updateHUD(); }
    this.recT += dt; if (this.recT > 2) { this.recT = 0; this.checkRecenter(); }
  }

  handleEvents() {
    const s = this.session;
    for (const ev of s.events.splice(0)) {
      if (ev.type === 'fangst') { this.audio.splash(1); this.showCatch(ev.fish); }
      else if (ev.type === 'brudd') { this.toast(`${ev.msg} Trykk R for å knyte på ny rigg (tar et halvt minutt).`, 'warn', 6000); if (s.rate > 1) s.rate = 1; }
      else if (ev.type === 'mistet') this.toast(ev.msg, '', 4000);
      else if (ev.type === 'varsel') { this.toast(ev.msg, 'warn', 4000); if (s.rate > 1) s.rate = 1; }
    }
  }

  updateHUD(force) {
    const s = this.session, e = s.e, B = s.boat, A = s.angler, w = this.world, f = this.f;
    const hdgTrue = w.gridToTrue(B.headingDeg);
    f.hdg.textContent = deg3(hdgTrue);
    f.sog.innerHTML = `${dec(B.speedKn, 1)}<em>kn</em>`;
    const [lon, lat] = w.toLonLat(B.x, B.y);
    f.pos.innerHTML = `${fmtLat(lat)}<br>${fmtLon(lon)}`;
    const bot = s.sonar.lastBottom;
    f.dep.innerHTML = bot != null ? `${dec(bot + 0.25, 1)}<em>m</em>` : '–';
    f.wind.innerHTML = `${int(e.ws)}<em>m/s ${compass(e.wd)}</em>`;
    f.wave.innerHTML = `${dec(e.hs, 1)}<em>m ${int(e.tp)} s</em>`;
    f.cur.innerHTML = `${dec(e.cs * KN, 1)}<em>kn mot ${compass(e.cd)}</em>`;
    const tr = e.tideRate > 0.02 ? 'stiger' : e.tideRate < -0.02 ? 'synker' : 'stille';
    f.tide.innerHTML = `${int(e.tide * 100)}<em>cm ${tr}${e.tideNext ? `, ${e.tideNext.kind} ${clock(e.tideNext.t)}` : ''}</em>`;
    f.sst.innerHTML = `${dec(e.sst, 1)}<em>°C</em>`;
    f.clock.innerHTML = `${clock(s.t)}<em>${s.paused ? 'pause' : s.rate + '×'}${s.lagging && s.rate > 5 ? ' (maks)' : ''}</em>`;
    f.date.textContent = `${dateShort(s.t)}, ${lightWord(e.sunElev)}`;
    s.lagging = false;
    const est = (k, on) => this.root.querySelector(`[data-c="${k}"]`)?.classList.toggle('est', !!on);
    est('wind', e.src.met !== 'MET'); est('wave', e.src.ocean !== 'MET'); est('cur', true); est('sst', e.src.ocean !== 'MET'); est('tide', e.src.tide !== 'Kartverket');
    // snelle
    f.out.innerHTML = `${int(A.line.broken ? 0 : Math.max(0, A.line.L - A.rod.len))}<em>m</em>`;
    f.drag.innerHTML = `${dec(A.dragKg, 1)}<em>kg</em>`;
    f.spool.textContent = A.line.broken ? '–' : A.free ? (A.thumb ? 'Tommel' : 'Frispole') : A.crank > 0.05 ? 'Sveiver' : 'Inne';
    let st = '';
    if (A.line.broken) st = 'Snøret røk. Trykk <i>R</i> for å knyte på ny rigg.';
    else if (s.landable) st = 'Fisken er ved båten. Trykk <i>N</i> for håven.';
    else if (A.inHolder) st = 'Stanga står i holderen. Klikk eller trykk <i>B</i> for å ta den.';
    else if (s.rigInBoat) {
      const baitGone = A.hooks.some((h) => h.bait && h.bait !== 'ingen' && h.baitLeft < 0.35);
      st = baitGone ? 'Agnet er borte. Trykk <i>R</i> for nytt agn.' : `Riggen er i båten. Trykk <i>F</i> for å slippe den ut.`;
    } else if (A.free) st = 'Snøret går ut. Sveiv eller trykk <i>F</i> for å stoppe.';
    else st = esc(A.rig.navn);
    if (force || st !== this.lastState) { f.state.innerHTML = st; this.lastState = st; }
  }

  // Bygg nytt nært terreng når båten har drevet langt
  checkRecenter() {
    if (this.recentering || this.session.synthetic) return;
    const g = this.world.near, w = this.world, B = this.session.boat;
    const cx = g.x0 + g.W * g.res / 2 - w.E0, cy = g.y1 - g.H * g.res / 2 - w.N0;
    if (Math.hypot(B.x - cx, B.y - cy) < 650) return;
    this.recentering = true;
    const lead = 150 / Math.max(0.3, Math.hypot(B.vx, B.vy));
    const nx = B.x + B.vx * Math.min(300, lead * 2), ny = B.y + B.vy * Math.min(300, lead * 2);
    buildTerrainAsync({ cx: w.E0 + nx, cy: w.N0 + ny, size: NEAR.size, res: NEAR.res, points: true, pointsSize: NEAR.size, ngu: true, msl: this.env.msl })
      .then((ng) => { if (this.dead) return; w.setNear(ng); this.session.fish.updateTerrain(ng); this.scene.setNear(ng); this.nearGrid = ng; })
      .catch(() => {})
      .finally(() => { this.recentering = false; });
  }

  toast(msg, kind = '', ms = 3500) {
    const box = this.$('.toasts');
    const el = document.createElement('div'); el.className = 'toast ' + kind; el.textContent = msg;
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => el.remove(), ms);
  }

  // Ark (utstyr, fangst, hjelp, test)
  openSheet(title, content, onClose) {
    const sh = this.$('.sheet');
    sh.querySelector('h2').textContent = title;
    const body = sh.querySelector('.body'); body.innerHTML = '';
    if (typeof content === 'string') body.innerHTML = content; else body.appendChild(content);
    sh.classList.remove('hidden');
    this.sheetOpen = true; this.sheetOnClose = onClose; this.wasPaused = this.session.paused; this.session.paused = true;
    this.controls.keys.clear();
    sh.querySelector('[data-a="close"]').focus();
    return body;
  }
  closeSheet() {
    if (!this.sheetOpen) return;
    this.$('.sheet').classList.add('hidden');
    this.sheetOpen = false; this.session.paused = !!this.wasPaused;
    const cb = this.sheetOnClose; this.sheetOnClose = null; cb && cb();
    this.canvas.focus();
  }

  openGear() {
    const s = this.session, A = s.angler;
    const gs = new GearSheet(A.setup, {
      canApply: () => (A.line.broken || s.rigInBoat ? '' : 'Sveiv inn riggen til båten først – du bytter utstyr i båten.'),
      onApply: (setup) => {
        A.apply(setup); A.free = false; A.crank = 0; A.inHolder = false;
        A.line.reset(A.rodFrame(s.boat).tip, 0.8); s.rigInBoat = true; s.brokeReported = false;
        this.scene.rod.setStyle(A.rod, A.lineSpec, A.rig);
        saveSetup(setup); s.t += 90e3;
        this.closeSheet(); this.toast('Nytt utstyr er klart.', '', 2500);
      },
    });
    this.openSheet('Utstyr', gs.el);
  }

  openHelp() { this.openSheet('Hjelp og kilder', helpHTML()); }

  openLog() {
    const body = this.openSheet('Fangstlogg', logHTML(this.log, this.tripId));
    body.addEventListener('click', (e) => {
      if (e.target.closest('[data-a="clearlog"]') && confirm('Tømme hele fangstloggen?')) { this.log = []; saveLog(this.log); body.innerHTML = logHTML(this.log, this.tripId); }
    });
  }

  showCatch(c) {
    const body = this.openSheet('Fisk i båten', catchCardHTML(c), () => { this.session.t += 60e3; });
    body.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a !== 'keep' && a !== 'release') return;
      this.log.push({ ...c, kept: a === 'keep', trip: this.tripId });
      saveLog(this.log);
      if (a === 'release') this.audio.splash(0.6);
      this.closeSheet();
    });
  }

  openSpotTest() {
    const s = this.session, A = s.angler;
    const tech = techniqueFor(A.rig);
    const wrap = document.createElement('div');
    wrap.className = 'spot';
    wrap.innerHTML = `
      <p>Simulerer flere fisketurer her, med utstyret du har nå (${esc(A.rig.navn)}), fra ${esc(clock(s.t))} og framover. Samme fiskemodell som i spillet, men fiskeren er forenklet: ${tech === 'pilk' ? 'pilker i drift og kjører opp igjen etter ca. 200 m' : tech === 'slo' ? 'slipper sloen ned og sveiver den opp gjennom vannet' : 'ligger med agnet på bunnen, ankret der det er under 45 m'}.</p>
      <div class="row"><label class="field" style="margin:0"><span>Timer per tur</span><select data-k="h"><option>2</option><option selected>3</option><option>6</option></select></label>
      <label class="field" style="margin:0"><span>Antall turer</span><select data-k="n"><option>4</option><option selected>8</option><option>16</option></select></label>
      <button class="btn primary" data-a="run" style="align-self:end">Start testen</button></div>
      <div data-out style="margin-top:14px"></div>`;
    this.openSheet('Test plassen', wrap, () => { if (this.spotWorker) { this.spotWorker.terminate(); this.spotWorker = null; } });
    wrap.querySelector('[data-a="run"]').addEventListener('click', () => {
      const hours = +wrap.querySelector('[data-k="h"]').value, runs = +wrap.querySelector('[data-k="n"]').value;
      const out = wrap.querySelector('[data-out]');
      out.innerHTML = '<div class="note">Kjører … <span data-p>0</span> %</div><div style="height:6px;background:var(--hull-2);border-radius:3px;margin-top:6px"><div data-bar style="height:6px;width:0;background:var(--buoy);border-radius:3px"></div></div>';
      if (this.spotWorker) this.spotWorker.terminate();
      const wk = (this.spotWorker = new Worker(new URL('./spottest.worker.js', import.meta.url), { type: 'module' }));
      const w = this.world, g = w.near;
      const copy = (gr) => gr && ({ ...gr, z: gr.z.slice(), mask: gr.mask.slice(), hard: gr.hard.slice(), sed: gr.sed?.slice(), tpi: gr.tpi?.slice(), lo: gr.lo?.slice(), hi: gr.hi?.slice() });
      const env = this.env;
      wk.postMessage({
        E0: w.E0, N0: w.N0, near: copy(g), far: null, start: { x: s.boat.x, y: s.boat.y }, setup: A.setup, timeMs: s.t, hours, runs,
        env: { lat: env.lat, lon: env.lon, loc: env.loc, ocean: env.ocean, period: env.period, tide: env.tide, levels: env.levels, status: env.status, override: env.override },
      });
      wk.onmessage = (ev) => {
        if (ev.data.progress != null) { const p = Math.round(ev.data.progress * 100); out.querySelector('[data-p]').textContent = p; out.querySelector('[data-bar]').style.width = p + '%'; return; }
        wk.terminate(); this.spotWorker = null;
        if (!ev.data.ok) { out.innerHTML = `<div class="rule bad">Testen feilet: ${esc(ev.data.error.split('\n')[0])}</div>`; return; }
        out.innerHTML = spotResultHTML(ev.data.res);
      };
      wk.onerror = (e) => { out.innerHTML = `<div class="rule bad">Testen feilet: ${esc(e.message || 'ukjent feil')}</div>`; };
    });
  }

  exit() {
    this.dead = true; cancelAnimationFrame(this.raf);
    this.controls.destroy(); window.removeEventListener('resize', this.onResize);
    if (this.spotWorker) this.spotWorker.terminate();
    this.audio.ctx?.close?.();
    this.scene.destroy();
    this.onExit();
  }
}

function spotResultHTML(r) {
  const rows = r.rows.map((x) => {
    const w = Math.min(100, (x.perHour / Math.max(0.5, r.rows[0]?.perHour || 1)) * 100);
    return `<tr><td>${esc(x.navn)}</td><td class="num">${dec(x.perHour, 2)}</td><td class="num">${dec(x.lo, 1)}–${dec(x.hi, 1)}</td><td style="width:22%"><div class="bar" style="width:${w}%"></div></td><td class="num">${x.lenMed} cm (${x.lenLo}–${x.lenHi})</td><td class="num">${x.overMin == null ? '–' : int(x.overMin * 100) + ' %'}</td></tr>`;
  }).join('');
  return `
    <p style="font-size:17px;margin:0 0 8px">Forventet fangst: <b class="num">${dec(r.total.perHour, 1)} fisk i timen</b> <span class="note">(80 % av turene: ${dec(r.total.lo, 1)}–${dec(r.total.hi, 1)})</span></p>
    ${r.rows.length ? `<table><thead><tr><th>Art</th><th>Per time</th><th>Spenn</th><th></th><th>Lengde (median)</th><th>Over minstemål</th></tr></thead><tbody>${rows}</tbody></table>` : '<p>Ingen fisk i noen av turene.</p>'}
    <p class="note">${r.runs} turer à ${r.hours} timer. Napp som fiskeren så: ${dec(r.bitesPerHour, 1)} i timen. Mistet under kampen: ${int(r.lostShare * 100)} %. Tid med agnet i vannet: ${int(r.fishingShare * 100)} %.</p>
    <p class="note"><span class="tag est">anslag</span> Tallene sier hvor godt plassen passer for artene med dette utstyret og disse forholdene, ifølge modellen. Fiskemengden er kalibrert mot vanlige fangstrater langs kysten, ikke målt her.</p>`;
}
