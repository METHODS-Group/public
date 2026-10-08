// Renders the sign-up sheet from data/schedule.json and data/signups.json.
// Claims are made by opening a pre-filled GitHub issue form; a workflow records them.
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

  function issueUrl(template, slot) {
    var prefix = template === 'claim' ? 'Claim: ' : template === 'join' ? 'Join: ' : 'Cancel: ';
    return issuesBase + '/new?template=' + template + '.yml' +
      '&title=' + encodeURIComponent(prefix + slot.label) +
      '&slot=' + encodeURIComponent(slot.id);
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
  function disabledBtn(cls, text) {
    var b = el('button', 'btn ' + cls, text);
    b.type = 'button'; b.disabled = true;
    return b;
  }

  // Times: "10:00" -> 10:00; a range shares one am/pm suffix when it can ("10:00–10:30 am").
  function mins(t) { var p = t.split(':'); return Number(p[0]) * 60 + Number(p[1]); }
  function clock(t) { var p = t.split(':'); return (((Number(p[0]) + 11) % 12) + 1) + ':' + p[1]; }
  function ampm(t) { return Number(t.split(':')[0]) < 12 ? 'am' : 'pm'; }
  function range(s, e) {
    if (!e) return clock(s) + ' ' + ampm(s);
    return ampm(s) === ampm(e) ? clock(s) + '–' + clock(e) + ' ' + ampm(e)
      : clock(s) + ' ' + ampm(s) + '–' + clock(e) + ' ' + ampm(e);
  }

  // Room strings in signups look like "Room 105 (Thomas's ...)"; the sheet shows "Room 105".
  function shortRoom(room) { var m = /^Room\s+\S+/.exec(room || ''); return m ? m[0] : room; }

  var TALK_SVG = '<svg viewBox="0 0 150 110" aria-hidden="true"><path d="M150 20 C110 25 95 60 60 70 S10 85 0 110"/><path d="M150 38 C118 42 104 72 72 82 S28 96 18 110"/><path d="M150 56 C126 60 114 84 86 93 S50 104 40 110"/><path d="M150 74 C134 77 124 96 104 102 S76 108 68 110"/><path d="M150 92 C142 94 136 104 124 108"/></svg>';

  // A meeting slot: one row with the time, the people in it, the room, and a Claim/Join button.
  function slotCell(slot, claims, dayOpen) {
    var cell = el('div', 'cell slot');
    var cap = slot.capacity == null ? Infinity : slot.capacity;
    var left = Math.max(0, cap - claims.length);
    cell.classList.add(claims.length === 0 ? 'open' : left === 0 ? 'full' : 'taken');

    var body = el('div', 'body');
    var list = el('div', 'who-list');
    if (!claims.length) {
      list.append(el('span', 'free', dayOpen ? 'Open · up to ' + slot.capacity + ' people' : 'Open'));
    }
    claims.forEach(function (c) {
      var who = el('div', 'who');
      var line = el('div', 'who-line');
      line.append(el('span', null, c.name), el('span', 'mail', '@' + c.login));
      who.append(line);
      list.append(who);
    });
    var first = claims.filter(function (c) { return c.room; })[0];
    if (first) {
      var loc = el('span', 'loc', shortRoom(first.room)); loc.title = first.room;
      var row = el('div', 'who'); row.append(loc); list.append(row);
    }
    if (claims.length && left > 0) list.append(el('span', 'free', left + ' spot left'));
    if (claims.length && dayOpen) list.append(link('link', 'Cancel my sign-up', issueUrl('cancel', slot)));
    body.append(list);

    if (!dayOpen) body.append(disabledBtn('primary', 'Claim'));
    else if (left > 0) body.append(link('primary', claims.length ? 'Join' : 'Claim', issueUrl('claim', slot)));
    else body.append(el('span', 'full-tag', 'Full'));

    cell.append(el('span', 'time', range(slot.start, slot.end)), body);
    return cell;
  }

  // A group event (lunch, the Tuesday outing): everyone can join.
  function groupCell(slot, claims, dayOpen) {
    if (!dayOpen) {
      // Not open yet: the sheet's striped placeholder block.
      var ph = el('div', 'cell block lunch');
      ph.append(el('span', 'label', slot.title || slot.label), el('span', 'time', range(slot.start, slot.end)));
      return ph;
    }
    var cell = el('div', 'cell block group');
    var head = el('div', 'group-head');
    var left = el('div'); left.style.display = 'flex'; left.style.flexDirection = 'column';
    left.append(el('span', 'kind', 'Group · all welcome'), el('span', 'label', slot.title || slot.label));
    head.append(left, el('span', 'time', range(slot.start, slot.end)));
    cell.append(head);
    if (slot.description) cell.append(el('span', 'group-empty', slot.description));
    if (claims.length) {
      var names = el('ul', 'group-names');
      claims.forEach(function (c) {
        var li = el('li', null, c.name);
        li.append(el('span', 'mail', '@' + c.login));
        names.append(li);
      });
      cell.append(names);
    }
    var foot = el('div', 'group-foot');
    foot.append(el('span', 'group-empty', claims.length
      ? claims.length + (claims.length === 1 ? ' person' : ' people') + ' going'
      : 'No one yet. Join if you’d like to come.'));
    var btns = el('div', 'btns');
    if (claims.length && dayOpen) btns.append(link('link', 'Cancel my sign-up', issueUrl('cancel', slot)));
    btns.append(dayOpen ? link('primary', 'Join', issueUrl('join', slot)) : disabledBtn('primary', 'Join'));
    foot.append(btns);
    cell.append(foot);
    return cell;
  }

  // The talk: no sign-up.
  function talkCell(slot) {
    var cell = el('div', 'cell block talk');
    cell.innerHTML = TALK_SVG;
    var title = (slot.title || slot.label).replace(/^Thomas's talk:\s*/i, '');
    cell.append(el('span', 'kind', 'Presentation'), el('span', 'label', title), el('span', 'time', range(slot.start, slot.end)));
    return cell;
  }

  function spots(slots, byslot) {
    var open = 0, total = 0;
    slots.forEach(function (s) {
      if (s.kind !== 'meeting' || !s.open || s.capacity == null) return;
      total += s.capacity;
      open += Math.max(0, s.capacity - (byslot[s.id] || []).length);
    });
    return [open, total];
  }

  // Days whose slots fall in the shared daytime grid share one 30-minute row scale;
  // a day with only evening events gets a single wide row above them.
  function render(schedule, signups) {
    var byslot = {};
    (signups.claims || []).forEach(function (c) { (byslot[c.slot] = byslot[c.slot] || []).push(c); });

    var allSlots = schedule.days.reduce(function (a, d) { return a.concat(d.slots); }, []);
    var tot = spots(allSlots, byslot);
    var count = document.getElementById('count');
    count.textContent = '';
    count.append(el('b', null, String(tot[0])), document.createTextNode(' of ' + tot[1] + ' spots open'));

    var timed = schedule.days.filter(function (d) { return d.slots.some(function (s) { return s.end; }); });
    var dayStart = Infinity, dayEnd = 0;
    timed.forEach(function (d) { d.slots.forEach(function (s) {
      if (!s.end) return;
      dayStart = Math.min(dayStart, mins(s.start)); dayEnd = Math.max(dayEnd, mins(s.end));
    }); });
    var rows = Math.max(1, Math.round((dayEnd - dayStart) / 30));

    var root = document.getElementById('days');
    root.textContent = '';
    schedule.days.forEach(function (day) {
      var dayOpen = day.slots.some(function (s) { return s.open; });
      var wide = timed.indexOf(day) === -1;
      var sec = el('section', 'day' + (dayOpen ? '' : ' closed') + (wide ? ' wide' : ''));
      sec.id = day.id;
      var ds = spots(day.slots, byslot);
      var head = el('div', 'day-head');
      head.append(el('h2', null, day.label),
        el('span', null, !dayOpen ? 'Not open yet' : ds[1] ? ds[0] + ' of ' + ds[1] + ' spots open' : 'Everyone welcome'));
      sec.append(head);
      if (day.note) sec.append(el('p', 'closed-note', day.note));
      var grid = el('div', 'grid');
      if (!wide) grid.style.gridTemplateRows = 'repeat(' + rows + ', minmax(var(--unit), auto))';
      day.slots.forEach(function (slot) {
        var claims = byslot[slot.id] || [];
        var cell = slot.kind === 'blocked' ? talkCell(slot)
          : slot.kind === 'group' ? groupCell(slot, claims, slot.open)
          : slotCell(slot, claims, slot.open);
        cell.setAttribute('data-slot', slot.id);
        if (!wide && slot.end) {
          var r0 = (mins(slot.start) - dayStart) / 30 + 1, r1 = (mins(slot.end) - dayStart) / 30 + 1;
          cell.style.gridRow = r0 + ' / ' + r1;
        }
        grid.append(cell);
      });
      sec.append(grid);
      root.append(sec);
    });
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
