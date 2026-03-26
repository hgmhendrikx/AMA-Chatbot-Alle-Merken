/* Hypotheek Acceptatie Assistent — main.js
   BRANDS is injected by the template as a global variable. */

let activeBrand = null;
let pdfOpen     = false;
let currentPage = null;

// ── Build sidebar ──────────────────────────────────────────
const brandList = document.getElementById('brand-list');
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

// ── Select brand ───────────────────────────────────────────
function selectBrand(key) {
  activeBrand = key;
  const brand = BRANDS[key];

  document.querySelectorAll('.brand-item').forEach(el => {
    const b = BRANDS[el.dataset.key];
    el.style.setProperty('--brand-accent', b.accent);
    el.classList.toggle('active', el.dataset.key === key);
  });

  document.getElementById('header').style.background = brand.color;
  document.documentElement.style.setProperty('--accent',  brand.color);
  document.documentElement.style.setProperty('--accent2', brand.accent);
  document.getElementById('header-icon').textContent    = brand.icon;
  document.getElementById('header-title').textContent   = brand.name;
  document.getElementById('header-sub').textContent     = 'Acceptatiegids assistent';
  document.getElementById('pdf-panel-title').textContent = brand.name + ' — Acceptatiegids';

  // Show PDF button
  const pdfBtn = document.getElementById('pdf-toggle-btn');
  pdfBtn.style.display = 'flex';

  // On mobile: collapse sidebar after selecting a brand
  if (window.innerWidth <= 768) {
    document.getElementById('sidebar').classList.add('collapsed');
  }

  // Reset PDF panel to first page of new brand
  currentPage = 1;
  if (pdfOpen) loadPdf(1);

  // Enable input
  const ta = document.getElementById('query');
  ta.disabled = false;
  ta.placeholder = `Stel een vraag over ${brand.name}...`;
  document.getElementById('send-btn').disabled = false;
  ta.focus();
}

// ── PDF panel ──────────────────────────────────────────────
function togglePdf() {
  pdfOpen = !pdfOpen;
  const panel   = document.getElementById('pdf-panel');
  const sidebar = document.getElementById('sidebar');
  const btn     = document.getElementById('pdf-toggle-btn');

  panel.classList.toggle('open', pdfOpen);
  sidebar.classList.toggle('collapsed', pdfOpen);
  btn.classList.toggle('active', pdfOpen);

  if (pdfOpen && activeBrand) {
    loadPdf(currentPage || 1);
  }
}

function loadPdf(page) {
  if (!activeBrand) return;
  const brand = BRANDS[activeBrand];
  const url   = brand.pdf_url + '#page=' + (page || 1) + '&zoom=75&pagemode=none&navpanes=0&toolbar=1';
  const wrap  = document.getElementById('pdf-frame-wrap');
  wrap.innerHTML = `<iframe src="${url}" title="${brand.name} Acceptatiegids" sandbox="allow-same-origin allow-scripts allow-popups"></iframe>`;
}

function jumpToPage(page) {
  currentPage = page;
  if (pdfOpen) {
    loadPdf(page);
  } else {
    // Auto-open panel and jump
    pdfOpen = true;
    document.getElementById('pdf-panel').classList.add('open');
    document.getElementById('sidebar').classList.add('collapsed');
    document.getElementById('pdf-toggle-btn').classList.add('active');
    loadPdf(page);
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
  // Collect all unique page numbers mentioned in the answer text
  const matches = [...text.matchAll(/[Pp]agina\s*(\d+)/g)];
  const pages = [...new Set(matches.map(m => parseInt(m[1])))].sort((a, b) => a - b);
  return pages;
}

function buildPageButtons(pages) {
  if (!pages || pages.length === 0) return '';
  const svgIcon = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
    <polyline points="14 2 14 8 20 8"></polyline>
  </svg>`;
  const buttons = pages.map(p =>
    `<button class="page-jump-btn" onclick="jumpToPage(${p})">${svgIcon} Pagina ${p}</button>`
  ).join('');
  return `<div class="page-buttons">${buttons}</div>`;
}

function addMessage(role, html, brandKey, pages = []) {
  const welcome = document.getElementById('welcome');
  if (welcome) welcome.remove();

  const div = document.createElement('div');
  div.className = `message ${role}`;

  let pageBtns = '';
  if (role === 'ai') {
    pageBtns = buildPageButtons(pages);

    // Auto-jump to first referenced page if PDF is open
    if (pages.length > 0 && pdfOpen) {
      jumpToPage(pages[0]);
    }
  }

  if (role === 'ai' && brandKey) {
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

function formatAnswer(text) {
  return text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/^### (.+)$/gm,'<h3>$1</h3>').replace(/^## (.+)$/gm,'<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/^[•\-] (.+)$/gm,'<li>$1</li>').replace(/(<li>.*<\/li>)/gs,'<ul>$1</ul>')
    .replace(/^---$/gm,'<hr>')
    .replace(/(Pagina\s*\d+[^\n<]*)/g, match => `<span class="source-tag">${match}</span>`)
    .split(/\n\n+/).map(p => p.startsWith('<') ? p : `<p>${p.replace(/\n/g,'<br>')}</p>`).join('');
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
    const res  = await fetch('/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q, brand: brandAtSend }),
    });
    const data = await res.json();
    removeTyping();
    const pages = extractPages(data.answer);
    addMessage('ai', formatAnswer(data.answer), brandAtSend, pages);
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
