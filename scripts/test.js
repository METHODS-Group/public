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

  // Second claim fills the slot and inherits the first claimant's room.
  r = apply(s, schedule, req('claim', claimBody('wed-1000', 'Emmy Noether', ROOM_303), 'emmy'));
  assert.ok(r.ok, r.message);
  assert.equal(r.signups.claims[1].room, ROOM_105);
  assert.match(r.message, /Room 105 .*Ada Lovelace booked this slot first/);
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
  r = apply(s, schedule, req('claim', claimBody('wed-1630', 'Sofia K', 'Room 999'), 'sofia'));
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

test('second claimant who picks the same room gets no note; a bad room is fine when inherited', () => {
  let r = apply({ claims: [] }, schedule, req('claim', claimBody('wed-1630', 'Ada', ROOM_303), 'ada'));
  r = apply(r.signups, schedule, req('claim', claimBody('wed-1630', 'Emmy', ROOM_303), 'emmy'));
  assert.ok(r.ok, r.message);
  assert.doesNotMatch(r.message, /booked this slot first/);
  r = apply(r.signups.claims.length ? { claims: [r.signups.claims[0]] } : r.signups, schedule,
    req('claim', claimBody('wed-1630', 'Carl', 'Room 999'), 'gauss'));
  assert.ok(r.ok, r.message);
  assert.equal(r.signups.claims[1].room, ROOM_303);
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

test('wed-1600 is a regular open meeting slot', () => {
  let r = apply({ claims: [] }, schedule, req('claim', claimBody('wed-1600', 'Ada', ROOM_105), 'ada'));
  assert.ok(r.ok, r.message);
  assert.match(r.message, /Booked: Wed 4:00 pm, Room 105/);
  r = apply(r.signups, schedule, req('claim', claimBody('wed-1600', 'Emmy', ROOM_303), 'emmy'));
  assert.ok(r.ok, r.message);
  r = apply(r.signups, schedule, req('claim', claimBody('wed-1600', 'Carl', ROOM_303), 'gauss'));
  assert.equal(r.ok, false);
  assert.match(r.message, /already full/);
});

test('wed-1630 is a regular open meeting slot; wed-1500 is held and rejects claims', () => {
  let r = apply({ claims: [] }, schedule, req('claim', claimBody('wed-1630', 'Ada', ROOM_105), 'ada'));
  assert.ok(r.ok, r.message);
  assert.match(r.message, /Booked: Wed 4:30 pm, Room 105/);
  const s = r.signups;
  r = apply(s, schedule, req('claim', claimBody('wed-1500', 'Emmy', ROOM_303), 'emmy'));
  assert.equal(r.ok, false);
  assert.match(r.message, /Wed 3:00 pm is temporarily reserved; pick another slot/);
  assert.equal(r.signups.claims.length, 1);
  // Title fallback reaches the same held slot and is rejected too.
  const body = `### Your name\n\nEmmy\n\n### Room\n\n${ROOM_303}`;
  r = apply(s, schedule, req('claim', body, 'emmy', 'Claim: Wed 3:00 pm'));
  assert.equal(r.ok, false);
});

test('the reserved Wednesday arrival entry is pre-filled and rejects claim, join, and cancel', () => {
  const signups = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'signups.json'), 'utf8'));
  const arrival = signups.claims.filter((c) => c.slot === 'wed-0900');
  assert.deepEqual(arrival.map((c) => c.login), ['brendankeith', 'ramimasri']);
  const slot = schedule.days.flatMap((d) => d.slots).find((s) => s.id === 'wed-0900');
  assert.equal(slot.kind, 'reserved');
  assert.equal(slot.open, false);
  for (const r of [
    apply(signups, schedule, req('claim', claimBody('wed-0900', 'Ada', ROOM_105), 'ada')),
    apply(signups, schedule, req('join', joinBody('wed-0900', 'Ada'), 'ada')),
    apply(signups, schedule, req('cancel', '### Slot\n\nwed-0900', 'brendankeith')),
    apply(signups, schedule, req('cancel', '### Slot\n\nwed-0900', 'ramimasri')),
  ]) {
    assert.equal(r.ok, false);
    assert.match(r.message, /reserved and cannot be changed/);
    assert.equal(r.signups.claims.filter((c) => c.slot === 'wed-0900').length, 2);
  }
});

test('lunch sign-ups close at noon on Tuesday; cancellations still work', () => {
  const lunch = schedule.days.flatMap((d) => d.slots).find((s) => s.id === 'wed-lunch');
  assert.equal(lunch.closes_at, '2026-10-13T12:00:00-04:00');
  const before = '2026-10-13T11:59:00-04:00';
  const after = '2026-10-13T12:00:00-04:00';

  // Before the cutoff: join works.
  let r = apply({ claims: [] }, schedule, { ...req('join', joinBody('wed-lunch', 'Ada'), 'ada'), now: before });
  assert.ok(r.ok, r.message);
  const s = r.signups;

  // At and after the cutoff: join is rejected with the explanation; nothing is recorded.
  for (const now of [after, '2026-10-14T09:00:00-04:00', new Date('2026-10-13T16:00:01Z'), Date.parse('2026-10-13T16:00:01Z')]) {
    r = apply(s, schedule, { ...req('join', joinBody('wed-lunch', 'Emmy'), 'emmy'), now });
    assert.equal(r.ok, false, `expected rejection at ${now}`);
    assert.equal(r.message, "Lunch sign-ups closed at noon on Tuesday so a table could be booked; message Brendan if you'd still like to come");
    assert.equal(r.signups.claims.length, 1);
  }

  // Cancelling after the cutoff is still allowed.
  r = apply(s, schedule, { ...req('cancel', '### Slot\n\nwed-lunch', 'ada'), now: after });
  assert.ok(r.ok, r.message);
  assert.equal(r.signups.claims.length, 0);

  // Other slots are unaffected by the lunch cutoff.
  r = apply(s, schedule, { ...req('claim', claimBody('wed-1600', 'Emmy', ROOM_303), 'emmy'), now: after });
  assert.ok(r.ok, r.message);
  r = apply(s, schedule, { ...req('join', joinBody('tue-2100', 'Emmy'), 'emmy'), now: after });
  assert.ok(r.ok, r.message);
});

test('closes_at is generic: a meeting slot with a past deadline is rejected with a default message', () => {
  const sched = JSON.parse(JSON.stringify(schedule));
  const slot = sched.days.flatMap((d) => d.slots).find((s) => s.id === 'wed-1000');
  slot.closes_at = '2026-10-12T09:00:00-04:00';
  let r = apply({ claims: [] }, sched, { ...req('claim', claimBody('wed-1000', 'Ada', ROOM_105), 'ada'), now: '2026-10-12T08:59:59-04:00' });
  assert.ok(r.ok, r.message);
  r = apply({ claims: [] }, sched, { ...req('claim', claimBody('wed-1000', 'Ada', ROOM_105), 'ada'), now: '2026-10-12T09:00:00-04:00' });
  assert.equal(r.ok, false);
  assert.match(r.message, /Sign-ups for Wed 10:00 am closed at 2026-10-12T09:00:00-04:00; message Brendan/);
  // An unparsable closes_at is ignored rather than locking the slot.
  slot.closes_at = 'noon-ish';
  r = apply({ claims: [] }, sched, { ...req('claim', claimBody('wed-1000', 'Ada', ROOM_105), 'ada'), now: '2026-10-20T09:00:00-04:00' });
  assert.ok(r.ok, r.message);
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
