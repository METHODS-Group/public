// Renders the postdoc interview sign-up sheet (postdoc-interviews-2026/) from its
// data/schedule.json and data/signups.json. Sign-ups, edits, and cancellations open
// pre-filled GitHub issue forms (interview.yml, interview-update.yml, cancel.yml); the
// Record sign-up workflow (scripts/process.js) validates them and commits data/signups.json.
(function () {
  'use strict';

  // Local-testing fallback. On GitHub Pages the owner and repo come from the URL.
  var CONFIG = { owner: 'METHODS-Group', repo: 'public' };
  var ET = 'America/New_York';

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
  var PREFIX = { interview: 'Interview: ', 'interview-update': 'Interview update: ', cancel: 'Cancel: ' };

  // A pre-filled issue form. The edit form is filled with the current entry.
  function issueUrl(template, slot, claim) {
    var q = '?template=' + template + '.yml' +
      '&title=' + encodeURIComponent(PREFIX[template] + slot.label) +
      '&slot=' + encodeURIComponent(slot.id);
    if (claim) {
      q += '&name=' + encodeURIComponent(claim.name || '') +
        '&talk_title=' + encodeURIComponent(claim.title || '') +
        '&abstract=' + encodeURIComponent(claim.description || '');
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

  // ---- Times: Eastern Time, plus the reader's own time zone when it differs. ----
  var localTz = null;
  try { localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch (e) { /* unknown */ }

  function clock(ms, tz) {
    // "1:45 PM" -> ["1:45", "pm"]
    var s = new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
    var m = /^(.*?)\s*([AP]M)$/i.exec(s);
    return m ? [m[1], m[2].toLowerCase()] : [s, ''];
  }
  function day(ms, tz) {
    return new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz });
  }
  // "1:00–1:45 pm" or "11:30 am–12:15 pm"
  function range(start, end, tz) {
    var a = clock(start, tz), b = clock(end, tz);
    return (a[1] === b[1] ? a[0] : a[0] + ' ' + a[1]) + '–' + b[0] + ' ' + b[1];
  }
  function sameAsEt(tz) {
    if (!tz || tz === ET) return true;
    // Different names can share Eastern Time (e.g. America/Detroit); compare a sample instant.
    var t = Date.parse('2026-12-09T13:00:00-05:00');
    return day(t, tz) === day(t, ET) && range(t, t, tz) === range(t, t, ET);
  }
  var showLocal = !sameAsEt(localTz);

  function whenLine(slot) {
    var start = Date.parse(slot.start), end = Date.parse(slot.end);
    var p = el('p', 'when');
    if (isNaN(start) || isNaN(end)) { p.append(el('span', 'et', slot.label)); return p; }
    p.append(el('span', 'et', range(start, end, ET) + ' ET'));
    if (showLocal) {
      var local = range(start, end, localTz);
      if (day(start, localTz) !== day(start, ET)) local = day(start, localTz) + ', ' + local;
      p.append(el('span', 'local', local + ' your time'));
    }
    return p;
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

  // One card per slot: the presenter, title, and abstract, or a Sign up button.
  function card(slot, claims, now) {
    var closed = !slot.open || isClosed(slot, now);
    var state = claims.length ? 'taken' : closed ? 'closed' : 'open';
    var art = el('article', 'pres ' + state);
    art.id = 'slot-' + slot.id;

    var head = el('div', 'pres-head');
    head.append(el('span', 'pos', slot.position + (slot.minutes ? ' · ' + slot.minutes + ' min' : '')));
    head.append(el('span', 'state', state === 'taken' ? 'Taken' : state === 'closed' ? 'Closed' : 'Open'));
    art.append(head);
    art.append(whenLine(slot));

    if (claims.length) {
      claims.forEach(function (c) {
        var who = el('div', 'presenter');
        who.append(el('span', 'name', c.name), el('span', 'mail', '@' + c.login));
        art.append(who);
        art.append(el('h3', 'title math', c.title || 'Title to be announced'));
        if (c.description) art.append(el('p', 'desc math', c.description));
        var acts = el('div', 'acts');
        acts.append(link('link', 'Edit my sign-up', issueUrl('interview-update', slot, c)),
          link('link', 'Cancel my sign-up', issueUrl('cancel', slot)));
        art.append(acts);
      });
    } else if (!closed) {
      art.append(el('p', 'free', 'Available. First come, first served.'));
      art.append(link('primary', 'Sign up', issueUrl('interview', slot)));
    } else {
      art.append(el('p', 'free', slot.note || (slot.open ? 'No one signed up.' : 'Not open for sign-up.')));
    }
    return art;
  }

  // Typeset $...$ and \(...\) in titles and abstracts if KaTeX loaded; otherwise leave the text as is.
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

  var WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'];

  function render(schedule, signups) {
    var now = Date.now();
    var byslot = {};
    (signups.claims || []).forEach(function (c) { (byslot[c.slot] = byslot[c.slot] || []).push(c); });

    var open = 0, total = 0;
    var root = document.getElementById('days');
    root.textContent = '';
    schedule.days.forEach(function (d) {
      var dayOpen = 0;
      d.slots.forEach(function (s) {
        total += 1;
        if (available(s, byslot[s.id] || [], now)) { open += 1; dayOpen += 1; }
      });
      var allClosed = d.slots.every(function (s) { return !s.open || isClosed(s, now); });

      var sec = el('section', 'pday');
      sec.id = d.id;
      var head = el('div', 'day-head');
      var n = d.slots.length;
      head.append(el('h2', null, d.label),
        el('span', null, (WORDS[n] || n) + (n === 1 ? ' presentation' : ' presentations') + ' · ' +
          (allClosed ? 'sign-ups closed' : dayOpen === 0 ? 'full' : dayOpen + ' open')));
      sec.append(head);
      if (d.interview) {
        var sub = el('p', 'day-sub');
        sub.append(el('strong', null, 'Individual interviews: '),
          document.createTextNode(d.interview.label + ' (' + (d.interview.when || 'morning') + '), on Zoom'));
        sec.append(sub);
      }
      if (d.note) sec.append(el('p', 'closed-note', d.note));
      var list = el('div', 'pres-list');
      d.slots.forEach(function (slot) { list.append(card(slot, byslot[slot.id] || [], now)); });
      sec.append(list);
      root.append(sec);
    });

    var count = document.getElementById('count');
    count.textContent = '';
    count.append(el('b', null, String(open)), document.createTextNode(' of ' + total + ' slots open'));
    typeset(root);
  }

  function fetchJson(p) {
    return fetch(p + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(p + ': HTTP ' + r.status);
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

  if (showLocal) {
    document.getElementById('tz-note').textContent =
      'Times are Eastern Time (ET), with your time (' + localTz.replace(/_/g, ' ') + ') alongside.';
  }
  document.getElementById('my-issues').href = issuesBase + '?q=' + encodeURIComponent('is:issue author:@me');
  document.getElementById('refresh').addEventListener('click', load);
  load();
})();
