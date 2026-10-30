// -----------------------------------------------------------------------------
// From the raw Zammad answers to what Gladys shows: states, groups and
// tickets with their times in milliseconds, and the counters of a local day
// (the time zone of Gladys, injected by the supervisor as TZ).
//
// Definitions, the same in the devices, the widget, the scene events and the
// documentation:
//   - open ticket: a ticket whose state is of type new, open, pending
//     reminder or pending action (not closed, merged or removed), like the
//     "Open tickets" of Zammad;
//   - new: state type new; pending: the two pending types;
//   - escalated: an open ticket whose escalation time (`escalation_at`, set
//     by a Zammad SLA) has passed. Zammad clears it on pending states;
//   - unassigned: owned by the system user (id 1, "-");
//   - created today: created during the local day, whatever its state now.
// -----------------------------------------------------------------------------

export const ACTIVE_STATE_TYPES = Object.freeze({
  new: 'new',
  open: 'open',
  'pending reminder': 'pending',
  'pending action': 'pending',
});

// The owner of an unassigned ticket.
export const NOBODY_ID = 1;

const time = (value) => {
  if (typeof value !== 'string' || value === '') {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * The active states, by id: `{ id → { name, kind: 'new'|'open'|'pending' } }`.
 * @param {unknown} raw answer of GET /ticket_states?expand=true
 */
export function parseStates(raw) {
  const states = new Map();
  for (const state of Array.isArray(raw) ? raw : []) {
    const kind = ACTIVE_STATE_TYPES[state?.state_type];
    if (Number.isInteger(state?.id) && kind) {
      states.set(state.id, { name: text(state.name), kind });
    }
  }
  return states;
}

/**
 * The active groups the agent sees, in id order (the default "Users" first).
 * @returns {Array<{ id: string, name: string }>}
 */
export function parseGroups(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((group) => Number.isInteger(group?.id) && group.active !== false && text(group.name))
    .map((group) => ({ id: String(group.id), name: text(group.name) }))
    .sort((a, b) => Number(a.id) - Number(b.id));
}

/**
 * A ticket of an expanded search answer; null when unusable.
 * @param {Map<number, { name: string, kind: string }>} states
 */
export function parseTicket(raw, states) {
  if (!raw || !Number.isInteger(raw.id)) {
    return null;
  }
  const state = states.get(raw.state_id);
  return {
    id: String(raw.id),
    number: text(String(raw.number ?? raw.id)),
    title: text(raw.title) || `#${raw.number ?? raw.id}`,
    groupId: Number.isInteger(raw.group_id) ? String(raw.group_id) : '',
    group: text(raw.group),
    state: text(raw.state) || state?.name || '',
    kind: state?.kind ?? null,
    priority: text(raw.priority),
    ownerId: Number.isInteger(raw.owner_id) ? raw.owner_id : NOBODY_ID,
    customer: text(raw.customer),
    createdAt: time(raw.created_at),
    escalationAt: time(raw.escalation_at),
  };
}

export const isEscalated = (ticket, now) =>
  ticket.kind !== null &&
  ticket.kind !== 'pending' &&
  ticket.escalationAt !== null &&
  ticket.escalationAt <= now;

// --- Counters ---------------------------------------------------------------------

/**
 * Counters of one set of tickets (the instance, or one group).
 * @param {object} options
 * @param {ReturnType<typeof parseTicket>[]} options.open open tickets
 * @param {ReturnType<typeof parseTicket>[]} options.created tickets created since local midnight (or before)
 * @param {number} options.now
 * @param {{ start: number, end: number }} options.day
 * @param {number|null} options.meId id of the token's user
 */
export function summarize({ open, created, now, day, meId }) {
  const escalated = open
    .filter((ticket) => isEscalated(ticket, now))
    .sort((a, b) => a.escalationAt - b.escalationAt);
  return {
    open: open.length,
    new: open.filter((ticket) => ticket.kind === 'new').length,
    pending: open.filter((ticket) => ticket.kind === 'pending').length,
    escalated: escalated.length,
    unassigned: open.filter((ticket) => ticket.ownerId === NOBODY_ID).length,
    mine: meId === null ? 0 : open.filter((ticket) => ticket.ownerId === meId).length,
    createdToday: created.filter(
      (ticket) => ticket.createdAt !== null && ticket.createdAt >= day.start,
    ).length,
    // The latest open tickets first, for the widget.
    latest: [...open].sort((a, b) => Number(b.id) - Number(a.id)),
    escalatedTickets: escalated,
  };
}

/** The next escalation time still ahead, null when none. */
export function nextEscalation(open, now) {
  const ahead = open
    .filter((ticket) => ticket.kind !== 'pending' && ticket.escalationAt > now)
    .map((ticket) => ticket.escalationAt);
  return ahead.length === 0 ? null : Math.min(...ahead);
}

const fold = (value) =>
  value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Find a group by id or exact name (case, accents and repeated blanks ignored).
 * @template {{ id: string, name: string }} T
 * @param {T[]} items
 * @param {unknown} query
 * @returns {T|null}
 */
export function findByIdOrName(items, query) {
  const wanted = String(query ?? '').trim();
  if (!wanted) {
    return null;
  }
  const number = wanted.match(/^#?(\d+)$/);
  if (number) {
    const byId = items.find((item) => item.id === number[1]);
    if (byId) {
      return byId;
    }
  }
  return items.find((item) => fold(item.name) === fold(wanted)) ?? null;
}

// --- Local days -------------------------------------------------------------------

const partsFormatters = new Map();

function zonedParts(ms, timeZone) {
  let format = partsFormatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    partsFormatters.set(timeZone, format);
  }
  const parts = Object.fromEntries(
    format.formatToParts(new Date(ms)).map(({ type, value }) => [type, Number(value)]),
  );
  return parts;
}

/** Offset of `timeZone` from UTC at `ms`, in milliseconds. */
function offsetAt(ms, timeZone) {
  const p = zonedParts(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** UTC instant of local midnight of a local calendar day (DST-safe). */
function localMidnight(year, month, day, timeZone) {
  const guess = Date.UTC(year, month - 1, day);
  const first = guess - offsetAt(guess, timeZone);
  let start = guess - offsetAt(first, timeZone);
  // Where the clocks jump at midnight (Chile, Cuba), 00:00 does not exist and
  // the instant found is 23:00 the day before: the day starts an hour later.
  if (zonedParts(start, timeZone).day !== day) {
    start += 60 * 60_000;
  }
  return start;
}

/** UTC instant of a local wall-clock time (in a DST overlap, one of the two). */
export function localTime(year, month, day, hour, minute, timeZone) {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const first = wall - offsetAt(wall, timeZone);
  return wall - offsetAt(first, timeZone);
}

/** A time zone Intl knows, else the one of the process. */
export function resolveTimeZone(timeZone) {
  try {
    if (timeZone) {
      new Intl.DateTimeFormat('en-US', { timeZone });
      return timeZone;
    }
  } catch {
    // fall through
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Start and end (exclusive) of the local day holding `now`. */
export function localDay(now, timeZone) {
  const p = zonedParts(now, timeZone);
  const start = localMidnight(p.year, p.month, p.day, timeZone);
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  const end = localMidnight(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    timeZone,
  );
  return { start, end };
}
