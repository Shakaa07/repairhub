// Shared helpers for every RepairHub page.

const STATUS_LABELS = {
  new: 'New — we are finding a specialist',
  matched: 'Specialist matched',
  in_progress: 'Work in progress',
  done: 'Done',
  cancelled: 'Cancelled',
};

async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || (data.errors || []).join(' ') || 'Something went wrong');
    err.list = data.errors || (data.error ? [data.error] : []);
    throw err;
  }
  return data;
}

function logEvent(type) {
  api('/api/events', { method: 'POST', body: { type } }).catch(() => {});
}

function showErrors(box, list) {
  box.innerHTML = '';
  if (!list || !list.length) { box.classList.remove('show'); return; }
  const ul = document.createElement('ul');
  ul.style.margin = '0';
  ul.style.paddingLeft = '18px';
  list.forEach((msg) => { const li = document.createElement('li'); li.textContent = msg; ul.appendChild(li); });
  box.appendChild(ul);
  box.classList.add('show');
}

// Small DOM builder: el('div', {class: 'x'}, 'text', childNode)
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  });
  children.flat().forEach((c) => node.append(c instanceof Node ? c : document.createTextNode(String(c ?? ''))));
  return node;
}

const fmtDate = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// Header + pilot banner shared by all public pages.
function renderHeader(active) {
  const links = [
    ['index.html', 'Home'], ['request.html', 'Request a repair'],
    ['track.html', 'My requests'], ['specialist.html', 'For specialists'],
  ];
  const header = el('header', { class: 'top' },
    el('div', { class: 'wrap' },
      el('a', { class: 'brand', href: 'index.html' }, 'REPAIR', el('span', {}, 'HUB')),
      el('nav', {}, links.map(([href, text]) => el('a', { href, class: href === active ? 'active' : '' }, text)))));
  const pilot = el('div', { class: 'pilot' }, 'Pilot version in Astana — a student project (Technological Entrepreneurship). Requests are handled by our team.');
  document.body.prepend(pilot);
  document.body.prepend(header);
  document.body.append(el('footer', {}, el('div', { class: 'wrap' },
    'RepairHub © 2026 · Zeinebek Karlygash, Yelemes Shattyk, Semikanuly Adil · ',
    el('a', { href: 'admin.html' }, 'Team dashboard'))));
}
