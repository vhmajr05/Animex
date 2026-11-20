/* ===================== ANIMEX – app.js =====================
   Données : API Jikan v4 (https://api.jikan.moe/v4)
   Favoris : LocalStorage
============================================================= */
const API = 'https://api.jikan.moe/v4';
const $ = (s) => document.querySelector(s);
const view = $('#view');
const PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="100%" height="100%" fill="#27272a"/><text x="50%" y="50%" fill="#71717a" font-family="sans-serif" font-size="20" text-anchor="middle">Pas d\'affiche</text></svg>');

/* ---------- Utilitaires ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.style.opacity = 1;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.style.opacity = 0), 1800);
}

/* ---------- Appels API : file d'attente + cache (limite Jikan : 3 req/s) ---------- */
const cache = new Map();
let queue = Promise.resolve();
function api(path) {
  if (cache.has(path)) return Promise.resolve(cache.get(path));
  const job = queue.then(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(API + path);
      if (res.status === 429) { await sleep(1200); continue; }   // trop de requêtes : on patiente
      if (!res.ok) throw new Error('Erreur API (' + res.status + ')');
      const json = await res.json();
      cache.set(path, json);
      await sleep(400);                                           // espace les requêtes
      return json;
    }
    throw new Error('Trop de requêtes, réessayez dans un instant.');
  });
  queue = job.catch(() => {});
  return job;
}

/* ---------- Favoris (LocalStorage) ---------- */
const KEY = 'animex:favs';
const getFavs = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
const saveFavs = (f) => localStorage.setItem(KEY, JSON.stringify(f));
const isFav = (type, id) => getFavs().some((f) => f.type === type && f.id === id);
function toggleFav(item) {
  let favs = getFavs();
  if (isFav(item.type, item.id)) { favs = favs.filter((f) => !(f.type === item.type && f.id === item.id)); toast('Retiré des favoris'); }
  else { favs.unshift(item); toast('Ajouté aux favoris ♥'); }
  saveFavs(favs); updateFavUI();
}
function updateFavUI() {
  const n = getFavs().length;
  $('#favCount').textContent = n ? `(${n})` : '';
  document.querySelectorAll('[data-fav]').forEach((b) => {
    const on = isFav(b.dataset.type, +b.dataset.id);
    b.classList.toggle('on', on); b.textContent = on ? '♥' : '♡';
  });
}

/* ---------- Normalisation d'un élément Jikan ---------- */
function norm(it, type) {
  const d = it.aired?.prop?.from?.year || it.published?.prop?.from?.year;
  return {
    id: it.mal_id, type,
    title: it.title_english || it.title,
    img: it.images?.webp?.large_image_url || it.images?.jpg?.large_image_url || '',
    score: it.score, year: it.year || d || '—', kind: it.type || '',
  };
}
function cardHTML(c) {
  return `<article class="card" data-open data-type="${c.type}" data-id="${c.id}">
    <img src="${esc(c.img) || PLACEHOLDER}" alt="${esc(c.title)}" loading="lazy">
    <button class="fav-btn" data-fav data-type="${c.type}" data-id="${c.id}" aria-label="Favori"
      data-item='${esc(JSON.stringify(c))}'>♡</button>
    <div class="absolute top-2 left-2 badge text-amber-300">★ ${c.score ?? 'N/A'}</div>
    <div class="p-3">
      <h3 class="text-sm font-semibold clamp2 leading-snug min-h-[2.4em]">${esc(c.title)}</h3>
      <p class="text-xs text-zinc-400 mt-1">${esc(c.kind || (c.type === 'anime' ? 'Anime' : 'Manga'))} · ${c.year}</p>
    </div></article>`;
}
const skeletonRow = (n = 6) => `<div class="row">${Array.from({ length: n }, () => '<div class="skeleton" style="flex:0 0 9rem;height:17rem"></div>').join('')}</div>`;
const errorBox = (msg, retry) => `<div class="text-center py-12 text-zinc-400"><p class="mb-4">⚠️ ${esc(msg)}</p><button class="btn" data-retry>${retry || 'Réessayer'}</button></div>`;

/* ---------- Routeur ---------- */
let route = '', token = 0;
function go(name) { location.hash = name; }
function render() {
  const name = (location.hash.slice(1) || 'home');
  route = ['home', 'explore', 'favs', 'profile'].includes(name) ? name : 'home';
  token++;
  document.querySelectorAll('[data-nav]').forEach((b) => b.classList.toggle('active', b.dataset.nav === route && !b.classList.contains('logo')));
  view.className = 'max-w-7xl mx-auto px-4 pb-28 md:pb-12 fade-in';
  view.style.animation = 'none'; void view.offsetWidth; view.style.animation = '';
  ({ home: renderHome, explore: renderExplore, favs: renderFavs, profile: renderProfile })[route]();
  window.scrollTo({ top: 0 });
}

/* ---------- Accueil ---------- */
async function renderHome() {
  const my = token;
  const sections = [
    ['pop', 'Animés populaires', '/top/anime?filter=bypopularity&limit=15', 'anime'],
    ['top', 'Les mieux notés', '/top/anime?limit=15', 'anime'],
    ['mg', 'Mangas populaires', '/top/manga?filter=bypopularity&limit=15', 'manga'],
  ];
  view.innerHTML = `<section id="hero" class="mt-4 skeleton" style="min-height:22rem"></section>` +
    sections.map(([id, t]) => `<section class="mt-8"><h2 class="text-xl font-bold mb-3">${t}</h2><div id="s-${id}">${skeletonRow()}</div></section>`).join('');
  for (const [id, , path, type] of sections) {
    try {
      const { data } = await api(path);
      if (my !== token) return;
      if (id === 'pop') renderHero(data[0]);
      const seen = new Set();
      const items = data.filter((d) => !seen.has(d.mal_id) && seen.add(d.mal_id)).map((d) => norm(d, type));
      $('#s-' + id).innerHTML = `<div class="row">${items.map(cardHTML).join('')}</div>`;
      updateFavUI();
    } catch (e) {
      if (my !== token) return;
      if (id === 'pop') $('#hero').outerHTML = '';
      $('#s-' + id).innerHTML = errorBox(e.message);
    }
  }
}
function renderHero(a) {
  const img = a.images?.jpg?.large_image_url || '';
  const el = $('#hero');
  el.classList.remove('skeleton'); el.classList.add('hero');
  el.style.backgroundImage = `url('${img}')`; el.style.minHeight = '';
  el.innerHTML = `<div class="p-6 md:p-12 flex flex-col justify-end min-h-[24rem] md:min-h-[30rem] max-w-2xl">
    <span class="badge self-start mb-3 text-indigo-300">🔥 À la une · ★ ${a.score ?? 'N/A'}</span>
    <h1 class="text-3xl md:text-5xl font-extrabold leading-tight">${esc(a.title_english || a.title)}</h1>
    <p class="mt-3 text-zinc-300 clamp3 text-sm md:text-base">${esc(a.synopsis || 'Pas de synopsis disponible.')}</p>
    <div class="mt-5"><button class="btn" data-open data-type="anime" data-id="${a.mal_id}">Découvrir</button></div></div>`;
}

/* ---------- Explorer (recherche + pagination) ---------- */
const S = { type: 'anime', q: '', page: 1 };
let debounce;
function renderExplore() {
  view.innerHTML = `<h2 class="text-2xl font-bold mt-6 mb-4">Explorer</h2>
    <div class="flex gap-2 mb-3">
      ${['anime', 'manga'].map((t) => `<button data-type-switch="${t}" class="nav-btn ${S.type === t ? 'active' : ''}">${t === 'anime' ? 'Animés' : 'Mangas'}</button>`).join('')}
    </div>
    <input id="q" type="search" value="${esc(S.q)}" placeholder="Rechercher un titre…" autocomplete="off"
      class="w-full bg-[#18181B] border border-white/10 focus:border-indigo-500 outline-none rounded-2xl px-4 py-3 mb-6 transition">
    <div id="results"></div>`;
  $('#q').addEventListener('input', (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { S.q = e.target.value.trim(); S.page = 1; loadResults(); }, 450);
  });
  loadResults();
}
async function loadResults() {
  const my = token, box = $('#results');
  if (!box) return;
  box.innerHTML = `<div class="flex justify-center py-16"><div class="spinner"></div></div>`;
  const path = S.q ? `/${S.type}?q=${encodeURIComponent(S.q)}&page=${S.page}&limit=24&sfw` : `/top/${S.type}?page=${S.page}&limit=24&filter=bypopularity`;
  try {
    const { data, pagination } = await api(path);
    if (my !== token) return;
    if (!data.length) { box.innerHTML = `<p class="text-center text-zinc-400 py-16">Aucun résultat pour « ${esc(S.q)} ».</p>`; return; }
    const seen = new Set();
    const items = data.filter((d) => !seen.has(d.mal_id) && seen.add(d.mal_id)).map((d) => norm(d, S.type));
    const last = pagination?.last_visible_page || 1;
    box.innerHTML = `<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">${items.map(cardHTML).join('')}</div>
      <div class="flex items-center justify-center gap-4 mt-8">
        <button class="btn-ghost" data-page="-1" ${S.page <= 1 ? 'disabled' : ''}>← Précédent</button>
        <span class="text-sm text-zinc-400">Page ${S.page} / ${last}</span>
        <button class="btn-ghost" data-page="1" ${pagination?.has_next_page ? '' : 'disabled'}>Suivant →</button>
      </div>`;
    updateFavUI();
  } catch (e) { if (my === token) box.innerHTML = errorBox(e.message); }
}

/* ---------- Favoris ---------- */
function renderFavs() {
  const favs = getFavs();
  view.innerHTML = `<h2 class="text-2xl font-bold mt-6 mb-4">Mes favoris</h2>` + (favs.length
    ? `<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">${favs.map(cardHTML).join('')}</div>`
    : `<div class="text-center py-16 text-zinc-400"><p class="mb-4">Aucun favori pour l'instant.</p><button class="btn" data-nav="explore">Explorer</button></div>`);
  updateFavUI();
}

/* ---------- Profil ---------- */
function renderProfile() {
  const f = getFavs(), a = f.filter((x) => x.type === 'anime').length, m = f.length - a;
  view.innerHTML = `<h2 class="text-2xl font-bold mt-6 mb-4">Profil</h2>
    <div class="grid grid-cols-3 gap-3 max-w-lg">
      ${[['Favoris', f.length], ['Animés', a], ['Mangas', m]].map(([l, n]) => `<div class="bg-[#18181B] rounded-2xl p-4 text-center"><div class="text-3xl font-extrabold logo">${n}</div><div class="text-xs text-zinc-400 mt-1">${l}</div></div>`).join('')}
    </div>
    <p class="text-sm text-zinc-400 mt-6 max-w-lg">Vos favoris sont enregistrés uniquement dans ce navigateur (LocalStorage). Données fournies par MyAnimeList via l'API Jikan.</p>
    <button class="btn-ghost mt-4 text-rose-400" data-clear ${f.length ? '' : 'disabled'}>Vider mes favoris</button>`;
}

/* ---------- Fiche détaillée ---------- */
async function openDetail(type, id) {
  const modal = $('#modal'), body = $('#modalBody');
  modal.classList.remove('hidden'); document.body.style.overflow = 'hidden';
  body.innerHTML = `<div class="flex justify-center py-32"><div class="spinner"></div></div>`;
  try {
    const { data: d } = await api(`/${type}/${id}/full`);
    const c = norm(d, type), isA = type === 'anime';
    const names = (arr) => (arr || []).map((x) => esc(x.name)).join(', ') || '—';
    const when = (isA ? d.aired?.string : d.published?.string) || '—';
    const count = isA ? d.episodes : d.chapters;
    const yt = isA && d.trailer?.embed_url ? d.trailer.embed_url.replace('autoplay=1', 'autoplay=0') : '';
    body.innerHTML = `<div class="p-5 md:p-8 pt-14 md:pt-8">
      <div class="flex flex-col sm:flex-row gap-6">
        <img src="${esc(c.img) || PLACEHOLDER}" alt="${esc(c.title)}" class="w-44 sm:w-56 rounded-2xl shadow-xl self-center sm:self-start">
        <div class="flex-1 min-w-0">
          <h2 class="text-2xl md:text-3xl font-extrabold leading-tight">${esc(d.title_english || d.title)}</h2>
          <p class="text-zinc-400 mt-1">${esc(d.title_japanese || '')}</p>
          <div class="flex flex-wrap gap-2 mt-3 text-sm">
            <span class="badge text-amber-300">★ ${d.score ?? 'N/A'}</span><span class="badge">${esc(d.type || '')}</span><span class="badge">${esc(d.status || '')}</span>
          </div>
          <dl class="mt-4 text-sm space-y-1 text-zinc-300">
            <div><dt class="inline text-zinc-500">${isA ? 'Épisodes' : 'Chapitres'} : </dt><dd class="inline">${count ?? '—'}</dd></div>
            <div><dt class="inline text-zinc-500">Sortie : </dt><dd class="inline">${esc(when)}</dd></div>
            <div><dt class="inline text-zinc-500">Genres : </dt><dd class="inline">${names(d.genres)}</dd></div>
            <div><dt class="inline text-zinc-500">${isA ? 'Studios' : 'Auteurs'} : </dt><dd class="inline">${names(isA ? d.studios : d.authors)}</dd></div>
          </dl>
          <button class="btn-ghost mt-4" data-fav data-type="${type}" data-id="${id}" data-item='${esc(JSON.stringify(c))}'>♡</button>
        </div>
      </div>
      <h3 class="font-bold mt-6 mb-2">Synopsis</h3>
      <p class="text-zinc-300 text-sm leading-relaxed whitespace-pre-line">${esc(d.synopsis || 'Pas de synopsis disponible.')}</p>
      ${yt ? `<h3 class="font-bold mt-6 mb-2">Bande-annonce</h3><div class="aspect-video rounded-2xl overflow-hidden bg-black"><iframe class="w-full h-full" src="${esc(yt)}" allowfullscreen loading="lazy" title="Bande-annonce"></iframe></div>` : ''}
    </div>`;
    updateFavUI();
  } catch (e) { body.innerHTML = `<div class="pt-14">${errorBox(e.message, 'Fermer')}</div>`; body.querySelector('[data-retry]').dataset.close = 1; }
}
function closeModal() { $('#modal').classList.add('hidden'); $('#modalBody').innerHTML = ''; document.body.style.overflow = ''; }

/* ---------- Événements (délégation) ---------- */
document.addEventListener('click', (e) => {
  const t = e.target;
  const nav = t.closest('[data-nav]');
  if (nav) { closeModal(); return go(nav.dataset.nav); }
  const fav = t.closest('[data-fav]');
  if (fav) {
    e.stopPropagation();
    toggleFav(JSON.parse(fav.dataset.item));
    if (route === 'favs') renderFavs();
    return;
  }
  if (t.closest('[data-close]') || t.id === 'modal' || t.closest('#modalClose')) return closeModal();
  const open = t.closest('[data-open]');
  if (open) return openDetail(open.dataset.type, +open.dataset.id);
  const sw = t.closest('[data-type-switch]');
  if (sw) { S.type = sw.dataset.typeSwitch; S.page = 1; return renderExplore(); }
  const pg = t.closest('[data-page]');
  if (pg && !pg.disabled) { S.page += +pg.dataset.page; loadResults(); return window.scrollTo({ top: 0, behavior: 'smooth' }); }
  if (t.closest('[data-retry]')) return render();
  if (t.closest('[data-clear]') && confirm('Supprimer tous vos favoris ?')) { saveFavs([]); updateFavUI(); renderProfile(); }
});
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeModal());
// Image absente ou cassée -> image de remplacement
document.addEventListener('error', (e) => { if (e.target.tagName === 'IMG' && e.target.src !== PLACEHOLDER) e.target.src = PLACEHOLDER; }, true);
window.addEventListener('hashchange', render);

updateFavUI();
render();
