'use strict';
// The sharing window of one item, opened from the Explorer's GCP-Drive menu. It follows the Linux
// sharing dialog: invite by e-mail, people with access, general access, copy link.
const path = decodeURIComponent(hashItem || '');
const ROLES = { reader: 'Leitor', commenter: 'Comentador', writer: 'Editor', owner: 'Proprietário', organizer: 'Administrador', fileOrganizer: 'Gerenciador de conteúdo' };
let canShare = false, sending = false;

const feedback = (text) => { $('feedback').textContent = text || ''; };
function updateInvite() {
  for (const id of ['email', 'grantee', 'role']) $(id).disabled = !canShare;
  $('send').disabled = !canShare || sending || !$('email').value.trim();
}

async function loadPermissions() {
  $('people').replaceChildren(el('p', { class: 'muted', text: 'Carregando permissões…' }));
  let data;
  try {
    data = JSON.parse(await call('context', 'sharing', path));
  } catch (err) {
    canShare = false;
    $('people').replaceChildren(el('p', { class: 'muted', text: 'Não foi possível consultar as permissões.' }));
    $('general').textContent = 'Não foi possível verificar o acesso geral.';
    feedback(err.message);
    updateInvite();
    return;
  }
  canShare = data.CanShare;
  const entries = data.Permissions.filter((p) => !p.Deleted);
  const visible = entries.filter((p) => p.Type === 'user' || p.Type === 'group');
  $('people').replaceChildren();
  if (!visible.length) $('people').append(el('p', { class: 'muted', text: 'Nenhuma pessoa ou grupo aparece nesta conta.' }));
  for (const person of visible) {
    const address = person.EmailAddress;
    const name = person.DisplayName || address || 'Conta do Google';
    $('people').append(el('div', { class: 'person' }, el('span', { class: 'avatar' }, icon(person.Type === 'group' ? 'people' : 'person')),
      el('div', { class: 'grow' }, el('div', { text: name }), address && address !== name ? el('div', { class: 'muted', text: address }) : null),
      el('span', { class: 'muted', text: ROLES[person.Role] || 'Acesso concedido' })));
  }
  const anyone = entries.find((p) => p.Type === 'anyone');
  const domains = entries.filter((p) => p.Type === 'domain').map((p) => p.Domain || p.DisplayName).filter(Boolean);
  let mark = 'lock', text = 'Restrito. Só quem tem acesso pode abrir pelo link.';
  if (anyone) { mark = 'globe'; text = anyone.AllowFileDiscovery ? 'Público' : 'Qualquer pessoa com o link'; }
  else if (domains.length) { mark = 'people'; text = 'Acesso na organização ' + domains.join(', '); }
  $('general-icon').replaceChildren(icon(mark));
  $('general').textContent = text;
  if (!canShare) feedback('Sua conta pode consultar as permissões deste item.');
  updateInvite();
}

$('invite').addEventListener('submit', async (event) => {
  event.preventDefault();
  if ($('send').disabled) return;
  sending = true;
  feedback('Enviando convite pelo Google Drive…');
  updateInvite();
  try {
    await call('context', 'share', path, $('email').value.trim(), $('role').value, $('grantee').value);
    feedback('Convite enviado.');
    $('email').value = '';
    loadPermissions();
  } catch (err) { feedback(err.message); }
  sending = false;
  updateInvite();
});
$('email').addEventListener('input', updateInvite);
$('copy-link').addEventListener('click', async () => {
  try {
    const link = (await call('context', 'link', path)).trim();
    if (await copy(link)) $('copy-link').lastChild.textContent = 'Link copiado';
    else feedback(link);
  } catch (err) { feedback(err.message); }
});
$('manage').addEventListener('click', () => call('context', 'web', path).catch((err) => feedback(err.message)));
$('done').addEventListener('click', () => window.close());

drawIcons(document);
(async () => {
  try {
    const item = JSON.parse(await call('context', 'describe', path));
    $('title').textContent = 'Compartilhar “' + item.Name + '”';
    document.title = 'Compartilhar “' + item.Name + '”';
  } catch (err) { feedback(err.message); }
  loadPermissions();
})();
