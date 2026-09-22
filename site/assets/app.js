/* app.js — 사전 읽개
 *
 *  화면에 있는 것은 셋뿐이다 — 위 가운데의 찾기 칸과 사전 고르개, 지면, 아래 쪽 넘김.
 *  지면은 두 단이면 520px, 한 단이면 260px. 쪽은 남아 있으나 낱장으로 그리지 않는다.
 */

import { makeFolder, search } from './fold.js';
import { buildBlocks, measureBlocks, packPages, renderCol, esc } from './typeset.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const W2 = 520;   // 두 단일 때의 가로
const W1 = 260;   // 한 단일 때의 가로
const STAGE_PAD = 10;   // 위 도구와 지면 사이 (paper.css 의 .stage 위 여백과 같게)

const state = {
  list: [],        // 사전 목록
  dict: null,      // 지금 펼친 사전
  folder: null,
  blocks: [],
  pages: [],       // 담긴 쪽들
  ofEntry: null,   // 표제어 → 쪽 번호 (0부터)
  cur: 0,
  sizeCache: null,
};

/* ── 치수 ─────────────────────────────────────────────────────────────── */

function geometry() {
  const vw = innerWidth, vh = innerHeight;
  const gutter = vw < 420 ? 14 : 24;
  const room = Math.max(200, vw - gutter * 2);

  const cols = room >= W2 ? 2 : 1;
  const pw = Math.min(cols === 2 ? W2 : W1, room);
  const colgap = cols === 2 ? 20 : 0;
  const colw = (pw - (cols - 1) * colgap) / cols;

  /* 한 단일 때에는 위 도구도 지면보다 좁아지므로, 높이를 재기 전에 먼저 반영한다 */
  document.documentElement.dataset.cols = cols;
  document.documentElement.style.setProperty('--pw', pw + 'px');

  const topH = $('.top')?.offsetHeight ?? 52;
  const statusH = $('.statusbar')?.offsetHeight ?? 44;

  /* 위 도구 + 지면 + 아래 넘김이 화면 높이를 꼭 채우게 한다.
     지면 아래의 여백은 상태띠가 스스로 가진 안쪽 여백이 맡는다. */
  const headH = 23;
  const ph = Math.max(200, vh - (topH + STAGE_PAD) - statusH);
  const colh = ph - headH;

  return { pw, ph, cols, colgap, colw, colh };
}

function applyGeometry(g) {
  const r = document.documentElement.style;
  r.setProperty('--pw', g.pw + 'px');
  r.setProperty('--ph', g.ph + 'px');
  r.setProperty('--colgap', g.colgap + 'px');
  r.setProperty('--colh', g.colh + 'px');
  r.setProperty('--top-h', ($('.top')?.offsetHeight ?? 52) + 'px');
  $('#measure').style.width = g.colw + 'px';
}

/* ── 사전 펼치기 ──────────────────────────────────────────────────────── */

async function openDict(id) {
  const res = await fetch(`data/${encodeURIComponent(id)}.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${id} 사전을 불러오지 못했습니다.`);
  state.dict = await res.json();
  state.folder = makeFolder(state.dict.meta);
  state.sizeCache = null;
  document.title = `${state.dict.meta.name} — 사전`;
  $('#dictSel').value = id;
  typeset({});
}

/* ── 조판 ─────────────────────────────────────────────────────────────── */

function typeset({ keepPage = false, keepEntry = null } = {}) {
  const g = geometry();
  applyGeometry(g);

  state.blocks = buildBlocks(state.dict);

  /* 같은 치수로 다시 조판할 때에는 잰 값을 다시 쓴다 */
  const stamp = [state.dict.meta.id, Math.round(g.colw * 10)].join('|');
  let sizes;
  if (state.sizeCache && state.sizeCache.stamp === stamp) {
    sizes = state.sizeCache.sizes;
  } else {
    sizes = measureBlocks($('#measure'), state.blocks);
    state.sizeCache = { stamp, sizes };
  }

  const { pages, ofEntry } = packPages(state.blocks, sizes, g.colh, g.cols);
  state.pages = pages;
  state.ofEntry = ofEntry;

  if (keepEntry != null) goEntry(keepEntry, { mark: false });
  else if (keepPage) goPage(state.cur);
  else goPage(0);
}

/** 다시 조판해도 보던 자리를 지키기 위한 인자 */
function keepView() {
  const pg = state.pages[state.cur];
  return pg ? { keepEntry: pg.first } : { keepPage: true };
}

const clampPage = (i) => Math.max(0, Math.min(state.pages.length - 1, i | 0));

/* ── 그리기 ───────────────────────────────────────────────────────────── */

function render() {
  const el = $('.page');
  const pg = state.pages[state.cur];
  if (!pg) { el.innerHTML = ''; return; }

  const entries = state.dict.entries;
  const hw = (i) => entries[i]?.hw ?? '';
  const cols = pg.cols.map(() => '<div class="col"></div>').join('');
  el.innerHTML =
    `<div class="page__head"><span class="rh">${esc(hw(pg.first))}</span>` +
    `<span class="rh rh--last">${esc(hw(pg.last))}</span></div>` +
    `<div class="page__body">${cols}</div>`;
  const colEls = $$('.col', el);
  pg.cols.forEach((items, i) => renderCol(colEls[i], items, state.blocks));

  $('.pager--prev').disabled = state.cur <= 0;
  $('.pager--next').disabled = state.cur >= state.pages.length - 1;
  updateStatus();
}

function goPage(i) {
  state.cur = clampPage(i);
  render();
}

function turn(dir) {
  const t = clampPage(state.cur + dir);
  if (t !== state.cur) goPage(t);
}

function goEntry(entryIdx, { mark = true } = {}) {
  goPage(state.ofEntry?.[entryIdx] ?? 0);
  if (!mark) return;
  for (const el of $$('.page .blk--hw')) {
    const b = state.blocks[+el.dataset.b];
    if (b && b.e === entryIdx) {
      el.classList.add('is-hit');
      setTimeout(() => el.classList.remove('is-hit'), 2400);
      break;
    }
  }
}

function updateStatus() {
  const total = Math.max(1, state.pages.length);
  $('#statusPage').textContent = String(state.cur + 1);
  $('#statusTotal').textContent = String(total);
  const sl = $('#slider');
  sl.max = String(total - 1);
  sl.value = String(state.cur);
}

/* ── 찾기 ─────────────────────────────────────────────────────────────── */

let hits = [], hitAt = -1;

function runSearch() {
  const q = $('#q').value;
  const box = $('.results');
  if (!q.trim()) { box.hidden = true; hits = []; return; }
  hits = search(state.dict.entries, q, state.folder, { limit: 40 });
  hitAt = hits.length ? 0 : -1;

  if (!hits.length) {
    box.innerHTML = `<div class="results__none">‘${esc(q)}’ 에 맞는 표제어가 없습니다.</div>`;
  } else {
    box.innerHTML = hits.map((h, i) => {
      const e = h.entry;
      const folio = (state.ofEntry[h.index] ?? 0) + 1;
      const gloss = (e.sn ?? []).map((s) => s.d).join('; ');
      return `<button type="button" class="results__hit" data-i="${h.index}" aria-selected="${i === 0}">
        <span class="results__folio">${folio} 쪽</span>
        <span class="results__hw">${esc(e.hw)}${e.hom ? `<sup>${e.hom}</sup>` : ''}</span>
        ${h.via ? `<span class="results__alt">${esc(h.via)}</span>` : ''}
        <span class="results__g">${esc(gloss)}</span></button>`;
    }).join('');
  }

  const r = $('.find').getBoundingClientRect();
  const w = Math.round(Math.max(r.width, 300));
  box.style.left = Math.round(Math.max(8, Math.min(r.left, innerWidth - w - 8))) + 'px';
  box.style.top = Math.round(r.bottom + 8) + 'px';
  box.style.width = w + 'px';
  box.hidden = false;
}

function moveHit(d) {
  if (!hits.length) return;
  hitAt = (hitAt + d + hits.length) % hits.length;
  const btns = $$('.results__hit');
  btns.forEach((b, i) => b.setAttribute('aria-selected', i === hitAt));
  btns[hitAt]?.scrollIntoView({ block: 'nearest' });
}

function takeHit(i) {
  const h = hits[i];
  if (!h) return;
  $('.results').hidden = true;
  $('#q').blur();
  goEntry(h.index);
  location.hash = `#/${state.dict.meta.id}/w/${encodeURIComponent(state.dict.entries[h.index].k)}`;
}

/* ── 주소 ─────────────────────────────────────────────────────────────── */

function readHash() {
  const m = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  return { id: m[0], kind: m[1], arg: m[2] };
}

async function routeFromHash() {
  const { id, kind, arg } = readHash();
  /* 주소에 사전이 없으면 첫 사전을 기본으로 편다 */
  const wanted = state.list.find((d) => d.id === id) ? id : state.list[0]?.id;
  if (!wanted) return;
  if (!state.dict || state.dict.meta.id !== wanted) await openDict(wanted);
  if (kind === 'w' && arg) {
    const i = state.dict.entries.findIndex((e) => e.k === arg || e.ks.toLowerCase() === arg.toLowerCase());
    if (i >= 0) goEntry(i);
  } else if (kind === 'p' && arg) {
    goPage(parseInt(arg, 10) - 1);
  }
}

/* ── 붙이기 ───────────────────────────────────────────────────────────── */

function bind() {
  $('.pager--prev').addEventListener('click', () => turn(-1));
  $('.pager--next').addEventListener('click', () => turn(1));

  addEventListener('keydown', (e) => {
    const inField = e.target.matches('input, select, textarea');
    if (e.key === '/' && !inField) { e.preventDefault(); $('#q').focus(); $('#q').select(); return; }
    if (inField && e.target.id === 'q') {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveHit(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveHit(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); takeHit(hitAt); }
      else if (e.key === 'Escape') { $('.results').hidden = true; e.target.value = ''; e.target.blur(); }
      return;
    }
    if (inField) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); turn(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); turn(-1); }
    else if (e.key === 'Home') goPage(0);
    else if (e.key === 'End') goPage(state.pages.length - 1);
  });

  /* 참고 항목 누르기 */
  $('.stage').addEventListener('click', (e) => {
    const xref = e.target.closest('.xref');
    if (xref) goEntry(+xref.dataset.go);
  });

  /* 휠 — 굴리면 쪽이 넘어간다 */
  let wheelLock = 0;
  $('.stage').addEventListener('wheel', (e) => {
    const now = Date.now();
    if (now < wheelLock) return;
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(d) < 16) return;
    wheelLock = now + 240;
    turn(d > 0 ? 1 : -1);
  }, { passive: true });

  /* 손가락 */
  let tx = 0, ty = 0, tracking = false;
  $('.stage').addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    tx = e.touches[0].clientX; ty = e.touches[0].clientY; tracking = true;
  }, { passive: true });
  $('.stage').addEventListener('touchend', (e) => {
    if (!tracking) return; tracking = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - tx, dy = t.clientY - ty;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.3) turn(dx < 0 ? 1 : -1);
    else if (Math.abs(dy) > 56 && Math.abs(dy) > Math.abs(dx) * 1.3) turn(dy < 0 ? 1 : -1);
  }, { passive: true });

  /* 찾기 */
  let deb;
  $('#q').addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(runSearch, 90); });
  $('#q').addEventListener('focus', () => { if ($('#q').value.trim()) runSearch(); });
  $('.results').addEventListener('click', (e) => {
    const b = e.target.closest('.results__hit');
    if (b) takeHit($$('.results__hit').indexOf(b));
  });
  addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.results') && !e.target.closest('.find')) $('.results').hidden = true;
  });

  $('#dictSel').addEventListener('change', (e) => { location.hash = `#/${e.target.value}`; });
  $('#slider').addEventListener('input', (e) => goPage(+e.target.value));

  addEventListener('hashchange', () => routeFromHash());

  let rz;
  addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(() => { if (state.dict) typeset(keepView()); }, 160);
  });
}

/* ── 시작 ─────────────────────────────────────────────────────────────── */

async function main() {
  const idx = await (await fetch('data/index.json', { cache: 'no-cache' })).json();
  state.list = idx.dicts ?? [];
  const sel = $('#dictSel');
  sel.innerHTML = state.list
    .map((d) => `<option value="${esc(d.id)}">${esc(d.nativeName || d.name)}</option>`)
    .join('');
  sel.hidden = state.list.length < 2;

  bind();
  await routeFromHash();

  /* 웹글꼴이 늦게 닿으면 글자 너비가 달라지므로 다시 조판한다 */
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => {
      if (!state.dict) return;
      state.sizeCache = null;
      typeset(keepView());
      document.documentElement.dataset.ready = '1';
    });
  } else {
    document.documentElement.dataset.ready = '1';
  }
}

main().catch((err) => {
  document.body.insertAdjacentHTML('beforeend',
    `<div style="position:fixed;inset:auto 16px 16px 16px;padding:14px 16px;background:#7a2018;color:#fff;border-radius:8px;font:14px/1.6 system-ui">
      사전을 여는 중 문제가 생겼습니다 — ${esc(err.message)}</div>`);
  console.error(err);
});
