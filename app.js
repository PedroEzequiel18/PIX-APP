const state = { entries: [], filter: 'todos', draft: null, appPassword: '' };

function authHeaders() {
  return state.appPassword ? { 'x-app-password': state.appPassword } : {};
}

function formatBRL(n) {
  return (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  if (sameDay(date, today)) return 'Hoje';
  if (sameDay(date, yest)) return 'Ontem';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', weekday: 'long' });
}

// --- boot / login ---
async function boot() {
  const cfg = await fetch('/api/config').then(r => r.json());
  if (cfg.passwordRequired && !sessionStorage.getItem('appPassword')) {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
  } else {
    state.appPassword = sessionStorage.getItem('appPassword') || '';
    startApp();
  }
}

document.getElementById('login-btn').addEventListener('click', async () => {
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  try {
    const res = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) { errEl.textContent = data.error || 'Senha incorreta.'; return; }
    sessionStorage.setItem('appPassword', password);
    state.appPassword = password;
    document.getElementById('login-screen').classList.add('hidden');
    startApp();
  } catch (e) {
    errEl.textContent = 'Erro ao conectar ao servidor.';
  }
});

async function startApp() {
  document.getElementById('app').classList.remove('hidden');
  await loadEntries();
  render();
}

// --- data ---
async function loadEntries() {
  const res = await fetch('/api/entries', { headers: authHeaders() });
  if (res.ok) state.entries = await res.json();
}

async function saveEntry(entry) {
  const res = await fetch('/api/entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(entry)
  });
  if (res.ok) { await loadEntries(); render(); }
}

async function deleteEntry(id) {
  await fetch(`/api/entries/${id}`, { method: 'DELETE', headers: authHeaders() });
  await loadEntries();
  render();
}

// --- render ---
function render() {
  const visible = state.filter === 'todos' ? state.entries : state.entries.filter(e => e.category === state.filter);
  const totalRecebido = visible.reduce((s, e) => s + (e.type === 'recebido' ? e.amount : 0), 0);
  const totalEnviado = visible.reduce((s, e) => s + (e.type === 'enviado' ? e.amount : 0), 0);
  const saldo = totalRecebido - totalEnviado;

  document.getElementById('saldo').textContent = formatBRL(saldo);
  document.getElementById('saldo').classList.toggle('negative', saldo < 0);
  document.getElementById('total-recebido').textContent = formatBRL(totalRecebido);
  document.getElementById('total-enviado').textContent = formatBRL(totalEnviado);

  document.querySelectorAll('.filter-chip').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === state.filter);
  });

  const grouped = visible.reduce((acc, e) => { (acc[e.date] = acc[e.date] || []).push(e); return acc; }, {});
  const dateKeys = Object.keys(grouped).sort((a, b) => (a < b ? 1 : -1));
  const list = document.getElementById('list');

  if (dateKeys.length === 0) {
    list.innerHTML = `<div class="empty-state">Nenhuma movimentação ainda.<br>Toque em um dos botões abaixo para registrar seu primeiro Pix do dia.</div>`;
    return;
  }

  list.innerHTML = dateKeys.map(date => `
    <div class="date-group">
      <div class="date-label">${formatDateLabel(date)}</div>
      <div class="receipt-list">
        ${grouped[date].map(e => `
          <div class="receipt">
            <div class="receipt-top">
              <div class="receipt-left">
                <span class="receipt-arrow">${e.type === 'recebido' ? '↙' : '↗'}</span>
                <div>
                  <div class="receipt-desc">${escapeHtml(e.description) || (e.type === 'recebido' ? 'Recebido via Pix' : 'Enviado via Pix')}</div>
                  <div class="receipt-meta">
                    <span class="receipt-time">${e.time || ''}</span>
                    <span class="receipt-cat">${e.category === 'empresarial' ? '💼 Empresarial' : '👤 Pessoal'}</span>
                  </div>
                </div>
              </div>
              <div class="receipt-right">
                <div class="amt receipt-amount ${e.type === 'recebido' ? 'in' : 'out'}">${e.type === 'recebido' ? '+' : '-'} ${formatBRL(e.amount)}</div>
                <button class="receipt-delete" data-id="${e.id}" aria-label="Excluir">🗑</button>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.receipt-delete').forEach(btn => {
    btn.addEventListener('click', () => deleteEntry(btn.dataset.id));
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// --- filtros ---
document.getElementById('filters').addEventListener('click', (e) => {
  const btn = e.target.closest('.filter-chip');
  if (!btn) return;
  state.filter = btn.dataset.filter;
  render();
});

// --- painel / modal ---
const overlay = document.getElementById('overlay');
const uploadZone = document.getElementById('upload-zone');
const draftForm = document.getElementById('draft-form');

function openPanel(mode) {
  overlay.classList.remove('hidden');
  document.getElementById('panel-title').textContent = mode === 'upload' ? 'Anexar comprovante' : 'Nova movimentação';
  document.getElementById('extract-error').classList.add('hidden');
  if (mode === 'upload') {
    uploadZone.classList.remove('hidden');
    draftForm.classList.add('hidden');
    document.getElementById('file-input').value = '';
    resetUploadLabel();
  } else {
    uploadZone.classList.add('hidden');
    draftForm.classList.remove('hidden');
    setDraft({ type: 'recebido', category: 'pessoal', amount: '', description: '', date: todayISO() });
  }
}

function closePanel() {
  overlay.classList.add('hidden');
  state.draft = null;
}

document.getElementById('btn-upload').addEventListener('click', () => openPanel('upload'));
document.getElementById('btn-manual').addEventListener('click', () => openPanel('manual'));
document.getElementById('panel-close').addEventListener('click', closePanel);
overlay.addEventListener('click', (e) => { if (e.target === overlay) closePanel(); });

function resetUploadLabel() {
  document.getElementById('upload-icon').textContent = '📷';
  document.getElementById('upload-text').textContent = 'Toque para escolher o print do comprovante';
}

document.getElementById('file-input').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  document.getElementById('upload-icon').textContent = '⏳';
  document.getElementById('upload-text').textContent = 'Lendo o comprovante...';

  try {
    const base64 = await fileToBase64(file);
    const res = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ imageBase64: base64, mediaType: file.type || 'image/jpeg' })
    });
    const parsed = await res.json();
    if (!res.ok) throw new Error(parsed.error || 'Falha ao extrair dados.');

    uploadZone.classList.add('hidden');
    draftForm.classList.remove('hidden');
    setDraft({
      type: parsed.type === 'enviado' ? 'enviado' : 'recebido',
      category: parsed.category === 'empresarial' ? 'empresarial' : 'pessoal',
      amount: parsed.amount != null ? String(parsed.amount) : '',
      description: parsed.description || '',
      date: /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : todayISO()
    });
  } catch (err) {
    console.error(err);
    uploadZone.classList.add('hidden');
    draftForm.classList.remove('hidden');
    document.getElementById('extract-error').classList.remove('hidden');
    document.getElementById('extract-error').textContent = 'Não consegui ler o print automaticamente. Confira ou digite os dados manualmente abaixo.';
    setDraft({ type: 'recebido', category: 'pessoal', amount: '', description: '', date: todayISO() });
  }
});

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(',')[1]);
    r.onerror = () => reject(new Error('Falha ao ler o arquivo'));
    r.readAsDataURL(file);
  });
}

function setDraft(draft) {
  state.draft = draft;
  document.querySelectorAll('#type-row .toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.type === draft.type));
  document.querySelectorAll('#category-row .toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.category === draft.category));
  document.getElementById('field-amount').value = draft.amount;
  document.getElementById('field-description').value = draft.description;
  document.getElementById('field-date').value = draft.date;
  updateSaveState();
}

document.getElementById('type-row').addEventListener('click', (e) => {
  const btn = e.target.closest('.toggle-btn');
  if (!btn || !state.draft) return;
  state.draft.type = btn.dataset.type;
  setDraft(state.draft);
});

document.getElementById('category-row').addEventListener('click', (e) => {
  const btn = e.target.closest('.toggle-btn');
  if (!btn || !state.draft) return;
  state.draft.category = btn.dataset.category;
  setDraft(state.draft);
});

['field-amount', 'field-description', 'field-date'].forEach(id => {
  document.getElementById(id).addEventListener('input', (e) => {
    if (!state.draft) return;
    const key = id.replace('field-', '');
    state.draft[key] = e.target.value;
    updateSaveState();
  });
});

function updateSaveState() {
  const valid = state.draft && state.draft.amount && Number(state.draft.amount) > 0;
  document.getElementById('btn-save').disabled = !valid;
}

document.getElementById('btn-save').addEventListener('click', async () => {
  if (!state.draft || !state.draft.amount || Number(state.draft.amount) <= 0) return;
  await saveEntry({
    type: state.draft.type,
    category: state.draft.category,
    amount: Number(state.draft.amount),
    description: (state.draft.description || '').trim(),
    date: state.draft.date
  });
  closePanel();
});

boot();
