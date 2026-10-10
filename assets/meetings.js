// Renders the group meetings page from data/meetings.json.
// The JSON's `status` field decides Upcoming vs Past; nothing here looks at today's date.
(function () {
  'use strict';

  var DATA_URL = '../data/meetings.json';
  var ABSTRACT_CLAMP_CHARS = 420; // longer abstracts start collapsed with a "Show abstract" button

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function $(id) { return document.getElementById(id); }

  function extLink(text, href, cls) {
    var a = el('a', cls || null, text);
    a.href = href; a.target = '_blank'; a.rel = 'noopener';
    return a;
  }

  // "2026-10-14" -> "Wed, Oct 14, 2026" (parsed as a calendar date, not UTC midnight)
  function fmtDate(iso) {
    var p = iso.split('-').map(Number);
    var d = new Date(p[0], p[1] - 1, p[2]);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }

  // Semester label: explicit `term` wins; otherwise derive from the month.
  function termOf(t) {
    if (t.term) return t.term;
    var p = t.date.split('-').map(Number);
    var m = p[1];
    return (m <= 5 ? 'Spring ' : m <= 8 ? 'Summer ' : 'Fall ') + p[0];
  }

  // Abstracts may carry a little inline HTML. Keep only b, i, em, strong, code, br and http(s) links; everything else becomes text.
  var ALLOWED = { B: 1, I: 1, EM: 1, STRONG: 1, CODE: 1, BR: 1, A: 1 };
  function sanitize(html, into) {
    var doc = new DOMParser().parseFromString('<!doctype html><body><div>' + html + '</div>', 'text/html');
    var root = doc.body.firstChild;
    function walk(src, dst) {
      Array.prototype.forEach.call(src.childNodes, function (n) {
        if (n.nodeType === 3) { dst.appendChild(document.createTextNode(n.nodeValue)); return; }
        if (n.nodeType !== 1) return;
        var tag = n.tagName;
        if (!ALLOWED[tag]) { walk(n, dst); return; }
        if (tag === 'A') {
          var href = n.getAttribute('href') || '';
          if (!/^https?:\/\//i.test(href)) { walk(n, dst); return; }
          var a = document.createElement('a');
          a.href = href; a.target = '_blank'; a.rel = 'noopener';
          walk(n, a); dst.appendChild(a); return;
        }
        var e = document.createElement(tag.toLowerCase());
        walk(n, e); dst.appendChild(e);
      });
    }
    walk(root, into);
    return into;
  }

  // Stable element ids, `talk-<date>`, so a card can be linked to directly (e.g. meetings/#talk-2026-10-14).
  // Two talks on one date get `-2`, `-3`, ... in data order.
  function assignIds(talks) {
    var seen = {};
    talks.forEach(function (t) {
      var n = (seen[t.date] || 0) + 1;
      seen[t.date] = n;
      t.id = 'talk-' + t.date + (n > 1 ? '-' + n : '');
    });
  }

  function card(t, isNext) {
    var c = el('article', 'talk ' + t.status + (isNext ? ' next' : ''));
    if (t.id) c.id = t.id;
    var head = el('div', 'talk-head');
    var date = el('span', 'date', fmtDate(t.date));
    if (isNext) date.appendChild(el('span', 'next-tag', 'Next'));
    head.append(date, el('span', 'presenter', t.presenter));
    c.appendChild(head);

    // Empty title: an italic placeholder. A note that just repeats the placeholder is not shown twice.
    var placeholder = null;
    if (t.title) c.appendChild(el('h3', 'title', t.title));
    else {
      placeholder = t.status !== 'upcoming' ? 'No title announced' : t.abstract ? 'Title to be announced' : 'Title and abstract to be announced';
      c.appendChild(el('h3', 'title tba', placeholder));
    }

    if (t.keywords && t.keywords.length) {
      var ul = el('ul', 'chips');
      t.keywords.forEach(function (k) { ul.appendChild(el('li', null, k)); });
      c.appendChild(ul);
    }

    if (t.abstract) {
      var p = sanitize(t.abstract, el('p', 'abstract'));
      c.appendChild(p);
      if (t.abstract.length > ABSTRACT_CLAMP_CHARS) {
        p.classList.add('clamp');
        var btn = el('button', 'btn ghost more', 'Show abstract');
        btn.type = 'button'; btn.setAttribute('aria-expanded', 'false');
        btn.addEventListener('click', function () {
          var open = p.classList.toggle('clamp') === false;
          btn.textContent = open ? 'Hide abstract' : 'Show abstract';
          btn.setAttribute('aria-expanded', String(open));
        });
        c.appendChild(btn);
      }
    }
    if (t.note && !(placeholder && t.note.replace(/\.$/, '').toLowerCase() === placeholder.toLowerCase())) c.appendChild(el('p', 'note', t.note));

    if (t.links && t.links.length) {
      var row = el('div', 'links');
      t.links.forEach(function (l) {
        if (!l || !/^https?:\/\//i.test(l.url || '')) return;
        row.appendChild(extLink(l.label || l.url, l.url, 'btn ghost ' + (LINK_CLASS[l.kind] || '')));
      });
      c.appendChild(row);
    }
    return c;
  }

  // Link kinds that get a highlighted button; any other kind renders as a plain ghost button.
  var LINK_CLASS = { slides: 'slides', signup: 'signup' };

  var data = null;
  var view = 'upcoming';

  function render() {
    var list = $('talks');
    list.replaceChildren();
    if (!data) return;
    var talks = data.talks.filter(function (t) { return t.status === view; });
    var hasSlack = false;
    talks.forEach(function (t) {
      (t.links || []).forEach(function (l) { if (/slack\.com\//i.test(l.url || '')) hasSlack = true; });
    });
    $('slack-hint').hidden = !hasSlack;

    if (!talks.length) {
      list.appendChild(el('p', 'empty', view === 'upcoming' ? 'No upcoming presentations are scheduled yet. Sign up using the sheet above.' : 'No past presentations recorded yet.'));
      return;
    }

    if (view === 'upcoming') {
      talks.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
      talks.forEach(function (t, i) { list.appendChild(card(t, i === 0)); });
    } else {
      talks.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
      var seen = {};
      talks.forEach(function (t) {
        var term = termOf(t);
        if (!seen[term]) {
          seen[term] = true;
          var n = talks.filter(function (x) { return termOf(x) === term; }).length;
          var h = el('h2', 'term', term);
          h.appendChild(el('small', null, n + (n === 1 ? ' meeting' : ' meetings')));
          list.appendChild(h);
        }
        list.appendChild(card(t, false));
      });
    }
  }

  // `writeHash` is true for tab clicks: the URL then reads #upcoming/#past. A talk hash (#talk-...) is left alone.
  function setView(v, writeHash) {
    view = v;
    [['tab-upcoming', 'upcoming'], ['tab-past', 'past']].forEach(function (pair) {
      var b = $(pair[0]), on = pair[1] === v;
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('primary', on);
      b.classList.toggle('ghost', !on);
    });
    if (writeHash) {
      try { history.replaceState(null, '', v === 'past' ? '#past' : '#upcoming'); } catch (e) { /* ignore */ }
    }
    render();
  }

  // #talk-<date>: show the tab that talk is on, scroll to its card, and flash it briefly.
  function talkForHash() {
    if (!data || !/^#talk-/.test(location.hash)) return null;
    var id = decodeURIComponent(location.hash.slice(1));
    return data.talks.filter(function (t) { return t.id === id; })[0] || null;
  }
  var flashTimer = null;
  function applyHash() {
    var h = location.hash;
    if (h === '#past' || h === '#upcoming') { if (view !== h.slice(1)) setView(h.slice(1), false); return; }
    var t = talkForHash();
    if (!t) return;
    if (view !== t.status) setView(t.status, false);
    var c = $(t.id);
    if (!c) return;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    c.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    Array.prototype.forEach.call(document.querySelectorAll('.talk.flash'), function (e) { e.classList.remove('flash'); });
    c.classList.add('flash');
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { c.classList.remove('flash'); }, 2000);
  }

  function renderInfo(s) {
    $('info-when').textContent = s.when || '';
    $('info-where').textContent = s.location || '';
    $('info-zoom').replaceChildren(s.zoom ? extLink(s.zoom.replace(/^https?:\/\//, ''), s.zoom) : document.createTextNode('—'));
    $('info-signup').replaceChildren(s.signup_url ? extLink('Sign up to present', s.signup_url) : document.createTextNode('—'));
    $('info-heading').textContent = s.name ? s.name : 'This semester';
  }

  function setStatus(state, text) {
    var st = $('status'); st.dataset.state = state; $('status-text').textContent = text;
  }

  function counts(d) {
    var u = 0, p = 0;
    d.talks.forEach(function (t) { if (t.status === 'upcoming') u++; else if (t.status === 'past') p++; });
    return { upcoming: u, past: p };
  }

  $('tab-upcoming').addEventListener('click', function () { setView('upcoming', true); });
  $('tab-past').addEventListener('click', function () { setView('past', true); });
  window.addEventListener('hashchange', applyHash);

  if (location.hash === '#past') view = 'past';
  setView(view, false);

  fetch(DATA_URL, { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (d) {
      data = d;
      assignIds(d.talks);
      renderInfo(d.semester || {});
      var n = counts(d);
      $('tab-upcoming').textContent = 'Upcoming (' + n.upcoming + ')';
      $('tab-past').textContent = 'Past (' + n.past + ')';
      setStatus('live', n.upcoming + ' upcoming, ' + n.past + ' past');
      if (d.updated) $('updated').textContent = 'Updated ' + fmtDate(d.updated) + '.';
      render();
      applyHash();
    })
    .catch(function (err) {
      setStatus('off', 'Could not load the schedule (' + err.message + ')');
      $('talks').appendChild(el('p', 'empty', 'The schedule could not be loaded. Try reloading the page.'));
    });
})();
