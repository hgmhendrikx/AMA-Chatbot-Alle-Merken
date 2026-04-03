/* Hypotheek Acceptatie Assistent — main.js
   BRANDS is injected by the template as a global variable. */

let activeBrand    = null;
let activePdfBrand = null;
let pdfOpen        = false;
let currentPage    = null;

// Stores key phrases per brand from the most recent answer
// e.g. { "attens": ["maximaal 90% van de marktwaarde", ...] }
let currentPhrases = {};

// ── All-brands PDF picker ──────────────────────────────────
function showAllBrandsPdfPicker() {
  const wrap = document.getElementById('pdf-frame-wrap');
  const buttons = Object.entries(BRANDS).map(([key, brand]) => `
    <button class="pdf-brand-pick-btn" onclick="loadPdf(1, '${key}')" style="--brand-color:${brand.color}">
      <span>${brand.icon}</span>
      <span>${brand.name}</span>
    </button>`).join('');
  wrap.innerHTML = `
    <div class="pdf-brand-picker">
      <p>Kies een acceptatiegids om te bekijken:</p>
      ${buttons}
    </div>`;
}

// ── Build sidebar ──────────────────────────────────────────
const brandList = document.getElementById('brand-list');

const allEl = document.createElement('div');
allEl.className = 'brand-item';
allEl.dataset.key = '__all__';
allEl.innerHTML = `
  <div class="brand-icon">🔍</div>
  <span class="brand-name">Alle merken</span>
  <span class="brand-tooltip">Alle merken</span>`;
allEl.onclick = () => selectAllBrands();
brandList.appendChild(allEl);

const divider = document.createElement('div');
divider.className = 'sidebar-divider';
brandList.appendChild(divider);

Object.entries(BRANDS).forEach(([key, brand]) => {
  const el = document.createElement('div');
  el.className = 'brand-item';
  el.dataset.key = key;
  el.innerHTML = `
    <div class="brand-icon">${brand.icon}</div>
    <span class="brand-name">${brand.name}</span>
    <span class="brand-tooltip">${brand.name}</span>`;
  el.onclick = () => selectBrand(key);
  brandList.appendChild(el);
});

// ── Select all brands ──────────────────────────────────────
function selectAllBrands() {
  activeBrand = '__all__';
  document.querySelectorAll('.brand-item').forEach(el => {
    el.classList.toggle('active', el.dataset.key === '__all__');
  });
  const allColor  = '#2D2D44';
  const allAccent = '#7B68EE';
  document.getElementById('header').style.background = allColor;
  document.documentElement.style.setProperty('--accent',  allColor);
  document.documentElement.style.setProperty('--accent2', allAccent);
  document.getElementById('header-icon').textContent    = '🔍';
  document.getElementById('header-title').textContent   = 'Alle merken';
  document.getElementById('header-sub').textContent     = 'Vergelijk acceptatiebeleid over alle geldverstrekkers';
  const pdfBtn = document.getElementById('pdf-toggle-btn');
  pdfBtn.style.display = 'flex';
  pdfBtn.classList.remove('active');
  showAllBrandsPdfPicker();
  if (window.innerWidth <= 768) document.getElementById('sidebar').classList.add('collapsed');
  const ta = document.getElementById('query');
  ta.disabled = false;
  ta.placeholder = 'Stel een vergelijkingsvraag over alle merken...';
  document.getElementById('send-btn').disabled = false;
  ta.focus();
}

// ── Select brand ───────────────────────────────────────────
function selectBrand(key) {
  activeBrand = key;
  const brand = BRANDS[key];
  document.querySelectorAll('.brand-item').forEach(el => {
    const b = BRANDS[el.dataset.key];
    if (b) el.style.setProperty('--brand-accent', b.accent);
    el.classList.toggle('active', el.dataset.key === key);
  });
  document.getElementById('header').style.background = brand.color;
  document.documentElement.style.setProperty('--accent',  brand.color);
  document.documentElement.style.setProperty('--accent2', brand.accent);
  document.getElementById('header-icon').textContent     = brand.icon;
  document.getElementById('header-title').textContent    = brand.name;
  document.getElementById('header-sub').textContent      = 'Acceptatiegids assistent';
  document.getElementById('pdf-panel-title').textContent = brand.name + ' — Acceptatiegids';
  document.getElementById('pdf-toggle-btn').style.display = 'flex';
  if (window.innerWidth <= 768) document.getElementById('sidebar').classList.add('collapsed');
  currentPage = 1;
  if (pdfOpen) loadPdf(1);
  const ta = document.getElementById('query');
  ta.disabled = false;
  ta.placeholder = `Stel een vraag over ${brand.name}...`;
  document.getElementById('send-btn').disabled = false;
  ta.focus();
}

// ── PDF panel toggle ───────────────────────────────────────
function togglePdf() {
  pdfOpen = !pdfOpen;
  const panel   = document.getElementById('pdf-panel');
  const sidebar = document.getElementById('sidebar');
  const btn     = document.getElementById('pdf-toggle-btn');
  panel.classList.toggle('open', pdfOpen);
  sidebar.classList.toggle('collapsed', pdfOpen);
  btn.classList.toggle('active', pdfOpen);
  if (pdfOpen) {
    if (activeBrand === '__all__') showAllBrandsPdfPicker();
    else loadPdf(currentPage || 1);
  }
}

// ── Core PDF loader ────────────────────────────────────────
// phrases: optional array of strings to highlight after the PDF loads
function loadPdf(page, brandKey, phrases) {
  const key = brandKey || (activeBrand !== '__all__' ? activeBrand : activePdfBrand);
  if (!key) return;
  const brand = BRANDS[key];
  if (!brand || !brand.pdf_url) return;

  activePdfBrand = key;
  const encoded   = encodeURIComponent(window.location.origin + brand.pdf_url);
  const viewerUrl = `/static/pdfjs/web/viewer.html?file=${encoded}#page=${page || 1}`;
  const wrap      = document.getElementById('pdf-frame-wrap');

  const iframe = document.createElement('iframe');
  iframe.title        = brand.name + ' Acceptatiegids';
  iframe.style.width  = '100%';
  iframe.style.height = '100%';
  iframe.style.border = 'none';

  if (phrases && phrases.length > 0) {
    iframe.addEventListener('load', () => {
      // Wait 800 ms for PDF.js to finish rendering before firing find commands
      setTimeout(() => highlightPhrasesInIframe(iframe, phrases), 800);
    });
  }

  iframe.src = viewerUrl;
  wrap.innerHTML = '';
  wrap.appendChild(iframe);
  document.getElementById('pdf-panel-title').textContent = brand.name + ' — Acceptatiegids';
}

// ── Highlight phrases via PDF.js Find API ──────────────────
// PDF.js (same-origin) exposes PDFViewerApplication inside the iframe.
// We call executeCommand('find', ...) for each phrase so all occurrences
// on the page get a yellow highlight.
function highlightPhrasesInIframe(iframe, phrases) {
  if (!phrases || phrases.length === 0) return;
  try {
    const win = iframe.contentWindow;
    if (!win) return;
    const app = win.PDFViewerApplication;
    if (!app || !app.findController) {
      // Not ready yet — retry once
      setTimeout(() => highlightPhrasesInIframe(iframe, phrases), 1000);
      return;
    }
    // Stagger each phrase by 150 ms so PDF.js doesn't drop events
    phrases.forEach((phrase, i) => {
      setTimeout(() => {
        try {
          app.findController.executeCommand('find', {
            query:         phrase,
            highlightAll:  true,
            caseSensitive: false,
            phraseSearch:  true,
            findPrevious:  false,
          });
        } catch (_) { /* individual phrase failures are silent */ }
      }, i * 150);
    });
  } catch (e) {
    console.warn('Could not access PDF.js iframe:', e);
  }
}

// ── Jump to page + highlight ───────────────────────────────
// Called by every "Pagina X" button.
function jumpToPage(page, brandKey) {
  const key     = brandKey || activeBrand;
  const phrases = currentPhrases[key] || [];
  currentPage   = page;
  if (pdfOpen) {
    loadPdf(page, key, phrases);
  } else {
    pdfOpen = true;
    document.getElementById('pdf-panel').classList.add('open');
    document.getElementById('sidebar').classList.add('collapsed');
    document.getElementById('pdf-toggle-btn').classList.add('active');
    loadPdf(page, key, phrases);
  }
}

// ── Textarea auto-resize ───────────────────────────────────
const textarea = document.getElementById('query');
textarea.addEventListener('input', () => {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
});
textarea.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

// ── Messages ───────────────────────────────────────────────
const chat = document.getElementById('chat');

function extractPages(text) {
  const matches = [...text.matchAll(/[Pp]agina\s*(\d+)/g)];
  return [...new Set(matches.map(m => parseInt(m[1])))].sort((a, b) => a - b);
}

function buildPageButtons(pages, brandKey) {
  if (!pages || pages.length === 0) return '';
  const svgIcon = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
    <polyline points="14 2 14 8 20 8"></polyline>
  </svg>`;
  const bk = brandKey ? `'${brandKey}'` : 'null';
  return `<div class="page-buttons">${
    pages.map(p => `<button class="page-jump-btn" onclick="jumpToPage(${p}, ${bk})">${svgIcon} Pagina ${p}</button>`).join('')
  }</div>`;
}

function addMessage(role, html, brandKey, pages = [], phrases = []) {
  const welcome = document.getElementById('welcome');
  if (welcome) welcome.remove();

  // Store phrases so jumpToPage can retrieve them later
  if (phrases.length > 0 && brandKey) {
    currentPhrases[brandKey] = phrases;
  }

  const div = document.createElement('div');
  div.className = `message ${role}`;

  let pageBtns = '';
  if (role === 'ai') {
    pageBtns = buildPageButtons(pages, brandKey);
    // If PDF already open, auto-jump to first cited page with highlights
    if (pages.length > 0 && pdfOpen) jumpToPage(pages[0], brandKey);
  }

  if (role === 'ai' && brandKey && BRANDS[brandKey]) {
    const b = BRANDS[brandKey];
    div.innerHTML = `
      <div class="brand-tag"><span style="background:${b.color}"></span>${b.name}</div>
      <div class="bubble">${html}${pageBtns}</div>`;
  } else {
    div.innerHTML = `<div class="bubble">${html}</div>`;
  }

  chat.appendChild(div);
  div.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function showTyping() {
  const div = document.createElement('div');
  div.className = 'message ai'; div.id = 'typing';
  div.innerHTML = `<div class="typing"><span></span><span></span><span></span></div>`;
  chat.appendChild(div);
  div.scrollIntoView({ behavior: 'smooth', block: 'end' });
}
function removeTyping() { const t = document.getElementById('typing'); if (t) t.remove(); }

function parseMarkdownTable(block) {
  const lines = block.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2 || !lines[0].trim().startsWith('|')) return null;
  const parseRow = line =>
    line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  const isSep = l => /^[\s|:\-]+$/.test(l);
  if (!isSep(lines[1])) return null;
  const headers = parseRow(lines[0]);
  const rows    = lines.slice(2).map(parseRow);
  const ths = headers.map(h => `<th>${h}</th>`).join('');
  const trs = rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('');
  return `<div class="table-wrap"><table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>`;
}

function formatAnswer(text) {
  const escaped = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return escaped.split(/\n\n+/).map(block => {
    const table = parseMarkdownTable(block);
    if (table) return table;
    if (block.trimStart().startsWith('<')) return block;
    return block
      .replace(/^### (.+)$/gm,'<h3>$1</h3>')
      .replace(/^## (.+)$/gm,'<h2>$1</h2>')
      .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
      .replace(/\*(.+?)\*/g,'<em>$1</em>')
      .replace(/^[•\-] (.+)$/gm,'<li>$1</li>')
      .replace(/(<li>.*<\/li>)/gs,'<ul>$1</ul>')
      .replace(/^---$/gm,'<hr>')
      .replace(/(Pagina\s*\d+[^\n<]*)/g, m => `<span class="source-tag">${m}</span>`)
      .split('\n').map(line => line.startsWith('<') ? line : `<p>${line}</p>`).join('');
  }).join('');
}

// ── All-brands message renderer ────────────────────────────
function addAllBrandsMessage(data) {
  const welcome = document.getElementById('welcome');
  if (welcome) welcome.remove();

  // Store per-brand phrases for jumpToPage
  Object.entries(data.brands || {}).forEach(([key, result]) => {
    if (result.key_phrases && result.key_phrases.length > 0) {
      currentPhrases[key] = result.key_phrases;
    }
  });

  const div = document.createElement('div');
  div.className = 'message ai all-brands-message';

  let html = `<div class="bubble all-brands-bubble">
    <div class="all-brands-header">
      <span class="all-brands-icon">🔍</span>
      <span class="all-brands-title">Vergelijking — alle merken</span>
    </div>
    <div class="all-brands-synthesis">${formatAnswer(data.synthesis)}</div>
    <div class="brand-details">`;

  Object.entries(BRANDS).forEach(([key, brand]) => {
    const result = data.brands[key];
    if (!result) return;
    const pages  = result.pages || [];
    const pageBtns = pages.map(p =>
      `<button class="page-jump-btn" onclick="jumpToPage(${p}, '${key}')">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
        </svg>Pagina ${p}</button>`
    ).join('');
    html += `
      <details class="brand-detail-item">
        <summary class="brand-detail-summary" style="--brand-color:${brand.color}">
          <span class="brand-detail-dot" style="background:${brand.color}"></span>
          <span>${brand.icon} ${brand.name}</span>
          <svg class="chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </summary>
        <div class="brand-detail-body">
          ${formatAnswer(result.answer)}
          ${pages.length ? `<div class="page-buttons">${pageBtns}</div>` : ''}
        </div>
      </details>`;
  });

  html += `</div></div>`;
  div.innerHTML = html;
  chat.appendChild(div);
  div.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

// ── Send message ───────────────────────────────────────────
async function sendMessage() {
  if (!activeBrand) return;
  const q = textarea.value.trim();
  if (!q) return;
  textarea.value = ''; textarea.style.height = 'auto';
  document.getElementById('send-btn').disabled = true;
  const brandAtSend = activeBrand;
  addMessage('user', q.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'));
  showTyping();
  try {
    if (brandAtSend === '__all__') {
      const res  = await fetch('/ask-all', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      });
      const data = await res.json();
      removeTyping();
      if (data.error) addMessage('ai', `<em>${data.error}</em>`);
      else addAllBrandsMessage(data);
    } else {
      const res  = await fetch('/ask', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, brand: brandAtSend }),
      });
      const data = await res.json();
      removeTyping();
      const pages   = data.pages && data.pages.length ? data.pages : extractPages(data.answer);
      const phrases = data.key_phrases || [];
      addMessage('ai', formatAnswer(data.answer), brandAtSend, pages, phrases);
    }
  } catch (err) {
    removeTyping();
    addMessage('ai', '<em>Er is een fout opgetreden. Probeer het opnieuw.</em>');
  } finally {
    document.getElementById('send-btn').disabled = false;
    textarea.focus();
  }
}

// ── Tooltip positioning ────────────────────────────────────
document.querySelectorAll('.brand-item').forEach(item => {
  item.addEventListener('mouseenter', () => {
    const tooltip = item.querySelector('.brand-tooltip');
    if (!tooltip) return;
    const rect = item.getBoundingClientRect();
    tooltip.style.top = (rect.top + rect.height / 2 - 14) + 'px';
  });
});
