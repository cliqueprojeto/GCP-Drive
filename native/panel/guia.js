'use strict';
// Google's pages open in the user's own browser, where they are signed in, not in the panel's window.
const token = location.hash.slice(1) || sessionStorage.getItem('token') || '';
for (const link of document.querySelectorAll('a[href="./"]')) link.href = './#' + token;
for (const button of document.querySelectorAll('button[data-open]')) {
  button.addEventListener('click', () => fetch('/api/browse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-GCP-Drive-Token': token },
    body: JSON.stringify({ ID: button.dataset.open }),
  }));
}
