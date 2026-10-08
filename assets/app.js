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

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  // "10:00" -> "10:00 am"; a range shares one am/pm suffix when it can: "10:00–10:30 am".
  function clock(hhmm) {
    var parts = hhmm.split(':');
    var h = parseInt(parts[0], 10);
    return (h % 12 === 0 ? 12 : h % 12) + ':' + parts[1];
  }
  function ampm(hhmm) { return parseInt(hhmm.split(':')[0], 10) >= 12 ? 'pm' : 'am'; }
  function timeRange(slot) {
    if (!slot.start) return '';
    if (!slot.end) return clock(slot.start) + ' ' + ampm(slot.start);
    if (ampm(slot.start) === ampm(slot.end)) return clock(slot.start) + '–' + clock(slot.end) + ' ' + ampm(slot.end);
    return clock(slot.start) + ' ' + ampm(slot.start) + '–' + clock(slot.end) + ' ' + ampm(slot.end);
  }

  // Room strings in signups look like "Room 105 (Thomas's ...)"; the card shows just "Room 105".
  function shortRoom(room) {
    var m = /^Room\s+\S+/.exec(room || '');
    return m ? m[0] : room;
  }

  var norm = function (s) { return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); };
  // Show a description only when it says something the title does not.
  function usefulDescription(slot) {
    var d = slot.description, t = slot.title || slot.label;
    if (!d) return null;
    var nd = norm(d), nt = norm(t);
    if (!nd || nd === nt || nt.indexOf(nd) !== -1 || nd.indexOf(nt) !== -1) return null;
    return d;
  }

  var TALK_SVG = '<svg class="talk-lines" viewBox="0 0 150 110" aria-hidden="true">' +
    '<path d="M150 20 C110 25 95 60 60 70 S10 85 0 110"/><path d="M150 38 C118 42 104 72 72 82 S28 96 18 110"/>' +
    '<path d="M150 56 C126 60 114 84 86 93 S50 104 40 110"/><path d="M150 74 C134 77 124 96 104 102 S76 108 68 110"/>' +
    '<path d="M150 92 C142 94 136 104 124 108"/></svg>';

  function renderPeople(claims, showRoom) {
    if (!claims.length) return el('p', { class: 'nobody', text: 'Nobody yet.' });
    return el('ul', { class: 'people' }, claims.map(function (c) {
      return el('li', null, [
        el('span', { class: 'name', text: c.name }),
        el('span', { class: 'login', text: '@' + c.login }),
        showRoom && c.room ? el('span', { class: 'room', text: shortRoom(c.room), title: c.room }) : null
      ]);
    }));
  }

  function renderSlot(slot, claims) {
    var isMeeting = slot.kind === 'meeting';
    var isGroup = slot.kind === 'group';
    var blocked = slot.kind === 'blocked';
    var closed = !slot.open;
    var left = slot.capacity == null ? null : Math.max(0, slot.capacity - claims.length);
    var full = left === 0;

    var classes = ['slot', slot.kind];
    if (closed && !blocked) classes.push('closed');
    if (full && !closed) classes.push('full');
    var card = el('article', { class: classes.join(' '), 'data-slot': slot.id });
    if (blocked) card.innerHTML = TALK_SVG;

    var kind = blocked ? 'Presentation' : isGroup ? 'Group · all welcome' : 'One-on-one · 30 min';
    var headText = el('div', { class: 'head-text' }, [el('span', { class: 'kind', text: kind })]);
    if (isMeeting) {
      headText.appendChild(el('p', { class: 'slot-time', text: timeRange(slot) }));
    } else {
      headText.appendChild(el('p', { class: 'slot-title', text: slot.title || slot.label }));
      headText.appendChild(el('p', { class: 'slot-time', text: timeRange(slot) }));
    }

    var tag = null;
    if (blocked) tag = null;
    else if (closed) tag = el('span', { class: 'tag closed', text: 'Not open yet' });
    else if (isGroup) tag = el('span', { class: 'tag going', text: claims.length + ' going' });
    else if (full) tag = el('span', { class: 'tag full', text: 'Full' });
    else tag = el('span', { class: 'tag open', text: left + ' of ' + slot.capacity + (left === 1 ? ' spot left' : ' spots left') });

    card.appendChild(el('div', { class: 'slot-head' }, [headText, tag]));

    var desc = isMeeting ? null : usefulDescription(slot);
    if (desc) card.appendChild(el('p', { class: 'slot-desc', text: desc }));

    if (!blocked) card.appendChild(renderPeople(claims, isMeeting));

    if (!blocked) {
      var actions = el('div', { class: 'actions' });
      var template = isMeeting ? 'claim' : 'join';
      var label = isMeeting ? 'Claim' : 'Join';
      if (closed) {
        actions.appendChild(el('button', { class: 'btn primary', type: 'button', disabled: '', text: label }));
      } else if (!full) {
        actions.appendChild(el('a', { class: 'btn primary', href: issueUrl(template, slot), target: '_blank', rel: 'noopener', text: label }));
      }
      if (!closed) {
        actions.appendChild(el('a', { class: 'btn link', href: issueUrl('cancel', slot), target: '_blank', rel: 'noopener', text: 'Cancel my sign-up' }));
      }
      card.appendChild(actions);
    }
    return card;
  }

  // Open one-on-one spots across the given slots: [open, total].
  function spots(slots, byslot) {
    var open = 0, total = 0;
    slots.forEach(function (s) {
      if (s.kind !== 'meeting' || !s.open || s.capacity == null) return;
      total += s.capacity;
      open += Math.max(0, s.capacity - (byslot[s.id] || []).length);
    });
    return [open, total];
  }

  function render(schedule, signups) {
    var byslot = {};
    (signups.claims || []).forEach(function (c) { (byslot[c.slot] = byslot[c.slot] || []).push(c); });

    var all = spots(schedule.days.reduce(function (a, d) { return a.concat(d.slots); }, []), byslot);
    var count = document.getElementById('count');
    count.textContent = '';
    count.appendChild(el('b', { text: String(all[0]) }));
    count.appendChild(document.createTextNode(' of ' + all[1] + ' one-on-one spots open'));

    var root = document.getElementById('days');
    root.textContent = '';
    schedule.days.forEach(function (day) {
      var dayOpen = day.slots.some(function (s) { return s.open; });
      var ds = spots(day.slots, byslot);
      var countText = !dayOpen ? 'Not open yet' : ds[1] ? ds[0] + ' of ' + ds[1] + ' spots open' : '';
      var section = el('section', { class: 'day' + (dayOpen ? '' : ' closed'), id: day.id }, [
        el('div', { class: 'day-head' }, [
          el('h2', { text: day.label }),
          countText ? el('span', { class: 'day-count', text: countText }) : null
        ]),
        day.note ? el('p', { class: 'closed-note', text: day.note }) : null,
        el('div', { class: 'slots' }, day.slots.map(function (s) { return renderSlot(s, byslot[s.id] || []); }))
      ]);
      root.appendChild(section);
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
        setStatus('live', 'Last updated ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
      })
      .catch(function (err) {
        setStatus('off', 'Could not load the sign-ups (' + err.message + '). Try Refresh.');
      });
  }

  document.getElementById('my-issues').href = issuesBase + '?q=' + encodeURIComponent('is:issue author:@me');
  document.getElementById('refresh').addEventListener('click', load);
  load();
})();
