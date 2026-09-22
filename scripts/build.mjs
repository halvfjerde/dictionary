#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import yaml from 'js-yaml';
import { makeFolder } from '../site/assets/fold.js';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const SITE = path.join(ROOT, 'site');
const DIST = path.join(ROOT, 'dist');

const warn = [];
const say = (...a) => console.log(...a);

function readYaml(file) {
  try {
    return yaml.load(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`${path.relative(ROOT, file)} 를 읽지 못했습니다: ${e.message}`);
  }
}

function readTsv(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trimStart().startsWith('#'));
  if (!lines.length) return [];
  const head = lines[0].split('\t').map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split('\t');
    const row = {};
    head.forEach((h, j) => {
      const v = (cells[j] ?? '').trim();
      if (v) row[h] = v;
    });
    if (row.hw) rows.push(row);
  }
  return rows;
}

function tsvToEntries(rows) {
  const byHw = new Map();
  for (const r of rows) {
    const key = r.hw + '\u0000' + (r.hom ?? '');
    const fresh = !byHw.has(key);
    if (fresh) {
      byHw.set(key, {
        hw: r.hw, ipa: r.ipa, pos: r.pos, infl: r.infl,
        etym: r.etym, note: r.note,
        find: r.find ? r.find.split('|') : undefined,
        see: r.see ? r.see.split(/[,;]\s*/).filter(Boolean) : undefined,
        senses: [],
      });
    }
    const e = byHw.get(key);
    if (r.gloss) {
      const s = { d: r.gloss };
      if (r.lbl) s.lbl = r.lbl;
      if (r.ex) s.ex = [{ t: r.ex, g: r.exg ?? '' }];
      e.senses.push(s);
    }
    for (const f of ['ipa', 'pos', 'infl', 'etym', 'note']) if (!e[f] && r[f]) e[f] = r[f];
    if (!e.see && r.see) e.see = r.see.split(/[,;]\s*/).filter(Boolean);
    if (!fresh && r.find) e.find = (e.find ?? []).concat(r.find.split('|'));
  }
  return [...byHw.values()];
}

function loadEntries(dir) {
  const out = [];
  const push = (file) => {
    const ext = path.extname(file).toLowerCase();
    if (ext === '.tsv' || ext === '.csv') out.push(...tsvToEntries(readTsv(file)));
    else if (ext === '.yaml' || ext === '.yml') {
      const d = readYaml(file);
      if (Array.isArray(d)) out.push(...d);
      else if (d && Array.isArray(d.entries)) out.push(...d.entries);
      else if (d) warn.push(`${path.relative(ROOT, file)} 는 표제어 배열이 아니라 건너뜁니다.`);
    }
  };
  for (const name of ['entries.yaml', 'entries.yml', 'entries.tsv', 'entries.csv']) {
    const f = path.join(dir, name);
    if (fs.existsSync(f)) push(f);
  }
  const sub = path.join(dir, 'entries');
  if (fs.existsSync(sub) && fs.statSync(sub).isDirectory()) {
    for (const name of fs.readdirSync(sub).sort()) push(path.join(sub, name));
  }
  return out;
}

function normalizeSenses(e) {
  let senses = e.senses ?? e.sense ?? e.defs ?? [];
  if (typeof senses === 'string') senses = [{ d: senses }];
  if (!Array.isArray(senses)) senses = [senses];
  return senses
    .map((s) => {
      if (typeof s === 'string') return { d: s };
      const o = { d: s.d ?? s.gloss ?? s.def ?? '' };
      if (s.lbl ?? s.domain) o.lbl = s.lbl ?? s.domain;
      let ex = s.ex ?? s.examples;
      if (ex) {
        if (!Array.isArray(ex)) ex = [ex];
        o.ex = ex
          .map((x) => (typeof x === 'string' ? { t: x, g: '' } : { t: x.t ?? x.text ?? '', g: x.g ?? x.gloss ?? '' }))
          .filter((x) => x.t);
        if (!o.ex.length) delete o.ex;
      }
      return o;
    })
    .filter((s) => s.d);
}

function buildDictionary(dir) {
  const lang = readYaml(path.join(dir, 'lang.yaml')) ?? {};
  lang.id = lang.id ?? path.basename(dir);
  const folder = makeFolder(lang);
  const raw = loadEntries(dir);
  if (!raw.length) warn.push(`${lang.id}: 표제어가 하나도 없습니다.`);

  const entries = raw.map((e) => {
    const hw = String(e.hw ?? e.headword ?? '').trim();
    const senses = normalizeSenses(e);
    const o = { hw };
    if (e.ipa) o.ipa = String(e.ipa).replace(/^[[/]|[\]/]$/g, '');
    if (e.pos) o.pos = e.pos;
    if (e.infl) o.infl = e.infl;
    if (senses.length) o.sn = senses;
    if (e.etym) o.et = String(e.etym).replace(/^\s*(?:←|<-|<|⇐|⟵)\s*/, '');
    if (e.note) o.nt = e.note;
    if (e.see) o.see = Array.isArray(e.see) ? e.see : String(e.see).split(/[,;]\s*/).filter(Boolean);

    o.k = folder.loose(hw);
    o.ks = folder.strict(hw);
    o.ini = folder.initial(hw);

    let find = e.find ?? e.search ?? e.keys ?? e.also;
    if (typeof find === 'string') find = find.split('|');
    if (Array.isArray(find)) {
      const fd = [...new Set(find.map((s) => String(s ?? '').trim()).filter(Boolean))];
      if (fd.length) {
        o.fd = fd;
        o.fk = fd.map((s) => folder.loose(s));
        o.fks = fd.map((s) => folder.strict(s));
      }
    }

    const bag = [];
    for (const s of senses) {
      bag.push(s.d);
      if (s.lbl) bag.push(s.lbl);
      for (const x of s.ex ?? []) { bag.push(x.t); if (x.g) bag.push(x.g); }
    }
    if (o.et) bag.push(o.et);
    if (o.nt) bag.push(o.nt);
    o.g = bag.join(' ').toLowerCase();
    return o;
  }).filter((e) => e.hw);

  entries.sort((a, b) => folder.compare(a.hw, b.hw) || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));

  const seen = new Map();
  for (const e of entries) {
    const n = (seen.get(e.ks) ?? 0) + 1;
    seen.set(e.ks, n);
  }
  const cnt = new Map();
  for (const e of entries) {
    if (seen.get(e.ks) > 1) {
      const n = (cnt.get(e.ks) ?? 0) + 1;
      cnt.set(e.ks, n);
      e.hom = n;
    }
  }

  const byKey = new Map(entries.map((e, i) => [e.k, i]));
  for (const e of entries) {
    if (!e.see) continue;
    e.see = e.see.map((s) => {
      const i = byKey.get(folder.loose(s));
      return i === undefined ? { t: s } : { t: entries[i].hw, i };
    });
  }

  const index = [];
  entries.forEach((e, i) => {
    if (!index.length || index[index.length - 1].c !== e.ini) index.push({ c: e.ini, i });
  });

  const meta = {
    id: lang.id,
    name: lang.name ?? lang.id,
    nativeName: lang.nativeName ?? '',
    subtitle: lang.subtitle ?? '',
    edition: lang.edition ?? '',
    compiler: lang.compiler ?? '',
    year: lang.year ?? '',
    order: lang.order ?? 99,
    primaryScript: lang.primaryScript ?? folder.scripts[0],
    scripts: folder.scripts,
    scriptLabels: lang.scriptLabels ?? {},
    collation: lang.collation ?? '',
    graphemes: lang.graphemes ?? [],
    ignore: lang.ignore ?? undefined,
  };

  return { meta, entries, index, count: entries.length };
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name), d = path.join(dst, name);
    const st = fs.statSync(s);
    if (st.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function main() {
  if (!fs.existsSync(DATA)) { console.error('data/ 폴더가 없습니다.'); process.exit(1); }
  fs.rmSync(DIST, { recursive: true, force: true });
  copyDir(SITE, DIST);
  fs.mkdirSync(path.join(DIST, 'data'), { recursive: true });

  const dirs = fs.readdirSync(DATA)
    .map((n) => path.join(DATA, n))
    .filter((p) => fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'lang.yaml')));

  if (!dirs.length) { console.error('data/ 안에 lang.yaml 을 가진 사전 폴더가 없습니다.'); process.exit(1); }

  const list = [];
  for (const dir of dirs) {
    const dict = buildDictionary(dir);
    const out = path.join(DIST, 'data', `${dict.meta.id}.json`);
    fs.writeFileSync(out, JSON.stringify(dict));
    const kb = (fs.statSync(out).size / 1024).toFixed(1);
    say(`  ${dict.meta.id.padEnd(12)} 표제어 ${String(dict.count).padStart(5)}개   ${kb} KB`);
    list.push({
      id: dict.meta.id, name: dict.meta.name, nativeName: dict.meta.nativeName,
      subtitle: dict.meta.subtitle, edition: dict.meta.edition, compiler: dict.meta.compiler,
      year: dict.meta.year, order: dict.meta.order, count: dict.count,
      primaryScript: dict.meta.primaryScript, scripts: dict.meta.scripts,
    });
  }
  list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ko'));
  fs.writeFileSync(
    path.join(DIST, 'data', 'index.json'),
    JSON.stringify({ built: new Date().toISOString(), dicts: list }),
  );

  for (const w of warn) console.warn('  ! ' + w);
  say(`\n사전 ${list.length}부, 표제어 ${list.reduce((s, d) => s + d.count, 0)}개 → dist/\n`);
}

main();
