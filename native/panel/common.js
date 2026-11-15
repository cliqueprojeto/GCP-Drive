'use strict';
// Shared by the panel and the sharing window. Names of files and accounts are always written as text,
// never as markup. The token comes after the #; a sharing window adds "|" and the item's path.
const [token, hashItem] = location.hash.slice(1).split('|');
const $ = (id) => document.getElementById(id);

async function api(path, body, headers) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-GCP-Drive-Token': token, ...(headers || {}) },
    body: body instanceof Blob ? body : JSON.stringify(body || {}),
  });
  if (!response.ok) throw new Error('Abra o painel pelo ícone do GCP-Drive ao lado do relógio.');
  const reply = await response.json();
  if (reply.Err) throw new Error(reply.Err);
  return reply.Out;
}
const call = (...args) => api('/api/call', { Args: args });
const browse = (address) => api('/api/browse', { ID: address });

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'onclick') node.addEventListener('click', value);
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children) if (child != null && child !== false) node.append(child);
  return node;
}

// Line icons drawn like the symbolic icons of the Linux interface.
const ICONS = {
  search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z', 'M20 20l-4-4'],
  pause: ['M9 5v14', 'M15 5v14'],
  play: ['M8 5l11 7-11 7Z'],
  gear: ['M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z', 'M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1'],
  star: ['M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z'],
  person: ['M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z', 'M4 21c1-4 4-6 8-6s7 2 8 6'],
  folder: ['M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5Z'],
  home: ['M4 11l8-7 8 7', 'M6 9.5V20h12V9.5', 'M10 20v-5h4v5'],
  refresh: ['M20 11a8 8 0 0 0-14-4.5L4 9', 'M4 4v5h5', 'M4 13a8 8 0 0 0 14 4.5l2-2.5', 'M20 20v-5h-5'],
  bulb: ['M9 18h6', 'M10 21h4', 'M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z'],
  send: ['M4 12l16-8-6 16-2.5-6.5Z', 'M11.5 13.5L20 4'],
  globe: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M3 12h18', 'M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9Z'],
  plus: ['M12 5v14', 'M5 12h14'],
  broom: ['M14 3l-4 8', 'M6 11h8l2 10H4Z', 'M9 15v6M12 15v6'],
  check: ['M5 12l5 5 9-10'],
  warning: ['M12 4l9 16H3Z', 'M12 10v4', 'M12 17v.5'],
  sync: ['M20 11a8 8 0 0 0-14-4.5L4 9', 'M4 4v5h5', 'M4 13a8 8 0 0 0 14 4.5l2-2.5', 'M20 20v-5h-5'],
  info: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M12 11v6', 'M12 7.5v.5'],
  link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
  lock: ['M6 11h12v9H6Z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3'],
  people: ['M9 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z', 'M3 19c.7-3 3-4.5 6-4.5s5.3 1.5 6 4.5', 'M16 5.5a3 3 0 0 1 0 5.5', 'M18 14.5c1.6.5 2.6 2 3 4.5'],
};

function icon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICONS[name] || []) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}
function drawIcons(root) {
  for (const slot of root.querySelectorAll('[data-icon]')) slot.replaceWith(icon(slot.dataset.icon));
}

// The same units the Linux interface shows.
function size(count) {
  let value = Number(count) || 0;
  for (const unit of ['bytes', 'KB', 'MB', 'GB', 'TB']) {
    if (value < 1024 || unit === 'TB') return unit === 'bytes' ? Math.round(value) + ' bytes' : value.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' ' + unit;
    value /= 1024;
  }
}

let noticeTimer = 0;
function notice(text, error) {
  const box = $('notice');
  clearTimeout(noticeTimer);
  box.textContent = text || '';
  box.className = 'notice' + (error ? ' error' : '');
  box.hidden = !text;
  if (text) noticeTimer = setTimeout(() => { box.hidden = true; }, error ? 9000 : 5000);
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
