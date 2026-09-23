/* typeset.js — 종이 사전 조판기
 *
 *  ① 모든 덩이(blk)를 단 너비 그대로인 보이지 않는 자리에 한 번 앉힌다.
 *  ② 각 덩이의 행 상자를 실측한다. (Range.getClientRects)
 *  ③ 들어가는 항목은 함께 담고, 긴 항목만 단 높이에 맞추어 행 단위로 끊는다. 끊긴 덩이는 같은 너비에서
 *     그대로 다시 앉힌 뒤 위로 밀어 올려 잘라 보이므로 줄바꿈이 어긋나지 않는다.
 *
 *  표제어가 단 맨 아래에 홀로 남거나, 한 줄만 다음 단으로 넘어가는 일은 막는다.
 */

const MIN_LINES = 2;   // 끊을 때 양쪽에 최소한 남겨야 할 줄 수

/* ── 덩이 만들기 ─────────────────────────────────────────────────────────── */

export function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/**
 * 사전 한 부를 덩이 배열로 푼다.
 * 표제어는 원고에 적힌 표시 이름 그대로 나온다. (찾기는 문자를 가리지 않는다)
 * @param {object} dict  빌드가 낸 {meta, entries, index}
 * @returns {Array<{e:number, kind:string, html:string}>}
 */
export function buildBlocks(dict) {
  const blocks = [];
  const { entries } = dict;

  let lastIni = null;
  entries.forEach((en, ei) => {
    if (en.ini !== lastIni) {
      lastIni = en.ini;
      blocks.push({ e: ei, kind: 'letter', ini: en.ini, html: `<span class="letter">${esc(en.ini)}</span>` });
    }

    /* 표제어 줄 */
    let h = `<span class="hw">${esc(en.hw)}</span>`;
    if (en.hom) h += `<sup class="hom">${en.hom}</sup>`;
    if (en.ipa) h += `<span class="ipa">/${esc(en.ipa)}/</span>`;
    if (en.pos) h += `<span class="pos">${esc(en.pos)}</span>`;
    if (en.infl) h += `<span class="infl">${esc(en.infl)}</span>`;
    blocks.push({ e: ei, kind: 'hw', html: h, anchor: true });

    /* 뜻 */
    const sn = en.sn ?? [];
    const numbered = sn.length > 1;
    sn.forEach((s, si) => {
      let b = '';
      if (numbered) b += `<span class="num">${circled(si + 1)}</span>`;
      if (s.lbl) b += `<span class="lbl">${esc(s.lbl)}</span>`;
      b += `<span class="gloss">${esc(s.d)}</span>`;
      blocks.push({ e: ei, kind: 'sense', html: b });
      for (const x of s.ex ?? []) {
        let t = `<span class="ex-t">${esc(x.t)}</span>`;
        if (x.g) t += `<span class="ex-g">${esc(x.g)}</span>`;
        blocks.push({ e: ei, kind: 'ex', html: t });
      }
    });

    if (en.et) blocks.push({ e: ei, kind: 'etym', html: `<span class="etym"><span class="mark">←</span>${esc(en.et)}</span>` });
    if (en.see && en.see.length) {
      const links = en.see.map((s) =>
        s.i === undefined ? esc(s.t) : `<a class="xref" data-go="${s.i}">${esc(s.t)}</a>`).join(', ');
      blocks.push({ e: ei, kind: 'see', html: `<span class="see"><span class="mark">⇒</span>${links}</span>` });
    }
    if (en.nt) blocks.push({ e: ei, kind: 'note', html: `<span class="note">${esc(en.nt)}</span>` });
    blocks.push({ e: ei, kind: 'gap', html: '' });
  });

  return blocks;
}

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
function circled(n) { return n <= CIRCLED.length ? CIRCLED[n - 1] : n + '.'; }

export function blockHtml(b) {
  return `<div class="blk blk--${b.kind}"><div class="blk__in">${b.html}</div></div>`;
}

/* ── 실측 ─────────────────────────────────────────────────────────────── */

/**
 * 덩이마다 {h, lines:[{t,b}]} 를 잰다.
 * @param {HTMLElement} host  #measure — 단 너비와 같은 폭으로 맞춰 둔 자리
 */
export function measureBlocks(host, blocks) {
  host.innerHTML = blocks.map(blockHtml).join('');
  const els = host.children;
  // 배치를 한 번만 일으키고 몰아서 읽는다
  const hostTop = host.getBoundingClientRect().top;
  const range = document.createRange();
  const padOf = new Map();          // 덩이 갈래마다 아래 여백은 늘 같다
  const out = new Array(blocks.length);
  for (let i = 0; i < blocks.length; i++) {
    const el = els[i];
    const r = el.getBoundingClientRect();
    const inner = el.firstElementChild;
    const kind = blocks[i].kind;
    if (kind === 'gap') { out[i] = { h: r.height, top: r.top - hostTop, lines: [] }; continue; }
    if (!padOf.has(kind)) padOf.set(kind, parseFloat(getComputedStyle(inner).paddingBottom) || 0);
    out[i] = {
      h: r.height,
      top: r.top - hostTop,
      lines: lineBoxes(range, inner, r.top, padOf.get(kind)),
    };
  }
  host.innerHTML = '';
  return out;
}

/** 한 덩이 안의 행 상자를 (덩이 위쪽 기준으로) 뽑는다. */
function lineBoxes(range, inner, blockTop, pad) {
  range.selectNodeContents(inner);
  const rects = range.getClientRects();
  const rows = [];
  for (const q of rects) {
    if (!q.height) continue;
    const last = rows[rows.length - 1];
    if (last && q.top + q.height / 2 < last.b) {
      last.t = Math.min(last.t, q.top);
      last.b = Math.max(last.b, q.bottom);
    } else {
      rows.push({ t: q.top, b: q.bottom });
    }
  }
  // 덩이 아래 여백까지 마지막 행에 얹는다
  if (rows.length) rows[rows.length - 1].b += pad;
  return rows.map((r) => ({ t: r.t - blockTop, b: r.b - blockTop }));
}

/* ── 담기 ─────────────────────────────────────────────────────────────── */

/**
 * 덩이를 단과 면에 담는다.
 * @param {Array} blocks
 * @param {Array} sizes    measureBlocks 결과
 * @param {number} colH    한 단의 높이 (px)
 * @param {number} perPage 한 면의 단 수
 * @param {boolean} keepEntries 내부 시험 조판에서는 false로 재진입을 막는다
 * @returns {{pages:Array, ofEntry:Int32Array}}
 *   pages[i] = {cols:[[{b, clipTop, clipH}]], first, last}
 *   ofEntry[entryIndex] = 그 표제어가 시작하는 면의 번호(본문 기준 0부터)
 */
export function packPages(blocks, sizes, colH, perPage, keepEntries = true) {
  const pages = [];
  let cols = [];
  let col = [];
  let y = 0;

  const flushCol = () => {
    cols.push(col); col = []; y = 0;
    if (cols.length >= perPage) { pages.push({ cols }); cols = []; }
  };

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i], s = sizes[i];
    // 항목 전체를 먼저 확인한다. 머리글자가 있으면 함께 옮긴다.
    const entryStart = b.kind === 'letter' ||
      (b.kind === 'hw' && blocks[i - 1]?.kind !== 'letter');
    if (keepEntries && entryStart) {
      let end = i;
      while (end < blocks.length && blocks[end].e === b.e && blocks[end].kind !== 'gap') end++;
      const entrySizes = sizes.slice(i, end);
      const height = entrySizes.reduce((sum, size) => sum + size.h, 0);
      if (height <= colH) {
        // 한 단에 들어가는 항목은 어느 덩이도 다음 단으로 넘기지 않는다.
        if (y > 0 && y + height > colH) flushCol();
      } else if (perPage > 1 && (cols.length || col.length)) {
        // 긴 항목은 기존 행 분할 규칙으로 시험 조판한다.
        // 현재 쪽에는 안 들어가지만 빈 쪽에는 들어가면 쪽째 넘긴다.
        const entryBlocks = blocks.slice(i, end).map((block) => ({ ...block, e: 0 }));
        const fits = (used, columns) => {
          const prefix = used > 0 ? [{ e: 0, kind: 'reserve' }] : [];
          const prefixSizes = used > 0 ? [{ h: used, lines: [] }] : [];
          return packPages([...prefix, ...entryBlocks], [...prefixSizes, ...entrySizes],
            colH, columns, false).pages.length === 1;
        };
        if (!fits(y, perPage - cols.length) && fits(0, perPage)) {
          do { flushCol(); } while (cols.length);
        }
      }
    }
    if (b.kind === 'gap') {
      // 단 끝의 여백은 흘려 버린다
      if (y > 0) y = Math.min(colH, y + s.h);
      continue;
    }

    // 머리글자가 단 맨 아래에 홀로 남지 않게 한다 (머리글자 + 첫 표제어 + 첫 줄)
    if (b.kind === 'letter' && y > 0) {
      const need = s.h + (sizes[i + 1]?.h ?? 0) + (sizes[i + 2]?.lines?.[0]?.b ?? 0);
      if (colH - y < need) flushCol();
    }

    let offset = 0;                 // 이 덩이에서 이미 실은 높이
    let guard = 0;
    while (offset < s.h - 0.5) {
      if (guard++ > 400) break;
      const rest = s.h - offset;
      const avail = colH - y;

      if (rest <= avail + 0.5) {
        col.push({ b: i, clipTop: offset || null, clipH: offset ? rest : null });
        y += rest;
        offset = s.h;
        break;
      }

      const splittable = b.kind !== 'hw' && b.kind !== 'letter' && s.lines.length >= MIN_LINES * 2;
      let cut = -1;
      if (splittable && avail > 0) {
        for (let k = 0; k < s.lines.length; k++) {
          if (s.lines[k].t < offset - 0.5) continue;          // 이미 실은 줄
          if (s.lines[k].b - offset <= avail + 0.5) cut = k; else break;
        }
        // 양쪽에 최소 줄 수가 남는지 본다
        const before = s.lines.filter((l) => l.t >= offset - 0.5 && l.b <= s.lines[cut]?.b + 0.5).length;
        const after = s.lines.filter((l) => l.t > s.lines[cut]?.b - 0.5).length;
        if (cut < 0 || before < MIN_LINES || after < MIN_LINES) cut = -1;
      }

      if (cut >= 0) {
        const h = s.lines[cut].b - offset;
        col.push({ b: i, clipTop: offset, clipH: h });
        offset = s.lines[cut + 1] ? s.lines[cut + 1].t : s.lines[cut].b;
        flushCol();
      } else {
        // 못 끊으면 통째로 다음 단으로. 단 맨 위인데도 안 들어가면 그냥 싣는다.
        if (y === 0) {
          col.push({ b: i, clipTop: offset || null, clipH: offset ? rest : null });
          y += rest; offset = s.h;
          break;
        }
        flushCol();
      }
    }

    // 표제어 줄이 단 맨 아래에 홀로 남지 않게 한다.
    // 뒤따르는 덩이가 끊기지 않는 것이면 그 덩이가 통째로 들어갈 자리가 있어야 한다.
    if (b.kind === 'hw' && col.length && col[col.length - 1].b === i) {
      const nb = blocks[i + 1], next = sizes[i + 1];
      const splitNext = nb && nb.kind !== 'hw' && nb.kind !== 'letter' && nb.kind !== 'gap'
        && next.lines.length >= MIN_LINES * 2;
      const need = !nb || nb.kind === 'gap' ? 0
        : splitNext ? (next.lines[MIN_LINES - 1]?.b ?? next.h)
        : next.h;
      if (next && need > 0 && need <= colH && colH - y < need - 0.5) {
        col.pop();
        // 바로 앞의 머리글자 가름줄도 함께 데려간다 (홀로 남지 않게)
        const lead = col.length && blocks[col[col.length - 1].b].kind === 'letter' ? col.pop() : null;
        flushCol();
        if (lead) { col.push(lead); y += sizes[lead.b].h; }
        col.push({ b: i, clipTop: null, clipH: null });
        y += s.h;
      }
    }
  }

  if (col.length) cols.push(col);
  if (cols.length) { while (cols.length < perPage) cols.push([]); pages.push({ cols }); }

  // 면마다 러닝헤드로 쓸 첫·끝 표제어를 적어 둔다
  const ofEntry = new Int32Array(blocks.length ? blocks[blocks.length - 1].e + 1 : 0).fill(-1);
  pages.forEach((p, pi) => {
    let first = -1, last = -1;
    for (const c of p.cols) for (const it of c) {
      const e = blocks[it.b].e;
      if (first < 0) first = e;
      last = e;
      if (blocks[it.b].kind === 'hw' && ofEntry[e] < 0) ofEntry[e] = pi;
    }
    p.first = first; p.last = last;
  });
  for (let i = 0; i < ofEntry.length; i++) if (ofEntry[i] < 0) ofEntry[i] = i > 0 ? ofEntry[i - 1] : 0;

  return { pages, ofEntry };
}

/* ── 그리기 ───────────────────────────────────────────────────────────── */

/** 담긴 결과대로 한 단을 그린다. */
export function renderCol(colEl, items, blocks) {
  let html = '';
  for (const it of items) {
    const b = blocks[it.b];
    if (it.clipTop === null || it.clipTop === undefined) {
      if (it.clipH == null) html += `<div class="blk blk--${b.kind}" data-b="${it.b}"><div class="blk__in">${b.html}</div></div>`;
      else html += `<div class="blk blk--${b.kind}" data-b="${it.b}" style="height:${it.clipH}px"><div class="blk__in">${b.html}</div></div>`;
    } else {
      html += `<div class="blk blk--${b.kind}" data-b="${it.b}" style="height:${it.clipH}px">` +
              `<div class="blk__in" style="margin-top:${-it.clipTop}px">${b.html}</div></div>`;
    }
  }
  colEl.innerHTML = html;
}
