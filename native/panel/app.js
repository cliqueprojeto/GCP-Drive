'use strict';
// The panel of the GCP-Drive service. Everything shown comes from the service; names of files and
// accounts are always written as text, never as markup.
const token = location.hash.slice(1);
const $ = (id) => document.getElementById(id);

async function api(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-GCP-Drive-Token': token },
    body: JSON.stringify(body || {}),
  });
  if (!response.ok) throw new Error('Abra o painel pelo ícone do GCP-Drive ao lado do relógio.');
  const reply = await response.json();
  if (reply.Err) throw new Error(reply.Err);
  return reply.Out;
}
const call = (...args) => api('/api/call', { Args: args });

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (key === 'class') node.className = value;
    else if (key === 'onclick') node.addEventListener('click', value);
    else node.setAttribute(key, value);
  }
  for (const child of children) if (child != null) node.append(child);
  return node;
}

function size(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Number(bytes) || 0, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return value.toLocaleString('pt-BR', { maximumFractionDigits: value < 10 && unit > 0 ? 1 : 0 }) + ' ' + units[unit];
}

function notice(text) {
  $('notice').textContent = text || '';
  $('notice').hidden = !text;
}

function ask(title, text, yes) {
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = text;
  $('confirm-yes').textContent = yes;
  const dialog = $('confirm');
  dialog.returnValue = 'no';
  dialog.showModal();
  return new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'yes'), { once: true }));
}

async function act(run) {
  try { notice(''); await run(); } catch (err) { notice(err.message); }
  refresh();
}

function state(account) {
  if (account.Problem) return ['bad', 'Com problema'];
  if (!account.Mounted) return ['bad', 'Pasta indisponível'];
  if (account.Paused) return ['idle', 'Pausada'];
  if (account.Uploads && account.Uploads.length) return ['busy', 'Enviando'];
  if (account.Pending) return ['busy', 'Aguardando envio'];
  if (account.Downloads) return ['busy', 'Baixando'];
  if (!account.Mapped) return ['busy', 'Mapeando a conta'];
  return ['ok', 'Sincronizada'];
}

const extras = {}; // per account: quota and storage, refreshed now and then

function card(account) {
  const [kind, label] = state(account);
  const extra = extras[account.ID] || {};
  const stat = (name, value) => el('div', { class: 'stat' }, el('span', { class: 'muted' }, name), el('b', null, value));
  const node = el('article', { class: 'card' },
    el('div', { class: 'head' },
      el('div', null, el('h2', null, account.Email), el('span', { class: 'muted' }, account.Name || '')),
      el('span', { class: 'chip ' + kind }, label)),
    account.Problem ? el('p', { class: 'problem' }, account.Problem) : null,
    account.FileProblem ? el('p', { class: 'problem' }, 'Envio com falha: ' + account.FileProblem) : null,
    el('div', { class: 'stats' },
      stat('Itens no mapa', account.Items.toLocaleString('pt-BR') + (account.Mapped ? '' : ' …')),
      stat('Fila de envio', String(account.Pending)),
      stat('Cache de leitura', size(account.CacheBytes) + ' de ' + size(account.CacheLimit)),
      stat('Mantidos off-line', String(account.Offline)),
      extra.quota ? stat('Uso no Google', extra.quota.Limit ? size(extra.quota.Usage) + ' de ' + size(extra.quota.Limit) : size(extra.quota.Usage)) : null));
  if (account.Uploads && account.Uploads.length) {
    node.append(el('h3', null, 'Enviando agora'), el('ul', null, ...account.Uploads.map((upload) =>
      el('li', null, el('span', { class: 'name' }, upload.Name), el('span', { class: 'muted' }, size(upload.Done) + ' de ' + size(upload.Total)),
        el('progress', { max: String(upload.Total || 1), value: String(upload.Done) })))));
  }
  const recent = (account.Activity || []).slice(0, 8);
  if (recent.length) {
    node.append(el('h3', null, 'Atividade recente'), el('ul', null, ...recent.map((item) =>
      el('li', null, el('span', { class: 'name' }, item.Action + ': ' + item.Name),
        el('span', { class: item.Status === 'Falhou' ? 'failed' : 'muted' }, item.Status),
        item.Detail ? el('span', { class: 'detail' }, item.Detail) : null))));
  }
  node.append(el('div', { class: 'actions' },
    el('button', { onclick: () => act(() => api('/api/open', { ID: account.ID })) }, 'Abrir pasta'),
    el('button', { onclick: () => act(() => call('pause', account.ID, account.Paused ? 'off' : 'on')) }, account.Paused ? 'Retomar' : 'Pausar'),
    el('button', { onclick: () => act(async () => {
      if (await ask('Limpar o cache de leitura?', 'Os blocos baixados desta conta são apagados deste computador. Nada muda no Google Drive nem nos arquivos da pasta.', 'Limpar cache')) await call('clear-cache', account.ID);
    }) }, 'Limpar cache'),
    el('button', { onclick: () => act(async () => {
      if (await ask('Desconectar ' + account.Email + '?', 'A pasta desta conta sai deste computador e o GCP-Drive deixa de ter acesso a ela. Nada é apagado no Google Drive. Se houver arquivos ainda não enviados, a desconexão é recusada.', 'Desconectar')) await call('disconnect', account.ID);
    }) }, 'Desconectar')));
  return node;
}

let shown = '';
async function refresh() {
  let accounts;
  try { accounts = await call('status'); } catch (err) { notice(err.message); return; }
  const first = accounts[0] || { Down: 0, Up: 0 };
  $('down').textContent = size(first.Down) + '/s';
  $('up').textContent = size(first.Up) + '/s';
  const text = JSON.stringify([accounts.map((a) => ({ ...a, Down: 0, Up: 0 })), extras]);
  if (text === shown) return;
  shown = text;
  const list = $('accounts');
  list.replaceChildren(...accounts.map(card));
  if (!accounts.length) {
    list.append(el('div', { class: 'card empty' }, el('h2', null, 'Nenhuma conta conectada'),
      el('p', { class: 'muted' }, 'Use “Adicionar conta” para entrar com uma conta do Google. Cada conta vira uma pasta dentro de GCP-Drive.')));
  }
}

async function refreshExtras() {
  let accounts;
  try { accounts = await call('status'); } catch { return; }
  for (const account of accounts) {
    try { extras[account.ID] = { quota: await call('quota', account.ID) }; } catch { /* shown without it */ }
  }
  refresh();
}

async function loadSettings() {
  const form = $('settings');
  try {
    const settings = await call('settings');
    for (const name of ['DownKBps', 'UpKBps', 'CacheGB']) form.elements[name].value = settings[name];
    form.elements.Premap.checked = settings.Premap;
    $('version').textContent = 'versão ' + settings.Version;
  } catch (err) { notice(err.message); }
}

$('settings').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.target;
  const number = (name) => Math.max(0, Math.round(Number(form.elements[name].value) || 0));
  act(async () => {
    await call('settings', JSON.stringify({ DownKBps: number('DownKBps'), UpKBps: number('UpKBps'), CacheGB: Math.max(1, number('CacheGB')), Premap: form.elements.Premap.checked }));
    $('saved').textContent = 'Configurações salvas.';
    setTimeout(() => { $('saved').textContent = ''; }, 4000);
    await loadSettings();
  });
});

$('add').addEventListener('click', () => {
  const button = $('add');
  button.disabled = true;
  notice('Conclua a autorização na janela do navegador que acabou de abrir.');
  api('/api/login').then(() => notice(''), (err) => notice(err.message)).finally(() => { button.disabled = false; refresh(); refreshExtras(); });
});
$('open-root').addEventListener('click', () => act(() => api('/api/open', {})));

loadSettings();
refresh();
refreshExtras();
setInterval(refresh, 1000);
setInterval(refreshExtras, 60000);
