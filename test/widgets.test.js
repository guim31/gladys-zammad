// -----------------------------------------------------------------------------
// The "open tickets" widget: content within the core budget (validated by the
// SDK's validateWidgetContent), the instance and one-group views, the setting
// that hides the counters, and the degraded states.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { BASE_CONFIG, createWorld, group, instance } from './helpers/world.js';

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

async function content(w, settings = {}, language = 'en') {
  const ack = await w.fake.widgetGet('open_tickets', { settings, language, units: 'metric' });
  assert.equal(ack.success, true, ack.error);
  const { content: tree } = ack.data;
  assert.deepEqual(validateWidgetContent(tree), [], 'within the core vocabulary and budget');
  return tree;
}

const ofType = (data, type) => data.components.filter((component) => component.type === type);

test('the whole instance: two tiles, the latest open tickets first', async (t) => {
  const w = await world(t);
  const data = await content(w);
  assert.deepEqual(
    ofType(data, 'value').map((tile) => [tile.label, tile.value, tile.color]),
    [
      ['Open', 5, undefined],
      ['Escalated', 2, 'danger'],
    ],
  );
  assert.deepEqual(
    ofType(data, 'status')[0].items.map((row) => [row.label, row.value, row.color]),
    [
      ['#20006 Fuite sous l évier', 'New · Users', 'warning'],
      ['#20004 Écran qui clignote', 'Escalated · Hardware', 'danger'],
      ['#20003 Mot de passe oublié', 'Pending · Users', 'neutral'],
      ['#20002 Imprimante en panne', 'Escalated · Hardware', 'danger'],
      ['#20001 Help me! I am an example ticket…', 'New · Users', 'warning'],
    ],
  );
});

test('one group, counters hidden, in French; ten rows at most', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, groups: 'Users' } });
  for (let i = 0; i < 12; i += 1) {
    w.server.addTicket({ title: `Demande ${i}`, group: i % 2 ? 'Users' : 'Hardware' });
  }
  await w.hub.poll();
  const data = await content(
    w,
    { device: group(w.gladys, '1').device, show_counters: false },
    'fr',
  );
  assert.deepEqual(ofType(data, 'value'), []);
  const rows = ofType(data, 'status')[0].items;
  assert.equal(rows.length, 9, 'the 6 new and 3 old tickets of Users');
  assert.deepEqual(rows[0], {
    label: '#20018 Demande 11',
    icon: 'inbox',
    value: 'Nouveau',
    color: 'warning',
  });

  const all = await content(w, { device: instance(w.gladys).device });
  assert.equal(ofType(all, 'status')[0].items.length, 10);
  assert.equal(ofType(all, 'value')[0].value, 17);
});

test('nothing open, a group no longer followed, not configured, Zammad down', async (t) => {
  const w = await world(t);
  for (const ticket of w.server.tickets.values()) {
    ticket.state_id = 4;
  }
  await w.hub.poll();
  const empty = await content(w);
  assert.equal(ofType(empty, 'text')[0].text, 'No open ticket.');

  const gone = await content(w, { device: group(w.gladys, '9').device });
  assert.match(gone.components[0].text, /no longer followed/);

  const bare = await world(t, { config: {} });
  assert.match((await content(bare)).components[0].text, /Enter the address of your Zammad/);

  const down = await world(t);
  down.server.online = false;
  await down.hub.poll();
  const stale = await content(down, {}, 'de');
  assert.equal(stale.components[0].text, 'Zammad antwortet nicht: zuletzt bekannte Tickets.');
  assert.equal(ofType(stale, 'status')[0].items.length, 5);
});

test('the widget is refreshed when the tickets change, not at every reading', async (t) => {
  const w = await world(t);
  // The fake's list is a copy: count from here.
  const start = w.fake.widgetRefreshes.length;
  await w.hub.poll();
  assert.equal(w.fake.widgetRefreshes.length, start);
  w.server.addTicket({ title: 'Nouveau' });
  await w.hub.poll();
  assert.deepEqual(w.fake.widgetRefreshes.slice(start), ['open_tickets']);
  await w.fake.deviceUpdated({ ...w.fake.discoveredDevices[0], name: 'Support' });
  assert.equal(w.fake.widgetRefreshes.length, start + 2);
});
