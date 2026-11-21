// Fiskesim: kart for fiske langs norskekysten.
import './ui/app.css';
import { App } from './ui/app.js';

// Feil vises nederst på skjermen i stedet for å forsvinne stille
function showError(msg) {
  let el = document.querySelector('.errbar');
  if (!el) { el = document.createElement('div'); el.className = 'errbar'; document.body.appendChild(el); el.addEventListener('click', () => el.remove()); }
  el.textContent = 'Noe gikk galt: ' + msg + ' (trykk for å lukke)';
}
window.addEventListener('error', (e) => { if (e.message && !/ResizeObserver/.test(e.message)) showError(e.message || String(e.error)); });
window.addEventListener('unhandledrejection', (e) => { const m = String(e.reason?.message || e.reason); if (!/abort|avbrutt/i.test(m)) showError(m); });

new App(document.getElementById('app'));
