/* ===================== ANIMEX – app.js (AniList GraphQL) =====================
   Données : API AniList (https://graphql.anilist.co)
   Favoris : LocalStorage
================================================================================ */
const API = 'https://graphql.anilist.co';
const $ = (s) => document.querySelector(s);
const view = $('#view');
const PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="100%" height="100%" fill="#27272a"/><text x="50%" y="50%" fill="#71717a" font-family="sans-serif" font-size="20" text-anchor="middle">Pas d\'affiche</text></svg>');

/* ---------- Utilitaires ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// AniList renvoie les descriptions avec des balises HTML : on les convertit en texte
const clean = (s) => (s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
const STATUS = { FINISHED: 'Terminé', RELEASING: 'En cours', NOT_YET_RELEASED: 'À venir', CANCELLED: 'Annulé', HIATUS: 'En pause' };
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.style.opacity = 1;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.style.opacity = 0), 1800);
}

/* ---------- Requêtes GraphQL ---------- */
// Fragment commun : les champs nécessaires pour afficher une carte
const MEDIA_FIELDS = `id title { romaji english } coverImage { large extraLarge } bannerImage
  averageScore seasonYear startDate { year } format description(asHtml: false)`;

// Liste paginée (accueil, explorer, recherche). $search et $sort sont optionnels.
const LIST_QUERY = `
query ($page: Int, $perPage: Int, $type: MediaType, $search: String, $sort: [MediaSort], $status: MediaStatus, $format: MediaFormat, $genre: String, $year: String) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { currentPage lastPage hasNextPage }
    media(type: $type, search: $search, sort: $sort, status: $status, format: $format, genre: $genre, startDate_like: $year, isAdult: false) { ${MEDIA_FIELDS} }
  }
}`;

// Fiche détaillée d'un seul élément, recherché par son id
const DETAIL_QUERY = `
query ($id: Int, $type: MediaType) {
  Media(id: $id, type: $type) {
    ${MEDIA_FIELDS}
    title { romaji english native }
    status episodes chapters genres popularity favourites
    recommendations(perPage: 8, sort: RATING_DESC) { nodes { mediaRecommendation { ${MEDIA_FIELDS} } } }
    startDate { year month day } endDate { year month day }
    studios(isMain: true) { nodes { name } }
    staff(perPage: 6, sort: RELEVANCE) { edges { role node { name { full } } } }
    trailer { id site }
  }
}`;

/* ---------- Appels API : POST + file d'attente + cache ---------- */
const cache = new Map();
let queue = Promise.resolve();
function api(query, variables = {}) {
  const key = JSON.stringify([query, variables]);
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  const job = queue.then(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      let res;
      try {
        res = await fetch(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ query, variables }),
        });
      } catch { await sleep(1000 * (attempt + 1)); continue; }       // erreur réseau : on réessaie
      if (res.status === 429) { await sleep((+res.headers.get('Retry-After') || 2) * 1000); continue; }
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.errors) throw new Error(json.errors?.[0]?.message || 'Erreur API (' + res.status + ')');
      cache.set(key, json.data);
      await sleep(300);
      return json.data;
    }
    throw new Error("Impossible de joindre l'API AniList. Vérifiez votre connexion puis réessayez.");
  });
  queue = job.catch(() => {});
  return job;
}

/* ---------- Favoris (LocalStorage) ---------- */
const KEY = 'animex:favs:anilist';   // nouvelle clé : les ids AniList sont différents de ceux de Jikan
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
    b.classList.toggle('on', on); b.textContent = (on ? '♥' : '♡') + (b.dataset.label ? (on ? ' Dans mes favoris' : ' Ajouter aux favoris') : '');
  });
}

/* ---------- Normalisation d'un élément AniList ---------- */
function norm(m, type) {
  return {
    id: m.id, type,
    title: m.title.english || m.title.romaji,
    img: m.coverImage?.large || '',
    score: m.averageScore ? (m.averageScore / 10).toFixed(1) : null,   // note /100 -> /10
    year: m.seasonYear || m.startDate?.year || '—',
    kind: (m.format || '').replace(/_/g, ' '),
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
  const my = token, seen = new Set();   // seen : évite les affiches en double entre sections
  const sections = [
    ['trend', 'Tendances', 'anime', { sort: ['TRENDING_DESC'] }],
    ['pop', 'Animés populaires', 'anime', { sort: ['POPULARITY_DESC'] }],
    ['new', 'Dernières sorties', 'anime', { sort: ['START_DATE_DESC'], status: 'RELEASING' }],
    ['top', 'Les mieux notés', 'anime', { sort: ['SCORE_DESC'] }],
    ['mg', 'Mangas populaires', 'manga', { sort: ['POPULARITY_DESC'] }],
  ];
  view.innerHTML = `<section id="hero" class="mt-4 skeleton" style="min-height:22rem"></section>` +
    sections.map(([id, t]) => `<section class="mt-8"><h2 class="text-xl font-bold mb-3">${t}</h2><div id="s-${id}">${skeletonRow()}</div></section>`).join('');
  for (const [id, , type, v] of sections) {
    try {
      const { Page } = await api(LIST_QUERY, { page: 1, perPage: 20, type: type.toUpperCase(), ...v });
      if (my !== token) return;
      let list = Page.media;
      if (id === 'trend') { renderHero(list[0]); seen.add(type + list[0].id); }
      list = list.filter((m) => !seen.has(type + m.id)).slice(0, 14);
      list.forEach((m) => seen.add(type + m.id));
      $('#s-' + id).innerHTML = `<div class="row">${list.map((m) => cardHTML(norm(m, type))).join('')}</div>`;
      updateFavUI();
    } catch (e) {
      if (my !== token) return;
      if (id === 'trend') $('#hero')?.remove();
      $('#s-' + id).innerHTML = errorBox(e.message);
    }
  }
}
function renderHero(m) {
  const img = m.bannerImage || m.coverImage?.extraLarge || '', c = norm(m, 'anime');
  const el = $('#hero');
  el.classList.remove('skeleton'); el.classList.add('hero');
  el.style.backgroundImage = `url('${img}')`; el.style.minHeight = '';
  el.innerHTML = `<div class="p-6 md:p-12 flex flex-col justify-end min-h-[24rem] md:min-h-[30rem] max-w-2xl">
    <span class="badge self-start mb-3 text-indigo-300">🔥 À la une · ★ ${c.score ?? 'N/A'}</span>
    <h1 class="text-3xl md:text-5xl font-extrabold leading-tight">${esc(c.title)}</h1>
    <p class="mt-3 text-zinc-300 clamp3 text-sm md:text-base">${esc(clean(m.description) || 'Pas de synopsis disponible.')}</p>
    <div class="mt-5 flex flex-wrap gap-3"><button class="btn" data-open data-type="anime" data-id="${m.id}">Découvrir</button>
    <button class="btn-ghost" data-fav data-label="1" data-type="anime" data-id="${m.id}" data-item='${esc(JSON.stringify(c))}'>♡</button></div></div>`;
}

/* ---------- Explorer (recherche, filtres, pagination) ---------- */
const S = { type: 'anime', q: '', page: 1, genre: '', year: '', format: '', sort: '' };
const FORMATS = { anime: ['TV', 'TV_SHORT', 'MOVIE', 'OVA', 'ONA', 'SPECIAL'], manga: ['MANGA', 'NOVEL', 'ONE_SHOT'] };
const SORTS = [['', 'Tri par défaut'], ['POPULARITY_DESC', 'Popularité'], ['SCORE_DESC', 'Meilleure note'], ['START_DATE_DESC', 'Plus récents']];
const GENRES_FR = { Adventure: 'Aventure', Comedy: 'Comédie', Drama: 'Drame', Fantasy: 'Fantastique', Horror: 'Horreur', Music: 'Musique', Mystery: 'Mystère', Psychological: 'Psychologique', 'Sci-Fi': 'Science-fiction', 'Slice of Life': 'Tranche de vie', Sports: 'Sport', Supernatural: 'Surnaturel' };
const SEL = 'w-full bg-[#18181B] border border-white/10 rounded-xl px-3 min-h-[44px] text-sm outline-none focus:border-indigo-500 [color-scheme:dark]';
const opts = (list, cur) => list.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('');
let debounce;
function renderExplore() {
  if (!FORMATS[S.type].includes(S.format)) S.format = '';
  const y = new Date().getFullYear();
  const years = Array.from({ length: y - 1978 }, (_, i) => String(y + 1 - i));
  view.innerHTML = `<h2 class="text-2xl font-bold mt-6 mb-4">Explorer</h2>
    <div class="flex gap-2 mb-3">
      ${['anime', 'manga'].map((t) => `<button data-type-switch="${t}" class="nav-btn ${S.type === t ? 'active' : ''}">${t === 'anime' ? 'Animés' : 'Mangas'}</button>`).join('')}
    </div>
    <input id="q" type="search" value="${esc(S.q)}" placeholder="Rechercher un titre…" autocomplete="off"
      class="w-full bg-[#18181B] border border-white/10 focus:border-indigo-500 outline-none rounded-2xl px-4 py-3 mb-3 transition">
    <div id="filters" class="grid grid-cols-2 md:grid-cols-5 gap-2 mb-6">
      <select name="genre" class="${SEL}" aria-label="Genre">${opts([['', 'Tous les genres']], S.genre)}</select>
      <select name="year" class="${SEL}" aria-label="Année">${opts([['', 'Toutes les années'], ...years.map((a) => [a, a])], S.year)}</select>
      <select name="format" class="${SEL}" aria-label="Type">${opts([['', 'Tous les types'], ...FORMATS[S.type].map((f) => [f, f.replace(/_/g, ' ')])], S.format)}</select>
      <select name="sort" class="${SEL}" aria-label="Tri">${opts(SORTS, S.sort)}</select>
      <button class="btn-ghost min-h-[44px]" data-reset-filters>Réinitialiser</button>
    </div>
    <div id="results"></div>`;
  $('#q').addEventListener('input', (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { S.q = e.target.value.trim(); S.page = 1; loadResults(); }, 450);
  });
  $('#filters').addEventListener('change', (e) => { if (e.target.name) { S[e.target.name] = e.target.value; S.page = 1; loadResults(); } });
  $('[data-reset-filters]').onclick = () => { Object.assign(S, { q: '', genre: '', year: '', format: '', sort: '', page: 1 }); renderExplore(); };
  fillGenres(); loadResults();
}
// Les genres viennent directement d'AniList (GenreCollection)
async function fillGenres() {
  try {
    const { GenreCollection: g } = await api('{ GenreCollection }');
    const el = $('#filters [name=genre]');
    if (el) el.innerHTML = opts([['', 'Tous les genres'], ...g.filter((x) => x !== 'Hentai').map((x) => [x, GENRES_FR[x] || x])], S.genre);
  } catch { /* les filtres restent utilisables sans la liste des genres */ }
}
async function loadResults() {
  const my = token, box = $('#results');
  if (!box) return;
  box.innerHTML = `<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">${Array.from({ length: 12 }, () => '<div class="skeleton" style="height:17rem"></div>').join('')}</div>`;
  const variables = {
    page: S.page, perPage: 24, type: S.type.toUpperCase(),
    search: S.q || undefined, genre: S.genre || undefined, format: S.format || undefined,
    year: S.year ? S.year + '%' : undefined,
    sort: [S.sort || (S.q ? 'SEARCH_MATCH' : 'POPULARITY_DESC')],
  };
  try {
    const { Page } = await api(LIST_QUERY, variables);
    if (my !== token) return;
    if (!Page.media.length) { box.innerHTML = `<p class="text-center text-zinc-400 py-16">Aucun résultat pour ces critères.</p>`; return; }
    box.innerHTML = `<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">${Page.media.map((m) => cardHTML(norm(m, S.type))).join('')}</div>
      <div class="flex items-center justify-center gap-4 mt-8">
        <button class="btn-ghost min-h-[44px]" data-page="-1" ${S.page <= 1 ? 'disabled' : ''}>← Précédent</button>
        <span class="text-sm text-zinc-400">Page ${S.page} / ${Page.pageInfo.lastPage || 1}</span>
        <button class="btn-ghost min-h-[44px]" data-page="1" ${Page.pageInfo.hasNextPage ? '' : 'disabled'}>Suivant →</button>
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

/* ---------- Profil local (pseudo, avatar, historique) ---------- */
const PKEY = 'animex:profile', HKEY = 'animex:history', AVATARS = ['😎', '🦊', '🐱', '🐉', '👾', '🥷', '🎧', '🌸'];
const getProfile = () => { try { return { name: 'Otaku', avatar: '😎', ...JSON.parse(localStorage.getItem(PKEY)) }; } catch { return { name: 'Otaku', avatar: '😎' }; } };
const saveProfile = (p) => localStorage.setItem(PKEY, JSON.stringify(p));
const getHist = () => { try { return JSON.parse(localStorage.getItem(HKEY)) || []; } catch { return []; } };
function pushHist(c) {
  localStorage.setItem(HKEY, JSON.stringify([c, ...getHist().filter((h) => !(h.type === c.type && h.id === c.id))].slice(0, 20)));
}
function renderProfile() {
  const f = getFavs(), a = f.filter((x) => x.type === 'anime').length, m = f.length - a, p = getProfile(), h = getHist();
  view.innerHTML = `<h2 class="text-2xl font-bold mt-6 mb-4">Profil</h2>
    <div class="flex items-center gap-4 mb-4">
      <div class="w-16 h-16 shrink-0 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 grid place-items-center text-3xl">${p.avatar}</div>
      <input id="pname" maxlength="20" value="${esc(p.name)}" aria-label="Pseudo" class="w-full max-w-xs bg-[#18181B] border border-white/10 focus:border-indigo-500 outline-none rounded-xl px-4 min-h-[44px]">
    </div>
    <div class="flex flex-wrap gap-2 mb-6">${AVATARS.map((e) => `<button data-avatar="${e}" aria-label="Avatar ${e}" class="w-12 h-12 rounded-full text-2xl bg-[#18181B] ${e === p.avatar ? 'ring-2 ring-indigo-500' : ''}">${e}</button>`).join('')}</div>
    <div class="grid grid-cols-3 gap-3 max-w-lg">
      ${[['Favoris', f.length], ['Animés', a], ['Mangas', m]].map(([l, n]) => `<div class="bg-[#18181B] rounded-2xl p-4 text-center"><div class="text-3xl font-extrabold logo">${n}</div><div class="text-xs text-zinc-400 mt-1">${l}</div></div>`).join('')}
    </div>
    <h3 class="font-bold mt-8 mb-3">Historique de consultation</h3>
    ${h.length ? `<div class="row">${h.map(cardHTML).join('')}</div>` : '<p class="text-sm text-zinc-400">Aucune fiche consultée pour l\'instant.</p>'}
    <p class="text-sm text-zinc-400 mt-8 max-w-lg">Profil, favoris et historique restent uniquement dans ce navigateur (LocalStorage). Données : AniList.</p>
    <div class="flex flex-wrap gap-3 mt-4">
      <button class="btn-ghost min-h-[44px] text-rose-400" data-clear ${f.length ? '' : 'disabled'}>Vider mes favoris</button>
      <button class="btn-ghost min-h-[44px] text-rose-400" data-reset>Réinitialiser toutes les données</button>
    </div>`;
  $('#pname').addEventListener('input', (e) => saveProfile({ ...getProfile(), name: e.target.value.trim() || 'Otaku' }));
  updateFavUI();
}

/* ---------- Fiche détaillée ---------- */
async function openDetail(type, id) {
  const modal = $('#modal'), body = $('#modalBody');
  modal.classList.remove('hidden'); modal.scrollTop = 0; document.body.style.overflow = 'hidden';
  body.innerHTML = `<div class="flex justify-center py-32"><div class="spinner"></div></div>`;
  try {
    const { Media: d } = await api(DETAIL_QUERY, { id, type: type.toUpperCase() });
    const c = norm(d, type), isA = type === 'anime';
    const fmt = (x) => (x?.year ? [x.day, x.month, x.year].filter(Boolean).join('/') : '');
    const when = fmt(d.startDate) ? `${fmt(d.startDate)}${fmt(d.endDate) ? ' → ' + fmt(d.endDate) : ''}` : '—';
    const studios = (d.studios?.nodes || []).map((s) => s.name).join(', ') || '—';
    const authors = (d.staff?.edges || []).filter((e) => /story|art/i.test(e.role))
      .map((e) => `${e.node.name.full} (${e.role})`).join(', ') || '—';
    const yt = d.trailer?.site === 'youtube' ? `https://www.youtube.com/embed/${encodeURIComponent(d.trailer.id)}` : '';
    const count = isA ? d.episodes : d.chapters;
    const sim = (d.recommendations?.nodes || []).map((n) => n.mediaRecommendation).filter(Boolean).map((m) => norm(m, type));
    pushHist(c);
    body.innerHTML = `<div class="p-5 md:p-8 pt-14 md:pt-8">
      <div class="flex flex-col sm:flex-row gap-6">
        <img src="${esc(d.coverImage?.extraLarge || c.img) || PLACEHOLDER}" alt="${esc(c.title)}" class="w-44 sm:w-56 rounded-2xl shadow-xl self-center sm:self-start">
        <div class="flex-1 min-w-0">
          <h2 class="text-2xl md:text-3xl font-extrabold leading-tight">${esc(d.title.english || d.title.romaji)}</h2>
          <p class="text-zinc-400 mt-1">${esc(d.title.native || '')}</p>
          <div class="flex flex-wrap gap-2 mt-3 text-sm">
            <span class="badge text-amber-300">★ ${c.score ?? 'N/A'}</span><span class="badge">${esc(c.kind)}</span><span class="badge">${esc(STATUS[d.status] || d.status || '')}</span>
          </div>
          <dl class="mt-4 text-sm space-y-1 text-zinc-300">
            <div><dt class="inline text-zinc-500">${isA ? 'Épisodes' : 'Chapitres'} : </dt><dd class="inline">${count ?? '—'}</dd></div>
            <div><dt class="inline text-zinc-500">Sortie : </dt><dd class="inline">${esc(when)}</dd></div>
            <div><dt class="inline text-zinc-500">Popularité : </dt><dd class="inline">${(d.popularity ?? 0).toLocaleString('fr-FR')} membres · ${(d.favourites ?? 0).toLocaleString('fr-FR')} favoris</dd></div>
            <div><dt class="inline text-zinc-500">Genres : </dt><dd class="inline">${esc((d.genres || []).join(', ') || '—')}</dd></div>
            <div><dt class="inline text-zinc-500">${isA ? 'Studio' : 'Auteurs'} : </dt><dd class="inline">${esc(isA ? studios : authors)}</dd></div>
          </dl>
          <button class="btn-ghost mt-4" data-fav data-type="${type}" data-id="${id}" data-label="1" data-item='${esc(JSON.stringify(c))}'>♡</button>
        </div>
      </div>
      <h3 class="font-bold mt-6 mb-2">Synopsis</h3>
      <p class="text-zinc-300 text-sm leading-relaxed whitespace-pre-line">${esc(clean(d.description) || 'Pas de synopsis disponible.')}</p>
      ${yt ? `<h3 class="font-bold mt-6 mb-2">Bande-annonce</h3><div class="aspect-video rounded-2xl overflow-hidden bg-black"><iframe class="w-full h-full" src="${esc(yt)}" allowfullscreen loading="lazy" title="Bande-annonce"></iframe></div>` : ''}
      ${sim.length ? `<h3 class="font-bold mt-6 mb-2">Titres similaires</h3><div class="row">${sim.map(cardHTML).join('')}</div>` : ''}
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
  const av = t.closest('[data-avatar]');
  if (av) { saveProfile({ ...getProfile(), avatar: av.dataset.avatar }); return renderProfile(); }
  if (t.closest('[data-reset]') && confirm('Réinitialiser toutes les données locales (favoris, historique, profil) ?')) {
    [KEY, HKEY, PKEY].forEach((k) => localStorage.removeItem(k)); updateFavUI(); return renderProfile();
  }
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
