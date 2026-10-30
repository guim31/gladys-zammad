// -----------------------------------------------------------------------------
// The hub against the fake Zammad built from real answers: counters of the
// instance and of the groups, the scene events (new ticket, escalation) with
// their persistence across a restart, the "Create a Zammad ticket" scene
// action, the connection status, and the reading after a device is added.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_CONFIG,
  ME_ID,
  createAll,
  createClock,
  createWorld,
  group,
  instance,
} from './helpers/world.js';

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const counters = (w, ids, keys) =>
  Object.fromEntries(keys.map((key) => [key, w.fake.lastState(ids.feature(key))]));

const ALL = ['open', 'new', 'pending', 'escalated', 'unassigned', 'mine', 'created_today'];
const GROUP = ALL.filter((key) => key !== 'mine');

test('the counters of the instance and of each followed group', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, groups: 'Users, hardware, Sales' } });
  await createAll(w);
  assert.deepEqual(
    w.fake.discoveredDevices.map((device) => device.name),
    ['Zammad', 'Zammad Users', 'Zammad Hardware'],
  );
  assert.deepEqual(counters(w, instance(w.gladys), ALL), {
    open: 5,
    new: 3,
    pending: 1,
    escalated: 2,
    unassigned: 4,
    mine: 1,
    // The closed ticket was created today too.
    created_today: 6,
  });
  assert.deepEqual(counters(w, group(w.gladys, '1'), GROUP), {
    open: 3,
    new: 2,
    pending: 1,
    escalated: 0,
    unassigned: 3,
    created_today: 4,
  });
  assert.deepEqual(counters(w, group(w.gladys, '2'), GROUP), {
    open: 2,
    new: 1,
    pending: 0,
    escalated: 2,
    unassigned: 1,
    created_today: 2,
  });
  assert.deepEqual(w.hub.unknownGroups, ['Sales']);
  assert.equal(w.hub.me.id, ME_ID);
  assert.equal(w.fake.connectionStatus.connected, true);
});

test('the searches use the condition of the active states, paged', async (t) => {
  const w = await world(t);
  const searches = w.server.requests.filter((r) => r.path === '/api/v1/tickets/search');
  assert.deepEqual(searches[0].body.condition, {
    'ticket.state_id': { operator: 'is', value: ['1', '2', '3', '6'] },
  });
  assert.deepEqual(searches[1].body.condition, {
    'ticket.state_id': { operator: 'is', value: ['1', '2', '3', '6'] },
    'ticket.escalation_at': { operator: 'before (absolute)', value: '2026-10-30T12:13:30.000Z' },
  });
  assert.deepEqual([searches[1].body.sort_by, searches[1].body.order_by], ['escalation_at', 'asc']);
  assert.deepEqual(searches[2].body.condition, {
    'ticket.created_at': { operator: 'after (absolute)', value: '2026-10-29T23:00:00.000Z' },
  });
  assert.equal(searches[0].body.expand, true);
  // 150 more open tickets: two pages, every ticket counted.
  for (let i = 0; i < 150; i += 1) {
    w.server.addTicket({ title: `Ticket ${i}` });
  }
  await w.hub.poll();
  assert.equal(w.fake.lastState(instance(w.gladys).feature('open')), 155);
});

test('no event for what exists at the first reading, then one per new ticket', async (t) => {
  const w = await world(t);
  assert.deepEqual(w.fake.sceneEvents, []);
  w.clock.advance(10_000);
  w.server.addTicket({ title: 'Imprimante bloquée', group: 'Hardware', priority: '3 high' });
  // Created and closed between two readings: still a new ticket.
  w.server.addTicket({ title: 'Vite réglé', state: 'closed' });
  await w.hub.poll();
  assert.deepEqual(
    w.fake.sceneEvents.map((event) => event.key),
    ['ticket_created', 'ticket_created'],
  );
  assert.deepEqual(w.fake.sceneEvents[0].data, {
    ticket_id: '7',
    number: '20007',
    title: 'Imprimante bloquée',
    group: 'Hardware',
    priority: '3 high',
    state: 'new',
    customer: 'claire@example.org',
    url: 'http://192.0.2.30:8080/#ticket/zoom/7',
  });
  await w.hub.poll();
  assert.equal(w.fake.sceneEvents.length, 2, 'never twice');
});

test('an escalation fires once, on time, and not again after a restart', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  clock.advance(60_000); // 12:14:30: 20006 escalated at 12:14:09
  await w.hub.poll();
  assert.deepEqual(
    w.fake.sceneEvents.map((event) => [event.key, event.data.number, event.data.escalation_at]),
    [['ticket_escalated', '20006', '2026-10-30T12:14:09.866Z']],
  );
  assert.equal(w.fake.lastState(instance(w.gladys).feature('escalated')), 3);
  await w.hub.poll();
  assert.equal(w.fake.sceneEvents.length, 1);

  await w.app.stop();
  const again = await world(t, { clock, server: w.server, dataDir: w.dataDir });
  clock.advance(60_000);
  w.server.addTicket({ title: 'Pendant le redémarrage' });
  await again.hub.poll();
  assert.deepEqual(
    again.fake.sceneEvents.map((event) => [event.key, event.data.title]),
    [['ticket_created', 'Pendant le redémarrage']],
  );
});

test('an SLA time moved by an answer escalates again; a pending ticket never', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  const ticket = w.server.tickets.get(2);
  ticket.escalation_at = new Date(clock.time + 60_000).toISOString();
  const pending = w.server.tickets.get(3);
  pending.escalation_at = new Date(clock.time - 60_000).toISOString();
  await w.hub.poll();
  clock.advance(120_000);
  await w.hub.poll();
  assert.deepEqual(
    w.fake.sceneEvents.map((event) => event.data.number),
    // In the order of their escalation times: 12:14:09.866, then 12:14:30.
    ['20006', '20002'],
  );
});

test('Gladys refusing an event: it is tried again at the next reading', async (t) => {
  const w = await world(t);
  const original = w.gladys.publishSceneEvent.bind(w.gladys);
  let refuse = true;
  t.mock.method(w.gladys, 'publishSceneEvent', async (...args) => {
    if (refuse) {
      throw new Error('HTTP 503');
    }
    return original(...args);
  });
  w.server.addTicket({ title: 'Réessayé' });
  await w.hub.poll();
  assert.deepEqual(w.fake.sceneEvents, []);
  refuse = false;
  await w.hub.poll();
  assert.deepEqual(
    w.fake.sceneEvents.map((event) => event.data.title),
    ['Réessayé'],
  );
});

test('the counters of the day start again at local midnight', async (t) => {
  const clock = createClock(Date.UTC(2026, 9, 30, 22, 59, 0));
  const w = await world(t, { clock });
  assert.equal(w.fake.lastState(instance(w.gladys).feature('created_today')), 6);
  clock.advance(2 * 60_000);
  await w.hub.poll();
  assert.equal(w.fake.lastState(instance(w.gladys).feature('created_today')), 0);
  assert.equal(w.fake.lastState(instance(w.gladys).feature('open')), 5);
});

test('create_ticket: in a group, as the token user by default', async (t) => {
  const w = await world(t);
  const ack = await w.fake.sceneAction('create_ticket', {
    title: 'Fuite détectée',
    group: 'hardware',
    text: 'Le capteur de la salle serveur a détecté de l’eau.',
    priority: '3 high',
  });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs ?? ack.data, {
    ticket_id: '7',
    number: '20007',
    title: 'Fuite détectée',
    group: 'Hardware',
    url: 'http://192.0.2.30:8080/#ticket/zoom/7',
  });
  const { body } = w.server.lastCreated;
  assert.equal(body.group, 'Hardware');
  assert.equal(body.customer_id, ME_ID);
  assert.equal(body.priority, '3 high');
  assert.equal(body.article.body, 'Le capteur de la salle serveur a détecté de l’eau.');
  assert.equal(body.article.internal, false);
});

test('create_ticket: defaults, customer by e-mail, and the errors in words', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, groups: 'Hardware', language: 'fr' } });
  let ack = await w.fake.sceneAction('create_ticket', {
    title: 'Plus de papier',
    customer: 'claire@example.org',
  });
  assert.equal(ack.success, true, ack.error);
  const { body } = w.server.lastCreated;
  assert.equal(body.group, 'Hardware', 'the first followed group');
  assert.equal(body.customer_id, 'guess:claire@example.org');
  assert.equal(body.article.body, 'Plus de papier', 'the title as text');
  assert.equal(body.priority, undefined);

  ack = await w.fake.sceneAction('create_ticket', { title: '  ' });
  assert.equal(ack.error, 'Indiquez le titre du nouveau ticket.');
  ack = await w.fake.sceneAction('create_ticket', { title: 'x', group: 'Ventes' });
  assert.equal(ack.error, 'Aucun groupe Zammad de cet agent ne porte ce nom.');
  w.server.token = 'revoked';
  ack = await w.fake.sceneAction('create_ticket', { title: 'x' });
  assert.equal(ack.error, "Zammad : jeton d'accès refusé (erroné, expiré ou révoqué) (HTTP 401)");
});

test('a refused token, a wrong address, a server down: the status says why', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, token: 'wrong' } });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.deepEqual(Object.keys(w.fake.connectionStatus.message), ['en', 'fr', 'de', 'es']);
  assert.match(w.fake.connectionStatus.message.en, /access token refused/);

  const html = await world(t);
  html.server.override = { status: 200, headers: {}, body: '<html></html>' };
  await html.hub.poll();
  assert.match(html.fake.connectionStatus.message.en, /does not answer like Zammad/);
  assert.equal(html.fake.transports.at(-1).transport, 'unreachable');

  const empty = await world(t, { config: { url: 'not a url !', token: 'x' } });
  assert.match(empty.fake.connectionStatus.message.en, /Address not understood/);
  const noToken = await world(t, { config: { url: 'helpdesk.example.org' } });
  assert.match(noToken.fake.connectionStatus.message.en, /access token/);
});

test('a device added: every state is published again, the widget refreshed', async (t) => {
  const w = await world(t);
  const [device] = w.fake.discoveredDevices;
  const before = w.fake.states.length;
  const refreshes = w.fake.widgetRefreshes.length;
  await w.fake.deviceCreated(device);
  assert.equal(w.fake.states.length - before, 7);
  assert.deepEqual(w.fake.widgetRefreshes.slice(refreshes), ['open_tickets']);
});

test('test_connection reports the open and escalated tickets', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, groups: 'Sales' } });
  const ack = await w.fake.action('test_connection', {});
  assert.equal(ack.success, true, ack.error);
  const text = typeof ack.data === 'string' ? ack.data : JSON.stringify(ack.data);
  assert.match(
    text,
    /Zammad OK: 5 open ticket\(s\), 2 escalated\. Unknown group\(s\) ignored: Sales/,
  );
  w.server.online = false;
  const failed = await w.fake.action('test_connection', {});
  assert.equal(failed.success, false);
  assert.match(failed.error, /Zammad does not answer/);
});

test('a Zammad hosted by its makers is a cloud device', async (t) => {
  const w = await world(t);
  w.hub.config = { ...w.hub.config, url: 'https://acme.zammad.com' };
  assert.equal(w.hub.transport(), 'cloud');
  w.hub.config = { ...w.hub.config, url: 'https://helpdesk.example.org' };
  assert.equal(w.hub.transport(), 'local');
});

test('beyond 1000 open tickets, the escalated ones are still counted and announced', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  for (let i = 0; i < 1100; i += 1) {
    w.server.addTicket({ title: `Ticket ${i}` });
  }
  clock.advance(60_000); // 20006 escalates
  await w.hub.poll();
  assert.equal(w.fake.lastState(instance(w.gladys).feature('escalated')), 3);
  assert.ok(
    w.fake.sceneEvents.some(
      (event) => event.key === 'ticket_escalated' && event.data.number === '20006',
    ),
  );
});

test('an escalated ticket missing from one reading does not fire twice', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  clock.advance(60_000);
  await w.hub.poll();
  assert.equal(w.fake.sceneEvents.length, 1);
  // Pending for a while (Zammad clears escalation_at), then open again with
  // the same escalation time: no new event.
  const ticket = w.server.tickets.get(6);
  const { escalation_at: at } = ticket;
  Object.assign(ticket, { state_id: 3, escalation_at: null });
  clock.advance(60_000);
  await w.hub.poll();
  Object.assign(ticket, { state_id: 1, escalation_at: at });
  clock.advance(60_000);
  await w.hub.poll();
  assert.equal(w.fake.sceneEvents.length, 1);
});

test('a reading slower than an escalation wakes up soon, not after the interval', async (t) => {
  const clock = createClock(Date.UTC(2026, 9, 30, 12, 14, 9));
  const w = await world(t, { clock, config: { ...BASE_CONFIG, poll_interval: '600' } });
  // The reading started at 12:14:09, 20006 escalates at 12:14:09.866, it is now 12:14:15.
  clock.advance(6_000);
  assert.equal(w.hub.nextDelay(Date.UTC(2026, 9, 30, 12, 14, 9)), 10_000);
});
