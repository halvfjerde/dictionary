/* fold.js — 라틴 · 키릴 · 그리스 문자 호환 검색 엔진
 *
 * 하나의 모듈을 빌드(Node)와 브라우저가 함께 쓴다.
 *
 * 핵심 아이디어
 *   어떤 문자로 적힌 낱말이든 "정식 라틴 자소열(strict key)"로 접는다.
 *   strict key 에서 결합 부호(악센트)를 떼면 "loose key" 가 된다.
 *   검색은 기본적으로 loose key 로 한다. → 문자·악센트를 모두 무시한 검색.
 *
 *   γádecuï  →  strict "gádecuï"  →  loose "gadecui"
 *   гадецуи  →  strict "gadecui"  →  loose "gadecui"
 *   gadecui  →  strict "gadecui"  →  loose "gadecui"
 */

/* ── 범용 자소표 (언어별 lang.yaml 의 graphemes 로 덮어쓸 수 있다) ───────── */

const GREEK = `α:a β:b γ:g δ:d ε:e ζ:z η:ē θ:th ι:i κ:k λ:l μ:m ν:n ξ:ks ο:o
π:p ρ:r σ:s ς:s τ:t υ:u φ:ph χ:kh ψ:ps ω:ō ϝ:w ϐ:b ϑ:th ϕ:ph ϰ:k ϱ:r ϲ:s ϳ:j`;

const CYRILLIC = `а:a б:b в:v г:g ґ:g ѓ:ǵ д:d ђ:đ е:e ё:ë є:je ж:ž з:z ѕ:dz
и:i і:i ї:ï й:j ј:j к:k ќ:ḱ л:l љ:lj м:m н:n њ:nj о:o п:p р:r с:s т:t ћ:ć
у:u ў:w ф:f х:h ц:c ч:č џ:dž ш:š щ:šč ъ:ʺ ы:y ь:ʹ э:è ю:ju я:ja
ѣ:ě ѳ:th ѵ:y ѫ:ǫ ѧ:ę ә:ə ғ:ğ қ:q ң:ñ ө:ö ұ:u ү:ü һ:h`;

/* 악센트가 아니라 글자에 붙은 획(stroke)이라 NFD 로는 떨어지지 않는 것들.
   loose 단계에서만 푼다. */
const LOOSE_EXTRA = `ø:o ł:l đ:d ħ:h ŧ:t ɨ:i ʉ:u ɵ:o ƶ:z ǥ:g ȼ:c ɖ:d ɗ:d
æ:ae œ:oe ß:ss ĳ:ij ʺ: ʹ: ə:e ǫ:o ę:e`;

/* 검색 키에서 통째로 지우는 문자 (loose 단계) */
const DEFAULT_IGNORE =
  "'’‘ʼ‛´`·‧∙•" +
  '–—‑-−_/\\|()[]{}<>.,;:!?"“”«»…*†‡ \t ';

function parseTable(src) {
  const t = Object.create(null);
  for (const pair of src.split(/\s+/)) {
    if (!pair) continue;
    const i = pair.indexOf(':');
    if (i < 0) continue;
    t[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return t;
}

const UNIVERSAL = Object.assign(parseTable(GREEK), parseTable(CYRILLIC));
const LOOSE_MAP = parseTable(LOOSE_EXTRA);

/* ── 문자열 분해 ──────────────────────────────────────────────────────── */

const RE_MARK = /\p{M}/u;

/** 문자열을 {base, marks[]} 단위로 분해한다. NFD 기준. */
export function toUnits(s) {
  const out = [];
  for (const ch of s.normalize('NFD')) {
    if (RE_MARK.test(ch)) {
      if (out.length) out[out.length - 1].marks.push(ch);
    } else {
      out.push({ base: ch, marks: [] });
    }
  }
  return out;
}

function stripMarks(s) {
  return s.normalize('NFD').replace(/\p{M}+/gu, '').normalize('NFC');
}

/**
 * units[i] 부터 최장일치를 찾는다.
 * 부호까지 포함한 형태(š)를 먼저 맞춰 보고, 안 되면 밑글자(s)만 맞춘 뒤 부호를 되붙인다.
 * @param lookup  후보 문자열을 받아 치환값을 돌려주거나 undefined
 * @returns {{n:number, to:*, marks:string}|null}
 */
function match(units, i, maxLen, lookup) {
  const room = Math.min(maxLen, units.length - i);
  for (let n = room; n >= 1; n--) {
    let full = '';
    for (let k = 0; k < n; k++) full += units[i + k].base + units[i + k].marks.join('');
    const hitFull = lookup(full.normalize('NFC').toLowerCase());
    if (hitFull !== undefined) return { n, to: hitFull, marks: '' };
  }
  for (let n = room; n >= 1; n--) {
    let base = '', marks = '';
    for (let k = 0; k < n; k++) { base += units[i + k].base; marks += units[i + k].marks.join(''); }
    const hitBase = lookup(base.toLowerCase());
    if (hitBase !== undefined) return { n, to: hitBase, marks };
  }
  return null;
}

/* ── 폴더(folder) 생성 ────────────────────────────────────────────────── */

/**
 * @param {object} lang  lang.yaml 에서 온 언어 정의
 *   lang.graphemes : [{key, latin, greek, cyrillic, ...}] — 이 언어의 자소표
 *   lang.ignore    : 검색에서 무시할 문자를 모은 문자열
 *   lang.collation : 사전 배열 순서 (strict key 기준, 공백 구분)
 *   lang.scripts   : ['latin','greek','cyrillic'] 처럼 지원 문자 목록
 *   lang.primaryScript : 표제어를 저장한 문자
 */
export function makeFolder(lang = {}) {
  const ignore = new Set((lang.ignore ?? DEFAULT_IGNORE).split(''));

  /* 최장일치 매칭용 표: 소스 문자열(소문자) → strict 치환값 */
  const table = Object.create(null);
  let maxLen = 1;
  const add = (from, to) => {
    if (!from) return;
    const f = from.toLowerCase();
    table[f] = to;
    if (f.length > maxLen) maxLen = f.length;
  };
  for (const [k, v] of Object.entries(UNIVERSAL)) add(k, v);

  /* 언어 자소표: 각 문자 표기형 → 그 자소의 key */
  const scripts = lang.scripts ?? ['latin', 'greek', 'cyrillic'];
  const graphemes = lang.graphemes ?? [];
  const byScript = Object.create(null); // script -> [forms]
  for (const g of graphemes) {
    const key = (g.key ?? g.latin ?? '').toLowerCase();
    if (!key) continue;
    for (const sc of scripts) {
      const form = g[sc];
      if (!form) continue;
      for (const variant of String(form).split('|')) add(variant, key);
    }
    add(key, key);
  }
  for (const sc of scripts) {
    byScript[sc] = graphemes.map((g) => String(g[sc] ?? g.key ?? '').split('|')[0]);
  }

  /** 문자·악센트를 그대로 둔 채 정식 라틴 자소열로 접는다. */
  function strict(input) {
    if (!input) return '';
    const units = toUnits(String(input).toLowerCase());
    let out = '';
    for (let i = 0; i < units.length; ) {
      const hit = match(units, i, maxLen, (probe) => (probe in table ? table[probe] : undefined));
      if (hit) {
        out += hit.to + hit.marks;
        i += hit.n;
      } else {
        out += units[i].base + units[i].marks.join('');
        i += 1;
      }
    }
    return out.normalize('NFC');
  }

  /** 문자·악센트를 모두 무시한 검색 키. */
  function loose(input) {
    let s = stripMarks(strict(input)).toLowerCase();
    let out = '';
    for (const ch of s) {
      if (ignore.has(ch)) continue;
      const rep = LOOSE_MAP[ch];
      out += rep === undefined ? ch : rep;
    }
    return out;
  }

  /* 정렬 ------------------------------------------------------------- */
  const collationList = (lang.collation ?? '').trim()
    ? lang.collation.trim().split(/\s+/)
    : null;
  /* 배열 순서는 어느 문자로 적어도 좋다. 안에서는 정식 자소열로 접어 견준다. */
  const collRank = Object.create(null);
  let collMax = 1;
  if (collationList) {
    collationList.forEach((el, i) => {
      const folded = strict(el).toLowerCase();
      if (!(folded in collRank)) collRank[folded] = i + 1;
      collRank[el.toLowerCase()] = collRank[el.toLowerCase()] ?? i + 1;
      collMax = Math.max(collMax, folded.length, el.length);
    });
  }

  /** 사전 배열 순서용 정렬 키 (숫자 배열). */
  function sortKey(headword) {
    const s = strict(headword);
    if (!collationList) {
      // 정의된 순서가 없으면: 악센트 무시 우선 → 악센트로 동점 처리
      return [loose(headword), s];
    }
    const ranks = [];
    for (let i = 0; i < s.length; ) {
      let matched = false;
      for (let n = Math.min(collMax, s.length - i); n >= 1; n--) {
        const probe = s.slice(i, i + n);
        if (probe in collRank) { ranks.push(collRank[probe]); i += n; matched = true; break; }
      }
      if (!matched) {
        const bare = stripMarks(s[i]).toLowerCase();
        ranks.push(bare in collRank ? collRank[bare] : 900 + s.codePointAt(i) / 1e6);
        i += 1;
      }
    }
    return [ranks.join(','), s];
  }

  function compare(a, b) {
    const ka = sortKey(a), kb = sortKey(b);
    if (collationList) {
      const ra = ka[0].split(',').map(Number), rb = kb[0].split(',').map(Number);
      const n = Math.max(ra.length, rb.length);
      for (let i = 0; i < n; i++) {
        const x = ra[i] ?? -1, y = rb[i] ?? -1;
        if (x !== y) return x - y;
      }
    } else if (ka[0] !== kb[0]) {
      return ka[0] < kb[0] ? -1 : 1;
    }
    return ka[1] < kb[1] ? -1 : ka[1] > kb[1] ? 1 : 0;
  }

  /* 다른 문자로 옮겨 적기 ---------------------------------------------- */

  /** headword 를 target 문자로 옮겨 적는다. 자소표가 없으면 null. */
  function translit(headword, target) {
    if (!graphemes.length || !byScript[target]) return null;
    const idxTable = Object.create(null);
    let mLen = 1;
    graphemes.forEach((g, gi) => {
      for (const sc of scripts) {
        const form = g[sc];
        if (!form) continue;
        for (const v of String(form).split('|')) {
          const f = v.toLowerCase();
          if (!(f in idxTable)) idxTable[f] = gi;
          if (f.length > mLen) mLen = f.length;
        }
      }
      const k = String(g.key ?? '').toLowerCase();
      if (k && !(k in idxTable)) idxTable[k] = gi;
    });

    const units = toUnits(String(headword));
    let out = '';
    for (let i = 0; i < units.length; ) {
      const hit = match(units, i, mLen, (p) => (p in idxTable ? idxTable[p] : undefined));
      if (hit) {
        const g = graphemes[hit.to];
        let rep = String(g[target] ?? g.key ?? '').split('|')[0];
        const firstBase = units[i].base;
        if (firstBase !== firstBase.toLowerCase() && rep) {
          rep = rep[0].toUpperCase() + rep.slice(1);
        }
        out += rep + hit.marks;
        i += hit.n;
      } else {
        // 자소표에 없는 글자: 라틴으로 옮길 때만 범용표로 메운다
        const ch = units[i].base + units[i].marks.join('');
        out += target === 'latin' ? strict(ch) : ch;
        i += 1;
      }
    }
    return out.normalize('NFC');
  }

  /** 첫 자소 (색인 탭·큰 머리글자용) */
  function initial(headword) {
    const s = strict(headword);
    if (!s) return '';
    if (collationList) {
      for (let n = Math.min(collMax, s.length); n >= 1; n--) {
        const probe = s.slice(0, n).toLowerCase();
        if (probe in collRank) return collationList[collRank[probe] - 1];
      }
    }
    return stripMarks(s[0]).toLowerCase();
  }

  /** 머리글자를 특정 문자로 보인 모습 (색인 탭·큰 머리글자용) */
  function initialIn(headword, script) {
    const key = initial(headword);
    if (!script || script === 'source') return key;
    const g = graphemes.find((x) => String(x.key ?? '').toLowerCase() === key);
    if (g && g[script]) return String(g[script]).split('|')[0];
    return key;
  }

  return { strict, loose, sortKey, compare, translit, initial, initialIn, scripts, graphemes };
}

/* ── 검색 ─────────────────────────────────────────────────────────────── */

/**
 * 표제어 목록에서 질의어에 맞는 것을 찾는다.
 *
 * 항목마다 세 갈래로 맞춰 본다.
 *   ① 표시 이름 (k = 느슨한 키, ks = 정식 자소열)
 *   ② 그 낱말에 손수 적어 둔 검색자 (fk / fks, 원래 글자는 fd)
 *   ③ 뜻풀이·보기글 (g)
 *
 * @param {Array} entries  빌드가 만든 항목 배열
 * @param {string} query
 * @param {object} folder  makeFolder 결과
 * @param {object} opt     {strict:boolean, limit:number}
 * @returns {Array<{entry, index, rank, via}>}  via 는 검색자로 걸렸을 때 그 검색자
 */
export function search(entries, query, folder, opt = {}) {
  const q = String(query ?? '').trim();
  if (!q) return [];
  const limit = opt.limit ?? 60;
  const useStrict = !!opt.strict;
  const key = useStrict ? folder.strict(q).toLowerCase() : folder.loose(q);
  const qLower = q.toLowerCase();
  if (!key && !qLower) return [];

  const out = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    let best = null;

    if (key) {
      const hay = useStrict ? (e.ks || '').toLowerCase() : e.k || '';
      const extra = (useStrict ? e.fks : e.fk) || [];
      for (let j = -1; j < extra.length; j++) {
        const s = j < 0 ? hay : String(extra[j] || '').toLowerCase();
        if (!s) continue;
        let rank = null;
        if (s === key) rank = 0;
        else if (s.startsWith(key)) rank = 1;
        else if (s.includes(key)) rank = 2;
        if (rank === null) continue;
        const own = j < 0 ? 0 : 1;          // 표시 이름이 검색자보다 앞선다
        if (!best || rank < best.rank || (rank === best.rank && own < best.own)) {
          best = { rank, own, len: s.length, via: j < 0 ? null : (e.fd && e.fd[j]) || null };
        }
      }
    }

    if (!best && e.g) {
      // 뜻풀이(한국어 등)에서도 찾는다
      const gi = e.g.indexOf(qLower);
      if (gi === 0) best = { rank: 3, own: 1, len: 0, via: null };
      else if (gi > 0) best = { rank: 4, own: 1, len: 0, via: null };
    }

    if (best) out.push({ i, ...best });
  }

  out.sort((a, b) => a.rank - b.rank || a.own - b.own || a.len - b.len || a.i - b.i);
  return out.slice(0, limit).map((r) => ({ entry: entries[r.i], index: r.i, rank: r.rank, via: r.via }));
}

export const _internal = { UNIVERSAL, LOOSE_MAP, DEFAULT_IGNORE, stripMarks };

(function () {
    'use strict';

    var HAN = '々-〇〻'
            + '぀-ゟ'
            + '゠-ヿ'
            + '㆐-㆟'
            + 'ㇰ-ㇿ'
            + '㐀-䶿'
            + '一-鿿'
            + '豈-﫿'
            + 'ｦ-ﾟ'
            + '\u{20000}-\u{2FA1F}'
            + '\u{30000}-\u{323AF}';
    var RUN = new RegExp('[' + HAN + ']+', 'gu');
    var HAS = new RegExp('[' + HAN + ']', 'u');

    var SKIP = 'ruby, rt, rp, script, style, noscript, textarea, input, select, option,'
             + ' code, pre, kbd, samp, svg, math, .katex, .hj, .no-hj, [contenteditable]';

    function wrapText(node) {
        var text = node.nodeValue;
        if (!text || !HAS.test(text)) return;
        var parent = node.parentElement;
        if (!parent || parent.closest(SKIP)) return;

        var frag = document.createDocumentFragment();
        var last = 0;
        RUN.lastIndex = 0;
        var m;
        while ((m = RUN.exec(text))) {
            if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
            var span = document.createElement('span');
            span.className = 'hj';
            span.textContent = m[0];
            frag.appendChild(span);
            last = m.index + m[0].length;
        }
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        node.parentNode.replaceChild(frag, node);
    }

    function walk(root) {
        if (!root) return;
        if (root.nodeType === Node.TEXT_NODE) { wrapText(root); return; }
        if (root.nodeType !== Node.ELEMENT_NODE || root.closest(SKIP)) return;
        var tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        var nodes = [];
        while (tw.nextNode()) nodes.push(tw.currentNode);
        nodes.forEach(wrapText);
    }

    function start() {
        walk(document.body);

        new MutationObserver(function (list) {
            list.forEach(function (mut) {
                if (mut.type === 'characterData') wrapText(mut.target);
                else mut.addedNodes.forEach(walk);
            });
        }).observe(document.body, { childList: true, characterData: true, subtree: true });
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }
    }
})();

