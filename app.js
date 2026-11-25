'use strict';

/* =========================================================
   Vokabeltrainer – läuft komplett auf dem Gerät (offline).
   Daten: localStorage. Texterkennung: tesseract.js (lokal).
   Lernsystem: Karteikasten (Leitner) mit 5 Fächern,
   angepasst an eingetragene Testtermine.
   ========================================================= */

// Testversion liegt unter /test/ und hat eigene, getrennte Daten
const IS_TEST = /\/test\//.test(location.pathname);
const STORE_KEY = 'vokabeltrainer.v1' + (IS_TEST ? '.test' : '');
if (IS_TEST) document.documentElement.classList.add('is-test');
const DAY = 24 * 60 * 60 * 1000;
const INTERVALS = [0, 1, 3, 7, 14, 30]; // Tage bis zur nächsten Abfrage je Fach (0 = neu)
const BOX_NAMES = ['Neu', 'Fach 1', 'Fach 2', 'Fach 3', 'Fach 4', 'Fach 5'];
const LANGS = {
  en: { name: 'Englisch', flag: '🇬🇧', ocr: 'eng', tts: 'en-GB' },
  fr: { name: 'Französisch', flag: '🇫🇷', ocr: 'fra', tts: 'fr-FR' },
};
const FR_ACCENTS = ['é', 'è', 'ê', 'à', 'â', 'ç', 'ù', 'û', 'ô', 'î', 'ï', 'ë', 'œ', '’'];
const AVATARS = ['🦊', '🐼', '🐸', '🦁', '🐧', '🦄', '🐶', '🐱', '🐯', '🐨', '🐙', '🦖', '🐬', '🦉', '🚀'];
const PRAISE = ['Richtig! 👍', 'Super! 🎉', 'Klasse! ⭐', 'Stark! 💪', 'Genau! ✅', 'Perfekt! 🌟', 'Toll gemacht! 🙌'];

/* ---------- Speicher ---------- */
function emptyDb() {
  return {
    version: 3,
    profile: { name: '', avatar: '🦊' },
    chapters: [],
    cards: [],
    days: {},
    settings: { direction: 'auto', mode: 'type', sessionSize: 20, sound: true, autoSpeak: false },
    parent: { pin: '', recipients: [] },
    lastBackup: 0,
  };
}
let db = load();
function migrate(d) {
  const e = emptyDb();
  const out = Object.assign(e, d);
  out.profile = Object.assign(emptyDb().profile, d.profile || {});
  out.settings = Object.assign(emptyDb().settings, d.settings || {});
  out.parent = Object.assign(emptyDb().parent, d.parent || {});
  out.chapters.forEach((c) => { if (c.testDate === undefined) c.testDate = ''; if (c.archived === undefined) c.archived = false; });
  if ((d.version || 1) < 3 && out.settings.direction === 'mixed') out.settings.direction = 'auto';
  out.version = 3;
  return out;
}
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? migrate(JSON.parse(raw)) : emptyDb();
  } catch (e) {
    console.error(e);
    return emptyDb();
  }
}
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(db));
  } catch (e) {
    toast('Speichern fehlgeschlagen – Speicher voll?');
  }
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

/* ---------- Helfer ---------- */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const startOfDay = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const keyToTime = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
const fmtDate = (t, opts = { weekday: 'short', day: '2-digit', month: '2-digit' }) => new Date(t).toLocaleDateString('de-DE', opts);
const fmtMin = (secs) => (secs < 60 ? (secs > 0 ? 'unter 1 Min.' : '0 Min.') : `${Math.round(secs / 60)} Min.`);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const chapter = (id) => db.chapters.find((c) => c.id === id);
const cardsOf = (chId) => db.cards.filter((c) => c.chapterId === chId);
const isProblem = (c) => c.wrong >= 2 && c.wrong >= c.right / 2 && c.box <= 3;

function dayRec(k = dayKey()) {
  const def = { right: 0, wrong: 0, secs: 0, sessions: 0, ch: {}, hard: [], sent: {}, exams: [] };
  db.days[k] = Object.assign(def, db.days[k] || {});
  return db.days[k];
}
function hasActivity(k) {
  const d = db.days[k];
  if (d && d.exams && d.exams.length) return true;
  const added = db.cards.some((c) => dayKey(c.created) === k);
  return !!(d && (d.right + d.wrong > 0)) || added;
}

/* ---------- Testtermine ---------- */
function testInfo(ch) {
  if (!ch || !ch.testDate) return null;
  const day = keyToTime(ch.testDate);
  const daysLeft = Math.round((day - startOfDay()) / DAY);
  if (daysLeft < 0) return null;
  const cs = cardsOf(ch.id);
  const readyN = cs.filter((c) => c.box >= 3).length;
  const notReady = cs.length - readyN;
  const target = daysLeft > 0 ? Math.ceil(notReady / daysLeft) : notReady;
  const today = (db.days[dayKey()] || {}).ch?.[ch.id];
  const doneToday = today ? today.r + today.w : 0;
  return { day, daysLeft, ready: cs.length ? Math.round((readyN / cs.length) * 100) : 0, target, doneToday, total: cs.length };
}
function daysLabel(n) {
  if (n === 0) return 'heute';
  if (n === 1) return 'morgen';
  return `in ${n} Tagen`;
}
// Fälligkeit unter Berücksichtigung eines Tests: spätestens am Tag davor kommt jedes Wort noch einmal dran
function effectiveDue(c) {
  const t = testInfo(chapter(c.chapterId));
  if (!t || t.daysLeft < 1) return c.due;
  const cap = t.day - DAY;
  if (c.due > cap && (c.seen || 0) < cap) return cap;
  return c.due;
}
const isDue = (c) => effectiveDue(c) <= Date.now();

/* ---------- Lernlogik (Karteikasten) ---------- */
function grade(card, correct, ctx) {
  const today = startOfDay();
  const d = dayRec();
  const chs = d.ch[card.chapterId] || (d.ch[card.chapterId] = { r: 0, w: 0 });
  if (correct) {
    if (ctx.wrongBefore) {
      card.box = 1;
      card.due = today + DAY;
    } else {
      card.right++;
      d.right++;
      chs.r++;
      if (ctx.wasDue) {
        card.box = Math.min(card.box + 1, 5);
        let days = INTERVALS[card.box];
        const t = testInfo(chapter(card.chapterId));
        if (t && t.daysLeft >= 1) days = Math.min(days, Math.max(1, Math.floor(t.daysLeft / 2)));
        card.due = today + days * DAY;
      }
    }
  } else if (!ctx.wrongBefore) {
    card.wrong++;
    d.wrong++;
    chs.w++;
    card.box = 1;
    card.due = Date.now();
    card.lastWrong = Date.now();
    if (!d.hard.includes(card.id) && d.hard.length < 60) d.hard.push(card.id);
  }
  card.seen = Date.now();
  save();
}

function newCard(chapterId, foreign, german) {
  return { id: uid(), chapterId, foreign: foreign.trim(), german: german.trim(), box: 0, due: 0, right: 0, wrong: 0, created: Date.now() };
}

/* ---------- Antwort prüfen ---------- */
const ARTICLES = /^(der|die|das|ein|eine|the|a|an|le|la|les|l'|un|une|des) ?/;
function stripAccents(s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/œ/g, 'oe').replace(/æ/g, 'ae'); }
function normalize(s) {
  return s.toLowerCase()
    .replace(/[’`´]/g, "'")
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(sth|sb|etw|jdn|jdm|qc|qn)\.?/g, ' ')
    .replace(/[.!?¡¿"„“”«»]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function variants(answer) {
  const base = answer.split(/[,;/]|\boder\b|\bor\b/).map(normalize).filter(Boolean);
  const out = new Set(base);
  out.add(normalize(answer));
  for (const v of base) {
    out.add(v.replace(/^to /, ''));
    out.add(v.replace(ARTICLES, ''));
    out.add(v.replace(/^sich /, ''));
  }
  return [...out].filter(Boolean);
}
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}
function check(input, answer) {
  const given = normalize(input);
  if (!given) return 'wrong';
  const opts = variants(answer);
  const g = [given, given.replace(/^to /, ''), given.replace(ARTICLES, ''), given.replace(/^sich /, '')];
  if (g.some((x) => opts.includes(x))) return 'right';
  const ga = g.map(stripAccents);
  if (opts.some((o) => ga.includes(stripAccents(o)))) return 'accent';
  if (opts.some((o) => o.length >= 5 && g.some((x) => lev(x, o) === 1))) return 'typo';
  return 'wrong';
}

/* ---------- UI-Helfer ---------- */
const app = $('#app');
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
function dialog(html, onSubmit) {
  const dlg = $('#dialog');
  const form = $('#dialog-form');
  form.innerHTML = html;
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise((resolve) => {
    dlg.onclose = () => resolve(dlg.returnValue);
    form.onsubmit = (e) => {
      const btn = e.submitter;
      if (btn && btn.value === 'ok' && onSubmit && onSubmit(form) === false) e.preventDefault();
    };
  });
}
async function confirmDlg(title, text, okLabel = 'Löschen') {
  const r = await dialog(`<h3>${esc(title)}</h3><p class="muted">${esc(text)}</p>
    <div class="actions"><button class="btn ghost" value="cancel">Abbrechen</button><button class="btn danger" value="ok">${esc(okLabel)}</button></div>`);
  return r === 'ok';
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('.seg[data-pick] button');
  if (!b) return;
  $$('button', b.parentElement).forEach((x) => x.classList.toggle('on', x === b));
});
function distBar(cards) {
  const counts = [0, 0, 0, 0, 0, 0];
  cards.forEach((c) => counts[c.box]++);
  const n = cards.length || 1;
  return `<div class="dist">${counts.map((k, i) => (k ? `<span style="width:${(k / n) * 100}%;background:var(--b${i})"></span>` : '')).join('')}</div>`;
}
function legend() {
  return `<div class="legend">${BOX_NAMES.map((n, i) => `<span><i class="box-dot" style="background:var(--b${i})"></i>${n}</span>`).join('')}</div>`;
}
function progressPct(cards) {
  if (!cards.length) return 0;
  return Math.round((cards.reduce((s, c) => s + c.box, 0) / (cards.length * 5)) * 100);
}
function streak() {
  let n = 0;
  let t = Date.now();
  const learned = (k) => db.days[k] && db.days[k].right + db.days[k].wrong > 0;
  if (!learned(dayKey(t))) t -= DAY;
  while (learned(dayKey(t))) { n++; t -= DAY; }
  return n;
}
// Aussprache über die Sprachausgabe des Geräts (offline, kostenlos).
// Zweimal kurz hintereinander auf denselben Knopf = langsam vorlesen.
let lastSpoken = { text: '', at: 0 };
function voiceFor(lang) {
  const want = LANGS[lang].tts;
  const voices = speechSynthesis.getVoices();
  return voices.find((v) => v.lang === want && v.localService) || voices.find((v) => v.lang === want)
    || voices.find((v) => v.lang.startsWith(lang)) || null;
}
let speechHintShown = false;
function speak(text, lang, forceSlow, onStatus) {
  if (!('speechSynthesis' in window) || !LANGS[lang]) {
    if (onStatus) onStatus('unsupported');
    return;
  }
  const synth = window.speechSynthesis;
  const slow = forceSlow || (lastSpoken.text === text && Date.now() - lastSpoken.at < 4000);
  lastSpoken = { text, at: slow ? 0 : Date.now() };
  // iPhone/Safari: cancel() direkt vor speak() verschluckt die Ansage manchmal –
  // daher nur abbrechen, wenn wirklich gerade etwas läuft, und kurz warten.
  const busy = synth.speaking || synth.pending;
  if (busy) synth.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/[()]/g, ''));
  u.lang = LANGS[lang].tts;
  let v = null;
  try { v = voiceFor(lang); if (v) u.voice = v; } catch (e) { v = null; /* Standardstimme der Sprache nutzen */ }
  u.rate = slow ? 0.55 : 0.9;
  u.volume = 1;
  let started = false;
  u.onstart = () => { started = true; if (onStatus) onStatus('started', v); };
  u.onerror = (e) => { if (onStatus) onStatus('error:' + (e.error || 'unbekannt'), v); };
  const go = () => { synth.resume(); synth.speak(u); };
  if (busy) setTimeout(go, 80); else go();
  setTimeout(() => {
    if (started) return;
    if (onStatus) onStatus('nostart', v);
    else if (!speechHintShown) { speechHintShown = true; toast('Kein Ton? Stummschalter am iPhone aus und Lautstärke hoch 🔊'); }
  }, 2500);
}
if ('speechSynthesis' in window) {
  speechSynthesis.getVoices();
  // iPhone: Sprachausgabe beim ersten Fingertipp freischalten (sonst bleibt automatisches Vorlesen stumm)
  const unlock = () => {
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch (e) { /* egal */ }
  };
  document.addEventListener('touchend', unlock, { once: true, passive: true });
  document.addEventListener('click', unlock, { once: true });
}

// Testknopf mit Diagnose (Mein Bereich)
function speechTest(out) {
  const voices = 'speechSynthesis' in window ? speechSynthesis.getVoices() : [];
  const en = voices.filter((v) => v.lang.startsWith('en')).length;
  const fr = voices.filter((v) => v.lang.startsWith('fr')).length;
  const lines = [`Sprachausgabe vorhanden: ${'speechSynthesis' in window ? 'ja' : 'nein'}`, `Stimmen: ${voices.length} (Englisch ${en}, Französisch ${fr})`];
  out.textContent = lines.join('\n') + '\nTeste Englisch …';
  speak('Hello! This is a test.', 'en', false, (st, v) => {
    const msg = st === 'started' ? '✅ Englisch gestartet' + (v ? ` (${v.name})` : '') : st === 'nostart' ? '❌ Englisch startet nicht' : st === 'unsupported' ? '❌ nicht unterstützt' : `❌ Fehler: ${st.slice(6)}`;
    lines.push(msg);
    out.textContent = lines.join('\n') + (st === 'started' ? '\nHörst du nichts? → Stummschalter/Lautstärke prüfen.' : '');
  });
}
const speakBtn = (attrs, small) => `<button type="button" class="speak${small ? ' sm' : ''}" ${attrs} aria-label="Aussprache anhören">🔊</button>`;
let actx;
function sound(ok) {
  if (!db.settings.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const notes = ok ? [660, 990] : [260, 200];
    notes.forEach((f, i) => {
      const t0 = actx.currentTime + i * 0.11;
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = ok ? 'sine' : 'triangle';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
      o.connect(g).connect(actx.destination);
      o.start(t0);
      o.stop(t0 + 0.22);
    });
  } catch (e) { /* ohne Ton weiter */ }
}
function confetti() {
  const colors = ['#ff7a45', '#ffc93c', '#13b5a3', '#3d8bff', '#ff5c8a', '#8b5cf6'];
  for (let i = 0; i < 70; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = pick(colors);
    c.style.animationDuration = 1.8 + Math.random() * 1.6 + 's';
    c.style.animationDelay = Math.random() * 0.5 + 's';
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 4200);
  }
}

/* ---------- Router ---------- */
let state = { view: 'home' };
function go(view, params = {}) {
  state = Object.assign({ view }, params);
  if (view !== 'learn' && 'speechSynthesis' in window) speechSynthesis.cancel();
  render();
  window.scrollTo(0, 0);
}
function render() {
  if (!db.profile.name && state.view !== 'onboarding') state = { view: 'onboarding' };
  (views[state.view] || views.home)();
}
const views = {};

/* ---------- Erster Start ---------- */
views.onboarding = () => {
  let avatar = db.profile.avatar || '🦊';
  app.innerHTML = `
    <div class="center" style="margin-top:20px"><div style="font-size:70px">📚</div><h1>Hallo! 👋</h1>
    <p class="muted">Mit dieser App lernst du deine Vokabeln – jeden Tag ein bisschen, und sie bleiben im Kopf.</p></div>
    <div class="card steps" style="margin-bottom:14px">
      <div><span>1</span>Kapitel anlegen (z. B. „Unit 3“)</div>
      <div><span>2</span>📷 Vokabelseite im Schulbuch fotografieren</div>
      <div><span>3</span>Erkannte Wörter kurz prüfen</div>
      <div><span>4</span>🚀 Jeden Tag ein paar Minuten lernen</div>
    </div>
    <div class="card stack">
      <label class="field" for="pname">Wie heißt du?</label>
      <input type="text" id="pname" autocomplete="off" placeholder="Dein Vorname" maxlength="20">
      <label class="field">Such dir ein Tier aus:</label>
      <div class="avatars">${AVATARS.map((a) => `<button type="button" data-a="${a}" class="${a === avatar ? 'on' : ''}">${a}</button>`).join('')}</div>
      <button class="btn primary big block" id="go">Los geht's!</button>
    </div>
    <div class="center" style="margin-top:22px">
      <button class="btn ghost" id="restore">Ich habe schon eine Sicherung (neues Handy)</button>
      <input type="file" id="impfile" accept="application/json,.json" class="hidden">
    </div>`;
  $$('.avatars button').forEach((b) => (b.onclick = () => { avatar = b.dataset.a; $$('.avatars button').forEach((x) => x.classList.toggle('on', x === b)); }));
  $('#go').onclick = () => {
    const n = $('#pname').value.trim();
    if (!n) { $('#pname').focus(); return toast('Bitte gib deinen Namen ein'); }
    db.profile = { name: n, avatar };
    save();
    go('home');
  };
  $('#restore').onclick = () => $('#impfile').click();
  $('#impfile').onchange = (e) => e.target.files[0] && importFile(e.target.files[0]);
};

/* ---------- Startseite ---------- */
function greeting() {
  const h = new Date().getHours();
  return h < 11 ? 'Guten Morgen' : h < 17 ? 'Hallo' : 'Guten Abend';
}
views.home = () => {
  const due = db.cards.filter(isDue);
  const problems = db.cards.filter(isProblem);
  const s = streak();
  const today = db.days[dayKey()] ? dayRec() : { right: 0, wrong: 0, secs: 0 };
  const active = db.chapters.filter((c) => !c.archived);
  const archived = db.chapters.filter((c) => c.archived);
  const tests = db.chapters.map((c) => ({ c, t: testInfo(c) })).filter((x) => x.t).sort((a, b) => a.t.daysLeft - b.t.daysLeft);

  const tile = (ch) => {
    const cs = cardsOf(ch.id);
    const d = cs.filter(isDue).length;
    const t = testInfo(ch);
    return `<button class="tile ${ch.lang}" data-ch="${ch.id}">
      <span class="flag">${LANGS[ch.lang].flag}</span>
      <div class="grow"><div class="row"><span class="title grow">${esc(ch.name)}</span>${d ? `<span class="badge">${d}</span>` : ''}</div>
      <div class="muted small">${plural(cs.length, 'Vokabel', 'Vokabeln')} · ${progressPct(cs)} % gelernt${t ? ` · 📅 Test ${daysLabel(t.daysLeft)}` : ''}</div>${distBar(cs)}</div>
      <span class="chev">›</span></button>`;
  };

  const banners = [];
  if (db.parent.recipients.length) {
    for (const k of [dayKey(Date.now() - DAY), dayKey()]) {
      if (!hasActivity(k)) continue;
      const rec = db.days[k] || { sent: {} };
      const open = db.parent.recipients.filter((r) => !(rec.sent || {})[r.id]);
      if (!open.length) continue;
      const isToday = k === dayKey();
      banners.push(`<div class="banner green"><span class="ico">📨</span><div class="grow">
        <div><strong>${isToday ? 'Bericht von heute' : 'Bericht von gestern'}</strong></div>
        <div class="row wrap" style="margin-top:8px">${open.map((r) => `<a class="btn wa" style="min-height:46px" href="${esc(waLink(r.number, buildReport(k)))}" target="_blank" rel="noopener" data-sent="${k}|${r.id}">An ${esc(r.name)} senden</a>`).join('')}</div></div></div>`);
    }
  }
  if (db.cards.length >= 20 && Date.now() - (db.lastBackup || 0) > 30 * DAY) {
    banners.push(`<div class="banner yellow"><span class="ico">💾</span><div class="grow"><strong>Zeit für eine Sicherung</strong><div class="small muted">Damit deine Vokabeln nie verloren gehen.</div></div><button class="btn white" id="quick-backup">Sichern</button></div>`);
  }

  app.innerHTML = `
    <div class="hello">
      <div class="avatar">${esc(db.profile.avatar)}</div>
      <div class="grow"><h1>${greeting()}, ${esc(db.profile.name)}!</h1>${s ? `<div class="muted small">🔥 ${plural(s, 'Tag', 'Tage')} in Folge gelernt</div>` : '<div class="muted small">Schön, dass du da bist!</div>'}</div>
      <button class="iconbtn" id="me" aria-label="Mein Bereich">⚙️</button>
    </div>
    ${db.cards.length ? `
    <div class="hero ${due.length ? '' : 'done'}">
      ${due.length ? `<div class="num">${due.length}</div><div class="lbl">${due.length === 1 ? 'Vokabel wartet' : 'Vokabeln warten'} heute auf dich</div>`
        : `<div class="num">🎉</div><div class="lbl">Alles geschafft für heute!</div>`}
      <div class="chips">
        ${today.right + today.wrong ? `<span class="chip">Heute: ${today.right} ✓ · ${today.wrong} ✗</span><span class="chip">⏱️ ${fmtMin(today.secs)}</span>` : ''}
        ${problems.length ? `<span class="chip">⚠️ ${problems.length} schwierige</span>` : ''}
      </div>
      ${due.length ? `<button class="btn white big block" id="learn-due">Los geht's! 🚀</button>`
        : problems.length ? `<button class="btn white block" id="learn-problems">Schwierige Wörter üben</button>` : ''}
    </div>` : `
    <div class="card center">
      <div style="font-size:54px">📷</div>
      <p><strong>Los geht's mit deinem ersten Kapitel!</strong></p>
      <p class="muted small">Leg ein Kapitel an – danach fotografierst du einfach die Vokabelseite aus deinem Schulbuch.</p>
      <button class="btn primary big block" id="new-ch-hero">+ Erstes Kapitel anlegen</button>
    </div>`}
    ${banners.join('')}
    ${tests.length ? `<h2>📅 Deine Tests</h2><div class="tests">${tests.map(({ c, t }) => `
      <button class="test-card ${t.daysLeft <= 2 ? 'soon' : ''}" data-ch="${c.id}">
        <div class="row spread"><span class="days">${t.daysLeft === 0 ? 'Heute!' : t.daysLeft === 1 ? 'Morgen' : `${t.daysLeft} Tage`}</span><span style="font-size:24px">${LANGS[c.lang].flag}</span></div>
        <div style="font-weight:900;margin-top:4px">${esc(c.name)}</div>
        <div class="muted tiny">${fmtDate(t.day, { weekday: 'long', day: '2-digit', month: '2-digit' })} · ${t.ready} % sicher</div>
        <div class="meter"><div style="width:${t.ready}%"></div></div>
        <div class="small" style="margin-top:8px">${t.daysLeft === 0 ? 'Viel Glück! 🍀' : t.doneToday >= t.target ? '✅ Tagesziel geschafft' : `🎯 Heute noch ${t.target - t.doneToday} üben`}</div>
      </button>`).join('')}</div>` : ''}
    ${active.length ? ['en', 'fr'].map((l) => {
      const list = active.filter((c) => c.lang === l);
      return list.length ? `<h2>${LANGS[l].flag} ${LANGS[l].name}</h2><div class="tiles">${list.map(tile).join('')}</div>` : '';
    }).join('') : ''}
    ${db.cards.length || db.chapters.length ? `<button class="btn block" style="margin-top:22px" id="new-ch">+ Neues Kapitel</button>` : ''}
    ${archived.length ? `<details class="archive" style="margin-top:14px"><summary>📦 Abgeschlossene Kapitel (${archived.length}) ›</summary><div class="tiles">${archived.map(tile).join('')}</div>
      <p class="muted tiny" style="margin-top:8px">Die Wörter daraus kommen trotzdem ab und zu zur Wiederholung dran.</p></details>` : ''}
  `;
  $('#me').onclick = () => go('me');
  ['#new-ch', '#new-ch-hero'].forEach((id) => { const b = $(id); if (b) b.onclick = () => chapterDialog(); });
  $$('[data-ch]').forEach((b) => (b.onclick = () => go('chapter', { id: b.dataset.ch })));
  const ld = $('#learn-due');
  if (ld) ld.onclick = () => startSession(pickDue(db.cards), 'Fällige Vokabeln');
  const lp = $('#learn-problems');
  if (lp) lp.onclick = () => startSession(shuffle(problems).slice(0, db.settings.sessionSize), 'Schwierige Wörter', true);
  const qb = $('#quick-backup');
  if (qb) qb.onclick = exportData;
  bindSent();
};
function bindSent() {
  $$('[data-sent]').forEach((a) => a.addEventListener('click', () => {
    const [k, rid] = a.dataset.sent.split('|');
    const d = dayRec(k);
    d.sent[rid] = Date.now();
    save();
    setTimeout(render, 800);
  }));
}

/* ---------- Kapitel anlegen / bearbeiten ---------- */
async function chapterDialog(ch) {
  const isNew = !ch;
  const lang = ch ? ch.lang : (db.chapters.length ? db.chapters[db.chapters.length - 1].lang : 'en');
  const r = dialog(`<h3>${isNew ? 'Neues Kapitel' : 'Kapitel bearbeiten'}</h3>
    ${isNew ? `<label class="field">Sprache</label>
    <div class="seg" data-pick id="langseg">${Object.entries(LANGS).map(([k, v]) => `<button type="button" data-l="${k}" class="${k === lang ? 'on' : ''}">${v.flag} ${v.name}</button>`).join('')}</div>` : ''}
    <label class="field" style="margin-top:14px" for="chname">Name</label>
    <input type="text" id="chname" value="${esc(ch?.name)}" placeholder="z. B. Unit 3 oder Unité 2" autocomplete="off" maxlength="40">
    <label class="field" style="margin-top:14px" for="chtest">📅 Vokabeltest am (freiwillig)</label>
    <input type="date" id="chtest" value="${esc(ch?.testDate)}" min="${dayKey()}">
    ${ch?.testDate ? `<button type="button" class="btn ghost" id="cleartest" style="min-height:40px;padding:0 4px">Testtermin entfernen</button>` : ''}
    ${!isNew ? `<label class="row" style="margin-top:16px;gap:12px;font-weight:800"><input type="checkbox" id="charch" ${ch.archived ? 'checked' : ''} style="width:24px;height:24px;accent-color:var(--primary)"> Kapitel ist abgeschlossen (ins Archiv)</label>
    <button type="button" class="btn teal-soft block" id="chshare" style="margin-top:14px">📤 Kapitel teilen (z. B. mit Geschwistern)</button>` : ''}
    <div class="actions" style="justify-content:space-between">
      ${isNew ? '<span></span>' : '<button class="btn danger" value="delete">Löschen</button>'}
      <span class="row"><button class="btn ghost" value="cancel">Abbrechen</button><button class="btn primary" value="ok">${isNew ? 'Anlegen' : 'Speichern'}</button></span>
    </div>`,
  (form) => { if (!$('#chname', form).value.trim()) { toast('Bitte gib einen Namen ein'); return false; } });
  const ct = $('#cleartest');
  if (ct) ct.onclick = () => { $('#chtest').value = ''; ct.remove(); };
  const sh = $('#chshare');
  if (sh) sh.onclick = () => shareChapter(ch);
  const res = await r;
  if (res === 'ok') {
    const name = $('#chname').value.trim();
    const testDate = $('#chtest').value || '';
    if (isNew) {
      const nc = { id: uid(), name, lang: $('#langseg .on').dataset.l, testDate, archived: false, created: Date.now() };
      db.chapters.push(nc);
      save();
      go('chapter', { id: nc.id });
    } else {
      ch.name = name;
      ch.testDate = testDate;
      ch.archived = $('#charch').checked;
      save();
      render();
    }
  } else if (res === 'delete') {
    const n = cardsOf(ch.id).length;
    if (await confirmDlg('Kapitel wirklich löschen?', `„${ch.name}“ und ${plural(n, 'Vokabel', 'Vokabeln')} werden für immer gelöscht. Tipp: Statt löschen kannst du das Kapitel auch als „abgeschlossen“ markieren.`)) {
      db.cards = db.cards.filter((c) => c.chapterId !== ch.id);
      db.chapters = db.chapters.filter((c) => c.id !== ch.id);
      save();
      go('home');
    }
  }
}

/* ---------- Kapitelansicht ---------- */
views.chapter = () => {
  const ch = chapter(state.id);
  if (!ch) return go('home');
  const cs = cardsOf(ch.id);
  const due = cs.filter(isDue);
  const probs = cs.filter(isProblem);
  const L = LANGS[ch.lang];
  const t = testInfo(ch);
  const sorted = [...cs].sort((a, b) => a.box - b.box || b.wrong - a.wrong || a.created - b.created);
  app.innerHTML = `
    <div class="topbar"><button class="iconbtn" id="back">‹</button><h1>${L.flag} ${esc(ch.name)}</h1><button class="iconbtn" id="menu" aria-label="Kapitel bearbeiten">✏️</button></div>
    ${t ? `<div class="banner purple" style="margin-top:0;margin-bottom:14px"><span class="ico">📅</span><div class="grow">
        <strong>Test ${daysLabel(t.daysLeft)}</strong> <span class="muted small">(${fmtDate(t.day, { weekday: 'long', day: '2-digit', month: '2-digit' })})</span>
        <div class="meter"><div style="width:${t.ready}%"></div></div>
        <div class="small" style="margin-top:6px">${t.ready} % der Wörter sitzen sicher · ${t.daysLeft === 0 ? 'Viel Glück! 🍀' : t.doneToday >= t.target ? '✅ Tagesziel geschafft!' : `🎯 Ziel heute: ${t.target} Wörter (${t.doneToday} geschafft)`}</div>
      </div></div>` : `<button class="btn purple-soft block" id="settest" style="margin-bottom:14px">📅 Testtermin eintragen</button>`}
    ${!cs.length ? `
    <div class="card center">
      <div style="font-size:50px">📷</div>
      <h3 style="margin:4px 0 6px">Vokabeln aus dem Buch holen</h3>
      <p class="muted small">Fotografiere die Vokabelseite zu diesem Kapitel. Die App liest die Wörter, du prüfst sie kurz – fertig.</p>
      ${`<div class="tips"><div>📖 Buch flach hinlegen</div><div>☀️ Helles Licht, kein Schatten</div><div>📐 Gerade von oben fotografieren</div><div>🔍 Nah ran – nur die Vokabeln</div></div>`}
      <button class="btn teal big block" id="scan">📷 Vokabelseite fotografieren</button>
      <p class="muted small" style="margin:16px 0 8px">oder von Hand:</p>
      <div class="grid2"><button class="btn" id="add">✍️ Eintippen</button><button class="btn" id="paste">📋 Einfügen</button></div>
    </div>
    <input type="file" id="file" accept="image/*" class="hidden">` : `
    <div class="card">
      <div class="row spread"><strong>${plural(cs.length, 'Vokabel', 'Vokabeln')}</strong><span class="muted">${progressPct(cs)} % gelernt</span></div>
      ${distBar(cs)}${legend()}
      <div class="stack" style="margin-top:16px">
        <button class="btn primary big block" id="l-due" ${due.length ? '' : 'disabled'}>${due.length ? `${due.length} fällige lernen 🚀` : 'Gerade nichts fällig ✓'}</button>
        <div class="grid2">
          <button class="btn teal-soft" id="l-all" ${cs.length ? '' : 'disabled'}>Alle üben</button>
          <button class="btn" id="l-prob" ${probs.length ? '' : 'disabled'}>Schwierige${probs.length ? ` (${probs.length})` : ''}</button>
        </div>
      </div>
    </div>
    <div class="card" style="margin-top:14px">
      <div class="row spread"><strong>🎓 Prüfung</strong>${lastExam(ch) ? `<span class="muted small">Zuletzt: ${lastExam(ch)}</span>` : ''}</div>
      <p class="muted small" style="margin:6px 0 12px">Teste dich wie in der Schule – ohne Hilfe, die Auswertung kommt am Ende. Ändert nichts an deinem Karteikasten.</p>
      <div class="grid2">
        <button class="btn purple-soft" id="ex-test" ${cs.length >= 3 ? '' : 'disabled'}>✍️ Vokabeltest</button>
        <button class="btn purple-soft" id="ex-cloze" ${clozeCards(cs).length >= 3 ? '' : 'disabled'}>📝 Lückentext${clozeCards(cs).length ? ` (${clozeCards(cs).length})` : ''}</button>
      </div>
      ${clozeCards(cs).length < 3 ? `<p class="muted tiny" style="margin:10px 0 0">Für den Lückentext braucht es Beispielsätze. Stehen im Buch Beispielsätze neben den Vokabeln, übernimmt die App sie beim Fotografieren automatisch. Du kannst sie auch bei jeder Vokabel selbst eintragen (Vokabel antippen).</p>` : ''}
    </div>
    <h2>Weitere Vokabeln hinzufügen</h2>
    <div class="stack">
      <button class="btn teal big block" id="scan">📷 Nächste Seite fotografieren</button>
      <div class="grid2"><button class="btn" id="add">✍️ Eintippen</button><button class="btn" id="paste">📋 Einfügen</button></div>
    </div>
    <input type="file" id="file" accept="image/*" class="hidden">
    <h2>Alle Vokabeln</h2>
    ${cs.length > 8 ? `<input type="search" id="filter" placeholder="🔍 Suchen …" style="margin-bottom:12px">` : ''}
    <div class="list" id="vlist">${sorted.length ? sorted.map((c) => `
      <div class="vocab" data-card="${c.id}" data-q="${esc((c.foreign + ' ' + c.german).toLowerCase())}">
        <i class="box-dot" style="background:var(--b${c.box})" title="${BOX_NAMES[c.box]}"></i>
        <div class="grow"><div class="f">${esc(c.foreign)}</div><div class="g">${esc(c.german)}</div></div>
        ${isProblem(c) ? '<span title="Schwieriges Wort">⚠️</span>' : ''}
        ${speakBtn(`data-say="${c.id}"`, true)}
      </div>`).join('') : ''}</div>`}
  `;
  $('#back').onclick = () => go('home');
  $('#menu').onclick = () => chapterDialog(ch);
  const st = $('#settest');
  if (st) st.onclick = () => chapterDialog(ch);
  if (cs.length) {
    $('#l-due').onclick = () => startSession(pickDue(cs), ch.name);
    $('#l-all').onclick = () => startSession(shuffle(cs), ch.name, true);
    $('#l-prob').onclick = () => startSession(shuffle(probs), `${ch.name} – Schwierige`, true);
    $('#ex-test').onclick = () => startExam(ch, 'test');
    $('#ex-cloze').onclick = () => startExam(ch, 'cloze');
  }
  $('#scan').onclick = () => $('#file').click();
  $('#file').onchange = (e) => { const f = e.target.files[0]; if (f) go('scan', { id: ch.id, file: f }); };
  $('#add').onclick = () => editCard(ch);
  $('#paste').onclick = () => go('paste', { id: ch.id });
  $$('[data-card]').forEach((el) => (el.onclick = (e) => {
    const card = db.cards.find((c) => c.id === el.dataset.card);
    if (e.target.closest('[data-say]')) return speak(card.foreign, ch.lang);
    editCard(ch, card);
  }));
  const f = $('#filter');
  if (f) f.oninput = () => { const q = f.value.toLowerCase().trim(); $$('#vlist .vocab').forEach((el) => el.classList.toggle('hidden', q && !el.dataset.q.includes(q))); };
};

async function editCard(ch, card) {
  const L = LANGS[ch.lang];
  const isNew = !card;
  const r = await dialog(`<h3>${isNew ? 'Neue Vokabel' : 'Vokabel bearbeiten'}</h3>
    <label class="field" for="vf">${L.flag} ${L.name}</label>
    <input type="text" id="vf" value="${esc(card?.foreign)}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
    <label class="field" style="margin-top:12px" for="vg">🇩🇪 Deutsch</label>
    <input type="text" id="vg" value="${esc(card?.german)}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
    <p class="muted tiny" style="margin-top:8px">Mehrere richtige Antworten mit Komma trennen, z. B. „groß, riesig“.</p>
    <details ${card?.example ? 'open' : ''} style="margin-top:6px"><summary class="small" style="font-weight:800;cursor:pointer;color:var(--purple)">📝 Beispielsatz für den Lückentext (freiwillig)</summary>
      <input type="text" id="vex" value="${esc(card?.example)}" placeholder="z. B. Can I [borrow] your pen?" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" style="margin-top:8px">
      <p class="muted tiny" style="margin-top:6px">Das Lückenwort in [eckige Klammern] setzen. Fehlen die Klammern, sucht die App das Wort selbst.</p>
      <input type="text" id="vexde" value="${esc(card?.exampleDe)}" placeholder="Übersetzung (freiwillig): Kann ich deinen Stift ausleihen?" autocomplete="off" style="margin-top:4px">
    </details>
    ${card ? `<p class="muted tiny">${BOX_NAMES[card.box]} · ${card.right}× gewusst · ${card.wrong}× nicht gewusst</p>` : ''}
    <div class="actions" style="justify-content:space-between">
      ${isNew ? '<span></span>' : '<button class="btn danger" value="delete">Löschen</button>'}
      <span class="row"><button class="btn ghost" value="cancel">${isNew ? 'Fertig' : 'Abbrechen'}</button><button class="btn primary" value="ok">${isNew ? 'Speichern' : 'Speichern'}</button></span>
    </div>`,
  (form) => { if (!$('#vf', form).value.trim() || !$('#vg', form).value.trim()) { toast('Bitte beide Felder ausfüllen'); return false; } });
  if (r === 'ok') {
    const f = $('#vf').value, g = $('#vg').value;
    const ex = $('#vex').value.trim(), exDe = $('#vexde').value.trim();
    if (isNew) { const nc = newCard(ch.id, f, g); if (ex) { nc.example = ex; nc.exampleDe = exDe; } db.cards.push(nc); toast('Gespeichert ✓ – nächste Vokabel'); }
    else { card.foreign = f.trim(); card.german = g.trim(); card.example = ex; card.exampleDe = exDe; }
    save();
    render();
    if (isNew) editCard(ch);
  } else if (r === 'delete') {
    if (!(await confirmDlg('Vokabel löschen?', `„${card.foreign}“ wird gelöscht.`))) return;
    db.cards = db.cards.filter((c) => c !== card);
    save();
    render();
  }
}

/* ---------- Text einfügen ---------- */
const IPA_CHARS = /[ɪəʊɒˈːæʃʒθðŋɔɜʌɑɛœ̃ɥʁ]/;
function isPhonetic(t) { return IPA_CHARS.test(t) || /^[[/{]/.test(t.trim()) || /[\]}]\s*$/.test(t.trim()); }
function splitText(line) {
  const l = line.replace(/\s+$/, '');
  const m = l.match(/^(.*?)\s*\[[^\]]{1,40}\]\s*(.+)$/);
  if (m && m[1].trim()) return [m[1], m[2]];
  const parts = l.split(/\t|\s+[-–—=:]\s+|\s*;\s*|\s{2,}/).map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) return [parts[0], parts.slice(1).join(', ')];
  return [l.trim(), ''];
}
function cleanSide(s) {
  let t = s.replace(/\[[^\]]*\]?/g, ' ').replace(/[|_©®™•■□►▪~]/g, ' ');
  t = t.split(/\s+/).filter((w) => !IPA_CHARS.test(w) && !/\]$/.test(w)).join(' ');
  if ((t.match(/\(/g) || []).length !== (t.match(/\)/g) || []).length) t = t.replace(/[()]/g, '');
  return t.replace(/^[^\p{L}\p{N}(¿¡'’]+/u, '').replace(/[^\p{L}\p{N})!?.'’]+$/u, '').replace(/\s+/g, ' ').trim();
}

views.paste = () => {
  const ch = chapter(state.id);
  if (!ch) return go('home');
  app.innerHTML = `
    <div class="topbar"><button class="iconbtn" id="back">‹</button><h1>Text einfügen</h1></div>
    <div class="card stack">
      <p class="small">Eine Vokabel pro Zeile, mit Bindestrich getrennt:</p>
      <div class="report">dog - Hund\nla maison - das Haus</div>
      <p class="muted small"><strong>📱 Tipp:</strong> In der Fotos-App lange auf den Text im Foto drücken → „Alles auswählen“ → „Kopieren“ und hier einfügen.</p>
      <textarea id="txt" placeholder="Hier einfügen …" autocapitalize="off" autocorrect="off" spellcheck="false"></textarea>
      <button class="btn primary big block" id="go">Weiter</button>
    </div>`;
  $('#back').onclick = () => go('chapter', { id: ch.id });
  $('#go').onclick = () => {
    const rows = $('#txt').value.split(/\n/).map((l) => l.trim()).filter(Boolean).map(splitText).map(([a, b]) => [cleanSide(a), cleanSide(b)]);
    if (!rows.length) return toast('Bitte zuerst Text einfügen');
    go('review', { id: ch.id, rows });
  };
};

/* ---------- Foto scannen (Texterkennung) ---------- */
let ocrWorker = null, ocrLangs = '', ocrProgress = null;
async function getWorker(langs) {
  const key = langs.join('+');
  if (ocrWorker && ocrLangs === key) return ocrWorker;
  if (ocrWorker) { await ocrWorker.terminate(); ocrWorker = null; }
  const abs = (p) => new URL(p, location.href).href;
  ocrWorker = await Tesseract.createWorker(langs, 1, {
    workerPath: abs('vendor/tesseract/worker.min.js'),
    corePath: abs('vendor/tesseract/core'),
    langPath: abs('vendor/tesseract/lang'),
    workerBlobURL: false,
    logger: (m) => ocrProgress && ocrProgress(m),
  });
  ocrLangs = key;
  return ocrWorker;
}

async function prepareImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const max = 2200;
    const scale = Math.min(2, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height);
    const p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      let g = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
      g = Math.max(0, Math.min(255, (g - 128) * 1.35 + 128));
      p[i] = p[i + 1] = p[i + 2] = g;
    }
    ctx.putImageData(d, 0, 0);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function linesFromResult(data) {
  const lines = [];
  for (const b of data.blocks || []) for (const par of b.paragraphs || []) for (const ln of par.lines || []) {
    const words = (ln.words || []).filter((w) => w.text && w.text.trim());
    if (words.length) lines.push({ words, conf: ln.confidence });
  }
  if (!lines.length && data.text) return data.text.split('\n').filter((t) => t.trim()).map((t) => ({ text: t }));
  return lines;
}

// Spalten im Buch anhand großer Lücken zwischen Wörtern erkennen
function columnsOf(words) {
  const heights = words.map((w) => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b);
  const h0 = heights[Math.floor(heights.length / 2)] || 20;
  const cols = [[words[0]]];
  for (let i = 1; i < words.length; i++) {
    if (words[i].bbox.x0 - words[i - 1].bbox.x1 > h0 * 1.2) cols.push([]);
    cols[cols.length - 1].push(words[i]);
  }
  return cols.map((c) => ({ x: c[0].bbox.x0, text: c.map((w) => w.text).join(' ') }));
}

function splitOcrLine(line) {
  if (line.text) return splitText(line.text);
  const words = line.words;
  const text = words.map((w) => w.text).join(' ');
  if (words.length >= 2) {
    const colText = columnsOf(words).map((c) => c.text);
    const cols = colText;
    if (cols.length >= 3) return [colText[0], colText[colText.length - 1], colText.slice(1, -1).join(' ')];
    if (cols.length === 2 && !isPhonetic(colText[1])) return [colText[0], colText[1]];
  }
  const m = text.match(/^(.*?)\s*[[{(][^\]})]{1,40}[\]})]\s*(.+)$/);
  if (m && m[1].trim() && /[[{]/.test(text)) return [m[1], m[2]];
  const parts = text.split(/\s+[-–—=:]\s+|\s*;\s*/).filter((s) => s.trim());
  if (parts.length >= 2) return [parts[0], parts.slice(1).join(', ')];
  return [text, ''];
}

// Erkannte Zeilen in Vokabel-Zeilen umwandeln. Bricht ein Eintrag im Buch in die
// nächste Zeile um (z. B. „der Nachbar, die / Nachbarin“), wird der Rest an die
// passende Spalte der Zeile davor angehängt.
function buildRows(lines) {
  const out = [];
  for (const l of lines) {
    // Lautschrift-Spalten (z. B. „[ˈklɑːsruːm]“ unter dem Wort) zählen nicht als Inhalt
    const cols = l.words ? columnsOf(l.words).filter((c) => !isPhonetic(c.text)) : null;
    if (cols && !cols.length) continue;
    const prev = out[out.length - 1];
    if (prev && prev.colX && cols && cols[0].x > prev.colX[0] + (prev.colX[1] - prev.colX[0]) * 0.5) {
      for (const c of cols) {
        let best = 0, bd = Infinity;
        prev.colX.forEach((x, i) => { const d = Math.abs(x - c.x); if (d < bd) { bd = d; best = i; } });
        if (best === prev.colX.length - 1) prev.g = `${prev.g} ${c.text}`;
        else if (best > 0) prev.mid = `${prev.mid} ${c.text}`.trim();
      }
      continue;
    }
    const [f, g, mid] = splitOcrLine(l);
    out.push({ f, g, mid: mid || '', colX: cols && cols.length >= 2 ? cols.map((c) => c.x) : null });
  }
  return out
    .map((r) => [cleanSide(r.f), cleanSide(r.g), exampleFrom(r.mid, r.f)])
    .filter(([a, b]) => (a + b).replace(/[^\p{L}]/gu, '').length >= 2);
}

// Überschriften, Seitenzahlen o. Ä. nicht vorab anhaken
function looksLikeJunk(f, g) {
  if (!f || !g) return true;
  if (/^[\d\s.,:;·\-–]+$/.test(g) || /^[\d\s.,:;·\-–]+$/.test(f)) return true;
  if (/^(unit|unité|station|volet|lesson|leçon|chapter|chapitre|module|part|teil|seite|page|words|vocabulaire|wortschatz|vokabeln)\b/i.test(f)) return true;
  if (f.split(/\s+/).length > 6 || g.split(/\s+/).length > 8) return true;
  return false;
}

views.scan = async () => {
  const ch = chapter(state.id);
  if (!ch) return go('home');
  const { file, prevRows, prevPages } = state;
  const preview = URL.createObjectURL(file);
  app.innerHTML = `
    <div class="topbar"><button class="iconbtn" id="back">‹</button><h1>Foto wird gelesen …</h1></div>
    <div class="card stack center">
      <img class="thumb" src="${preview}" alt="Ausgewähltes Foto">
      <div style="font-size:44px">🔍</div>
      <div class="bar"><div id="pbar"></div></div>
      <p class="small" id="pstatus">Bild wird vorbereitet …</p>
      <p class="muted tiny">Beim allerersten Mal dauert es etwas länger.</p>
    </div>`;
  let cancelled = false;
  $('#back').onclick = () => { cancelled = true; prevRows ? go('review', { id: ch.id, rows: prevRows, pages: prevPages }) : go('chapter', { id: ch.id }); };
  const STATUS = {
    'loading tesseract core': 'Texterkennung wird geladen …',
    'initializing tesseract': 'Texterkennung startet …',
    'loading language traineddata': 'Sprachen werden geladen …',
    'initializing api': 'Texterkennung startet …',
    'recognizing text': 'Wörter werden gelesen …',
  };
  ocrProgress = (m) => {
    if (cancelled) return;
    const s = $('#pstatus'), b = $('#pbar');
    if (s && STATUS[m.status]) s.textContent = STATUS[m.status];
    if (b && typeof m.progress === 'number') b.style.width = (m.status === 'recognizing text' ? 30 + m.progress * 70 : m.progress * 30) + '%';
  };
  try {
    const pageBlob = await compressPhoto(file).catch(() => null);
    const canvas = await prepareImage(file);
    const worker = await getWorker([LANGS[ch.lang].ocr, 'deu']);
    const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
    if (cancelled) return;
    const rows = buildRows(linesFromResult(data).filter((l) => l.text || l.conf > 35));
    URL.revokeObjectURL(preview);
    if (!rows.length) {
      toast('Keine Wörter gefunden – probier es mit mehr Licht nochmal');
      return prevRows ? go('review', { id: ch.id, rows: prevRows, pages: prevPages }) : go('chapter', { id: ch.id });
    }
    go('review', { id: ch.id, rows: [...(prevRows || []), ...rows], pages: [...(prevPages || []), ...(pageBlob ? [pageBlob] : [])] });
  } catch (e) {
    console.error(e);
    if (cancelled) return;
    toast('Das hat nicht geklappt – bitte nochmal versuchen');
    go('chapter', { id: ch.id });
  } finally {
    ocrProgress = null;
  }
};

/* ---------- Erkannte Vokabeln prüfen ---------- */
views.review = () => {
  const ch = chapter(state.id);
  if (!ch) return go('home');
  const L = LANGS[ch.lang];
  const rows = state.rows.map((r) => (Array.isArray(r) ? { f: r[0], g: r[1], ex: r[2] || '', on: !looksLikeJunk(r[0], r[1]) } : r));
  const pages = state.pages || [];
  const pageUrls = pages.map((b) => URL.createObjectURL(b));
  const count = () => rows.filter((r) => r.on && r.f.trim() && r.g.trim()).length;
  const asArrays = () => rows.map((r) => ({ ...r }));
  const draw = () => {
    app.innerHTML = `
      <div class="topbar"><button class="iconbtn" id="back">‹</button><h1>Stimmt alles?</h1></div>
      <div class="banner yellow" style="margin-top:0;margin-bottom:14px"><span class="ico">🧐</span><div class="small">Vergleiche mit deinem Foto und verbessere Fehler (z. B. fehlende ä, ö, ü). Nur Zeilen mit Haken werden gespeichert.</div></div>
      ${pageUrls.length ? `<div class="pagestrip">${pageUrls.map((u, i) => `<img src="${u}" alt="Foto ${i + 1}" data-big="${i}">`).join('')}<span class="muted tiny">Foto antippen = groß. Es wird nach dem Speichern gelöscht.</span></div>` : ''}
      <div class="row tiny muted" style="margin:0 4px 8px 46px;font-weight:800"><span class="grow">oben: ${L.flag} ${L.name} · unten: 🇩🇪 Deutsch</span></div>
      <div id="rows">${rows.map((r, i) => `<div class="revrow ${r.on ? '' : 'off'}" data-i="${i}">
          <input type="checkbox" ${r.on ? 'checked' : ''} aria-label="Übernehmen">
          <div class="inputs">
            <input type="text" data-k="f" value="${esc(r.f)}" placeholder="${L.flag} ${L.name}" autocapitalize="off" autocorrect="off" spellcheck="false">
            <input type="text" data-k="g" value="${esc(r.g)}" placeholder="🇩🇪 Deutsch" autocapitalize="off" autocorrect="off" spellcheck="false">
            ${r.ex ? `<div class="tiny muted">📝 Beispielsatz: ${esc(r.ex)} <button type="button" class="linkbtn" data-noex>entfernen</button></div>` : ''}
          </div>
          <button class="del" data-del aria-label="Zeile entfernen">✕</button>
        </div>`).join('')}</div>
      <div class="grid3" style="margin-top:14px">
        <button class="btn" id="addrow">+ Zeile</button>
        <button class="btn" id="swap">⇅ Tauschen</button>
        <button class="btn teal-soft" id="more">📷 + Foto</button>
      </div>
      <input type="file" id="file" accept="image/*" class="hidden">
      <div class="sticky-bottom"><button class="btn primary big block" id="save">${count()} Vokabeln speichern</button></div>`;
    $('#back').onclick = async () => { if (await confirmDlg('Abbrechen?', 'Die erkannten Wörter werden nicht gespeichert.', 'Ja, abbrechen')) { pageUrls.forEach((u) => URL.revokeObjectURL(u)); go('chapter', { id: ch.id }); } };
    $('#swap').onclick = () => { rows.forEach((r) => ([r.f, r.g] = [r.g, r.f])); draw(); };
    $('#addrow').onclick = () => { rows.push({ f: '', g: '', on: true }); draw(); $$('.revrow').pop().querySelector('input[type=text]').focus(); };
    $('#more').onclick = () => $('#file').click();
    $('#file').onchange = (e) => { const f = e.target.files[0]; if (f) go('scan', { id: ch.id, file: f, prevRows: asArrays(), prevPages: pages }); };
    $$('[data-big]').forEach((im) => (im.onclick = () => showImage(pageUrls[+im.dataset.big])));
    $$('.revrow').forEach((el) => {
      const r = rows[+el.dataset.i];
      const cb = el.querySelector('input[type=checkbox]');
      cb.onchange = () => { r.on = cb.checked; el.classList.toggle('off', !r.on); upd(); };
      el.querySelectorAll('input[type=text]').forEach((inp) => (inp.oninput = () => {
        r[inp.dataset.k] = inp.value;
        if (r.f.trim() && r.g.trim() && !r.on) { r.on = true; el.classList.remove('off'); cb.checked = true; }
        upd();
      }));
      el.querySelector('[data-del]').onclick = () => { rows.splice(+el.dataset.i, 1); draw(); };
      const nx = el.querySelector('[data-noex]');
      if (nx) nx.onclick = () => { r.ex = ''; draw(); };
    });
    $('#save').onclick = () => {
      const ok = rows.filter((r) => r.on && r.f.trim() && r.g.trim());
      if (!ok.length) return toast('Keine vollständige Zeile mit Haken');
      const existing = new Set(cardsOf(ch.id).map((c) => c.foreign.toLowerCase()));
      let added = 0, dup = 0;
      ok.forEach((r) => {
        const k = r.f.trim().toLowerCase();
        if (existing.has(k)) { dup++; return; }
        const nc = newCard(ch.id, r.f, r.g);
        if (r.ex) nc.example = r.ex;
        db.cards.push(nc);
        existing.add(k);
        added++;
      });
      save();
      // Fotos werden nicht gespeichert – sie dienten nur zum Erfassen und Prüfen
      pageUrls.forEach((u) => URL.revokeObjectURL(u));
      toast(`🎉 ${plural(added, 'Vokabel', 'Vokabeln')} gespeichert${dup ? ` (${dup} doppelt)` : ''}`);
      go('chapter', { id: ch.id });
    };
  };
  const upd = () => { $('#save').textContent = `${count()} Vokabeln speichern`; };
  draw();
};

/* ---------- Lernen ---------- */
function shuffle(a) { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function pickDue(cards) {
  const size = db.settings.sessionSize;
  const testDays = (c) => { const t = testInfo(chapter(c.chapterId)); return t ? t.daysLeft : 999; };
  const due = shuffle(cards.filter(isDue)).sort((a, b) => {
    const ta = Math.min(testDays(a), 14), tb = Math.min(testDays(b), 14);
    if (ta !== tb) return ta - tb; // Kapitel mit nahem Test zuerst
    if ((a.box === 0) !== (b.box === 0)) return a.box === 0 ? 1 : -1; // Wiederholungen vor neuen Wörtern
    return a.box - b.box;
  });
  // Ohne nahen Test höchstens 10 neue Wörter pro Runde
  let fresh = 0;
  const out = [];
  for (const c of due) {
    if (out.length >= size) break;
    if (c.box === 0 && testDays(c) > 7) { if (fresh >= 10) continue; fresh++; }
    out.push(c);
  }
  return shuffle(out);
}

let session = null;
function startSession(cards, title, practice = false) {
  if (!cards.length) return toast('Keine Vokabeln zum Lernen');
  const back = state.view === 'chapter' ? { view: 'chapter', id: state.id } : { view: 'home' };
  session = { title, practice, queue: cards.map((c) => c.id), total: cards.length, done: 0, wrongIds: new Set(), firstTryRight: 0, dirs: {}, introduced: new Set(), back, last: Date.now(), streakNow: 0, bestStreak: 0 };
  dayRec().sessions++;
  save();
  go('learn');
}

// Lernrichtung:
// "auto" (empfohlen): neue/unsichere Wörter zuerst verstehen (Fremdsprache → Deutsch),
// ab Fach 2 selbst schreiben (Deutsch → Fremdsprache) – so wie im Vokabeltest.
// Steht ein Test in ≤ 7 Tagen an, wird schon ab Fach 1 geschrieben.
// Die Richtung bleibt pro Karte in einer Runde gleich, damit ein Fehler in derselben Richtung korrigiert wird.
function direction(card) {
  if (session.dirs[card.id]) return session.dirs[card.id];
  const d = db.settings.direction;
  let r;
  if (d === 'f2g' || d === 'g2f') r = d;
  else if (d === 'mixed') r = Math.random() < 0.5 ? 'f2g' : 'g2f';
  else {
    const t = testInfo(chapter(card.chapterId));
    const testSoon = t && t.daysLeft <= 7;
    r = card.box === 0 || (card.box === 1 && !testSoon) ? 'f2g' : 'g2f';
  }
  session.dirs[card.id] = r;
  return r;
}

views.learn = () => {
  if (!session) return go('home');
  if (!session.queue.length) return go('summary');
  const card = db.cards.find((c) => c.id === session.queue[0]);
  if (!card) { session.queue.shift(); session.total--; return render(); }
  const ch = chapter(card.chapterId) || { lang: 'en' };
  const L = LANGS[ch.lang];
  if (card.box === 0 && !session.introduced.has(card.id) && !session.wrongIds.has(card.id)) return introCard(card, ch);
  const dir = direction(card);
  const question = dir === 'f2g' ? card.foreign : card.german;
  const answer = dir === 'f2g' ? card.german : card.foreign;
  const answerLang = dir === 'f2g' ? 'de' : ch.lang;
  const pct = (session.done / session.total) * 100;

  app.innerHTML = `
    <div class="topbar"><button class="iconbtn" id="quit" aria-label="Beenden">✕</button><div class="progress"><div style="width:${pct}%"></div></div><span class="small" style="font-weight:900">${session.done}/${session.total}</span></div>
    ${session.streakNow >= 3 ? `<div class="center small" style="font-weight:900;color:var(--primary-dark);margin-bottom:6px">🔥 ${session.streakNow} richtig hintereinander!</div>` : ''}
    <div class="card quiz" id="qcard">
      <span class="dir ${ch.lang}">${dir === 'f2g' ? `${L.flag} ${L.name} → 🇩🇪 Deutsch` : `🇩🇪 Deutsch → ${L.flag} ${L.name}`}</span>
      <div class="tiny muted" style="margin-top:6px">${dir === 'f2g' ? '📖 Was bedeutet das?' : '✍️ Schreib es selbst – achte auf die Rechtschreibung'}${session.wrongIds.has(card.id) ? ' · Nochmal probieren 💪' : ''}</div>
      <div class="word">${esc(question)}</div>
      ${dir === 'f2g' ? `${speakBtn('id="say"')}<div class="muted tiny" style="margin-top:4px">2× tippen = langsam</div>` : ''}
      <div id="area"></div>
    </div>`;
  $('#quit').onclick = async () => {
    if (session.done > 0 && !(await confirmDlg('Aufhören?', 'Was du schon gelernt hast, ist gespeichert.', 'Aufhören'))) return;
    const b = session.back;
    session = null;
    go(b.view, b);
  };
  const say = $('#say');
  if (say) {
    say.onclick = () => speak(card.foreign, ch.lang);
    if (db.settings.autoSpeak) setTimeout(() => speak(card.foreign, ch.lang), 250);
  }
  const area = $('#area');

  const finish = (correct) => {
    const now = Date.now();
    dayRec().secs += Math.min((now - session.last) / 1000, 90);
    session.last = now;
    const ctx = { wasDue: isDue(card) || card.box === 0, wrongBefore: session.wrongIds.has(card.id) };
    grade(card, correct, ctx);
    session.queue.shift();
    if (correct) {
      session.done++;
      if (!ctx.wrongBefore) session.firstTryRight++;
      session.streakNow++;
      session.bestStreak = Math.max(session.bestStreak, session.streakNow);
    } else {
      session.streakNow = 0;
      session.wrongIds.add(card.id);
      session.queue.splice(Math.min(3, session.queue.length), 0, card.id);
    }
    save();
    render();
  };

  const showResult = (kind, given) => {
    // Beim Schreiben in der Fremdsprache zählt die Rechtschreibung (wie im Test).
    const strict = dir === 'g2f';
    const correct = kind === 'right' || (!strict && kind !== 'wrong');
    sound(correct);
    if (!correct) $('#qcard').classList.add('shake');
    const msg = {
      right: ['ok', pick(PRAISE)],
      accent: strict ? ['warn', 'Fast! Achte auf die Akzente – im Test wäre das ein Fehler.'] : ['ok', 'Richtig – aber achte auf die Akzente!'],
      typo: strict ? ['warn', 'Fast! Achte auf die Schreibweise – im Test wäre das ein Fehler.'] : ['ok', 'Fast! Kleiner Tippfehler.'],
      wrong: ['bad', given ? 'Leider falsch.' : 'Kein Problem – so heißt es:'],
    }[kind];
    area.innerHTML = `
      <div class="result ${msg[0]}"><strong>${msg[1]}</strong>
        ${kind !== 'right' ? `<div class="sol">${esc(answer)}</div>` : ''}
        <div class="row" style="margin-top:10px;color:var(--text)">${speakBtn('id="say2"', true)}<span class="small">${dir === 'f2g' || kind === 'right' ? `<strong>${esc(card.foreign)}</strong><br>` : ''}<span class="muted tiny">Anhören & nachsprechen · 2× tippen = langsam</span></span></div>
        ${(kind === 'wrong' || (strict && kind !== 'right')) && given ? `<div class="small muted" style="margin-top:4px">Du hast geschrieben: ${esc(given)}</div>` : ''}
      </div>
      <div class="stack" style="margin-top:16px">
        <button class="btn ${correct ? 'ok' : 'primary'} big block" id="next">Weiter ›</button>
        ${kind === 'wrong' && given ? `<button class="btn ghost block" id="override">Ich hatte doch recht</button>` : ''}
        ${kind === 'typo' && !strict ? `<button class="btn ghost block" id="override-bad">Zählt als falsch</button>` : ''}
      </div>`;
    if (dir === 'g2f' || kind !== 'right') speak(card.foreign, ch.lang);
    $('#say2').onclick = () => speak(card.foreign, ch.lang);
    const next = $('#next');
    next.focus();
    next.onclick = () => finish(correct);
    const ov = $('#override');
    if (ov) ov.onclick = () => finish(true);
    const ob = $('#override-bad');
    if (ob) ob.onclick = () => finish(false);
  };

  if (db.settings.mode === 'type') {
    area.innerHTML = `
      <form id="aform" style="margin-top:18px">
        <input type="text" id="answer" placeholder="${answerLang === 'de' ? 'Auf Deutsch …' : `Auf ${L.name} …`}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done">
        ${answerLang === 'fr' ? `<div class="accents">${FR_ACCENTS.map((a) => `<button type="button" data-a="${a}">${a}</button>`).join('')}</div>` : ''}
        <div class="grid2" style="margin-top:14px">
          <button type="button" class="btn" id="dunno">🤷 Weiß nicht</button>
          <button class="btn primary" id="check">Prüfen ✓</button>
        </div>
      </form>`;
    const inp = $('#answer');
    setTimeout(() => inp.focus(), 60);
    $$('.accents button').forEach((b) => (b.onclick = () => {
      const s = inp.selectionStart ?? inp.value.length, e = inp.selectionEnd ?? s;
      inp.value = inp.value.slice(0, s) + b.dataset.a + inp.value.slice(e);
      inp.focus();
      inp.setSelectionRange(s + 1, s + 1);
    }));
    $('#aform').onsubmit = (e) => {
      e.preventDefault();
      if (!inp.value.trim()) return inp.focus();
      showResult(check(inp.value, answer), inp.value.trim());
    };
    $('#dunno').onclick = () => showResult('wrong', '');
  } else {
    area.innerHTML = `<button class="btn primary big block" id="reveal" style="margin-top:18px">Aufdecken 👀</button>`;
    $('#reveal').onclick = () => {
      area.innerHTML = `<div class="ans">${esc(answer)}</div>
        ${dir === 'g2f' ? `<div style="margin-top:8px">${speakBtn('id="say2"')}</div>` : ''}
        <p class="muted small" style="margin-top:12px">Hast du es gewusst?</p>
        <div class="grid2"><button class="btn bad big" id="no">✗ Nein</button><button class="btn ok big" id="yes">✓ Ja</button></div>`;
      if (dir === 'g2f') { speak(card.foreign, ch.lang); $('#say2').onclick = () => speak(card.foreign, ch.lang); }
      $('#no').onclick = () => { sound(false); finish(false); };
      $('#yes').onclick = () => { sound(true); finish(true); };
    };
  }
};

function introCard(card, ch) {
  const L = LANGS[ch.lang];
  const pct = (session.done / session.total) * 100;
  app.innerHTML = `
    <div class="topbar"><button class="iconbtn" id="quit" aria-label="Beenden">✕</button><div class="progress"><div style="width:${pct}%"></div></div><span class="small" style="font-weight:900">${session.done}/${session.total}</span></div>
    <div class="card quiz">
      <span class="dir ${ch.lang}">✨ Neues Wort</span>
      <div class="word">${esc(card.foreign)}</div>
      ${speakBtn('id="say"')}
      <div class="ans">${esc(card.german)}</div>
      <div class="banner yellow" style="text-align:left"><span class="ico">🗣️</span><div class="small">Hör gut zu und <strong>sprich das Wort zweimal laut nach</strong>. Gleich wirst du danach gefragt!</div></div>
      <button class="btn primary big block" id="gotit" style="margin-top:16px">Hab's mir gemerkt ›</button>
    </div>`;
  const say = () => speak(card.foreign, ch.lang);
  $('#say').onclick = say;
  setTimeout(say, 300);
  $('#quit').onclick = () => { const b = session.back; session = null; go(b.view, b); };
  $('#gotit').onclick = () => {
    session.introduced.add(card.id);
    session.queue.shift();
    // Kurz darauf (nach 2 anderen Wörtern) wird das neue Wort abgefragt
    session.queue.splice(Math.min(2, session.queue.length), 0, card.id);
    render();
  };
}

views.summary = () => {
  const s = session;
  if (!s) return go('home');
  const wrongCards = [...s.wrongIds].map((id) => db.cards.find((c) => c.id === id)).filter(Boolean);
  const pct = Math.round((s.firstTryRight / s.total) * 100);
  const [emoji, text] = pct === 100 ? ['🏆', 'Perfekt! Alles auf Anhieb gewusst!'] : pct >= 80 ? ['🎉', 'Super gemacht!'] : pct >= 50 ? ['💪', 'Gut geübt – weiter so!'] : ['🌱', 'Jedes Mal wird es besser!'];
  const moreDue = pickDue(s.back.view === 'chapter' ? cardsOf(s.back.id) : db.cards).length;
  const recips = db.parent.recipients;
  const k = dayKey();
  app.innerHTML = `
    <div class="hero ${pct >= 80 ? 'done' : ''} center">
      <div style="font-size:64px;position:relative;z-index:1">${emoji}</div>
      <div class="num" style="position:relative;z-index:1">${pct} %</div>
      <div class="lbl" style="position:relative;z-index:1">${text}</div>
      <div class="chips" style="justify-content:center">
        <span class="chip">${s.firstTryRight} von ${s.total} auf Anhieb</span>
        ${s.bestStreak >= 3 ? `<span class="chip">🔥 ${s.bestStreak} in Folge</span>` : ''}
      </div>
    </div>
    ${wrongCards.length ? `<h2>Diese Wörter üben wir morgen nochmal</h2>
      <div class="list">${wrongCards.map((c) => `<div class="vocab"><i class="box-dot" style="background:var(--b1)"></i><div class="grow"><div class="f">${esc(c.foreign)}</div><div class="g">${esc(c.german)}</div></div></div>`).join('')}</div>` : ''}
    <div class="stack" style="margin-top:22px">
      ${moreDue ? `<button class="btn primary big block" id="again">Noch eine Runde (${moreDue}) 🚀</button>` : ''}
      ${recips.map((r) => `<a class="btn wa block" href="${esc(waLink(r.number, buildReport(k)))}" target="_blank" rel="noopener" data-sent="${k}|${r.id}">📨 Bericht an ${esc(r.name)} senden</a>`).join('')}
      <button class="btn ${moreDue ? '' : 'primary big'} block" id="done">Fertig</button>
    </div>`;
  if (pct >= 80) confetti();
  $('#done').onclick = () => { const b = s.back; session = null; go(b.view, b); };
  const ag = $('#again');
  if (ag) ag.onclick = () => { const b = s.back; state = Object.assign({ view: b.view }, b); startSession(pickDue(b.view === 'chapter' ? cardsOf(b.id) : db.cards), s.title); };
  $$('[data-sent]').forEach((a) => a.addEventListener('click', () => {
    const [kk, rid] = a.dataset.sent.split('|');
    dayRec(kk).sent[rid] = Date.now();
    save();
    a.textContent = '✓ Bericht geöffnet';
  }));
};

/* ---------- WhatsApp-Bericht ---------- */
function normNumber(n) {
  let d = String(n).replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = '49' + d.slice(1);
  return d.replace(/\D/g, '');
}
function waLink(number, text) {
  return `https://wa.me/${normNumber(number)}?text=${encodeURIComponent(text)}`;
}
function buildReport(k) {
  const d = db.days[k] ? dayRec(k) : { right: 0, wrong: 0, secs: 0, sessions: 0, ch: {}, hard: [] };
  const name = db.profile.name || 'Kind';
  const L = [];
  L.push(`📚 Vokabel-Bericht von ${name}`);
  L.push(`${fmtDate(keyToTime(k), { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}`);
  L.push('');
  const total = d.right + d.wrong;
  if (total) {
    L.push(`⏱️ Lernzeit: ${fmtMin(d.secs)} (${plural(d.sessions || 1, 'Runde', 'Runden')})`);
    L.push(`✅ ${d.right} gewusst · ❌ ${d.wrong} nicht gewusst (${Math.round((d.right / total) * 100)} %)`);
    const chs = Object.entries(d.ch).map(([id, v]) => ({ c: chapter(id), v })).filter((x) => x.c);
    if (chs.length) {
      L.push('');
      L.push('📖 Geübt:');
      chs.forEach(({ c, v }) => L.push(`• ${LANGS[c.lang].flag} ${c.name}: ${v.r} ✓ / ${v.w} ✗`));
    }
  } else {
    L.push('Heute wurde noch nicht abgefragt.');
  }
  const added = db.cards.filter((c) => dayKey(c.created) === k);
  if (added.length) {
    L.push('');
    L.push(`➕ Neu angelegt: ${plural(added.length, 'Vokabel', 'Vokabeln')}`);
    const byCh = {};
    added.forEach((c) => (byCh[c.chapterId] = byCh[c.chapterId] || []).push(c));
    Object.entries(byCh).forEach(([id, list]) => {
      const c = chapter(id);
      if (!c) return;
      const words = list.slice(0, 12).map((x) => x.foreign).join(', ');
      L.push(`• ${LANGS[c.lang].flag} ${c.name} (${list.length}): ${words}${list.length > 12 ? ` … +${list.length - 12}` : ''}`);
    });
  }
  if ((d.exams || []).length) {
    L.push('');
    L.push('🎓 Prüfungen:');
    d.exams.forEach((e) => { const c = chapter(e.ch); if (c) L.push(`• ${LANGS[c.lang].flag} ${c.name} – ${e.type === 'cloze' ? 'Lückentext' : 'Vokabeltest'}: ${e.score}/${e.total} (${Math.round((e.score / e.total) * 100)} %, etwa Note ${gradeFor(e.score / e.total)})`); });
  }
  const hard = (d.hard || []).map((id) => db.cards.find((c) => c.id === id)).filter(Boolean);
  if (hard.length) {
    L.push('');
    L.push('⚠️ Noch unsicher:');
    hard.slice(0, 10).forEach((c) => L.push(`• ${c.foreign} – ${c.german}`));
    if (hard.length > 10) L.push(`• … und ${hard.length - 10} weitere`);
  }
  const tests = db.chapters.map((c) => ({ c, t: testInfo(c) })).filter((x) => x.t && x.t.daysLeft <= 21).sort((a, b) => a.t.daysLeft - b.t.daysLeft);
  if (tests.length) {
    L.push('');
    L.push('📅 Anstehende Tests:');
    tests.forEach(({ c, t }) => L.push(`• ${LANGS[c.lang].flag} ${c.name}: ${fmtDate(t.day)} (${daysLabel(t.daysLeft)}) – ${t.ready} % sicher`));
  }
  const s = streak();
  if (s > 1) { L.push(''); L.push(`🔥 ${s} Tage in Folge gelernt`); }
  return L.join('\n');
}

/* ---------- Mein Bereich ---------- */
views.me = () => {
  const st = db.settings;
  const total = db.cards.length;
  const learned = db.cards.filter((c) => c.box >= 4).length;
  const last14 = [];
  for (let i = 13; i >= 0; i--) { const k = dayKey(Date.now() - i * DAY); last14.push([k, db.days[k] || { right: 0, wrong: 0, secs: 0 }]); }
  const maxDay = Math.max(1, ...last14.map(([, v]) => v.right + v.wrong));
  const mins14 = Math.round(last14.reduce((s, [, v]) => s + (v.secs || 0), 0) / 60);
  const problems = db.cards.filter(isProblem).sort((a, b) => b.wrong - a.wrong).slice(0, 15);
  const seg = (key, opts) => `<div class="seg" data-set="${key}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${String(st[key]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  let used = 0;
  try { used = (localStorage.getItem(STORE_KEY) || '').length * 2; } catch (e) { /* egal */ }

  app.innerHTML = `
    <div class="topbar"><button class="iconbtn" id="back">‹</button><h1>Mein Bereich</h1></div>
    <div class="card row" style="gap:14px">
      <div class="avatar">${esc(db.profile.avatar)}</div>
      <div class="grow"><div style="font-weight:900;font-size:20px">${esc(db.profile.name)}</div><div class="muted small">🔥 ${plural(streak(), 'Tag', 'Tage')} in Folge</div></div>
      <button class="btn" id="editprof" style="min-height:46px">Ändern</button>
    </div>
    <h2>📊 Statistik</h2>
    <div class="card">
      <div class="grid3 center">
        <div><div style="font-size:28px;font-weight:900">${total}</div><div class="muted tiny">Vokabeln</div></div>
        <div><div style="font-size:28px;font-weight:900;color:var(--ok)">${learned}</div><div class="muted tiny">sitzen sicher</div></div>
        <div><div style="font-size:28px;font-weight:900;color:var(--primary)">${mins14}</div><div class="muted tiny">Min. in 14 Tagen</div></div>
      </div>
      ${distBar(db.cards)}${legend()}
      <div style="display:flex;align-items:flex-end;gap:4px;height:90px;margin-top:18px" aria-label="Abfragen pro Tag">
        ${last14.map(([k, v]) => `<div title="${k}: ${v.right} richtig, ${v.wrong} falsch" style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%">
          <div style="height:${(v.wrong / maxDay) * 80}px;background:var(--bad);border-radius:4px 4px 0 0;opacity:.85"></div>
          <div style="height:${(v.right / maxDay) * 80}px;background:var(--ok);${v.wrong ? '' : 'border-radius:4px 4px 0 0;'}"></div>
          ${v.right + v.wrong ? '' : '<div style="height:3px;background:var(--line);border-radius:2px"></div>'}</div>`).join('')}
      </div>
      <div class="row spread muted tiny" style="margin-top:6px"><span>vor 2 Wochen</span><span>heute</span></div>
    </div>
    ${problems.length ? `<h2>⚠️ Schwierige Wörter</h2><div class="list">${problems.map((c) => `<div class="vocab"><i class="box-dot" style="background:var(--b${c.box})"></i><div class="grow"><div class="f">${esc(c.foreign)}</div><div class="g">${esc(c.german)}</div></div><span class="muted small">${c.wrong}× ✗</span></div>`).join('')}</div>` : ''}
    <h2>⚙️ So möchte ich lernen</h2>
    <div class="card stack">
      <label class="field">Abfragen</label>${seg('direction', [['auto', '✨ Auto'], ['f2g', 'Fremd→DE'], ['g2f', 'DE→Fremd'], ['mixed', 'Mix']])}
      <p class="muted tiny" style="margin-top:6px">Empfohlen: <strong>Auto</strong> – neue Wörter erst verstehen, dann selbst schreiben.</p>
      <label class="field">Antworten</label>${seg('mode', [['type', '⌨️ Eintippen'], ['reveal', '👀 Aufdecken']])}
      <p class="muted tiny" style="margin-top:6px">Eintippen lernt besser (auch die Rechtschreibung). Aufdecken geht schneller.</p>
      <label class="field">Wörter pro Runde</label>${seg('sessionSize', [[10, '10'], [20, '20'], [30, '30'], [50, '50']])}
      <label class="field">Töne</label>${seg('sound', [['true', '🔊 An'], ['false', '🔇 Aus']])}
      <label class="field">Fremdwort automatisch vorlesen</label>${seg('autoSpeak', [['true', '🗣️ Ja'], ['false', 'Nur per Knopf']])}
      <button type="button" class="btn teal-soft block" id="ttstest">🔊 Vorlesen testen</button>
      <div class="report hidden" id="ttsout"></div>
    </div>
    <h2>💾 Sicherung & Handywechsel</h2>
    <div class="card stack">
      <p class="small">Deine Vokabeln sind nur auf diesem Handy gespeichert. Mit einer Sicherung kannst du sie auf ein neues Handy mitnehmen.</p>
      <p class="muted tiny">Letzte Sicherung: ${db.lastBackup ? fmtDate(db.lastBackup, { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'noch nie'} · belegt: ${(used / 1024 / 1024).toFixed(2)} MB von ca. 5 MB</p>
      <button class="btn teal block" id="export">💾 Sicherung erstellen</button>
      <button class="btn block" id="import">📂 Sicherung oder geteiltes Kapitel laden</button>
      <input type="file" id="impfile" accept="application/json,.json" class="hidden">
      <details class="small muted"><summary style="font-weight:800;cursor:pointer">So klappt der Handywechsel</summary>
        <ol style="padding-left:20px;margin:8px 0 0">
          <li>Auf dem alten Handy „Sicherung erstellen“ → „In Dateien sichern“ (iCloud Drive) oder per AirDrop/WhatsApp an das neue Handy schicken.</li>
          <li>Auf dem neuen Handy die App öffnen und zum Home-Bildschirm hinzufügen.</li>
          <li>Beim Start „Ich habe schon eine Sicherung“ tippen und die Datei auswählen.</li>
        </ol></details>
    </div>
    <h2>👨‍👩‍👧 Für Eltern</h2>
    <div class="card"><p class="small muted">WhatsApp-Bericht einrichten (mit PIN geschützt).</p><button class="btn purple-soft block" id="parent">🔒 Elternbereich</button></div>
    <h2>💡 So lernst du mit der App</h2>
    <div class="card small">
      <p><strong>1. Kennenlernen:</strong> Ein neues Wort siehst du zuerst mit Übersetzung und Aussprache. Sprich es laut nach – das hilft beim Merken.</p>
      <p><strong>2. Verstehen:</strong> Danach fragt die App: Was bedeutet das Wort auf Deutsch?</p>
      <p><strong>3. Selbst schreiben:</strong> Sobald du es verstehst, schreibst du es selbst in der Fremdsprache – genau wie im Vokabeltest. Dabei zählt die Rechtschreibung.</p>
      <p><strong>Karteikasten:</strong> Jede Vokabel wandert durch 5 Fächer. Weißt du sie, rückt sie ein Fach weiter und kommt seltener dran: nach 1, 3, 7, 14 und 30 Tagen. Weißt du sie nicht, fällt sie zurück in Fach 1 und kommt gleich nochmal und am nächsten Tag wieder.</p>
      <p>Hast du einen Testtermin eingetragen, plant die App so, dass jedes Wort vor dem Test oft genug drankommt – spätestens am Tag davor nochmal alle.</p>
      <p style="margin:0">Am besten jeden Tag 10 Minuten – dann bleiben die Wörter für immer im Kopf. 🧠</p>
    </div>
    <p class="muted tiny center" style="margin-top:24px">Texterkennung: Tesseract (Apache-2.0) · Schrift: Nunito (OFL) · alles läuft offline auf dem Gerät</p>`;
  $('#back').onclick = () => go('home');
  $('#editprof').onclick = editProfile;
  $$('[data-set]').forEach((segEl) => $$('button', segEl).forEach((b) => (b.onclick = () => {
    const key = segEl.dataset.set;
    st[key] = key === 'sessionSize' ? +b.dataset.v : (key === 'sound' || key === 'autoSpeak') ? b.dataset.v === 'true' : b.dataset.v;
    save();
    $$('button', segEl).forEach((x) => x.classList.toggle('on', x === b));
    if (key === 'sound' && st.sound) sound(true);
  })));
  $('#export').onclick = exportData;
  $('#ttstest').onclick = () => { const o = $('#ttsout'); o.classList.remove('hidden'); speechTest(o); };
  $('#import').onclick = () => $('#impfile').click();
  $('#impfile').onchange = (e) => e.target.files[0] && importFile(e.target.files[0]);
  $('#parent').onclick = () => askPin(() => go('parent'));
};

async function editProfile() {
  let avatar = db.profile.avatar;
  const p = dialog(`<h3>Profil</h3>
    <label class="field" for="pname">Name</label>
    <input type="text" id="pname" value="${esc(db.profile.name)}" maxlength="20" autocomplete="off">
    <label class="field" style="margin-top:14px">Tier</label>
    <div class="avatars">${AVATARS.map((a) => `<button type="button" data-a="${a}" class="${a === avatar ? 'on' : ''}">${a}</button>`).join('')}</div>
    <div class="actions"><button class="btn ghost" value="cancel">Abbrechen</button><button class="btn primary" value="ok">Speichern</button></div>`);
  $$('#dialog .avatars button').forEach((b) => (b.onclick = () => { avatar = b.dataset.a; $$('#dialog .avatars button').forEach((x) => x.classList.toggle('on', x === b)); }));
  if ((await p) === 'ok') {
    const n = $('#pname').value.trim();
    if (n) db.profile.name = n;
    db.profile.avatar = avatar;
    save();
    render();
  }
}

/* ---------- PIN & Elternbereich ---------- */
function askPin(onOk) {
  const setting = !db.parent.pin;
  let first = '';
  let entered = '';
  const dlg = $('#dialog');
  const form = $('#dialog-form');
  const draw = (title, hint) => {
    form.innerHTML = `<h3 class="center">🔒 ${title}</h3><p class="muted small center">${hint}</p>
      <div class="pindots">${[0, 1, 2, 3].map((i) => `<i class="${i < entered.length ? 'on' : ''}"></i>`).join('')}</div>
      <div class="pinpad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-n="${n}">${n}</button>`).join('')}
        <button type="button" value="cancel" data-x style="font-size:16px">Abbrechen</button><button type="button" data-n="0">0</button><button type="button" data-b style="font-size:20px">⌫</button></div>`;
    $$('[data-n]', form).forEach((b) => (b.onclick = () => press(b.dataset.n)));
    $('[data-b]', form).onclick = () => { entered = entered.slice(0, -1); redraw(); };
    $('[data-x]', form).onclick = () => dlg.close('cancel');
  };
  const redraw = () => {
    if (setting) draw(first ? 'PIN wiederholen' : 'PIN festlegen', first ? 'Bitte die gleiche PIN nochmal eingeben.' : 'Lege eine 4-stellige PIN für den Elternbereich fest.');
    else draw('Elternbereich', 'Bitte PIN eingeben.');
  };
  const press = (n) => {
    if (entered.length >= 4) return;
    entered += n;
    redraw();
    if (entered.length < 4) return;
    setTimeout(() => {
      if (setting && !first) { first = entered; entered = ''; return redraw(); }
      if (setting) {
        if (entered === first) { db.parent.pin = entered; save(); dlg.close('ok'); toast('PIN gespeichert'); onOk(); }
        else { first = ''; entered = ''; toast('Die PINs waren unterschiedlich'); redraw(); }
        return;
      }
      if (entered === db.parent.pin) { dlg.close('ok'); onOk(); }
      else { entered = ''; toast('Falsche PIN'); redraw(); }
    }, 150);
  };
  form.onsubmit = (e) => e.preventDefault();
  dlg.onclose = null;
  redraw();
  dlg.showModal();
}

views.parent = () => {
  const p = db.parent;
  const report = buildReport(dayKey());
  app.innerHTML = `
    <div class="topbar"><button class="iconbtn" id="back">‹</button><h1>🔒 Elternbereich</h1></div>
    <h2 style="margin-top:6px">📨 WhatsApp-Bericht</h2>
    <div class="card stack">
      <p class="small">Nach dem Lernen erscheint ein grüner Knopf „Bericht an … senden“. Ein Tipp öffnet WhatsApp mit dem fertigen Bericht – das Kind muss nur noch auf Senden tippen. Bis der Bericht abgeschickt ist, erinnert die Startseite daran (auch noch am nächsten Tag).</p>
      <div class="list" style="box-shadow:none;border:2px solid var(--line)">
        ${p.recipients.length ? p.recipients.map((r) => `<div class="item" style="cursor:default"><span style="font-size:24px">👤</span><div class="grow"><div style="font-weight:900">${esc(r.name)}</div><div class="muted small">+${esc(normNumber(r.number))}</div></div><button class="btn danger" style="min-height:42px" data-delr="${r.id}">Entfernen</button></div>`).join('')
          : '<div class="empty small">Noch keine Nummer hinterlegt.</div>'}
      </div>
      <button class="btn primary block" id="addr">+ Empfänger hinzufügen</button>
    </div>
    <h2>👀 Vorschau: Bericht von heute</h2>
    <div class="card"><div class="report">${esc(report)}</div></div>
    <h2>🔑 PIN</h2>
    <div class="card"><button class="btn block" id="chpin">PIN ändern</button></div>
    <p class="muted tiny" style="margin-top:16px">Hinweis: Die PIN ist ein Kinderschutz, keine Verschlüsselung. Alle Daten liegen nur auf diesem Gerät.</p>`;
  $('#back').onclick = () => go('me');
  $('#addr').onclick = addRecipient;
  $$('[data-delr]').forEach((b) => (b.onclick = async () => {
    if (!(await confirmDlg('Empfänger entfernen?', 'An diese Nummer wird dann kein Bericht mehr angeboten.', 'Entfernen'))) return;
    p.recipients = p.recipients.filter((r) => r.id !== b.dataset.delr);
    save();
    render();
  }));
  $('#chpin').onclick = () => { db.parent.pin = ''; askPin(() => render()); };
};

async function addRecipient() {
  const r = await dialog(`<h3>Empfänger hinzufügen</h3>
    <label class="field" for="rname">Name (wie er im Knopf erscheint)</label>
    <input type="text" id="rname" placeholder="z. B. Papa" maxlength="20" autocomplete="off">
    <label class="field" style="margin-top:14px" for="rnum">Handynummer (WhatsApp)</label>
    <input type="tel" id="rnum" placeholder="z. B. 0171 1234567" autocomplete="off">
    <p class="muted tiny" style="margin-top:6px">Deutsche Nummern mit 0 am Anfang werden automatisch zu +49.</p>
    <div class="actions"><button class="btn ghost" value="cancel">Abbrechen</button><button class="btn primary" value="ok">Hinzufügen</button></div>`,
  (form) => {
    const n = normNumber($('#rnum', form).value);
    if (!$('#rname', form).value.trim()) { toast('Bitte einen Namen eingeben'); return false; }
    if (n.length < 9 || n.length > 15) { toast('Die Nummer sieht nicht richtig aus'); return false; }
  });
  if (r !== 'ok') return;
  db.parent.recipients.push({ id: uid(), name: $('#rname').value.trim(), number: $('#rnum').value.trim() });
  save();
  render();
}

function importPack(pack) {
  if (!pack || !LANGS[pack.lang] || !Array.isArray(pack.cards)) throw new Error('format');
  let ch = pack.id ? db.chapters.find((c) => c.source === pack.id) : null;
  let created = false;
  if (!ch) {
    ch = { id: uid(), name: pack.name || 'Neues Kapitel', lang: pack.lang, testDate: '', archived: false, created: Date.now(), source: pack.id || '' };
    db.chapters.push(ch);
    created = true;
  }
  const byForeign = new Map(cardsOf(ch.id).map((c) => [c.foreign.trim().toLowerCase(), c]));
  let added = 0, sentences = 0;
  pack.cards.forEach((row) => {
    const [f, g, ex, exDe] = Array.isArray(row) ? row : [row.foreign, row.german, row.example, row.exampleDe];
    if (!f || !g) return;
    const k = String(f).trim().toLowerCase();
    let c = byForeign.get(k);
    if (!c) {
      c = newCard(ch.id, String(f), String(g));
      db.cards.push(c);
      byForeign.set(k, c);
      added++;
    }
    if (ex && !c.example) { c.example = String(ex); c.exampleDe = exDe ? String(exDe) : ''; sentences++; }
  });
  save();
  return { created, added, sentences, chapter: ch };
}

/* ---------- Prüfung (Vokabeltest & Lückentext) ----------
   Läuft parallel zum Karteikasten und verändert keine Fächer.
   Lückentexte nutzen gespeicherte Beispielsätze – keine KI zur Laufzeit. */
function parseCloze(card) {
  const ex = (card.example || '').trim();
  if (!ex) return null;
  const m = ex.match(/^(.*?)\[([^\]]+)\](.*)$/);
  if (m) return { before: m[1], gap: m[2].trim(), after: m[3] };
  // Ohne Klammern: Vokabel (ohne Artikel / "to") im Satz suchen
  const base = card.foreign.split(/[,;/]/)[0].replace(/\([^)]*\)/g, '').trim().replace(/^to /i, '');
  const cands = [base, base.replace(ARTICLES, '')].filter((x) => x.length >= 2);
  for (const c of cands) {
    const i = ex.toLowerCase().indexOf(c.toLowerCase());
    if (i >= 0) return { before: ex.slice(0, i), gap: ex.slice(i, i + c.length), after: ex.slice(i + c.length) };
  }
  return null;
}
const clozeCards = (cards) => cards.filter((c) => parseCloze(c));
function gradeFor(ratio) {
  // Üblicher Notenschlüssel (kann je nach Schule/Lehrkraft abweichen)
  const pct = ratio * 100;
  return pct >= 92 ? 1 : pct >= 81 ? 2 : pct >= 67 ? 3 : pct >= 50 ? 4 : pct >= 30 ? 5 : 6;
}
function lastExam(ch) {
  const e = (ch.exams || [])[ch.exams?.length - 1];
  if (!e) return '';
  return `${Math.round((e.score / e.total) * 100)} % · Note ${gradeFor(e.score / e.total)}`;
}

let exam = null;
function startExam(ch, type) {
  const cs = cardsOf(ch.id);
  const items = type === 'cloze'
    ? shuffle(clozeCards(cs)).map((c) => ({ id: c.id, kind: 'cloze' }))
    : shuffle(cs).map((c) => ({ id: c.id, kind: 'word' }));
  if (items.length < 3) return toast('Zu wenige Vokabeln für eine Prüfung');
  exam = { chId: ch.id, type, items, idx: 0, answers: [], start: Date.now() };
  go('exam');
}

views.exam = () => {
  if (!exam) return go('home');
  const ch = chapter(exam.chId);
  if (!ch) { exam = null; return go('home'); }
  if (exam.idx >= exam.items.length) return finishExam();
  const it = exam.items[exam.idx];
  const card = db.cards.find((c) => c.id === it.id);
  if (!card) { exam.items.splice(exam.idx, 1); return render(); }
  const L = LANGS[ch.lang];
  const cl = it.kind === 'cloze' ? parseCloze(card) : null;
  const pct = (exam.idx / exam.items.length) * 100;
  app.innerHTML = `
    <div class="topbar"><button class="iconbtn" id="quit" aria-label="Prüfung abbrechen">✕</button><div class="progress"><div style="width:${pct}%;background:linear-gradient(90deg,#b794ff,var(--purple))"></div></div><span class="small" style="font-weight:900">${exam.idx + 1}/${exam.items.length}</span></div>
    <div class="card quiz">
      <span class="dir" style="background:var(--purple-soft);color:var(--purple)">🎓 ${exam.type === 'cloze' ? 'Lückentext' : 'Vokabeltest'} · ${L.flag} ${esc(ch.name)}</span>
      ${cl ? `
        <div class="cloze">${esc(cl.before)}<span class="gap">?</span>${esc(cl.after)}</div>
        <div class="muted small">Gesuchtes Wort: <strong style="color:var(--text)">${esc(card.german)}</strong></div>
        ${card.exampleDe ? `<div class="muted tiny" style="margin-top:4px">${esc(card.exampleDe)}</div>` : ''}`
      : `<div class="tiny muted" style="margin-top:10px">Wie heißt das auf ${L.name}?</div><div class="word">${esc(card.german)}</div>`}
      <form id="eform" style="margin-top:18px">
        <input type="text" id="eans" placeholder="${cl ? 'Wort für die Lücke …' : `Auf ${L.name} …`}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="next">
        ${ch.lang === 'fr' ? `<div class="accents">${FR_ACCENTS.map((a) => `<button type="button" data-a="${a}">${a}</button>`).join('')}</div>` : ''}
        <div class="grid2" style="margin-top:14px">
          <button type="button" class="btn" id="skip">Weiß nicht</button>
          <button class="btn primary" style="background:var(--purple);box-shadow:0 5px 0 #6d3fd6">Weiter ›</button>
        </div>
      </form>
    </div>`;
  const inp = $('#eans');
  setTimeout(() => inp.focus(), 60);
  $$('.accents button').forEach((b) => (b.onclick = () => {
    const s0 = inp.selectionStart ?? inp.value.length, e0 = inp.selectionEnd ?? s0;
    inp.value = inp.value.slice(0, s0) + b.dataset.a + inp.value.slice(e0);
    inp.focus();
    inp.setSelectionRange(s0 + 1, s0 + 1);
  }));
  const next = (given) => {
    const expected = cl ? cl.gap : card.foreign;
    const res = given ? check(given, expected) : 'wrong';
    exam.answers.push({ id: card.id, kind: it.kind, given, expected, ok: res === 'right', near: res === 'accent' || res === 'typo' });
    exam.idx++;
    render();
  };
  $('#eform').onsubmit = (e) => { e.preventDefault(); if (!inp.value.trim()) return inp.focus(); next(inp.value.trim()); };
  $('#skip').onclick = () => next('');
  $('#quit').onclick = async () => {
    if (!(await confirmDlg('Prüfung abbrechen?', 'Die Prüfung wird nicht gewertet.', 'Abbrechen'))) return;
    const id = exam.chId;
    exam = null;
    go('chapter', { id });
  };
};

function finishExam() {
  const ch = chapter(exam.chId);
  const score = exam.answers.filter((a) => a.ok).length;
  const total = exam.answers.length;
  const rec = { date: Date.now(), type: exam.type, score, total };
  ch.exams = ch.exams || [];
  ch.exams.push(rec);
  const d = dayRec();
  d.exams.push({ ch: ch.id, type: exam.type, score, total });
  d.secs += Math.min((Date.now() - exam.start) / 1000, total * 90);
  save();
  exam.result = rec;
  go('examResult');
}

views.examResult = () => {
  if (!exam || !exam.result) return go('home');
  const ch = chapter(exam.chId);
  const { score, total } = exam.result;
  const ratio = score / total;
  const note = gradeFor(ratio);
  const wrongIds = exam.answers.filter((a) => !a.ok).map((a) => a.id);
  const recips = db.parent.recipients;
  const k = dayKey();
  app.innerHTML = `
    <div class="hero center" style="background:linear-gradient(135deg,#8b5cf6 0%,#3d8bff 100%);box-shadow:0 10px 24px rgba(110,90,240,.3)">
      <div style="font-size:56px;position:relative;z-index:1">${note <= 2 ? '🏆' : note <= 3 ? '👍' : '📚'}</div>
      <div class="num" style="position:relative;z-index:1">${score}/${total}</div>
      <div class="lbl" style="position:relative;z-index:1">${Math.round(ratio * 100)} % – das wäre etwa eine ${note}</div>
      <div class="chips" style="justify-content:center"><span class="chip">🎓 ${exam.type === 'cloze' ? 'Lückentext' : 'Vokabeltest'} · ${esc(ch.name)}</span></div>
    </div>
    <h2>Auswertung</h2>
    <div class="list">${exam.answers.map((a) => {
      const c = db.cards.find((x) => x.id === a.id);
      const cl = a.kind === 'cloze' && c ? parseCloze(c) : null;
      return `<div class="vocab" style="cursor:default;align-items:flex-start">
        <span style="font-size:20px">${a.ok ? '✅' : a.near ? '🟡' : '❌'}</span>
        <div class="grow">
          ${cl ? `<div class="small">${esc(cl.before)}<strong style="color:var(--ok-dark)">${esc(cl.gap)}</strong>${esc(cl.after)}</div>` : `<div class="f">${esc(a.expected)}</div><div class="g">${esc(c ? c.german : '')}</div>`}
          ${a.ok ? '' : `<div class="tiny" style="color:var(--bad-dark);margin-top:2px">Deine Antwort: ${a.given ? esc(a.given) : '—'}${a.near ? ' (fast – Rechtschreibung)' : ''}</div>`}
        </div></div>`;
    }).join('')}</div>
    <p class="muted tiny" style="margin-top:8px">Die Note ist nur eine Schätzung nach einem üblichen Notenschlüssel – in deiner Schule kann er anders sein.</p>
    <div class="stack" style="margin-top:18px">
      ${wrongIds.length ? `<button class="btn primary big block" id="practice">Fehler jetzt üben (${wrongIds.length}) 💪</button>` : ''}
      ${recips.map((r) => `<a class="btn wa block" href="${esc(waLink(r.number, buildReport(k)))}" target="_blank" rel="noopener" data-sent="${k}|${r.id}">📨 Bericht an ${esc(r.name)} senden</a>`).join('')}
      <button class="btn block" id="done">Fertig</button>
    </div>`;
  if (note <= 2) confetti();
  $('#done').onclick = () => { const id = exam.chId; exam = null; go('chapter', { id }); };
  const pr = $('#practice');
  if (pr) pr.onclick = () => {
    const cards = wrongIds.map((id) => db.cards.find((c) => c.id === id)).filter(Boolean);
    const id = exam.chId;
    exam = null;
    state = { view: 'chapter', id };
    startSession(cards, 'Prüfungsfehler', true);
  };
  $$('[data-sent]').forEach((a) => a.addEventListener('click', () => {
    const [kk, rid] = a.dataset.sent.split('|');
    dayRec(kk).sent[rid] = Date.now();
    save();
    a.textContent = '✓ Bericht geöffnet';
  }));
};

/* ---------- Kapitel teilen ---------- */
async function shareChapter(ch) {
  const pack = {
    type: 'vokabel-kapitel',
    id: ch.source || 'k-' + ch.id,
    name: ch.name,
    lang: ch.lang,
    cards: cardsOf(ch.id).map((c) => (c.example ? [c.foreign, c.german, c.example, c.exampleDe || ''] : [c.foreign, c.german])),
  };
  const name = `kapitel-${ch.name.toLowerCase().replace(/[^a-z0-9äöüéèàç]+/g, '-')}.json`;
  const file = new File([JSON.stringify(pack, null, 1)], name, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: ch.name }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- Foto nur für die Prüfung (wird nicht gespeichert) ---------- */
async function compressPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.72));
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Mittlere Buchspalte als Beispielsatz übernehmen, wenn sie das Wort enthält
function exampleFrom(mid, foreign) {
  if (!mid) return '';
  const t = cleanSide(mid);
  if (t.split(/\s+/).length < 3 || isPhonetic(mid)) return '';
  const base = cleanSide(foreign || '').replace(/^to /i, '').replace(ARTICLES, '').toLowerCase();
  return base.length >= 2 && t.toLowerCase().includes(base) ? t : '';
}

function showImage(url) {
  const o = document.createElement('div');
  o.className = 'overlay';
  o.innerHTML = `<img src="${url}" alt="Buchseite"><div class="muted tiny" style="color:#fff;margin-top:8px">Zum Schließen tippen · mit zwei Fingern zoomen</div>`;
  o.onclick = () => o.remove();
  document.body.appendChild(o);
}


/* ---------- Sicherung ---------- */
async function exportData() {
  const json = JSON.stringify(Object.assign({ type: 'vokabeltrainer-sicherung' }, db));
  const safeName = (db.profile.name || 'kind').toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-');
  const name = `vokabeln-${safeName}-${dayKey()}.json`;
  const file = new File([json], name, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Vokabel-Sicherung' });
      db.lastBackup = Date.now();
      save();
      toast('Sicherung erstellt ✓');
      render();
      return;
    }
  } catch (e) {
    if (e.name === 'AbortError') return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  db.lastBackup = Date.now();
  save();
  toast('Sicherung erstellt ✓');
  render();
}

async function importFile(file) {
  let d;
  try {
    d = JSON.parse(await file.text());
  } catch (e) {
    return toast('Diese Datei kann ich nicht lesen');
  }
  try {
    if (d.type === 'vokabel-kapitel') {
      const r = importPack(d);
      toast(`🎉 ${plural(r.added, 'Vokabel', 'Vokabeln')}${r.sentences ? ` und ${r.sentences} Beispielsätze` : ''} in „${r.chapter.name}“ geladen`);
      return go('chapter', { id: r.chapter.id });
    }
    if (!Array.isArray(d.chapters) || !Array.isArray(d.cards)) throw new Error('format');
    const fresh = !db.cards.length && !db.chapters.length;
    let mode = 'replace';
    if (!fresh) {
      mode = await dialog(`<h3>Sicherung laden</h3>
        <p>${plural(d.chapters.length, 'Kapitel', 'Kapitel')} und ${plural(d.cards.length, 'Vokabel', 'Vokabeln')}${d.profile?.name ? ` von ${esc(d.profile.name)}` : ''} gefunden.</p>
        <p class="muted small">„Ergänzen“ fügt fehlende Kapitel und Vokabeln hinzu. „Ersetzen“ überschreibt alles auf diesem Handy.</p>
        <div class="actions"><button class="btn ghost" value="cancel">Abbrechen</button><button class="btn" value="merge">Ergänzen</button><button class="btn danger" value="replace">Ersetzen</button></div>`);
    }
    if (mode === 'replace') {
      const { type, ...rest } = d;
      db = migrate(rest);
    } else if (mode === 'merge') {
      const chIds = new Set(db.chapters.map((c) => c.id));
      const cIds = new Set(db.cards.map((c) => c.id));
      d.chapters.forEach((c) => !chIds.has(c.id) && db.chapters.push(c));
      d.cards.forEach((c) => !cIds.has(c.id) && db.cards.push(c));
      Object.entries(d.days || {}).forEach(([k, v]) => { if (!db.days[k]) db.days[k] = v; });
      db = migrate(db);
    } else return;
    save();
    toast('Sicherung geladen ✓');
    go('home');
  } catch (e) {
    toast('Diese Datei ist keine gültige Sicherung');
  }
}

/* ---------- Start ---------- */
try { indexedDB.deleteDatabase('vokabeltrainer-fotos'); } catch (e) { /* nicht vorhanden */ }
render();
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
