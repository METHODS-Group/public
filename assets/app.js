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

  function fmtTime(hhmm) {
    if (!hhmm) return '';
    var parts = hhmm.split(':');
    var h = parseInt(parts[0], 10), m = parts[1];
    var suffix = h >= 12 ? 'pm' : 'am';
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ':' + m + ' ' + suffix;
  }
  function timeRange(slot) {
    if (!slot.end) return fmtTime(slot.start);
    return fmtTime(slot.start) + ' to ' + fmtTime(slot.end);
  }

  function renderPeople(claims, showRoom) {
    if (!claims.length) return el('p', { class: 'nobody', text: 'Nobody yet.' });
    return el('ul', { class: 'people' }, claims.map(function (c) {
      return el('li', null, [
        el('span', { class: 'name', text: c.name }),
        el('span', { class: 'login', text: '@' + c.login }),
        showRoom && c.room ? el('span', { class: 'meta', text: c.room }) : null
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
    if (blocked || closed) classes.push('shaded');
    var card = el('article', { class: classes.join(' '), 'data-slot': slot.id });

    var badge = null;
    if (blocked) badge = null;
    else if (closed) badge = el('span', { class: 'badge closed', text: 'Not open yet' });
    else if (isGroup) badge = el('span', { class: 'badge open', text: claims.length + ' going' });
    else if (full) badge = el('span', { class: 'badge full', text: 'Full' });
    else badge = el('span', { class: 'badge open', text: left + ' of ' + slot.capacity + (left === 1 ? ' spot left' : ' spots left') });

    var head = el('div', { class: 'slot-head' }, [
      el('p', { class: 'slot-time', text: timeRange(slot) }),
      badge
    ]);
    card.appendChild(head);

    var title = slot.title || slot.label;
    card.appendChild(el('p', { class: 'slot-title', text: title }));
    if (slot.description && !isMeeting) card.appendChild(el('p', { class: 'slot-desc', text: slot.description }));

    if (!blocked) card.appendChild(renderPeople(claims, isMeeting));

    if (!blocked) {
      var actions = el('div', { class: 'actions' });
      var template = isMeeting ? 'claim' : 'join';
      var label = isMeeting ? 'Claim' : 'Join';
      if (closed) {
        actions.appendChild(el('button', { class: 'claim', type: 'button', disabled: '', text: label }));
      } else if (!full) {
        actions.appendChild(el('a', { class: 'claim', href: issueUrl(template, slot), target: '_blank', rel: 'noopener', text: label }));
      }
      if (!closed) {
        actions.appendChild(el('a', { class: 'cancel', href: issueUrl('cancel', slot), target: '_blank', rel: 'noopener', text: 'Cancel my sign-up' }));
      }
      card.appendChild(actions);
    }
    return card;
  }

  function render(schedule, signups) {
    var byslot = {};
    (signups.claims || []).forEach(function (c) { (byslot[c.slot] = byslot[c.slot] || []).push(c); });
    var root = document.getElementById('days');
    root.textContent = '';
    schedule.days.forEach(function (day) {
      var section = el('section', { class: 'day', id: day.id }, [
        el('div', { class: 'day-head' }, [
          el('h2', { text: day.label }),
          day.note ? el('p', { class: 'day-note', text: day.note }) : null
        ]),
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
  function load() {
    status.textContent = 'Refreshing…';
    return Promise.all([fetchJson('data/schedule.json'), fetchJson('data/signups.json')])
      .then(function (res) {
        render(res[0], res[1]);
        status.textContent = 'Last updated ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      })
      .catch(function (err) {
        status.textContent = 'Could not load the sign-ups (' + err.message + '). Try Refresh.';
      });
  }

  document.getElementById('my-issues').href = issuesBase + '?q=' + encodeURIComponent('is:issue author:@me');
  document.getElementById('refresh').addEventListener('click', load);
  load();
})();
