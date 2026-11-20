// Styring med tastatur og mus. Stanga kan løftes med mellomrom eller styres direkte ved å dra med musa;
// snella sveives med S eller musehjulet/styreflaten.
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Controls {
  constructor(el, actions) {
    this.el = el; this.actions = actions;
    this.keys = new Set(); this.shift = false;
    this.wheel = 0; this.look = { dyaw: 0, dpitch: 0 };
    this.rodDrag = null; this.lookDrag = null; this.enabled = true;
    this.onKeyDown = (e) => {
      if (e.code === 'Escape') { this.actions.escape?.(); return; }
      if (!this.enabled || e.target.closest?.('input, select, textarea')) return;
      if (e.metaKey || e.ctrlKey) return;
      this.shift = e.shiftKey;
      const k = e.code;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(k);
      const a = this.actions;
      const map = {
        KeyF: 'freeSpool', KeyB: 'holder', KeyN: 'net', KeyR: 'rebait', KeyX: 'cut', KeyM: 'motor', KeyK: 'anchor', KeyJ: 'driftAnchor',
        Digit1: 'camSit', Digit2: 'camStand', Digit3: 'camBack', KeyC: 'camCycle', KeyI: 'inset', KeyL: 'lamp', KeyO: 'sonarSize',
        KeyG: 'gear', KeyH: 'help', KeyP: 'pause', Escape: 'escape', KeyQ: 'dragDown', KeyE: 'dragUp', KeyU: 'sound',
      };
      if (map[k]) { a[map[k]]?.(e); e.preventDefault(); }
      if (e.key === '+' || k === 'NumpadAdd') a.faster?.();
      if (e.key === '-' || k === 'NumpadSubtract') a.slower?.();
    };
    this.onKeyUp = (e) => { this.keys.delete(e.code); this.shift = e.shiftKey; };
    this.onBlur = () => { this.keys.clear(); this.rodDrag = null; this.lookDrag = null; };
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);

    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      el.setPointerCapture(e.pointerId);
      if (e.button === 2 || e.altKey || e.button === 1) this.lookDrag = { x: e.clientX, y: e.clientY };
      else if (e.button === 0) { this.rodDrag = { y: e.clientY, x: e.clientX, start: null }; this.actions.rodGrab?.(); }
    });
    el.addEventListener('pointermove', (e) => {
      if (this.lookDrag) { this.look.dyaw += (e.clientX - this.lookDrag.x) * 0.0035; this.look.dpitch -= (e.clientY - this.lookDrag.y) * 0.003; this.lookDrag.x = e.clientX; this.lookDrag.y = e.clientY; }
      if (this.rodDrag) this.rodDrag.cur = e.clientY;
    });
    const up = (e) => { if (this.rodDrag) { this.actions.rodRelease?.(); this.rodDrag = null; } this.lookDrag = null; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      const d = Math.abs(e.deltaY) * (e.deltaMode === 1 ? 30 : e.deltaMode === 2 ? 300 : 1);
      this.wheel = Math.min(3.2, this.wheel + d * 0.006); // omdreininger i sekundet (avtar raskt)
    }, { passive: false });
  }

  // Overfør inndata til fiskeren og båten (kalles hver ramme)
  apply(dt, session, view) {
    const A = session.angler, B = session.boat, k = this.keys, fast = this.shift;
    this.wheel *= Math.exp(-dt / 0.22);
    const motor = B.motorOn;
    // stang
    if (!A.inHolder) {
      if (this.rodDrag && this.rodDrag.cur != null) {
        if (this.rodDrag.start == null) this.rodDrag.start = A.pitch;
        A.target = clamp(this.rodDrag.start + (this.rodDrag.y - this.rodDrag.cur) * 0.0055, -0.35, 1.25);
      } else if (!this.rodDrag) A.target = null;
      A.lift = k.has('Space'); A.fastLift = A.lift && fast;
      const keyCrank = k.has('KeyS') ? (fast ? 2.6 : 1.2) : 0;
      A.crank = Math.max(keyCrank, this.wheel > 0.05 ? this.wheel : 0);
      A.thumb = k.has('KeyT');
      if (A.crank > 0 && A.free) A.free = false; // sveiven kobler inn spolen (lukker bøylen på haspelsnelle)
    } else { A.lift = false; A.crank = 0; A.target = null; }
    // båt og blikk
    if (motor) {
      if (k.has('ArrowUp')) B.throttle = clamp(B.throttle + dt * 0.5, -0.4, 1);
      if (k.has('ArrowDown')) B.throttle = clamp(B.throttle - dt * 0.5, -0.4, 1);
      B.rudder = (k.has('ArrowLeft') ? -1 : 0) + (k.has('ArrowRight') ? 1 : 0);
    } else {
      if (k.has('ArrowLeft')) this.look.dyaw -= dt * 1.2;
      if (k.has('ArrowRight')) this.look.dyaw += dt * 1.2;
      if (k.has('ArrowUp')) this.look.dpitch += dt * 0.8;
      if (k.has('ArrowDown')) this.look.dpitch -= dt * 0.8;
    }
    view.look.yaw = clamp(view.look.yaw + this.look.dyaw, -2.6, 2.6);
    view.look.pitch = clamp(view.look.pitch + this.look.dpitch, -1.2, 0.9);
    this.look.dyaw = 0; this.look.dpitch = 0;
  }

  destroy() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }
}
