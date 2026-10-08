'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseBody, apply, templateFor } = require('./process.js');

const schedule = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'schedule.json'), 'utf8'));
const ROOM_105 = "Room 105 (Thomas's visiting scholar office, 182 George St)";
const ROOM_303 = "Room 303 (Brendan's office, 182 George St)";

function claimBody(slot, name, room, email) {
  return [
    `### Slot\n\n${slot}`,
    `### Your name\n\n${name}`,
    `### Room\n\n${room}`,
    `### Email (optional, for a calendar invite)\n\n${email || '_No response_'}`,
  ].join('\n\n');
}
function joinBody(slot, name, email) {
  return `### Slot\n\n${slot}\n\n### Your name\n\n${name}\n\n### Email (optional, for a calendar invite)\n\n${email || '_No response_'}`;
}

let n = 1;
function req(template, body, login, title) {
  return { template, fields: parseBody(body), login, number: n++, created_at: '2026-10-08T12:00:00Z', title: title || '' };
}

test('parseBody reads issue-form sections and maps _No response_ to null', () => {
  const f = parseBody(claimBody('wed-1000', 'Ada Lovelace', ROOM_105));
  assert.deepEqual(f, { slot: 'wed-1000', name: 'Ada Lovelace', room: ROOM_105, email: null });
});

test('claims, capacity, duplicates, cancel', () => {
  let s = { claims: [] };
  let r = apply(s, schedule, req('claim', claimBody('wed-1000', 'Ada Lovelace', ROOM_105, 'ada@example.edu'), 'ada'));
  assert.ok(r.ok, r.message);
  assert.match(r.message, /✅ Booked: Wed 10:00 am, Room 105/);
  assert.equal(r.signups.claims.length, 1);
  assert.equal(r.signups.claims[0].email, 'ada@example.edu');
  assert.equal(s.claims.length, 0, 'input is not mutated');
  s = r.signups;

  // Second claim fills the slot.
  r = apply(s, schedule, req('claim', claimBody('wed-1000', 'Emmy Noether', ROOM_303), 'emmy'));
  assert.ok(r.ok, r.message);
  s = r.signups;

  // Third is rejected as full.
  r = apply(s, schedule, req('claim', claimBody('wed-1000', 'Carl Gauss', ROOM_105), 'gauss'));
  assert.equal(r.ok, false);
  assert.match(r.message, /already full/);
  assert.equal(r.signups.claims.length, 2);

  // Duplicate login rejected on an open slot.
  r = apply(s, schedule, req('claim', claimBody('wed-1030', 'Ada again', ROOM_105), 'ada'));
  assert.ok(r.ok);
  r = apply(r.signups, schedule, req('claim', claimBody('wed-1030', 'Ada again', ROOM_105), 'ada'));
  assert.equal(r.ok, false);
  assert.match(r.message, /already signed up/);

  // Bad room rejected.
  r = apply(s, schedule, req('claim', claimBody('wed-1500', 'Sofia K', 'Room 999'), 'sofia'));
  assert.equal(r.ok, false);
  assert.match(r.message, /listed rooms/);

  // Cancel removes the right entry.
  r = apply(s, schedule, req('cancel', '### Slot\n\nwed-1000', 'ada'));
  assert.ok(r.ok, r.message);
  assert.deepEqual(r.signups.claims.map((c) => c.login), ['emmy']);
  // Cancel by someone not signed up fails.
  r = apply(s, schedule, req('cancel', '### Slot\n\nwed-1000', 'nobody'));
  assert.equal(r.ok, false);
});

test('closed Thursday slots and the blocked talk are rejected', () => {
  const s = { claims: [] };
  let r = apply(s, schedule, req('claim', claimBody('thu-1000', 'Ada', ROOM_105), 'ada'));
  assert.equal(r.ok, false);
  assert.match(r.message, /not open yet/);
  r = apply(s, schedule, req('join', joinBody('thu-lunch', 'Ada'), 'ada'));
  assert.equal(r.ok, false);
  r = apply(s, schedule, req('claim', claimBody('wed-talk', 'Ada', ROOM_105), 'ada'));
  assert.equal(r.ok, false);
});

test('join on lunch and on tue-2100 succeeds; wrong template rejected', () => {
  let s = { claims: [] };
  let r = apply(s, schedule, req('join', joinBody('wed-lunch', 'Ada'), 'ada'));
  assert.ok(r.ok, r.message);
  r = apply(r.signups, schedule, req('join', joinBody('tue-2100', 'Emmy', 'emmy@example.edu'), 'emmy'));
  assert.ok(r.ok, r.message);
  assert.equal(r.signups.claims.length, 2);
  assert.equal('room' in r.signups.claims[0], false);
  // Many people can join a group event.
  s = r.signups;
  for (let i = 0; i < 10; i++) {
    r = apply(s, schedule, req('join', joinBody('wed-lunch', `Person ${i}`), `p${i}`));
    assert.ok(r.ok, r.message);
    s = r.signups;
  }
  // Claim template on a group slot, and join on a meeting slot, are rejected.
  r = apply(s, schedule, req('claim', claimBody('wed-lunch', 'Ada', ROOM_105), 'x'));
  assert.equal(r.ok, false);
  r = apply(s, schedule, req('join', joinBody('wed-1000', 'Ada'), 'x'));
  assert.equal(r.ok, false);
});

test('slot falls back to the title when the field is missing', () => {
  const body = `### Your name\n\nAda\n\n### Room\n\n${ROOM_303}\n\n### Email (optional, for a calendar invite)\n\n_No response_`;
  const r = apply({ claims: [] }, schedule, req('claim', body, 'ada', 'Claim: Wed 3:30 pm'));
  assert.ok(r.ok, r.message);
  assert.equal(r.signups.claims[0].slot, 'wed-1530');
});

// Issue #1 as GitHub delivered it: the "join" label was missing because the
// label did not exist in the repo yet, so the template must come from the title.
test('issue #1 verbatim: unlabeled Join issue is recorded for tue-2100', () => {
  const issue = {
    number: 1,
    title: 'Join: Tue 9:00 pm, late dinner, a snack, or an ice cold beer with Thomas',
    body: '### Slot\n\ntue-2100\n\n### Your name\n\nBrendan Keith\n\n### Email (optional, for a calendar invite)\n\nbrendan_keith@brown.edu',
    labels: [],
    user: { login: 'brendankeith' },
    created_at: '2026-10-08T19:22:54Z',
  };
  assert.equal(templateFor(issue), 'join');
  assert.equal(templateFor({ ...issue, title: 'Something else', labels: [{ name: 'join' }] }), 'join');
  assert.equal(templateFor({ ...issue, title: 'Something else' }), null);
  const fields = parseBody(issue.body);
  assert.deepEqual(fields, { slot: 'tue-2100', name: 'Brendan Keith', email: 'brendan_keith@brown.edu' });
  const r = apply({ claims: [] }, schedule, {
    template: templateFor(issue), fields, login: issue.user.login, number: issue.number,
    created_at: issue.created_at, title: issue.title,
  });
  assert.ok(r.ok, r.message);
  assert.deepEqual(r.signups.claims[0], {
    slot: 'tue-2100', name: 'Brendan Keith', login: 'brendankeith',
    email: 'brendan_keith@brown.edu', issue: 1, created_at: '2026-10-08T19:22:54Z',
  });
});
