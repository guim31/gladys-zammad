# Zammad for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) external integration for the
[Zammad](https://zammad.org) helpdesk: ticket counters in Gladys, scene
triggers on new and escalated tickets, a scene action that opens a ticket,
and a dashboard widget with the latest open tickets.

Install it in Gladys: **Integrations** → **Install from GitHub** →
`https://github.com/guim31/gladys-zammad`. The user documentation is in
[`docs/en.md`](docs/en.md) (also in [French](docs/fr.md),
[German](docs/de.md) and [Spanish](docs/es.md)).

> **Feedback welcome.** Tested against a real Zammad server in Docker, not yet
> in everyday use: please report what does not work in the
> [issues](https://github.com/guim31/gladys-zammad/issues).

## Features

- **Devices**: one for the instance (open, new, pending, escalated,
  unassigned tickets, tickets assigned to me, tickets created today), and one
  per followed group (the same counters, without "assigned to me").
- **Scene triggers**: `ticket_created` (a new ticket, filtered by group and
  priority) and `ticket_escalated` (an open ticket past its SLA escalation
  time, once per escalation time).
- **Scene action**: `create_ticket` (title, group, text, priority, customer
  e-mail), returning the ticket id, number and address.
- **Widget**: `open_tickets`, the 10 latest open tickets (escalated in red)
  with the open and escalated counts, for the instance or one group.
- A "Test the connection" button, a connection status naming the problem,
  and every text in English, French, German and Spanish.

## Requirements

- Gladys Assistant 5.1.0 or later.
- Zammad 7.x, self-hosted or hosted by Zammad, reachable from Gladys
  (Elasticsearch not needed).
- A personal access token of an agent, with the `ticket.agent` permission
  (Profile → Token Access).

## Installation

1. **Integrations** → **Install from GitHub** →
   `https://github.com/guim31/gladys-zammad`.
2. In **Configuration**, give the address of Zammad and the access token, and
   optionally the groups to follow.
3. **Test the connection**, then add the devices in **Discovery**.

## How it works

The container reads Zammad on its own timer (1 to 10 minutes, 2 by default),
and also wakes up at the next escalation time and at local midnight. Each
reading calls `GET /api/v1/users/me`, `/ticket_states`, `/groups`, and three
`POST /api/v1/tickets/search` with a `condition` (the selector of the Zammad
overviews, which works without Elasticsearch): the open tickets, the
escalated ones, and the tickets created since midnight. Counters are published only when they change
(and every 12 h), devices with `should_poll: false`.

New tickets are those above the highest ticket id already seen; escalations
are remembered by ticket and escalation time. Both are kept in
`/data/zammad-state.json`, so a restart neither repeats an event nor loses one
(within the hour).

## Checked on a real Zammad, and what was not

Checked against `ghcr.io/zammad/zammad` 7.2.2 with PostgreSQL 17, Redis and
memcached in a Docker network, without Elasticsearch: an administrator agent
and its access token, two groups, a 24/7 calendar and an SLA, tickets in every
active state (new, open, pending reminder), one closed, one assigned, three
escalated, created through the API; the error answers (wrong token, unknown
group, unknown route, the web page outside `/api`). The real answers are in
`test/fixtures/zammad/` and drive the tests. The integration ran in its own
container under the Gladys sandbox limits (read-only root, no capabilities,
256 MB) against that server and the SDK's fake Gladys.

Not checked: a real Gladys instance, a Zammad hosted by Zammad
(`*.zammad.com`), Zammad with Elasticsearch, Zammad behind a reverse proxy
with a path prefix.

## Limitations

- Reads only, apart from creating tickets: no answer, assignment or closing.
- A new ticket triggers its scene at the next reading (no Zammad webhook).
- 1000 tickets at most per search (the oldest open ones are left out; the
  escalated ones are read apart).
- The priority filter of the triggers offers the default priorities of
  Zammad.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`)
and an in-memory Zammad (`test/helpers/fakeZammad.js`) built from real
answers. See [`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- [Zammad](https://github.com/zammad/zammad) by the Zammad Foundation and its
  contributors (AGPL-3.0): the integration only talks to its REST API; no
  code was copied. The cover uses the Zammad logo from the Zammad repository
  (`public/assets/images/logo.svg`), to name the service.
- The test server followed
  [zammad-docker-compose](https://github.com/zammad/zammad-docker-compose).
- The architecture and the conformity tests follow
  [gladys-planka](https://github.com/guim31/gladys-planka) and
  [gladys-wled](https://github.com/guim31/gladys-wled).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by Zammad GmbH or
the Zammad Foundation. The Zammad name and logo belong to their owners.

## License

Apache-2.0
