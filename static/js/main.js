/* Hypotheek Acceptatie Assistent — main.js
   BRANDS is injected by the template as a global variable. */

let activeBrand    = null;
let activePdfBrand = null;  // tracks which brand PDF is shown (relevant in all-brands mode)
let pdfOpen        = false;
let currentPage    = null;

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

// "Alle merken" item at the top
const allEl = document.createElement('div');
allEl.className = 'brand-item';
allEl.dataset.key = '__all__';
allEl.innerHTML = `
  <div class="brand-icon">🔍</div>
  <span class="brand-name">Alle merken</span>
  <span class="brand-tooltip">Alle merken</span>`;
allEl.onclick = () => selectAllBrands();
brandList.appendChild(allEl);

// Divider
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

  // Neutral dark header for all-brands mode
  const allColor  = '#2D2D44';
  const allAccent = '#7B68EE';
  document.getElementById('header').style.background = allColor;
  document.documentElement.style.setProperty('--accent',  allColor);
  document.documentElement.style.setProperty('--accent2', allAccent);
  document.getElementById('header-icon').textContent    = '🔍';
  document.getElementById('header-title').textContent   = 'Alle merken';
  document.getElementById('header-sub').textContent     = 'Vergelijk acceptatiebeleid over alle geldverstrekkers';

  // Show PDF button — in all-brands mode it opens a brand picker
  const pdfBtn = document.getElementById('pdf-toggle-btn');
  pdfBtn.style.display = 'flex';
  pdfBtn.classList.remove('active');

  // Reset PDF panel to brand-picker mode
  showAllBrandsPdfPicker();

  if (window.innerWidth <= 768) {
    document.getElementById('sidebar').classList.add('collapsed');
  }

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

  if (pdfOpen) {
    if (activeBrand === '__all__') {
      showAllBrandsPdfPicker();
    } else {
      loadPdf(currentPage || 1);
    }
  }
}

function loadPdf(page, brandKey) {
  // In all-brands mode, use the explicitly passed brandKey or fall back to activePdfBrand
  const key = brandKey || (activeBrand !== '__all__' ? activeBrand : activePdfBrand);
  if (!key) return;
  const brand = BRANDS[key];
  if (!brand || !brand.pdf_url) return;

  activePdfBrand = key;
  const url  = brand.pdf_url + '#page=' + (page || 1) + '&zoom=75&pagemode=none&navpanes=0&toolbar=1';
  const wrap = document.getElementById('pdf-frame-wrap');
  wrap.innerHTML = `<iframe src="${url}" title="${brand.name} Acceptatiegids"></iframe>`;
  document.getElementById('pdf-panel-title').textContent = brand.name + ' — Acceptatiegids';
}

function jumpToPage(page, brandKey) {
  currentPage = page;
  if (pdfOpen) {
    loadPdf(page, brandKey);
  } else {
    pdfOpen = true;
    document.getElementById('pdf-panel').classList.add('open');
    document.getElementById('sidebar').classList.add('collapsed');
    document.getElementById('pdf-toggle-btn').classList.add('active');
    loadPdf(page, brandKey);
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

function parseMarkdownTable(block) {
  const lines = block.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) return null;
  // Check it looks like a table (starts and ends with |)
  if (!lines[0].trim().startsWith('|')) return null;

  const parseRow = line =>
    line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());

  const headers = parseRow(lines[0]);
  // lines[1] should be the separator row (---|---|...)
  const isSep = l => /^[\s|:\-]+$/.test(l);
  if (!isSep(lines[1])) return null;

  const rows = lines.slice(2).map(parseRow);

  const ths = headers.map(h => `<th>${h}</th>`).join('');
  const trs = rows.map(r =>
    `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`
  ).join('');

  return `<div class="table-wrap"><table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>`;
}

function formatAnswer(text) {
  // HTML-escape first
  const escaped = text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // Split into blocks and process each
  const blocks = escaped.split(/\n\n+/);
  const processed = blocks.map(block => {
    // Table block
    const table = parseMarkdownTable(block);
    if (table) return table;

    // Already an HTML tag
    if (block.trimStart().startsWith('<')) return block;

    // Apply inline formatting line by line
    return block
      .replace(/^### (.+)$/gm,'<h3>$1</h3>')
      .replace(/^## (.+)$/gm,'<h2>$1</h2>')
      .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
      .replace(/\*(.+?)\*/g,'<em>$1</em>')
      .replace(/^[•\-] (.+)$/gm,'<li>$1</li>')
      .replace(/(<li>.*<\/li>)/gs,'<ul>$1</ul>')
      .replace(/^---$/gm,'<hr>')
      .replace(/(Pagina\s*\d+[^\n<]*)/g, match => `<span class="source-tag">${match}</span>`)
      .split('\n').map(line => line.startsWith('<') ? line : `<p>${line}</p>`).join('');
  });

  return processed.join('');
}

// ── All-brands message renderer ────────────────────────────
function addAllBrandsMessage(data) {
  const welcome = document.getElementById('welcome');
  if (welcome) welcome.remove();

  const div = document.createElement('div');
  div.className = 'message ai all-brands-message';

  // Synthesis block
  let html = `<div class="bubble all-brands-bubble">
    <div class="all-brands-header">
      <span class="all-brands-icon">🔍</span>
      <span class="all-brands-title">Vergelijking — alle merken</span>
    </div>
    <div class="all-brands-synthesis">${formatAnswer(data.synthesis)}</div>`;

  // Per-brand detail accordion
  html += `<div class="brand-details">`;
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      });
      const data = await res.json();
      removeTyping();
      if (data.error) {
        addMessage('ai', `<em>${data.error}</em>`);
      } else {
        addAllBrandsMessage(data);
      }
    } else {
      const res  = await fetch('/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, brand: brandAtSend }),
      });
      const data = await res.json();
      removeTyping();
      const pages = data.pages && data.pages.length ? data.pages : extractPages(data.answer);
      addMessage('ai', formatAnswer(data.answer), brandAtSend, pages);
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
