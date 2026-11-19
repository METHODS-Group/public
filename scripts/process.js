// Records sign-ups from GitHub issues opened through the issue forms.
// Pure logic lives in parseBody(), apply(), sheetFor(), and processIssues();
// main() does the file and GitHub I/O.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCHEDULE_PATH = path.join(ROOT, 'data', 'schedule.json');
const SIGNUPS_PATH = path.join(ROOT, 'data', 'signups.json');

// The live sign-up sheets. Each has its own schedule.json and signups.json in `dir`,
// its page at `page` (relative to the site root), and the issue forms that book it.
// A form shared by several sheets (cancel) goes to the sheet whose schedule has the slot.
const SHEETS = [
  { id: 'apma2570b', dir: 'data', page: '', templates: ['claim', 'join', 'present', 'update', 'cancel'] },
  { id: 'postdoc-interviews-2026', dir: 'postdoc-interviews-2026/data', page: 'postdoc-interviews-2026/', templates: ['interview', 'interview-update', 'cancel'] },
];

// Issue-form field labels (from .github/ISSUE_TEMPLATE/*.yml) mapped to field ids.
// Room and Email belong to the meeting/group forms of visitor sheets (see
// thomas-visit-2026/); the presentation forms use the title and description,
// which the interview forms label "Abstract".
const FIELD_IDS = {
  'Slot': 'slot',
  'Your name': 'name',
  'Room': 'room',
  'Email (optional, for a calendar invite)': 'email',
  'Presentation title': 'talk_title',
  'Brief description': 'description',
  'Abstract': 'description',
};

// Which slot kind each sign-up form books, and the page button for each kind.
const TEMPLATE_KIND = { claim: 'meeting', join: 'group', present: 'presentation', interview: 'presentation' };
const BUTTON = { meeting: 'Claim', group: 'Join', presentation: 'Sign up' };
const TEMPLATES = ['claim', 'join', 'present', 'update', 'cancel', 'interview', 'interview-update'];
// Forms that edit the title and description of one's own presentation sign-up.
const UPDATE_TEMPLATES = ['update', 'interview-update'];
// Issue-title prefixes of the forms ("Interview update: Wed Dec 9, 1:00 pm ET").
const TITLE_PREFIX = /^(claim|join|cancel|present|update|interview update|interview):\s*(.*)$/i;

// GitHub renders an issue form as "### <label>\n\n<value>" sections.
function parseBody(body) {
  const fields = {};
  const sections = String(body || '').replace(/\r\n?/g, '\n').split(/^### /m).slice(1);
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
  const m = TITLE_PREFIX.exec(String(title || '').trim());
  if (m && m[2].trim()) {
    const text = m[2].trim().toLowerCase();
    return slots.find((s) => s.label.toLowerCase() === text || s.id === text) || null;
  }
  return null;
}

// A trimmed single-spaced field value, or null when empty.
function text(value) {
  const v = String(value == null ? '' : value).replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  return v || null;
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

  if (!TEMPLATES.includes(template)) {
    return fail('This issue is not from one of the sign-up forms, so nothing was recorded.');
  }
  if (!login) return fail('Could not determine your GitHub login.');

  const slot = findSlot(schedule, fields, title);
  if (!slot) {
    return fail('Could not find that slot. Start from the sign-up page so the slot is filled in for you: ' + page);
  }

  // A reserved entry is assigned by hand in data/signups.json; the forms cannot touch it.
  if (slot.kind === 'reserved') return fail(`${slot.label} is reserved and cannot be changed through the sign-up forms.`);

  if (template === 'cancel') {
    const before = next.claims.length;
    next.claims = next.claims.filter((c) => !(c.slot === slot.id && c.login === login));
    if (next.claims.length === before) {
      return fail(`No sign-up by @${login} was found for ${slot.label}.`);
    }
    return { ok: true, message: `🗑️ Removed your sign-up for ${slot.label}. The sign-up page will update shortly: ${page}`, signups: next };
  }

  // What the sheet calls the description in messages ("abstract" on the interview sheet).
  const descLabel = schedule.description_label || 'brief description';

  // Edit the name, title, and description of your own presentation sign-up.
  // Like cancel, this still works after the slot's deadline.
  if (UPDATE_TEMPLATES.includes(template)) {
    if (slot.kind !== 'presentation') return fail(`${slot.label} has no title or description to edit.`);
    const i = next.claims.findIndex((c) => c.slot === slot.id && c.login === login);
    if (i === -1) {
      return fail(`No sign-up by @${login} was found for ${slot.label}. To take an open slot, use its "Sign up" button on the sign-up page: ${page}`);
    }
    const name = text(fields.name);
    const talkTitle = text(fields.talk_title);
    const description = text(fields.description);
    if (!name || !talkTitle || !description) {
      return fail(`Please fill in all three fields: your name, the presentation title, and the ${descLabel}.`);
    }
    next.claims[i] = { ...next.claims[i], name, title: talkTitle, description, updated_at: created_at || new Date().toISOString() };
    return { ok: true, message: `✏️ Updated your sign-up for ${slot.label}: "${talkTitle}". The sign-up page will update shortly: ${page}`, signups: next };
  }

  if (slot.kind === 'blocked') return fail(`${slot.label} is not available for sign-up.`);
  if (!slot.open) {
    return fail(slot.closed_message
      ? `${slot.closed_message}: ${page}`
      : `${slot.label} is not open yet; check the sign-up page later: ${page}`);
  }
  if (closedAt(slot, now)) {
    return fail(slot.closed_message || `Sign-ups for ${slot.label} closed at ${slot.closes_at}; message Brendan if you'd still like to come.`);
  }
  if (slot.kind !== TEMPLATE_KIND[template]) {
    return fail(`${slot.label} is a ${slot.kind} slot; use the "${BUTTON[slot.kind] || 'sign-up'}" button for it on the sign-up page: ${page}`);
  }

  const existing = claimsFor(next, slot.id);
  if (existing.some((c) => c.login === login)) {
    return fail(`You are already signed up for ${slot.label}.`);
  }
  // A sheet with `max_per_person` caps how many slots one GitHub login can hold.
  if (schedule.max_per_person != null) {
    const mine = next.claims.filter((c) => c.login === login);
    if (mine.length >= schedule.max_per_person) {
      const held = mine.map((c) => (allSlots(schedule).find((s) => s.id === c.slot) || { label: c.slot }).label).join(', ');
      return fail(`You are already signed up for ${held}, and each person can hold only ${schedule.max_per_person === 1 ? 'one slot' : schedule.max_per_person + ' slots'}. To switch, press "Cancel my sign-up" next to your name on the sign-up page, then sign up for the new slot: ${page}`);
    }
  }
  if (slot.capacity != null && existing.length >= slot.capacity) {
    return fail(`That slot is already full; pick another on the sign-up page: ${page}`);
  }

  const name = (fields.name || '').trim();
  if (!name) return fail('Please fill in your name.');

  if (slot.kind === 'presentation') {
    const talkTitle = text(fields.talk_title);
    const description = text(fields.description);
    if (!talkTitle) return fail('Please fill in the title of your presentation.');
    if (!description) {
      return fail(descLabel === 'brief description'
        ? 'Please fill in a brief description of your presentation.'
        : `Please fill in the ${descLabel} of your presentation.`);
    }
    next.claims.push({
      slot: slot.id,
      name,
      login,
      title: talkTitle,
      description,
      issue: number,
      created_at: created_at || new Date().toISOString(),
    });
    return {
      ok: true,
      message: `✅ Signed up: ${slot.label}, "${talkTitle}". Your entry now appears on the sign-up page: ${page}`,
      signups: next,
    };
  }

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

// Which issue form the issue came from: by label, or by the form's title
// prefix ("Present: ...") when the label was not applied (GitHub drops a
// template label that does not exist in the repo).
function templateFor(issue) {
  const labels = (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
  const byLabel = TEMPLATES.find((t) => labels.includes(t));
  if (byLabel) return byLabel;
  const m = TITLE_PREFIX.exec(String(issue.title || '').trim());
  return m ? m[1].toLowerCase().replace(/\s+/g, '-') : null;
}

// The sheet an issue belongs to: the one whose forms include its template; for a form
// several sheets share (cancel), the one whose schedule has the slot, else the first.
// `sheets` are SHEETS entries with their `schedule` loaded.
function sheetFor(template, fields, title, sheets) {
  const candidates = sheets.filter((s) => s.templates.includes(template));
  if (candidates.length <= 1) return candidates[0] || null;
  return candidates.find((s) => findSlot(s.schedule, fields, title)) || candidates[0];
}

// Applies open sign-up issues in the order they were opened, oldest first, so that
// arrival order decides a contested slot. `sheets` carry `schedule` and `signups`,
// which are updated in place; `site` is the page URL of the site root; `now` (for
// tests) is the clock for `closes_at` deadlines, which defaults to the current time.
// Returns one { issue, sheet, ok, message } per sign-up issue; other issues are skipped.
function processIssues(issues, sheets, site, now) {
  const ordered = [...issues].sort((a, b) =>
    (Date.parse(a.created_at) - Date.parse(b.created_at)) || (a.number - b.number));
  const results = [];
  for (const issue of ordered) {
    if (issue.pull_request || (issue.state && issue.state !== 'open')) continue;
    const template = templateFor(issue);
    if (!template) continue;
    const fields = parseBody(issue.body);
    const sheet = sheetFor(template, fields, issue.title, sheets) || sheets[0];
    const result = apply(sheet.signups, sheet.schedule, {
      template,
      fields,
      login: issue.user && issue.user.login,
      number: issue.number,
      created_at: issue.created_at,
      title: issue.title,
      now,
      pageUrl: site + sheet.page,
    });
    if (result.ok) {
      sheet.signups = result.signups;
      sheet.changed = true;
    }
    results.push({ issue, sheet: sheet.id, ok: result.ok, message: result.message });
  }
  return results;
}

// The live sheets with their schedule and sign-ups read from disk; a sheet whose
// folder is gone (archived elsewhere) is skipped.
function loadSheets(root = ROOT) {
  return SHEETS.flatMap((s) => {
    const schedulePath = path.join(root, s.dir, 'schedule.json');
    const signupsPath = path.join(root, s.dir, 'signups.json');
    if (!fs.existsSync(schedulePath) || !fs.existsSync(signupsPath)) return [];
    return [{
      ...s,
      schedulePath,
      signupsPath,
      schedule: JSON.parse(fs.readFileSync(schedulePath, 'utf8')),
      signups: JSON.parse(fs.readFileSync(signupsPath, 'utf8')),
      changed: false,
    }];
  });
}

// All open issues in the repository, oldest first (pull requests excluded).
async function openIssues(repo, token) {
  const all = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await github('GET',
      `https://api.github.com/repos/${repo}/issues?state=open&sort=created&direction=asc&per_page=100&page=${page}`, token);
    all.push(...batch.filter((i) => !i.pull_request));
    if (batch.length < 100) break;
  }
  return all;
}

// Every run handles all open sign-up issues, not just the one that triggered it:
// GitHub keeps at most one pending run per concurrency group and cancels the older
// pending run when another is queued, so a burst of sign-ups would otherwise lose
// requests. With a sweep, the next run picks up whatever a cancelled run missed.
async function main(eventPath) {
  const event = eventPath ? JSON.parse(fs.readFileSync(eventPath, 'utf8')) : {};
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY || (event.repository && event.repository.full_name);

  let issues = [];
  if (token && repo) {
    issues = await openIssues(repo, token);
  } else {
    console.log('No GITHUB_TOKEN/GH_TOKEN or repository set; processing only the event\'s issue, without comments.');
  }
  // The issue list can lag a moment behind the event, so include the event's issue.
  if (event.issue && event.issue.state === 'open' && !issues.some((i) => i.number === event.issue.number)) {
    issues.push(event.issue);
  }

  const sheets = loadSheets();
  const results = processIssues(issues, sheets, pageUrl(repo));
  for (const s of sheets) {
    if (s.changed) fs.writeFileSync(s.signupsPath, JSON.stringify(s.signups, null, 2) + '\n');
  }
  for (const r of results) {
    console.log(`#${r.issue.number} [${r.sheet}]`, r.ok ? 'OK' : 'REJECTED', r.message);
    if (!token || !repo) continue;
    const base = `https://api.github.com/repos/${repo}/issues/${r.issue.number}`;
    await github('POST', `${base}/comments`, token, { body: r.message });
    await github('PATCH', base, token, {
      state: 'closed',
      state_reason: r.ok ? 'completed' : 'not_planned',
    });
  }
  if (!results.length) console.log('No open sign-up issues to process.');
}

module.exports = {
  parseBody, apply, findSlot, templateFor, sheetFor, processIssues, loadSheets, pageUrl, closedAt,
  FIELD_IDS, SHEETS, SCHEDULE_PATH, SIGNUPS_PATH,
};

if (require.main === module) {
  // With no event file (a manual run), the sweep alone does the work.
  const eventPath = process.argv[2] || process.env.GITHUB_EVENT_PATH;
  if (!eventPath && !(process.env.GITHUB_TOKEN || process.env.GH_TOKEN)) {
    console.error('Usage: node scripts/process.js <event.json>  (or set GITHUB_TOKEN and GITHUB_REPOSITORY to sweep open issues)');
    process.exit(2);
  }
  main(eventPath).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
