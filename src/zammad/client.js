// -----------------------------------------------------------------------------
// Zammad REST API client: the calls the integration needs, on `/api/v1`.
// Checked against a real ghcr.io/zammad/zammad 7.2.2 (PostgreSQL, Redis,
// memcached, no Elasticsearch) in Docker, October 2026.
//
// Authentication: a personal access token (Profile → Token Access, permission
// "Agent tickets"), sent as `Authorization: Token token=…`.
//
//   GET  /api/v1/users/me          the token's user (its id: "assigned to me")
//   GET  /api/v1/ticket_states     every state, with its state_type_id
//   GET  /api/v1/groups            the groups the agent sees
//   POST /api/v1/tickets/search    { condition, expand, sort_by, order_by, per_page, page }
//   POST /api/v1/tickets           create a ticket with its first article
//
// Pitfalls found on the real server:
//   - `tickets/search` with a `condition` (the selector of the overviews)
//     works without Elasticsearch, and so does the search with one; a
//     `query` such as `state.name:new` needs Elasticsearch (empty answer
//     without it). The condition is the portable way.
//   - Paging is `per_page` + `page` (1000 per page at most); `offset` is
//     ignored. `expand: true` returns an array of tickets with the names of
//     their group, state, priority and owner beside the ids.
//   - The unassigned owner is the system user, id 1, name "-".
//   - An error answers JSON `{ error, error_human }`: 401 for a bad token,
//     422 for an unknown group on creation, 404 for an unknown route.
// -----------------------------------------------------------------------------

import { httpRequest } from './http.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: down, wrong address, firewall
  TLS: 'tls', // the certificate does not verify (self-signed without the option)
  AUTH: 'auth', // wrong or revoked token
  FORBIDDEN: 'forbidden', // the token lacks the "Agent tickets" permission
  NOT_FOUND: 'not_found', // the ticket or route is gone
  INVALID: 'invalid', // 422: Zammad refused a value (unknown group, customer…)
  NOT_ZAMMAD: 'not_zammad', // something answers, but not the Zammad API
  REDIRECT: 'redirect', // HTTP redirected to HTTPS, or a login portal
  RATE_LIMIT: 'rate_limit', // 429: a reverse proxy's request limit
  HTTP: 'http', // any other unexpected answer
});

export class ZammadError extends Error {
  constructor(kind, message, status) {
    super(message);
    this.name = 'ZammadError';
    this.kind = kind;
    this.status = status;
  }
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

function networkError(err) {
  if (TLS_CODES.has(err.code)) {
    return new ZammadError(ERROR_KINDS.TLS, `Certificate refused (${err.code})`);
  }
  return new ZammadError(ERROR_KINDS.UNREACHABLE, err.code ? `${err.code}` : err.message);
}

// Tickets read per page, and pages per search: 1000 tickets at most.
export const PER_PAGE = 100;
export const MAX_PAGES = 10;

export class ZammadClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL, without trailing slash
   * @param {string} options.token personal access token
   * @param {boolean} [options.insecure] accept a self-signed certificate
   * @param {Function} [options.request] HTTP seam (src/zammad/http.js)
   */
  constructor({ url, token, insecure = false, request }) {
    this.url = url;
    this.token = token;
    this.insecure = insecure;
    this.request = request ?? httpRequest;
  }

  async call(path, { method = 'GET', json } = {}) {
    let response;
    try {
      response = await this.request(`${this.url}/api/v1${path}`, {
        method,
        json,
        insecure: this.insecure,
        headers: { authorization: `Token token=${this.token}` },
      });
    } catch (err) {
      throw networkError(err);
    }
    const { status, body } = response;
    let parsed;
    let parsedOk = true;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsedOk = false;
    }
    // The server's own message, short; it never echoes the token.
    const said =
      parsedOk && typeof parsed?.error === 'string' ? ` ${parsed.error.slice(0, 200)}` : '';
    if (status === 429) {
      throw new ZammadError(ERROR_KINDS.RATE_LIMIT, 'HTTP 429', status);
    }
    if (status >= 300 && status < 400) {
      throw new ZammadError(ERROR_KINDS.REDIRECT, `HTTP ${status}`, status);
    }
    if (!parsedOk) {
      // A web server, a reverse proxy page or another application.
      throw new ZammadError(
        status === 200 || status === 404 ? ERROR_KINDS.NOT_ZAMMAD : ERROR_KINDS.HTTP,
        `HTTP ${status}, not JSON`,
        status,
      );
    }
    if (status === 401) {
      throw new ZammadError(ERROR_KINDS.AUTH, `HTTP 401${said}`, status);
    }
    if (status === 403) {
      throw new ZammadError(ERROR_KINDS.FORBIDDEN, `HTTP 403${said}`, status);
    }
    if (status === 404) {
      throw new ZammadError(ERROR_KINDS.NOT_FOUND, `HTTP 404${said}`, status);
    }
    if (status === 422) {
      throw new ZammadError(ERROR_KINDS.INVALID, `HTTP 422${said}`, status);
    }
    if (status < 200 || status >= 300) {
      throw new ZammadError(ERROR_KINDS.HTTP, `HTTP ${status}${said}`, status);
    }
    return parsed;
  }

  /** The token's user; also the probe that this is Zammad. */
  async me() {
    let data;
    try {
      data = await this.call('/users/me');
    } catch (err) {
      // Another JSON API, or a path prefix missing from the address.
      if (err instanceof ZammadError && err.kind === ERROR_KINDS.NOT_FOUND) {
        throw new ZammadError(ERROR_KINDS.NOT_ZAMMAD, 'no /api/v1/users/me', 404);
      }
      throw err;
    }
    if (!data || !Number.isInteger(data.id)) {
      throw new ZammadError(ERROR_KINDS.NOT_ZAMMAD, 'no user in /users/me', 200);
    }
    return data;
  }

  async list(path) {
    const data = await this.call(path);
    if (!Array.isArray(data)) {
      throw new ZammadError(ERROR_KINDS.NOT_ZAMMAD, `no list in ${path}`, 200);
    }
    return data;
  }

  ticketStates() {
    return this.list('/ticket_states');
  }

  groups() {
    return this.list('/groups');
  }

  /**
   * Every ticket matching a condition, newest first, page after page: beyond
   * the last page, the oldest ones are left out, never a new ticket.
   * @returns {Promise<{ tickets: object[], truncated: boolean }>}
   */
  async searchTickets(condition) {
    const tickets = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const data = await this.call('/tickets/search', {
        method: 'POST',
        json: {
          condition,
          expand: true,
          sort_by: 'id',
          order_by: 'desc',
          per_page: PER_PAGE,
          page,
        },
      });
      if (!Array.isArray(data)) {
        throw new ZammadError(ERROR_KINDS.NOT_ZAMMAD, 'no list in /tickets/search', 200);
      }
      tickets.push(...data);
      if (data.length < PER_PAGE) {
        return { tickets, truncated: false };
      }
    }
    return { tickets, truncated: true };
  }

  /**
   * Create a ticket with its first article (a note visible to the customer).
   * `customer`: a user id, or `guess:<e-mail>` (found, or created by Zammad).
   */
  async createTicket({ title, group, customer, body, priority }) {
    const json = {
      title,
      group,
      customer_id: customer,
      article: { subject: title, body, type: 'note', internal: false, content_type: 'text/plain' },
    };
    if (priority) {
      json.priority = priority;
    }
    const data = await this.call('/tickets', { method: 'POST', json });
    if (!data || !Number.isInteger(data.id)) {
      throw new ZammadError(ERROR_KINDS.NOT_ZAMMAD, 'no ticket in the answer', 200);
    }
    return data;
  }
}
