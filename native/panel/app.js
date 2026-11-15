'use strict';
// The panel of the GCP-Drive service on Windows. Its pages and texts follow the Linux interface
// (native/ui/opengdrive-ui); everything shown comes from the service.

const SUPPORT_STRIPE = 'https://donate.stripe.com/fZu4gzeBSfhbd7451F6Ri00';
const SUPPORT_PIX = '00020126850014br.gov.bcb.pix0136e474b71b-7491-4eac-992f-632652e5a4eb' +
  '0223DEV GESTAO CULTURAL PRO5204000053039865802BR5915BRUNO ALBERTINI' +
  '6006BRASIL62200516ChromeExtensions63042B27';

const view = {
  rows: [], error: '', selected: '', page: 'home', settings: null, autostart: null, version: '',
  registered: true, loginPending: false, storage: null, quota: null, search: null, live: {}, shown: '',
};
try { view.selected = localStorage.getItem('account') || ''; } catch { /* per-viewer convenience only */ }

const current = () => view.rows.find((r) => r.ID === view.selected);

function stateOf(row) {
  if (row.Problem) return ['Precisa de atenção', 'warn'];
  if (row.Paused) return ['Pausada', 'idle'];
  if (!row.Mounted) return ['Montando…', 'idle'];
  if ((row.Uploads && row.Uploads.length) || row.Pending) return ['Enviando alterações', 'busy'];
  if (row.Downloads) return ['Baixando', 'busy'];
  return ['Tudo em dia', 'ok'];
}
const chip = (row) => { const [text, kind] = stateOf(row); return el('span', { class: 'chip ' + kind, text }); };

function problems() {
  const list = view.error ? [view.error] : [];
  for (const row of view.rows) for (const text of [row.Problem, row.FileProblem]) if (text) list.push(row.Email + ' · ' + text);
  return list;
}

function mapText(row) {
  const count = row.Items.toLocaleString('pt-BR');
  return row.Mapped ? 'Mapa de pastas completo · ' + count + ' itens. As pastas abrem na hora.'
    : 'Mapeando as pastas da conta… ' + count + ' itens até agora. Você já pode usar a unidade.';
}

function card(heading, description, extraClass) {
  const box = el('section', { class: 'card' + (extraClass ? ' ' + extraClass : '') }, el('h2', { text: heading }));
  if (description) box.append(el('p', { class: 'muted', text: description }));
  return box;
}
function button(text, onclick, kind, iconName) {
  return el('button', { class: kind || 'pill', onclick }, iconName ? icon(iconName) : null, text);
}
const linkButton = (text, onclick) => button(text, onclick, 'link');

async function act(run, refreshAfter = true) {
  try { await run(); } catch (err) { notice(err.message, true); }
  if (refreshAfter) refresh(true);
}

function ask(title, text, yes) {
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = text;
  $('confirm-yes').textContent = yes || 'Continuar';
  const dialog = $('confirm');
  dialog.returnValue = 'no';
  dialog.showModal();
  return new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'yes'), { once: true }));
}

function show(page) {
  view.page = page;
  view.storage = view.quota = null;
  $('menu').hidden = true;
  $('more').classList.remove('open');
  render();
  const active = current();
  if (page === 'storage' && active) loadStorage(active.ID);
  if (page === 'preferences' || page === 'about') loadSettings();
}

function select(id) {
  view.selected = id;
  try { localStorage.setItem('account', id); } catch { /* ignored */ }
}

// Actions shared by the pages

function openDrive() {
  const active = current();
  if (!active) return show('accounts');
  if (!active.Mounted) return notice(active.Problem || 'Aguarde a montagem da conta.', true);
  act(() => api('/api/open', { ID: active.ID }), false);
}

function upload() {
  if (!current()) return show('accounts');
  $('upload-file').click();
}
$('upload-file').addEventListener('change', () => {
  const file = $('upload-file').files[0];
  const active = current();
  $('upload-file').value = '';
  if (!file || !active) return;
  notice('Copiando “' + file.name + '” para Meu Drive…');
  act(async () => {
    await api('/api/upload', file, { 'Content-Type': 'application/octet-stream', 'X-GCP-Drive-Account': active.ID, 'X-GCP-Drive-Name': encodeURIComponent(file.name) });
    notice('“' + file.name + '” está na fila de envio para Meu Drive.');
  });
});

function openWeb() {
  const active = current();
  if (active) act(() => api('/api/web', { ID: active.ID }), false);
}

function addAccount() {
  if (view.loginPending) return;
  if (!view.registered) {
    notice('Falta o cadastro no Google. Escolha o arquivo do cadastro para conectar uma conta.', true);
    return show('accounts');
  }
  view.loginPending = true;
  render();
  notice('Conclua a autorização na janela do navegador que acabou de abrir.');
  api('/api/login').then(() => notice('Conta conectada.'), (err) => notice(err.message, true))
    .finally(() => { view.loginPending = false; refresh(true); });
}
const addAccountButton = (iconName) => {
  const item = button(view.loginPending ? 'Aguardando autorização no navegador…' : 'Conectar conta do Google', addAccount, 'primary', iconName);
  item.disabled = view.loginPending;
  return item;
};

function disconnect(row) {
  act(async () => {
    if (await ask('Desconectar a conta?', row.Email + '\nA pasta desta conta sai deste computador e o GCP-Drive deixa de ter acesso a ela. Nada é apagado no Google Drive. Se houver arquivos ainda não enviados, a desconexão é recusada.', 'Desconectar')) {
      await call('disconnect', row.ID);
    }
  });
}

// Pages

function home(active, surface) {
  if (!active) {
    const hero = card('Bem-vindo ao GCP-Drive', 'Conecte a sua conta do Google. O Drive aparece como uma pasta do computador, e os arquivos são baixados só quando você abre.', 'hero');
    hero.append(el('div', { class: 'row-actions' }, addAccountButton('plus')));
    surface.append(hero);
    if (!view.registered) surface.append(registrationCard());
    return;
  }
  const hero = card(active.Name || active.Email, active.Email, 'hero');
  hero.append(chip(active));
  const stat = (key, title, value) => {
    const number = el('b', { text: value });
    if (key) view.live[key] = number;
    return el('div', { class: 'stat' }, number, el('span', { class: 'muted', text: title }));
  };
  hero.append(el('div', { class: 'stats' }, stat('down', 'Download', '0 bytes/s'), stat('up', 'Envio', '0 bytes/s'), stat(null, 'Aguardando envio', String(active.Pending))));
  hero.append(el('div', { class: 'row-actions' },
    button('Abrir pasta do Drive', openDrive, 'primary', 'folder'),
    button('Enviar arquivo', upload, 'pill', 'send'),
    button('Abrir na Web', openWeb, 'pill', 'globe')));
  surface.append(hero);

  const left = el('div'), right = el('div');
  surface.append(el('div', { class: 'columns' }, left, right));
  const files = card('Pastas e arquivos');
  view.live.map = el('p', { class: 'muted' });
  view.live.cache = el('progress', { max: '1', value: '0' });
  view.live.cacheText = el('p', { class: 'muted' });
  files.append(view.live.map, view.live.cache, view.live.cacheText);
  if (active.Offline) files.append(el('p', { class: 'muted', text: active.Offline + ' item(ns) marcados para ficar off-line' }));
  files.append(linkButton('Gerenciar espaço', () => show('storage')));
  left.append(files);

  const transfers = card('Transferências agora');
  view.live.uploads = {};
  for (const item of active.Uploads || []) {
    const bar = el('progress', { max: '1', value: '0' });
    transfers.append(el('p', { text: 'Enviando · ' + item.Name }), bar);
    view.live.uploads[item.Name] = bar;
  }
  if (active.Downloads) transfers.append(el('p', { class: 'muted', text: 'Baixando do Drive os arquivos abertos…' }));
  if (!(active.Uploads && active.Uploads.length) && !active.Downloads) transfers.append(el('p', { class: 'muted', text: 'Nenhuma transferência em andamento.' }));
  transfers.append(linkButton('Ver atividade', () => show('activity')));
  right.append(transfers);

  const errors = problems();
  if (errors.length) {
    const attention = card('Precisa de atenção');
    for (const text of errors.slice(0, 3)) attention.append(el('p', { class: 'muted', text }));
    attention.append(linkButton('Ver tudo', () => show('notifications')));
    right.append(attention);
  }
}

function registrationCard() {
  const box = card('Cadastro no Google', view.registered
    ? 'Configurado neste computador. Para usar outro cadastro, escolha o novo arquivo.'
    : 'Para entrar numa Conta do Google, o Google exige um cadastro do aplicativo. O GCP-Drive não traz um pronto: cada pessoa cria o seu, de graça, em cerca de 10 minutos, uma vez só. Siga o passo a passo ilustrado, baixe o arquivo que começa com client_secret e escolha-o aqui. O arquivo fica só neste computador.');
  box.append(el('div', { class: 'row-actions small' },
    button('Ver o passo a passo', () => { location.href = 'guia.html#' + token; }, 'pill'),
    button(view.registered ? 'Trocar arquivo' : 'Escolher arquivo', () => $('registration-file').click(), view.registered ? 'pill' : 'primary')));
  return box;
}
$('registration-file').addEventListener('change', () => {
  const file = $('registration-file').files[0];
  $('registration-file').value = '';
  if (!file) return;
  act(async () => {
    if (file.size > 100000) throw new Error('Este não parece ser o arquivo baixado do Google.');
    view.registered = await api('/api/registration', { ID: await file.text() });
    notice('Cadastro guardado. Agora é só conectar a conta.');
  });
});

function accounts(active, surface) {
  const box = card('Contas do Google', 'Cada conta aparece como uma pasta em GCP-Drive, na sua pasta pessoal.');
  for (const row of view.rows) {
    const line = el('div', { class: 'list-row' }, el('img', { src: 'gcp-drive.svg', alt: '' }),
      el('div', { class: 'grow' }, el('span', { text: row.Name || row.Email }), el('span', { class: 'muted', text: row.Email }), chip(row)));
    const actions = el('div', { class: 'row-actions small' }, button('Abrir pasta', () => act(() => api('/api/open', { ID: row.ID }), false), 'pill', 'folder'));
    if (!active || row.ID !== active.ID) actions.append(button('Ver no painel', () => { select(row.ID); render(); }, 'pill'));
    actions.append(linkButton('Desconectar', () => disconnect(row)));
    line.append(actions);
    box.append(line);
  }
  box.append(el('div', { class: 'row-actions small' }, addAccountButton('plus'), button('Cadastro no Google', () => document.querySelector('#registration')?.scrollIntoView({ behavior: 'smooth' }), 'pill')));
  surface.append(box);
  const registration = registrationCard();
  registration.id = 'registration';
  surface.append(registration);
}

function numberField(value, low, high, stepValue, onchange) {
  const input = el('input', { type: 'number', min: String(low), max: String(high), step: String(stepValue), value: String(value), 'aria-label': 'Valor' });
  const commit = () => {
    const number = Math.min(high, Math.max(low, Math.round(Number(input.value) || low)));
    input.value = String(number);
    onchange(number);
  };
  input.addEventListener('change', commit);
  const nudge = (delta) => { if (!input.disabled) { input.value = String(Number(input.value) + delta); commit(); } };
  return { box: el('div', { class: 'number' }, input, el('button', { type: 'button', 'aria-label': 'Diminuir', onclick: () => nudge(-stepValue), text: '−' }), el('button', { type: 'button', 'aria-label': 'Aumentar', onclick: () => nudge(stepValue), text: '+' })), input };
}
function toggle(checked, onchange, label) {
  const input = el('input', { type: 'checkbox', role: 'switch', 'aria-label': label });
  input.checked = checked;
  input.addEventListener('change', () => onchange(input.checked));
  return { box: el('label', { class: 'switch' }, input, el('span')), input };
}

function saveSettings(values) {
  act(async () => { view.settings = JSON.parse(await call('settings', JSON.stringify(values))); }, false);
}

function preferences(active, surface) {
  const set = view.settings;
  if (!set) { surface.append(card('Preferências', 'Carregando…')); return; }
  const speed = card('Velocidade da internet', 'Abrir arquivos e pastas sempre tem prioridade. Envios e cópias off-line esperam enquanto você está usando a unidade.');
  for (const [key, title] of [['DownKBps', 'Limite de download'], ['UpKBps', 'Limite de envio']]) {
    const field = numberField(set[key] || 5000, 100, 1000000, 100, (value) => { if (limited.input.checked) saveSettings({ [key]: value }); });
    field.input.disabled = !(set[key] > 0);
    const limited = toggle(set[key] > 0, (on) => { field.input.disabled = !on; saveSettings({ [key]: on ? Number(field.input.value) : 0 }); }, title);
    speed.append(el('div', { class: 'setting' }, el('span', { text: title }), field.box, el('span', { class: 'muted', text: 'KB/s' }), limited.box));
  }
  speed.append(el('p', { class: 'muted', text: 'Desligado = sem limite, usa toda a velocidade disponível.' }));
  const space = card('Espaço neste computador', 'Os arquivos que você abre ficam guardados aqui para abrir na hora da próxima vez. Os mais antigos saem sozinhos quando o limite é atingido.');
  space.append(el('div', { class: 'setting' }, el('span', { text: 'Tamanho máximo' }), numberField(set.CacheGB, 1, 500, 1, (value) => saveSettings({ CacheGB: value })).box, el('span', { class: 'muted', text: 'GB' })));
  const mapping = card('Mapa de pastas', 'O GCP-Drive lê a lista de pastas e arquivos da conta uma vez e depois acompanha só o que muda. Assim as pastas abrem sem esperar a internet.');
  mapping.append(el('div', { class: 'setting' }, el('span', { text: 'Mapear a conta inteira em segundo plano' }), toggle(set.Premap, (on) => saveSettings({ Premap: on }), 'Mapear a conta inteira em segundo plano').box));
  const general = card('Geral');
  const auto = el('input', { type: 'checkbox' });
  auto.checked = view.autostart !== false;
  auto.disabled = view.autostart === null;
  auto.addEventListener('change', () => act(async () => { view.autostart = await call('autostart', auto.checked ? 'on' : 'off'); }, false));
  general.append(el('label', { class: 'check' }, auto, 'Iniciar o GCP-Drive ao entrar no computador'));
  general.append(el('p', { class: 'muted', text: 'No Explorador de Arquivos, clique com o botão direito num arquivo ou pasta da conta e escolha GCP-Drive para copiar o link, compartilhar, abrir na nuvem ou manter off-line. No Windows 11, o submenu também aparece em “Mostrar mais opções”.' }));
  surface.append(speed, space, mapping, general);
}

function storage(active, surface) {
  const box = card('Espaço usado', 'Veja quanto cada conta ocupa na nuvem e neste computador.');
  surface.append(box);
  if (!active) { box.append(el('div', { class: 'row-actions' }, addAccountButton())); return; }
  const chooser = el('select', { class: 'field', 'aria-label': 'Conta' });
  for (const row of view.rows) chooser.append(el('option', { value: row.ID, text: row.Email }));
  chooser.value = active.ID;
  chooser.addEventListener('change', () => { select(chooser.value); show('storage'); });
  box.append(chooser);
  const quota = view.quota;
  if (quota && !quota.Error) {
    box.append(el('p', { text: 'No Google Drive' }));
    if (quota.Limit) box.append(el('progress', { max: String(quota.Limit), value: String(Math.min(quota.Usage, quota.Limit)) }));
    box.append(el('p', { class: 'muted', text: size(quota.Usage) + (quota.Limit ? ' de ' + size(quota.Limit) : '') + ' usados' }));
  }
  const local = view.storage;
  if (!local) { box.append(el('p', { class: 'muted', text: 'Calculando…' })); return; }
  if (local.Error) { box.append(el('p', { text: local.Error })); return; }
  box.append(el('p', { text: 'Neste computador' }),
    el('progress', { max: String(Math.max(1, local.cache.Limit)), value: String(Math.min(local.cache.Bytes, local.cache.Limit)) }),
    el('p', { class: 'muted', text: 'Arquivos abertos recentemente: ' + size(local.cache.Bytes) + ' de ' + size(local.cache.Limit) }),
    el('p', { class: 'muted', text: 'Cópias off-line: ' + local.offline.Files + ' arquivo(s), ' + size(local.offline.Bytes) }),
    el('p', { class: 'muted', text: 'Aguardando envio: ' + size(local.pending.Bytes) }),
    el('p', { class: 'muted', text: 'Para manter um arquivo ou pasta off-line, clique nele com o botão direito no Explorador de Arquivos e escolha GCP-Drive → Disponibilizar off-line, ou “Sempre manter neste dispositivo”.' }),
    el('div', { class: 'row-actions small' }, button('Liberar espaço', () => act(async () => {
      if (await ask('Liberar espaço desta conta?', 'Os arquivos continuam no Google Drive e serão baixados de novo quando você abrir. As cópias off-line e os envios pendentes são mantidos.', 'Liberar espaço')) {
        await call('clear-cache', active.ID);
        loadStorage(active.ID);
      }
    }, false), 'pill', 'broom')));
}

function loadStorage(id) {
  const receive = (field) => (value) => { if (view.page === 'storage' && view.selected === id) { view[field] = value; render(); } };
  call('storage', id).then(receive('storage'), (err) => receive('storage')({ Error: err.message }));
  call('quota', id).then(receive('quota'), (err) => receive('quota')({ Error: err.message }));
}

function activity(active, surface) {
  const box = card('Atividade');
  surface.append(box);
  if (!active) { box.append(el('p', { text: 'Nenhuma conta conectada.' })); return; }
  box.append(el('p', { class: 'muted', text: active.Email }), chip(active));
  const icons = { 'Concluída': 'check', 'Falhou': 'warning', 'Em andamento': 'sync' };
  for (const item of active.Activity || []) {
    const moment = new Date(item.At).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    box.append(el('div', { class: 'list-row' }, icon(icons[item.Status] || 'info'),
      el('div', { class: 'grow' }, el('span', { text: item.Name }), el('span', { class: 'muted', text: item.Action + ' · ' + item.Status + ' · ' + moment }),
        item.Detail ? el('span', { class: 'muted', text: item.Detail }) : null)));
  }
  if (!(active.Activity && active.Activity.length)) box.append(el('p', { class: 'muted', text: 'Nada por aqui ainda. Envios, cópias off-line e avisos aparecem nesta lista.' }));
}

function notifications(active, surface) {
  const box = card('Notificações');
  for (const text of problems().length ? problems() : ['Nenhum problema registrado.']) box.append(el('p', { class: 'muted', text }));
  surface.append(box);
}

function about(active, surface) {
  const box = card('GCP-Drive ' + view.version, 'Google Drive no Windows, com streaming, cópias off-line e várias contas.');
  box.append(el('p', { class: 'muted', text: 'Gestão Cultural Pro · Bruno Albertini' }));
  const support = button('Apoie o projeto', showSupport, 'pill');
  support.classList.add('wide');
  box.append(support);
  surface.append(box);
}

function results(active, surface) {
  const search = view.search;
  if (!search) return;
  const box = card('Resultados da pesquisa', '“' + search.query + '” em ' + search.email);
  if (search.pending) box.append(el('p', { class: 'muted', text: 'Pesquisando…' }));
  else if (search.error) box.append(el('p', { text: search.error }));
  else if (!search.rows.length) box.append(el('p', { text: 'Nenhum resultado nesta conta.' }));
  else for (const row of search.rows) box.append(linkButton(row.Name, () => act(() => browse(row.Link), false)));
  surface.append(box);
}

const pages = { home, accounts, preferences, storage, activity, notifications, about, search: results };

function render() {
  const surface = $('surface');
  const active = current();
  const paused = active && active.Paused;
  const pause = $('pause');
  pause.replaceChildren(icon(paused ? 'play' : 'pause'));
  pause.title = paused ? 'Retomar sincronização' : 'Pausar sincronização';
  pause.setAttribute('aria-label', pause.title);
  pause.disabled = !active;
  $('account-name').textContent = active ? (active.Name || active.Email).split(/\s+/)[0] : 'Contas';
  for (const item of document.querySelectorAll('.nav')) item.classList.toggle('selected', item.dataset.page === view.page);
  const scroll = surface.scrollTop;
  view.live = {};
  surface.replaceChildren();
  (pages[view.page] || home)(active, surface);
  surface.scrollTop = scroll;
  updateLive();
}

function updateLive() {
  const active = current();
  const live = view.live;
  if (!active) return;
  if (live.down) { live.down.textContent = size(active.Down) + '/s'; live.up.textContent = size(active.Up) + '/s'; }
  if (live.map) live.map.textContent = mapText(active);
  if (live.cache) {
    live.cache.max = Math.max(1, active.CacheLimit);
    live.cache.value = Math.min(active.CacheBytes, active.CacheLimit);
    live.cacheText.textContent = size(active.CacheBytes) + ' de ' + size(active.CacheLimit) + ' usados para abrir arquivos mais rápido';
  }
  for (const [name, bar] of Object.entries(live.uploads || {})) {
    const item = (active.Uploads || []).find((u) => u.Name === name);
    if (item && item.Total) { bar.max = item.Total; bar.value = item.Done; }
  }
}

// The part of the status that changes the layout; live numbers update in place.
function stable(rows) {
  return JSON.stringify(rows.map(({ Down, Up, Downloads, CacheBytes, Uploads, Items, ...rest }) => ({ ...rest, U: (Uploads || []).map((u) => u.Name), B: !!Downloads })));
}

let refreshing = false;
async function refresh(force) {
  if (refreshing) return;
  refreshing = true;
  let rows = view.rows, error = '';
  try { rows = await call('status'); } catch (err) { error = err.message; }
  refreshing = false;
  const signature = stable(rows) + error + view.registered;
  view.rows = rows;
  view.error = error;
  if (!current()) select(rows[0] ? rows[0].ID : '');
  // Pages with fields being edited are drawn again only when asked.
  const editing = view.page === 'preferences' || view.page === 'search';
  if (force === true || (signature !== view.shown && !editing)) { view.shown = signature; render(); } else updateLive();
}

async function loadSettings() {
  try {
    view.settings = await call('settings');
    view.version = view.settings.Version || view.version;
  } catch (err) { notice(err.message, true); }
  try { view.autostart = await call('autostart'); } catch { view.autostart = null; }
  if (view.page === 'preferences' || view.page === 'about') render();
}

async function loadRegistration() {
  try { view.registered = await api('/api/registration', {}); } catch { return; }
  render();
}

function showSupport() {
  $('menu').hidden = true;
  $('copy-pix').textContent = 'Copiar PIX';
  $('copy-stripe').textContent = 'Copiar link do Stripe';
  $('support').showModal();
}

// Top bar and rail

$('search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const active = current();
  const query = $('search').value.trim();
  if (!active) return show('accounts');
  if (!query) return;
  view.search = { query, email: active.Email, pending: true, rows: [] };
  show('search');
  call('search', active.ID, query).then((rows) => { view.search = { query, email: active.Email, rows: rows || [] }; }, (err) => { view.search = { query, email: active.Email, error: err.message, rows: [] }; })
    .finally(() => { if (view.page === 'search') render(); });
});
$('pause').addEventListener('click', () => {
  const active = current();
  if (active) act(() => call('pause', active.ID, active.Paused ? 'off' : 'on'));
});
$('more').addEventListener('click', (event) => {
  event.stopPropagation();
  const menu = $('menu');
  menu.hidden = !menu.hidden;
  $('more').classList.toggle('open', !menu.hidden);
  $('more').setAttribute('aria-expanded', String(!menu.hidden));
});
document.addEventListener('click', (event) => {
  if (!$('menu').hidden && !event.target.closest('.menu-wrap')) { $('menu').hidden = true; $('more').classList.remove('open'); }
});
for (const item of document.querySelectorAll('[data-page]')) item.addEventListener('click', () => show(item.dataset.page));
$('menu-support').addEventListener('click', showSupport);
$('gemini').addEventListener('click', () => {
  if (!current()) return show('accounts');
  openWeb();
  notice('No Drive para Web, abra o painel do Gemini se o recurso estiver disponível para a sua conta.');
});
$('account').addEventListener('click', () => show('accounts'));
$('open-drive').addEventListener('click', openDrive);

// Support dialog
$('pix-code').textContent = SUPPORT_PIX;
$('copy-pix').addEventListener('click', async () => { if (await copy(SUPPORT_PIX)) $('copy-pix').textContent = 'Copiado'; });
$('copy-stripe').addEventListener('click', async () => { if (await copy(SUPPORT_STRIPE)) $('copy-stripe').textContent = 'Copiado'; });
$('open-stripe').addEventListener('click', () => act(() => browse(SUPPORT_STRIPE), false));
for (const item of document.querySelectorAll('[data-browse]')) item.addEventListener('click', () => act(() => browse(item.dataset.browse), false));

sessionStorage.setItem('token', token);
drawIcons(document);
render();
loadRegistration();
loadSettings();
refresh(true);
setInterval(refresh, 1000);
