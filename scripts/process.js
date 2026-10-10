// Records a sign-up from a GitHub issue opened through one of the issue forms.
// Pure logic lives in parseBody() and apply(); main() does the file and GitHub I/O.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCHEDULE_PATH = path.join(ROOT, 'data', 'schedule.json');
const SIGNUPS_PATH = path.join(ROOT, 'data', 'signups.json');

// Issue-form field labels (from .github/ISSUE_TEMPLATE/*.yml) mapped to field ids.
const FIELD_IDS = {
  'Slot': 'slot',
  'Your name': 'name',
  'Room': 'room',
  'Email (optional, for a calendar invite)': 'email',
};

const TEMPLATE_KIND = { claim: 'meeting', join: 'group' };

// GitHub renders an issue form as "### <label>\n\n<value>" sections.
function parseBody(body) {
  const fields = {};
  const sections = String(body || '').split(/^### /m).slice(1);
  for (const section of sections) {
    const nl = section.indexOf('\n');
    const label = (nl === -1 ? section : section.slice(0, nl)).trim();
    let value = (nl === -1 ? '' : section.slice(nl + 1)).trim();
    if (value === '_No response_' || value === '') value = null;
    const id = FIELD_IDS[label] || label.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    fields[id] = value;
  }
  return fields;
}

function allSlots(schedule) {
  return schedule.days.flatMap((d) => d.slots);
}

function findSlot(schedule, fields, title) {
  const slots = allSlots(schedule);
  const id = (fields.slot || '').trim();
  if (id) {
    const byId = slots.find((s) => s.id === id);
    if (byId) return byId;
    const byLabel = slots.find((s) => s.label.toLowerCase() === id.toLowerCase());
    if (byLabel) return byLabel;
  }
  // Fall back to the title, e.g. "Claim: Wed 10:00 am".
  const m = /^(?:Claim|Join|Cancel):\s*(.+)$/i.exec(title || '');
  if (m) {
    const text = m[1].trim().toLowerCase();
    return slots.find((s) => s.label.toLowerCase() === text || s.id === text) || null;
  }
  return null;
}

function claimsFor(signups, slotId) {
  return signups.claims.filter((c) => c.slot === slotId);
}

function pageUrl(repository) {
  const [owner, repo] = String(repository || 'METHODS-Group/public').split('/');
  return `https://${owner.toLowerCase()}.github.io/${repo}/`;
}

// A slot with `closes_at` (ISO 8601 with offset) takes no new sign-ups after that
// time; cancellations are still allowed. `now` is a Date, ms, or ISO string.
function closedAt(slot, now) {
  if (!slot.closes_at) return false;
  const t = Date.parse(slot.closes_at);
  if (Number.isNaN(t)) return false;
  const n = now instanceof Date ? now.getTime() : typeof now === 'string' ? Date.parse(now) : now;
  return n >= t;
}

// Returns { ok, message, signups } without mutating the input signups.
// req.now (optional) is the current time, for tests; it defaults to the clock.
function apply(signups, schedule, req) {
  const { template, fields = {}, login, number, created_at, title } = req;
  const now = req.now == null ? Date.now() : req.now;
  const next = { ...signups, claims: signups.claims.map((c) => ({ ...c })) };
  const page = req.pageUrl || pageUrl(process.env.GITHUB_REPOSITORY);
  const fail = (message) => ({ ok: false, message, signups });

  if (!['claim', 'join', 'cancel'].includes(template)) {
    return fail('This issue is not from one of the sign-up forms, so nothing was recorded.');
  }
  if (!login) return fail('Could not determine your GitHub login.');

  const slot = findSlot(schedule, fields, title);
  if (!slot) {
    return fail('Could not find that slot. Start from the sign-up page so the slot is filled in for you: ' + page);
  }

  if (template === 'cancel') {
    const before = next.claims.length;
    next.claims = next.claims.filter((c) => !(c.slot === slot.id && c.login === login));
    if (next.claims.length === before) {
      return fail(`No sign-up by @${login} was found for ${slot.label}.`);
    }
    return { ok: true, message: `🗑️ Removed your sign-up for ${slot.label}. The sign-up page will update shortly: ${page}`, signups: next };
  }

  if (slot.kind === 'blocked') return fail(`${slot.label} is not available for sign-up.`);
  if (!slot.open) return fail(`${slot.label} is not open yet; check the sign-up page later: ${page}`);
  if (closedAt(slot, now)) {
    return fail(slot.closed_message || `Sign-ups for ${slot.label} closed at ${slot.closes_at}; message Brendan if you'd still like to come.`);
  }
  if (slot.kind !== TEMPLATE_KIND[template]) {
    const other = template === 'claim' ? 'Join' : 'Claim';
    return fail(`${slot.label} is a ${slot.kind} slot; use the "${other}" button for it on the sign-up page: ${page}`);
  }

  const existing = claimsFor(next, slot.id);
  if (existing.some((c) => c.login === login)) {
    return fail(`You are already signed up for ${slot.label}.`);
  }
  if (slot.capacity != null && existing.length >= slot.capacity) {
    return fail(`That slot is already full; pick another on the sign-up page: ${page}`);
  }

  const name = (fields.name || '').trim();
  if (!name) return fail('Please fill in your name.');

  // Whoever books a meeting slot first picks the room; a second person inherits it.
  let room = null;
  let inherited = false;
  if (slot.kind === 'meeting') {
    const first = existing.find((c) => c.room);
    const chosen = (fields.room || '').trim();
    if (first) {
      room = first.room;
      inherited = chosen !== room;
    } else {
      room = chosen;
      if (!schedule.rooms.includes(room)) {
        return fail(`Please pick one of the listed rooms: ${schedule.rooms.join(' or ')}.`);
      }
    }
  }

  const claim = {
    slot: slot.id,
    name,
    login,
    ...(slot.kind === 'meeting' ? { room } : {}),
    email: fields.email ? fields.email.trim() : null,
    issue: number,
    created_at: created_at || new Date().toISOString(),
  };
  next.claims.push(claim);

  const where = room ? `, ${room}` : '';
  const note = inherited ? ` (${existing.find((c) => c.room).name} booked this slot first and picked the room, so your choice was not used)` : '';
  return {
    ok: true,
    message: `✅ Booked: ${slot.label}${where}${note}. Your name now appears on the sign-up page: ${page}`,
    signups: next,
  };
}

async function github(method, url, token, body) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'signup-sheet',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${url} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

const TEMPLATES = ['claim', 'join', 'cancel'];

// Which issue form the issue came from: by label, or by the form's title
// prefix ("Claim: ...") when the label was not applied (GitHub drops a
// template label that does not exist in the repo).
function templateFor(issue) {
  const labels = (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
  const byLabel = TEMPLATES.find((t) => labels.includes(t));
  if (byLabel) return byLabel;
  const m = /^(claim|join|cancel):/i.exec(String(issue.title || '').trim());
  return m ? m[1].toLowerCase() : null;
}

async function main(eventPath) {
  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  const issue = event.issue;
  const template = templateFor(issue);

  const schedule = JSON.parse(fs.readFileSync(SCHEDULE_PATH, 'utf8'));
  const signups = JSON.parse(fs.readFileSync(SIGNUPS_PATH, 'utf8'));

  const result = apply(signups, schedule, {
    template,
    fields: parseBody(issue.body),
    login: issue.user && issue.user.login,
    number: issue.number,
    created_at: issue.created_at,
    title: issue.title,
  });

  console.log(result.ok ? 'OK' : 'REJECTED', result.message);
  if (result.ok) {
    fs.writeFileSync(SIGNUPS_PATH, JSON.stringify(result.signups, null, 2) + '\n');
  }

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    console.log('No GITHUB_TOKEN/GH_TOKEN set; skipping the issue comment and close.');
    return;
  }
  const repo = process.env.GITHUB_REPOSITORY || (event.repository && event.repository.full_name);
  const base = `https://api.github.com/repos/${repo}/issues/${issue.number}`;
  await github('POST', `${base}/comments`, token, { body: result.message });
  await github('PATCH', base, token, {
    state: 'closed',
    state_reason: result.ok ? 'completed' : 'not_planned',
  });
}

module.exports = { parseBody, apply, findSlot, templateFor, pageUrl, closedAt, FIELD_IDS };

if (require.main === module) {
  const eventPath = process.argv[2] || process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    console.error('Usage: node scripts/process.js <event.json>');
    process.exit(2);
  }
  main(eventPath).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
