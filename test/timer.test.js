// -----------------------------------------------------------------------------
// The reading timer of the container. Gladys never polls a device published
// with should_poll: false (nor one created without should_poll,
// GladysAssistant/Gladys#3198): Zammad must be read by the hub's own timer,
// with no onPoll at all — and on time for an escalation between two readings.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_CONFIG, createAll, createClock, createWorld, instance } from './helpers/world.js';

const settle = async () => {
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

const reads = (server) => server.requests.filter((r) => r.path === '/api/v1/users/me').length;

test('the internal timer reads Zammad without any onPoll from Gladys', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // 12:20 UTC: no escalation ahead, the interval rules.
  const clock = createClock(Date.UTC(2026, 9, 30, 12, 20));
  const w = await createWorld({
    clock,
    config: { ...BASE_CONFIG, poll_interval: '300' },
    timers: true,
  });
  t.after(() => w.app.stop());
  const polled = t.mock.method(w.hub, 'poll');
  await createAll(w);
  assert.equal(w.fake.discoveredDevices[0].should_poll, false, 'Gladys is not asked to poll');

  const before = reads(w.server);
  for (let i = 0; i < 3; i += 1) {
    clock.advance(300_000);
    t.mock.timers.tick(300_000);
    await settle();
  }
  assert.equal(reads(w.server) - before, 3, 'one reading per interval');
  assert.ok(polled.mock.callCount() >= 3);
});

test('the timer wakes up at an escalation time shorter than the interval', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = createClock(); // 12:13:30, 20006 escalates at 12:14:09.866
  const w = await createWorld({
    clock,
    config: { ...BASE_CONFIG, poll_interval: '600' },
    timers: true,
  });
  t.after(() => w.app.stop());
  const escalated = instance(w.gladys).feature('escalated');
  assert.equal(w.fake.lastState(escalated), 2);
  clock.advance(42_000);
  t.mock.timers.tick(42_000);
  await settle();
  assert.equal(w.fake.lastState(escalated), 3, 'read 42 s later, not ten minutes');
  assert.deepEqual(
    w.fake.sceneEvents.map((event) => event.key),
    ['ticket_escalated'],
  );
});

test('the timer stops with the integration', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = await createWorld({ timers: true });
  await w.app.stop();
  const before = w.server.requests.length;
  t.mock.timers.tick(60 * 60_000);
  await settle();
  assert.equal(w.server.requests.length, before);
});
