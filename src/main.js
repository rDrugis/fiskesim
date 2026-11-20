// Fiskesim: kart → last fiskeplass → båten.
import './ui/app.css';
import { MapScreen } from './ui/mapscreen.js';
import { BoatScreen } from './ui/boatscreen.js';
import { loadSpot } from './app/loader.js';
import { helpHTML } from './ui/help.js';
import { esc } from './ui/fmt.js';

const app = document.getElementById('app');
let current = null;
const params = new URLSearchParams(location.search);

function mount() { app.innerHTML = ''; const d = document.createElement('div'); app.appendChild(d); return d; }

function showMap(start) {
  current?.destroy?.();
  current = new MapScreen(mount(), { onLaunch: launch, onHelp: showHelp, start });
  window.fiskesim = { screen: current }; // for feilsøking i konsollen
}

function showHelp() {
  const sh = document.createElement('div');
  sh.className = 'sheet'; sh.style.inset = '0';
  sh.innerHTML = `<div class="panel"><header><h2>Hjelp og kilder</h2><button class="btn ghost" data-a="close">Lukk</button></header>${helpHTML()}</div>`;
  const close = () => { sh.remove(); window.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  sh.addEventListener('click', (e) => { if (e.target === sh || e.target.closest('[data-a="close"]')) close(); });
  window.addEventListener('keydown', onKey);
  document.body.appendChild(sh);
}

const STAGES = [['env', 'Vær, bølger, strøm og tidevann'], ['near', 'Dybdemodell for området rundt båten'], ['scene', '3D-landskap, hus og skog']];

async function launch({ lon, lat, timeMs, zoom }) {
  const ov = document.createElement('div');
  ov.className = 'loading';
  ov.innerHTML = `<div class="box"><h2>Gjør klar båten</h2><p class="note" style="margin:0">Henter data fra Kartverket, MET og NGU for akkurat dette stedet.</p><ol>${STAGES.map(([k, t]) => `<li data-s="${k}"><span><span>${t}</span><br><small class="note" data-d></small></span></li>`).join('')}</ol><div data-err></div></div>`;
  document.body.appendChild(ov);
  const stage = (k, text, state) => {
    const li = ov.querySelector(`[data-s="${k}"]`); if (!li) return;
    if (text) li.querySelector('[data-d]').textContent = text;
    li.className = state === 'done' ? 'done' : 'now';
  };
  try {
    const ctx = await loadSpot({ lon, lat, timeMs, onStage: stage, demo: params.has('demo') });
    stage('scene', 'Bygger terreng og vann', 'now');
    await new Promise((r) => setTimeout(r, 30));
    current?.destroy?.();
    current = new BoatScreen(mount(), ctx, { onExit: () => showMap({ center: [lon, lat], zoom: zoom || 13 }) });
    window.fiskesim = { ctx, screen: current }; // for feilsøking i konsollen
    ov.remove();
  } catch (e) {
    console.error(e);
    ov.querySelector('[data-err]').innerHTML = `<div class="rule bad" style="margin-top:14px">Klarte ikke å laste plassen: ${esc(e.message || e)}</div><button class="btn" data-a="back">Tilbake til kartet</button>`;
    ov.querySelector('[data-a="back"]').addEventListener('click', () => ov.remove());
  }
}

// Feil vises nederst på skjermen i stedet for å forsvinne stille
function showError(msg) {
  let el = document.querySelector('.errbar');
  if (!el) { el = document.createElement('div'); el.className = 'errbar'; document.body.appendChild(el); el.addEventListener('click', () => el.remove()); }
  el.textContent = 'Noe gikk galt: ' + msg + ' (klikk for å lukke)';
}
window.addEventListener('error', (e) => showError(e.message || String(e.error)));
window.addEventListener('unhandledrejection', (e) => showError(String(e.reason?.message || e.reason)));

// Direkte til en plass: ?sted=61.60,5.03 (valgfritt &tid=2026-11-21T08:00)
const sted = params.get('sted');
if (sted) {
  const [la, lo] = sted.split(',').map(Number);
  const t = params.get('tid') ? Date.parse(params.get('tid')) : Date.now();
  if (la === la && lo === lo) launch({ lon: lo, lat: la, timeMs: t === t ? t : Date.now(), zoom: 13 });
  else showMap();
} else showMap();
