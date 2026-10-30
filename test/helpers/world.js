// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake Zammad on a fake
// network, a temporary /data, a manual clock and the Paris time zone, with
// the integration wired on top through registerHandlers. No timer runs unless
// `timers: true` (with node:test mock timers): the tests read Zammad with
// `world.hub.poll()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { FakeZammad, ME_ID, TOKEN, createNetwork } from './fakeZammad.js';

// The integration logs its lifecycle; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const URL_1 = 'http://192.0.2.30:8080';
export const TIME_ZONE = 'Europe/Paris';
// The fixtures were captured on 30/10/2026 at 12:14:23 UTC. The tests start
// at 12:13:30 UTC: tickets 20002 and 20004 are escalated (since 12:13:03 and
// 12:13:04), 20006 escalates at 12:14:09. Local midnight was 23:00 UTC.
export const START = Date.UTC(2026, 9, 30, 12, 13, 30);

export function createClock(start = START) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export const BASE_CONFIG = { url: URL_1, token: TOKEN, language: 'en' };

/**
 * @param {object} [options]
 * @param {FakeZammad} [options.server]
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 */
export async function createWorld({
  clock = createClock(),
  server,
  config = BASE_CONFIG,
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-zammad-')),
  timings = {},
  timers = false,
} = {}) {
  const zammad = server ?? new FakeZammad({ now: clock.now });
  const network = createNetwork({ [URL_1]: zammad });
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: network.request,
    timers,
    timings,
    now: clock.now,
    timeZone: TIME_ZONE,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, server: zammad, app, hub: app.hub, clock, dataDir };
}

export const instance = (gladys) => gladys.externalIds('zammad', 'instance');
export const group = (gladys, id) => gladys.externalIds('zammad', `group-${id}`);

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
}

export { FakeZammad, ME_ID, TOKEN };
