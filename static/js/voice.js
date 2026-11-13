/* Hypotheek Acceptatie Assistent — voice.js
   Spraakmodus via een ElevenLabs Agent.

   Werkt naast main.js (die moet eerst geladen zijn) en hergebruikt daaruit:
   BRANDS, activeBrand, selectBrand, selectAllBrands, jumpToPage,
   addMessage, formatAnswer, extractPages, buildPageButtons.

   Config (in index.html, vóór dit script):
     window.APP_CONFIG = { voiceTokenUrl: "https://<ref>.supabase.co/functions/v1/elevenlabs-token" };
*/
import { Conversation } from 'https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.36.0/+esm';

const appCfg  = window.APP_CONFIG || {};
const cfg     = { tokenUrl: appCfg.voiceTokenUrl || (window.VOICE_CONFIG || {}).tokenUrl };
const micBtn  = document.getElementById('voice-btn');
const bar     = document.getElementById('voice-bar');
const statusEl  = document.getElementById('voice-status');
const captionEl = document.getElementById('voice-caption');
const stopBtn = document.getElementById('voice-stop');

let conversation = null;
let toolDriven   = false;   // true als de agent zelf het merk wisselt (geen contextupdate terugsturen)

const welcomeTalk  = document.getElementById('welcome-talk');
const welcomeLabel = document.getElementById('welcome-talk-label');

if (!cfg.tokenUrl) {
  micBtn.style.display = 'none';
  if (welcomeTalk) welcomeTalk.style.display = 'none';
  const or = document.getElementById('welcome-or');
  if (or) or.textContent = 'Kies een geldverstrekker om te beginnen';
  console.info('[voice] Geen voiceTokenUrl in APP_CONFIG — spraakmodus uitgeschakeld.');
}

// ── Helpers ────────────────────────────────────────────────
const escapeHtml = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function huidigMerk() {
  if (activeBrand === '__all__') return 'alle merken (code: alle)';
  if (activeBrand && BRANDS[activeBrand]) return `${BRANDS[activeBrand].name} (code: ${activeBrand})`;
  return 'geen';
}

function setUi(state, text) {
  // state: idle | connecting | listening | speaking | error
  bar.dataset.state = state;
  micBtn.dataset.state = state;
  bar.classList.toggle('open', state !== 'idle');
  micBtn.classList.toggle('active', state !== 'idle' && state !== 'error');
  micBtn.title = state === 'idle' ? 'Start spraakgesprek' : 'Stop spraakgesprek';
  const labels = {
    idle: '', connecting: 'Verbinden…', listening: 'Luistert…',
    speaking: 'Spreekt…', error: 'Er ging iets mis',
  };
  statusEl.textContent = labels[state] ?? '';
  if (text !== undefined) captionEl.textContent = text;

  // Welkomstscherm: Hypo luistert/praat mee, de grote knop wordt een stopknop
  document.body.dataset.voice = state;
  if (welcomeLabel) {
    welcomeLabel.textContent = {
      idle: 'Praat met me', connecting: 'Even verbinden…', listening: 'Ik luister… (tik om te stoppen)',
      speaking: 'Ik praat… (tik om te stoppen)', error: 'Probeer het opnieuw',
    }[state] ?? 'Praat met me';
  }
}

// ── Token ophalen (met optionele toegangscode) ─────────────
// Zelfde toegangscode als de chat (main.js) gebruikt
function storedCode() { try { return localStorage.getItem('accessCode') || ''; } catch { return ''; } }
function storeCode(c) { try { localStorage.setItem('accessCode', c); } catch { /* geen opslag */ } }

async function fetchToken(retry = true) {
  const url = new URL(cfg.tokenUrl);
  const code = storedCode();
  if (code) url.searchParams.set('code', code);

  const res = await fetch(url);
  if (res.status === 401 && retry) {
    const entered = window.prompt('Toegangscode voor de Hypotheek Assistent:');
    if (!entered) throw new Error('Geen toegangscode ingevoerd');
    storeCode(entered.trim());
    return fetchToken(false);
  }
  if (!res.ok) throw new Error(`Token ophalen mislukt (${res.status})`);
  const { token } = await res.json();
  return token;
}

// ── PDF-markering via de PDF.js-viewer in de iframe ────────
function highlightInViewer(phrase, page, attempt = 0) {
  const iframe = document.querySelector('#pdf-frame-wrap iframe');
  const app = iframe?.contentWindow?.PDFViewerApplication;
  // Wachten tot het document geladen is én de viewer op de gevraagde pagina staat;
  // PDF.js zoekt vanaf de huidige pagina, dus anders vindt hij een eerdere vermelding.
  const ready = app && app.pdfDocument && app.eventBus && app.pdfViewer?.pagesCount > 0
    && (!page || app.page === page || page > app.pdfViewer.pagesCount);
  if (!ready) {
    if (attempt < 40) setTimeout(() => highlightInViewer(phrase, page, attempt + 1), 250); // max ~10s
    return;
  }

  const find = query => app.eventBus.dispatch('find', {
    source: window, type: '', query,
    caseSensitive: false, entireWord: false, highlightAll: true,
    findPrevious: false, matchDiacritics: false,
  });

  // Valt de hele zin niet te vinden (afbreekstreepjes, regelovergangen),
  // probeer dan de eerste zes woorden.
  const shorter = phrase.split(/\s+/).slice(0, 6).join(' ');
  if (shorter !== phrase) {
    const onState = e => {
      if (e.state === 1 /* NOT_FOUND */) find(shorter);
      app.eventBus.off('updatefindcontrolstate', onState);
    };
    app.eventBus.on('updatefindcontrolstate', onState);
  }
  find(phrase);
}

// ── Client-tools: de agent bestuurt hiermee het scherm ─────
const clientTools = {
  open_pdf: ({ merk, pdf_pagina, zinsnede }) => {
    if (!BRANDS[merk]) return `Onbekend merk: ${merk}`;
    const page = Math.max(1, parseInt(pdf_pagina, 10) || 1);

    toolDriven = true;
    if (activeBrand !== '__all__' && activeBrand !== merk) selectBrand(merk);
    toolDriven = false;

    jumpToPage(page, merk);
    if (zinsnede) highlightInViewer(String(zinsnede).trim(), page);
    return `Gids van ${BRANDS[merk].name} geopend op pagina ${page}.`;
  },

  toon_antwoord: ({ merk, tekst }) => {
    if (!tekst) return 'Geen tekst ontvangen.';
    toolDriven = true;
    if (merk === 'alle') {
      if (activeBrand !== '__all__') selectAllBrands();
      addMessage('ai', `<div class="voice-tag">🎙 Spraakantwoord · alle merken</div>${formatAnswer(tekst)}`);
    } else if (BRANDS[merk]) {
      if (activeBrand !== merk) selectBrand(merk);
      // Paginaknoppen zelf toevoegen i.p.v. via addMessage: die zou automatisch
      // de PDF herladen en een markering van open_pdf wissen.
      const pageBtns = buildPageButtons(extractPages(tekst));
      addMessage('ai', `<div class="voice-tag">🎙 Spraakantwoord</div>${formatAnswer(tekst)}${pageBtns}`, merk, []);
    } else {
      addMessage('ai', formatAnswer(tekst));
    }
    toolDriven = false;
    return 'Antwoord getoond.';
  },
};

// ── Merkwissel door de gebruiker doorgeven aan de agent ────
for (const fn of ['selectBrand', 'selectAllBrands']) {
  const original = window[fn];
  window[fn] = function (...args) {
    const result = original.apply(this, args);
    if (conversation && !toolDriven) {
      try {
        conversation.sendContextualUpdate(`De adviseur heeft in het scherm nu geselecteerd: ${huidigMerk()}.`);
      } catch (e) { console.warn('[voice] contextupdate mislukt', e); }
    }
    return result;
  };
}

// ── Start / stop ───────────────────────────────────────────
async function startVoice() {
  setUi('connecting', '');
  try {
    // Eerst expliciet om de microfoon vragen: duidelijkere melding bij weigeren
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());

    const conversationToken = await fetchToken();

    conversation = await Conversation.startSession({
      conversationToken,
      connectionType: 'webrtc',
      dynamicVariables: { actief_merk: huidigMerk() },
      clientTools,

      onConnect: () => setUi('listening', 'Zeg het maar…'),
      onDisconnect: () => { conversation = null; setUi('idle', ''); },
      onModeChange: ({ mode }) => setUi(mode === 'speaking' ? 'speaking' : 'listening'),
      onError: (message) => { console.error('[voice]', message); setUi('error', String(message)); },
      onMessage: ({ message, role, source }) => {
        const who = role || (source === 'ai' ? 'agent' : 'user');
        if (who === 'user') {
          addMessage('user', `<span class="voice-tag-inline">🎙</span> ${escapeHtml(message)}`);
        } else {
          captionEl.textContent = message;   // gesproken tekst als ondertitel
        }
      },
    });
  } catch (err) {
    console.error('[voice] start mislukt', err);
    conversation = null;
    const msg = err?.name === 'NotAllowedError'
      ? 'Geen toegang tot de microfoon. Sta dit toe in je browser.'
      : (err?.message || 'Kon het spraakgesprek niet starten.');
    setUi('error', msg);
    setTimeout(() => { if (!conversation) setUi('idle', ''); }, 5000);
  }
}

async function stopVoice() {
  const c = conversation;
  conversation = null;
  setUi('idle', '');
  if (c) { try { await c.endSession(); } catch { /* al gesloten */ } }
}

micBtn.addEventListener('click', () => {
  const state = micBtn.dataset.state || 'idle';
  if (state === 'idle' || state === 'error') startVoice();
  else stopVoice();
});
stopBtn.addEventListener('click', stopVoice);
if (welcomeTalk) welcomeTalk.addEventListener('click', () => micBtn.click());
window.addEventListener('beforeunload', () => { if (conversation) conversation.endSession(); });

setUi('idle', '');
