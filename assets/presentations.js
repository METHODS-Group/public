// Renders the APMA 2570B presentation sign-up sheet from data/schedule.json and data/signups.json.
// Sign-ups, edits, and cancellations open pre-filled GitHub issue forms; the Record sign-up
// workflow (scripts/process.js) validates them and commits data/signups.json.
(function () {
  'use strict';

  // Local-testing fallback. On GitHub Pages the owner and repo come from the URL.
  var CONFIG = { owner: 'METHODS-Group', repo: 'public' };

  function repoInfo() {
    var host = location.hostname;
    if (/\.github\.io$/i.test(host)) {
      var owner = host.split('.')[0];
      var seg = location.pathname.split('/').filter(Boolean)[0];
      if (owner && seg) return { owner: owner, repo: seg };
    }
    return CONFIG;
  }

  var repo = repoInfo();
  var issuesBase = 'https://github.com/' + repo.owner + '/' + repo.repo + '/issues';
  var PREFIX = { present: 'Present: ', update: 'Update: ', cancel: 'Cancel: ' };

  // A pre-filled issue form. The edit form is filled with the current entry.
  function issueUrl(template, slot, claim) {
    var q = '?template=' + template + '.yml' +
      '&title=' + encodeURIComponent(PREFIX[template] + slot.label) +
      '&slot=' + encodeURIComponent(slot.id);
    if (claim) {
      q += '&name=' + encodeURIComponent(claim.name || '') +
        '&talk_title=' + encodeURIComponent(claim.title || '') +
        '&description=' + encodeURIComponent(claim.description || '');
    }
    return issuesBase + '/new' + q;
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function link(cls, text, href) {
    var a = el('a', 'btn ' + cls, text);
    a.href = href; a.target = '_blank'; a.rel = 'noopener';
    return a;
  }

  // A slot with `closes_at` (ISO 8601 with offset) takes no new sign-ups after that time.
  function closesAt(slot) {
    if (!slot.closes_at) return null;
    var t = Date.parse(slot.closes_at);
    return isNaN(t) ? null : t;
  }
  function isClosed(slot, now) { var t = closesAt(slot); return t != null && now >= t; }
  // Open for sign-up: open, not past its deadline, and with room left.
  function available(slot, claims, now) {
    var cap = slot.capacity == null ? 1 : slot.capacity;
    return !!slot.open && !isClosed(slot, now) && claims.length < cap;
  }

  // One card per slot: the presenter, title, and description, or a Sign up button.
  function card(slot, claims, now) {
    var closed = !slot.open || isClosed(slot, now);
    var state = claims.length ? 'taken' : closed ? 'closed' : 'open';
    var art = el('article', 'pres ' + state);
    art.id = 'slot-' + slot.id;

    var head = el('div', 'pres-head');
    head.append(el('span', 'pos', slot.position + (slot.minutes ? ' · ' + slot.minutes + ' min' : '')));
    head.append(el('span', 'state', state === 'taken' ? 'Taken' : state === 'closed' ? 'Closed' : 'Open'));
    art.append(head);

    if (claims.length) {
      claims.forEach(function (c) {
        var who = el('div', 'presenter');
        who.append(el('span', 'name', c.name), el('span', 'mail', '@' + c.login));
        art.append(who);
        art.append(el('h3', 'title math', c.title || 'Title to be announced'));
        if (c.description) art.append(el('p', 'desc math', c.description));
        var acts = el('div', 'acts');
        acts.append(link('link', 'Edit my sign-up', issueUrl('update', slot, c)),
          link('link', 'Cancel my sign-up', issueUrl('cancel', slot)));
        art.append(acts);
      });
    } else if (!closed) {
      art.append(el('p', 'free', 'Available. First come, first served.'));
      art.append(link('primary', 'Sign up', issueUrl('present', slot)));
    } else {
      art.append(el('p', 'free', slot.note || (slot.open ? 'No one signed up.' : 'Not open for sign-up.')));
    }
    return art;
  }

  // Typeset $...$ and \(...\) in titles and descriptions if KaTeX loaded; otherwise leave the text as is.
  function typeset(root) {
    if (typeof window.renderMathInElement !== 'function') return;
    root.querySelectorAll('.math').forEach(function (node) {
      try {
        window.renderMathInElement(node, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '\\[', right: '\\]', display: true },
            { left: '$', right: '$', display: false },
            { left: '\\(', right: '\\)', display: false },
          ],
          throwOnError: false,
        });
      } catch (e) { /* leave the raw text */ }
    });
  }

  function render(schedule, signups) {
    var now = Date.now();
    var byslot = {};
    (signups.claims || []).forEach(function (c) { (byslot[c.slot] = byslot[c.slot] || []).push(c); });

    var open = 0, total = 0;
    var root = document.getElementById('days');
    root.textContent = '';
    schedule.days.forEach(function (day) {
      var dayOpen = 0;
      day.slots.forEach(function (s) {
        total += 1;
        if (available(s, byslot[s.id] || [], now)) { open += 1; dayOpen += 1; }
      });
      var allClosed = day.slots.every(function (s) { return !s.open || isClosed(s, now); });

      var sec = el('section', 'pday');
      sec.id = day.id;
      var head = el('div', 'day-head');
      var n = day.slots.length;
      head.append(el('h2', null, day.label),
        el('span', null, (n === 1 ? 'One presentation' : n + ' presentations') + ' · ' +
          (allClosed ? 'sign-ups closed' : dayOpen === 0 ? 'full' : dayOpen + ' open')));
      sec.append(head);
      if (day.note) sec.append(el('p', 'closed-note', day.note));
      var list = el('div', 'pres-list' + (n === 1 ? ' single' : ''));
      day.slots.forEach(function (slot) { list.append(card(slot, byslot[slot.id] || [], now)); });
      sec.append(list);
      root.append(sec);
    });

    var count = document.getElementById('count');
    count.textContent = '';
    count.append(el('b', null, String(open)), document.createTextNode(' of ' + total + ' slots open'));
    typeset(root);
  }

  function fetchJson(path) {
    return fetch(path + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(path + ': HTTP ' + r.status);
      return r.json();
    });
  }

  var status = document.getElementById('status');
  var statusText = document.getElementById('status-text');
  function setStatus(state, text) { status.dataset.state = state; statusText.textContent = text; }

  function load() {
    setStatus('wait', 'Refreshing…');
    return Promise.all([fetchJson('data/schedule.json'), fetchJson('data/signups.json')])
      .then(function (res) {
        render(res[0], res[1]);
        setStatus('live', 'Updated ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ' · refresh to see new sign-ups');
      })
      .catch(function (err) {
        setStatus('off', 'Could not load the sign-ups (' + err.message + '). Try Refresh.');
      });
  }

  document.getElementById('my-issues').href = issuesBase + '?q=' + encodeURIComponent('is:issue author:@me');
  document.getElementById('refresh').addEventListener('click', load);
  load();
})();
