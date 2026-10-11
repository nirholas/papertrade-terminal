/* Papertrade Terminal docs client: theme toggle, mobile nav, copy buttons, TOC highlight, full-text search.
   Served from 'self' so it satisfies the CSP. No inline script or style anywhere. */
(function () {
  'use strict';
  var root = document.documentElement;
  var THEME_KEY = 'pt-docs-theme';

  function readTheme() {
    try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; }
  }
  function writeTheme(v) {
    try { localStorage.setItem(THEME_KEY, v); } catch (e) { /* storage unavailable, theme stays for this page */ }
  }
  var saved = readTheme();
  if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved);

  function effectiveTheme() {
    var t = root.getAttribute('data-theme');
    if (t) return t;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  ready(function () {
    initTheme();
    initNav();
    initCopy();
    initToc();
    initSearch();
  });

  function initTheme() {
    var btn = document.querySelector('.theme-btn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var next = effectiveTheme() === 'light' ? 'dark' : 'light';
      root.setAttribute('data-theme', next);
      writeTheme(next);
    });
  }

  function initNav() {
    var btn = document.querySelector('.menu-btn');
    var sidebar = document.getElementById('sidebar');
    var scrim = document.querySelector('.scrim');
    if (!btn || !sidebar || !scrim) return;
    function set(open) {
      sidebar.classList.toggle('open', open);
      scrim.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
      if (open) {
        var first = sidebar.querySelector('a');
        if (first) first.focus();
      }
    }
    btn.addEventListener('click', function () { set(!sidebar.classList.contains('open')); });
    scrim.addEventListener('click', function () { set(false); btn.focus(); });
    sidebar.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('a')) set(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && sidebar.classList.contains('open')) { set(false); btn.focus(); }
    });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.className = 'visually-hidden';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) resolve(); else reject(new Error('copy failed'));
    });
  }

  function initCopy() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('.copy');
      if (!btn) return;
      var code = btn.parentElement.querySelector('pre code');
      if (!code) return;
      copyText(code.textContent).then(function () {
        btn.textContent = 'Copied';
        btn.classList.add('done');
      }, function () {
        btn.textContent = 'Press Ctrl+C';
      }).then(function () {
        window.setTimeout(function () { btn.textContent = 'Copy'; btn.classList.remove('done'); }, 1800);
      });
    });
  }

  function initToc() {
    var links = Array.prototype.slice.call(document.querySelectorAll('.toc a'));
    if (!links.length || !('IntersectionObserver' in window)) return;
    var byId = {};
    links.forEach(function (a) { byId[decodeURIComponent(a.getAttribute('href').slice(1))] = a; });
    var heads = Array.prototype.slice.call(document.querySelectorAll('.doc h2[id], .doc h3[id]'));
    var current = null;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var a = byId[en.target.id];
        if (!a || a === current) return;
        if (current) current.classList.remove('active');
        a.classList.add('active');
        current = a;
      });
    }, { rootMargin: '-72px 0px -70% 0px' });
    heads.forEach(function (h) { io.observe(h); });
  }

  function initSearch() {
    var input = document.getElementById('doc-search');
    var list = document.getElementById('search-results');
    if (!input || !list) return;
    var entries = null;
    var loading = null;
    var items = [];
    var active = -1;

    function load() {
      if (entries) return Promise.resolve(entries);
      if (!loading) {
        loading = fetch('/docs/search-index.json', { credentials: 'omit' })
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function (j) { entries = j.entries; return entries; })
          .catch(function (err) { loading = null; throw err; });
      }
      return loading;
    }

    function terms(q) {
      return q.toLowerCase().split(/[^a-z0-9_.]+/).filter(Boolean);
    }

    function score(entry, ts) {
      var h = entry.h.toLowerCase();
      var p = entry.p.toLowerCase();
      var t = entry.t.toLowerCase();
      var total = 0;
      for (var i = 0; i < ts.length; i++) {
        var term = ts[i];
        var s = 0;
        if (h.indexOf(term) !== -1) s += 10;
        if (p.indexOf(term) !== -1) s += 3;
        if (t.indexOf(term) !== -1) s += 1;
        if (s === 0) return 0;
        total += s;
      }
      return total;
    }

    function esc(s) {
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function highlight(text, ts) {
      var out = esc(text);
      ts.forEach(function (term) {
        var re = new RegExp('(' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
        out = out.replace(re, '<mark>$1</mark>');
      });
      return out;
    }

    function snippet(entry, ts) {
      var t = entry.t;
      var low = t.toLowerCase();
      var at = -1;
      for (var i = 0; i < ts.length && at === -1; i++) at = low.indexOf(ts[i]);
      var start = Math.max(0, at - 40);
      var s = t.slice(start, start + 140);
      return (start > 0 ? '...' : '') + s + (start + 140 < t.length ? '...' : '');
    }

    function close() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      active = -1;
    }

    function setActive(i) {
      items.forEach(function (a, n) { a.setAttribute('aria-selected', n === i ? 'true' : 'false'); });
      active = i;
      if (items[i]) items[i].scrollIntoView({ block: 'nearest' });
    }

    function render(q) {
      var ts = terms(q);
      list.textContent = '';
      items = [];
      active = -1;
      if (!ts.length) { close(); return; }
      var hits = entries
        .map(function (e) { return { e: e, s: score(e, ts) }; })
        .filter(function (x) { return x.s > 0; })
        .sort(function (a, b) { return b.s - a.s; })
        .slice(0, 8);
      if (!hits.length) {
        var empty = document.createElement('li');
        empty.className = 'search-empty';
        empty.textContent = 'No results for "' + q + '". Try a tool name, a flag or a concept.';
        list.appendChild(empty);
      }
      hits.forEach(function (x) {
        var li = document.createElement('li');
        li.setAttribute('role', 'option');
        var a = document.createElement('a');
        a.href = x.e.u;
        a.setAttribute('aria-selected', 'false');
        a.innerHTML = '<span class="r-page">' + esc(x.e.p) + '</span><span class="r-head">' + highlight(x.e.h, ts) +
          '</span><span class="r-snip">' + highlight(snippet(x.e, ts), ts) + '</span>';
        li.appendChild(a);
        list.appendChild(li);
        items.push(a);
      });
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }

    function run() {
      var q = input.value.trim();
      if (!q) { close(); return; }
      load().then(function () { render(input.value.trim()); }, function () {
        list.textContent = '';
        var li = document.createElement('li');
        li.className = 'search-empty';
        li.textContent = 'Search could not load. Check your connection and try again.';
        list.appendChild(li);
        list.hidden = false;
      });
    }

    input.addEventListener('focus', function () { load().catch(function () { /* surfaced when the user types */ }); });
    input.addEventListener('input', run);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (items.length) setActive((active + 1) % items.length); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (items.length) setActive((active - 1 + items.length) % items.length); }
      else if (e.key === 'Enter') { var t = items[active] || items[0]; if (t) { e.preventDefault(); window.location.href = t.getAttribute('href'); } }
      else if (e.key === 'Escape') { close(); input.blur(); }
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest || !e.target.closest('.search')) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      var tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      input.focus();
      input.select();
    });
  }
})();
