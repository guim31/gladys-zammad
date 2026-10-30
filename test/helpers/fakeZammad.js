// -----------------------------------------------------------------------------
// An in-memory Zammad, answering the routes the integration calls the way the
// real server does (status codes, `{ error, error_human }` errors, the
// condition search paged by `per_page`/`page`, 422 for an unknown group).
// Its starting data are real answers of ghcr.io/zammad/zammad 7.2.2 in Docker
// (30/10/2026, test/fixtures/zammad/real-*.json): two groups (Users,
// Hardware), six tickets created that day — "Welcome to Zammad" (new, no
// SLA), an escalated new one, a pending one, an escalated open one assigned
// to the token's user, a closed one and a new one escalating at 12:14:09 UTC.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/zammad/${name}.json`, import.meta.url), 'utf8'));

export const TOKEN = 'MRgiTestTokenOnlyForTheFakeServer_0123456789abcdefABCDEF';
export const ME_ID = 3;

const json = (status, value) => ({
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify(value),
});
const error = (status, message) => json(status, { error: message, error_human: message });

export class FakeZammad {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.online = true;
    this.token = TOKEN;
    this.me = fixture('real-users-me');
    this.states = fixture('real-ticket-states');
    this.groups = fixture('real-groups');
    /** Every ticket, expanded, by id. */
    this.tickets = new Map(fixture('real-search-created').map((ticket) => [ticket.id, ticket]));
    this.template = fixture('real-ticket-created');
    /** `{ method, path, body }` of every request. */
    this.requests = [];
    /** Answer every request with this, when set: `{ status, body }`. */
    this.override = null;
  }

  /** Add a ticket as Zammad would store it. */
  addTicket({
    title,
    group = 'Users',
    state = 'new',
    priority = '2 normal',
    ownerId = 1,
    ...more
  }) {
    const id = Math.max(...this.tickets.keys()) + 1;
    const groupRow = this.groups.find((row) => row.name === group);
    const stateRow = this.states.find((row) => row.name === state);
    const ticket = {
      ...this.template,
      id,
      number: String(20000 + id),
      title,
      group_id: groupRow.id,
      group,
      state_id: stateRow.id,
      state,
      priority_id: Number(priority[0]),
      priority,
      owner_id: ownerId,
      owner: ownerId === 1 ? '-' : 'admin@example.org',
      customer: 'claire@example.org',
      created_at: new Date(this.now()).toISOString(),
      updated_at: new Date(this.now()).toISOString(),
      escalation_at: null,
      ...more,
    };
    this.tickets.set(id, ticket);
    return ticket;
  }

  matches(ticket, condition = {}) {
    for (const [field, rule] of Object.entries(condition)) {
      if (field === 'ticket.state_id' && rule.operator === 'is') {
        if (!rule.value.map(Number).includes(ticket.state_id)) {
          return false;
        }
      } else if (field === 'ticket.created_at' && rule.operator === 'after (absolute)') {
        if (!(Date.parse(ticket.created_at) > Date.parse(rule.value))) {
          return false;
        }
      } else if (field === 'ticket.escalation_at' && rule.operator === 'before (absolute)') {
        if (!(ticket.escalation_at && Date.parse(ticket.escalation_at) < Date.parse(rule.value))) {
          return false;
        }
      } else {
        throw new Error(`fake Zammad: condition ${field} ${rule.operator} not supported`);
      }
    }
    return true;
  }

  handle(url, { method = 'GET', headers = {}, json: body } = {}) {
    const { pathname, searchParams } = new URL(url);
    this.requests.push({ method, path: pathname, body });
    if (this.override) {
      return this.override;
    }
    if (!pathname.startsWith('/api/v1/')) {
      return { status: 200, headers: { 'content-type': 'text/html' }, body: '<!DOCTYPE html>' };
    }
    if (headers.authorization !== `Token token=${this.token}`) {
      return error(401, "Can't find User for Token");
    }
    const route = `${method} ${pathname.slice('/api/v1'.length)}`;
    switch (route) {
      case 'GET /users/me':
        return json(200, this.me);
      case 'GET /ticket_states':
        // The names of the types come with `expand` only, as on the real server.
        return json(
          200,
          searchParams.get('expand') === 'true'
            ? this.states
            : this.states.map((state) =>
                Object.fromEntries(Object.entries(state).filter(([key]) => key !== 'state_type')),
              ),
        );
      case 'GET /groups':
        return json(200, this.groups);
      case 'POST /tickets/search': {
        const perPage = Math.min(Number(body.per_page ?? 100), 1000);
        const page = Number(body.page ?? 1);
        const found = [...this.tickets.values()]
          .filter((ticket) => this.matches(ticket, body.condition))
          .sort((a, b) => {
            const key = (ticket) =>
              body.sort_by === 'escalation_at' ? Date.parse(ticket.escalation_at) : ticket.id;
            return body.order_by === 'desc' ? key(b) - key(a) : key(a) - key(b);
          });
        return json(200, found.slice((page - 1) * perPage, page * perPage));
      }
      case 'POST /tickets': {
        if (!this.groups.some((row) => row.name === body.group)) {
          return error(422, `No lookup value found for 'group': "${body.group}"`);
        }
        if (body.priority && !['1 low', '2 normal', '3 high'].includes(body.priority)) {
          return error(422, `No lookup value found for 'priority': "${body.priority}"`);
        }
        const ticket = this.addTicket({
          title: body.title,
          group: body.group,
          priority: body.priority || '2 normal',
        });
        this.lastCreated = { body, ticket };
        // The creation answers the ticket without the names `expand` adds.
        const expanded = ['group', 'state', 'priority', 'owner', 'customer'];
        return json(
          201,
          Object.fromEntries(Object.entries(ticket).filter(([key]) => !expanded.includes(key))),
        );
      }
      default:
        return error(404, "This page doesn't exist.");
    }
  }
}

export function createNetwork(servers) {
  return {
    servers,
    async request(url, options = {}) {
      const base = Object.keys(servers).find((origin) => url.startsWith(`${origin}/`));
      const server = base ? servers[base] : null;
      if (!server || !server.online) {
        const err = new Error('connect ECONNREFUSED');
        err.code = 'ECONNREFUSED';
        throw err;
      }
      return server.handle(url, options);
    },
  };
}
