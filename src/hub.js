// -----------------------------------------------------------------------------
// The Zammad hub: reads the instance on a timer of the container, publishes
// the counters of the instance and of every followed group when they change,
// fires the scene events (a new ticket, a ticket past its escalation time),
// and creates tickets for the scene action.
//
// Gladys never polls these devices (should_poll: false): the interval goes up
// to 10 minutes, beyond the fixed list of the core scheduler, and the scene
// events must fire even when no device was added. The timer also wakes up at
// the next escalation time and at local midnight, so the events and the
// counters move on time whatever the interval.
// (Architecture adapted from guim31/gladys-planka.)
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { hostOf } from './config.js';
import { buildDevice, featureStates, groupIds, instanceIds } from './devices.js';
import { ERROR_KINDS, ZammadClient, ZammadError } from './zammad/client.js';
import {
  findByIdOrName,
  isEscalated,
  localDay,
  nextEscalation,
  parseGroups,
  parseStates,
  parseTicket,
  resolveTimeZone,
  summarize,
} from './zammad/model.js';
import {
  ACTION_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  REPORT_TEXT,
  UNKNOWN_GROUPS,
  allLanguages,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'zammad-hub' });

export const WIDGET_KEY = 'open_tickets';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  CREATED: 'ticket_created',
  ESCALATED: 'ticket_escalated',
});

export const HUB_TIMINGS = {
  // A failed read is tried again this soon, whatever the interval.
  retryMs: 30_000,
  // Read this long after an escalation time or midnight, so the server agrees.
  wakeSlackMs: 2_000,
  // Never read more often than this, even for escalations a second apart.
  minDelayMs: 10_000,
  // Re-send unchanged values this often: Gladys shows "no recent value" after 48 h.
  heartbeatMs: 12 * 60 * 60_000,
  // An event this late (Zammad or the integration was down) is dropped.
  maxLateMs: 60 * 60_000,
  // The "created since" search starts this much before the previous reading,
  // against a clock gap between Zammad and Gladys.
  overlapMs: 5 * 60_000,
};

// The reading after a command is awaited at most this long: the scene action
// answers within its 20 s.
const REFRESH_WAIT_MS = 3_000;
const MAX_TITLE = 250;
const MAX_BODY = 20_000;
// Escalations remembered (the key holds the time: a new SLA time fires again).
const MAX_REMEMBERED = 2_000;

const iso = (ms) => (ms === null || ms === undefined ? '' : new Date(ms).toISOString());
const maxId = (tickets) => tickets.reduce((max, ticket) => Math.max(max, Number(ticket.id)), 0);
const escalationKey = (ticket) => `${ticket.id}@${ticket.escalationAt}`;

export class ZammadHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/zammad/http.js)
   * @param {boolean} [options.timers] periodic timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   * @param {string} [options.timeZone] defaults to TZ, set by the Gladys supervisor
   */
  constructor({ gladys, store, request, timers = true, timings, now, timeZone }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.timeZone = resolveTimeZone(timeZone ?? process.env.TZ);
    this.config = null;
    this.client = null;
    this.reset();
    this.saved = { scope: null, readAt: 0, maxId: 0, escalated: [] };
    this.connection = null;
    this.devicesSignature = null;
    this.widgetSignature = null;
    this.transports = new Map();
    this.timer = null;
    this.polling = null;
    this.stopped = false;
    /** Problems already logged, by key: repeats go to debug. */
    this.warned = new Set();
  }

  reset() {
    /** The token's user: `{ id }`. */
    this.me = null;
    /** Every active group the agent sees, and the followed ones. */
    this.groups = [];
    this.followed = [];
    this.unknownGroups = [];
    /** Open tickets, and tickets created since the start of the search window. */
    this.open = [];
    this.created = [];
    this.error = null;
    this.downSince = null;
    this.readAt = 0;
    this.connectedLogged = false;
  }

  // --- Logs ------------------------------------------------------------------
  // Info keeps the lifecycle only (connected, lost, back, user commands). A
  // problem that repeats is logged once, then at debug until it clears.

  problem(key, message, err, level = 'warn') {
    const args = err === undefined ? [message] : [message, err];
    if (this.warned.has(key)) {
      logger.debug(...args);
      return;
    }
    this.warned.add(key);
    logger[level](...args);
  }

  resolved(key, message) {
    if (this.warned.delete(key) && message) {
      logger.info(message);
    }
  }

  get language() {
    return this.config?.language ?? 'en';
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    this.saved = {
      scope: typeof saved.scope === 'string' ? saved.scope : null,
      readAt: Number.isFinite(saved.readAt) ? saved.readAt : 0,
      maxId: Number.isFinite(saved.maxId) ? saved.maxId : 0,
      escalated: Array.isArray(saved.escalated) ? saved.escalated.filter(Boolean) : [],
    };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.connection = null;
    this.devicesSignature = null;
    this.transports.clear();
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    const same =
      previous &&
      previous.url === config.url &&
      previous.token === config.token &&
      previous.allowSelfSigned === config.allowSelfSigned;
    if (!same) {
      this.reset();
      this.client =
        config.url && config.token
          ? new ZammadClient({
              url: config.url,
              token: config.token,
              insecure: config.allowSelfSigned,
              request: this.request,
            })
          : null;
    }
    // A new language or group list: the devices are published again.
    this.devicesSignature = null;
    this.gladys.forgetPublishedStates?.();
    await this.poll();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.polling?.catch(() => {});
    await this.store.flush();
  }

  schedule(delay) {
    clearTimeout(this.timer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    this.timer = setTimeout(() => {
      this.poll().catch((err) => this.problem('poll', 'Reading failed', err, 'error'));
    }, delay);
  }

  /** The interval, shortened to the next escalation time or local midnight. */
  nextDelay(readAt = this.now()) {
    if (this.error) {
      return Math.min(this.config.pollIntervalMs, this.timings.retryMs);
    }
    const now = this.now();
    // `readAt`: a moment that passed during the reading is still ahead of it.
    const moments = [localDay(readAt, this.timeZone).end];
    const escalation = nextEscalation(this.open, readAt);
    if (escalation !== null) {
      moments.push(escalation);
    }
    const ahead = moments.filter((moment) => moment + this.timings.wakeSlackMs > now);
    const wake = ahead.length === 0 ? 0 : Math.min(...ahead) - now + this.timings.wakeSlackMs;
    return Math.max(this.timings.minDelayMs, Math.min(this.config.pollIntervalMs, wake));
  }

  // --- Reading ---------------------------------------------------------------

  /** One reading at a time: a call during a reading waits for it, then reads. */
  poll() {
    const run = async () => {
      const readAt = this.now();
      try {
        await this.read();
      } finally {
        this.schedule(this.nextDelay(readAt));
      }
    };
    this.polling = (this.polling ?? Promise.resolve()).catch(() => {}).then(run);
    return this.polling;
  }

  /** Start of the "created since" search: local midnight, or earlier to catch up. */
  createdSince(now) {
    const midnight = localDay(now, this.timeZone).start;
    if (this.saved.scope !== this.config.url || this.saved.readAt === 0) {
      return midnight;
    }
    const caughtUp = Math.max(this.saved.readAt, now - this.timings.maxLateMs);
    return Math.min(midnight, caughtUp - this.timings.overlapMs);
  }

  async read() {
    if (!this.client) {
      await this.publishConnectionStatus();
      return;
    }
    const now = this.now();
    const { client } = this;
    try {
      const me = await client.me();
      const states = parseStates(await client.ticketStates());
      const groups = parseGroups(await client.groups());
      if (states.size === 0) {
        throw new ZammadError(ERROR_KINDS.NOT_ZAMMAD, 'no active ticket state', 200);
      }
      const open = await client.searchTickets({
        'ticket.state_id': { operator: 'is', value: [...states.keys()].map(String) },
      });
      const created = await client.searchTickets({
        'ticket.created_at': { operator: 'after (absolute)', value: iso(this.createdSince(now)) },
      });
      if (client !== this.client) {
        // The configuration changed during the reading: these are the old
        // instance's tickets; the new one is being read.
        return;
      }
      if (open.truncated || created.truncated) {
        this.problem('truncated', 'More than 1000 tickets match: the counters stop at 1000');
      } else {
        this.resolved('truncated');
      }
      const parse = (list) =>
        list.map((raw) => parseTicket(raw, states)).filter((ticket) => ticket !== null);
      this.me = { id: me.id };
      this.groups = groups;
      this.followed = this.follow(groups);
      this.open = parse(open.tickets).filter((ticket) => ticket.kind !== null);
      this.created = parse(created.tickets);
      this.readAt = now;
      this.recovered(now);
    } catch (err) {
      if (client !== this.client) {
        return;
      }
      this.failed(err, now);
    }
    if (this.readAt !== 0) {
      await this.publishDevices();
      // The configuration may change while Gladys answers: never write the
      // old reading's events under the new one.
      if (!this.error && client === this.client) {
        await this.publishStates();
        if (client === this.client) {
          await this.fireEvents(now);
        }
      }
    }
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.refreshWidget();
  }

  /** The groups with a device: the configuration's list (names or ids). */
  follow(groups) {
    const unknown = [];
    const found = [];
    for (const query of this.config.groups) {
      const group = findByIdOrName(groups, query);
      if (!group) {
        unknown.push(query);
      } else if (!found.includes(group)) {
        found.push(group);
      }
    }
    if (unknown.join('|') !== this.unknownGroups.join('|')) {
      this.unknownGroups = unknown;
      if (unknown.length > 0) {
        logger.warn(UNKNOWN_GROUPS.en(unknown.join(', ')));
      }
    }
    return found;
  }

  recovered(now) {
    const host = hostOf(this.config.url);
    if (this.downSince !== null) {
      const minutes = Math.round((now - this.downSince) / 60_000);
      this.resolved('read', `Zammad at ${host} answers again after ${minutes} min`);
    }
    if (!this.connectedLogged) {
      this.connectedLogged = true;
      logger.info(
        `Connected to Zammad at ${host}: ${this.open.length} open ticket(s), ${this.followed.length} followed group(s)`,
      );
    }
    this.error = null;
    this.downSince = null;
  }

  failed(err, now) {
    const kind = err instanceof ZammadError ? err.kind : ERROR_KINDS.HTTP;
    this.error = { kind, message: err.message };
    this.downSince ??= now;
    this.problem(
      'read',
      `Zammad at ${hostOf(this.config.url)}: ${err.message}`,
      undefined,
      'error',
    );
  }

  /** The followed group of a device external id; null for the instance. */
  view(deviceExternalId) {
    if (!deviceExternalId || deviceExternalId === instanceIds(this.gladys).device) {
      return { group: null, unknown: false };
    }
    const group =
      this.followed.find((item) => groupIds(this.gladys, item.id).device === deviceExternalId) ??
      null;
    return { group, unknown: !group };
  }

  summary(group = null) {
    const now = this.now();
    const inGroup = (ticket) => !group || ticket.groupId === group.id;
    return summarize({
      open: this.open.filter(inGroup),
      created: this.created.filter(inGroup),
      now,
      day: localDay(now, this.timeZone),
      meId: this.me?.id ?? null,
    });
  }

  ticketUrl(ticket) {
    return `${this.config.url}/#ticket/zoom/${ticket.id}`;
  }

  // --- Publishing to Gladys --------------------------------------------------

  devices() {
    return [null, ...this.followed].map((group) => buildDevice(this.gladys, group, this.language));
  }

  async publishDevices() {
    const devices = this.devices();
    const signature = JSON.stringify(devices);
    if (signature === this.devicesSignature) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.devicesSignature = signature;
      this.resolved('devices');
    } catch (err) {
      this.problem('devices', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab. */
  async rediscover() {
    this.devicesSignature = null;
    await this.poll();
  }

  /** The user added a device: the states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    this.gladys.forgetPublishedStates?.(device?.external_id);
    if (!this.error && this.readAt !== 0) {
      await this.publishStates();
    }
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  states() {
    return [null, ...this.followed].flatMap((group) =>
      featureStates(this.gladys, group, this.summary(group)),
    );
  }

  async publishStates() {
    try {
      // Only the changes, and every value again after `heartbeatMs`.
      await this.gladys.publishChangedStates(this.states(), {
        heartbeat: this.timings.heartbeatMs,
      });
      this.resolved('states');
    } catch (err) {
      this.problem('states', `States refused: ${err.message}`);
    }
  }

  /** Zammad hosted by its makers is a cloud service; any other, local. */
  transport() {
    if (this.error) {
      return DEVICE_TRANSPORTS.UNREACHABLE;
    }
    const host = new URL(this.config.url).hostname;
    return /(^|\.)zammad\.com$/i.test(host) ? DEVICE_TRANSPORTS.CLOUD : DEVICE_TRANSPORTS.LOCAL;
  }

  async publishTransports() {
    if (this.readAt === 0) {
      return;
    }
    const transport = this.transport();
    const entries = this.devices()
      .map((device) => ({ external_id: device.external_id, transport }))
      .filter((entry) => this.transports.get(entry.external_id) !== entry.transport);
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      for (const entry of entries) {
        this.transports.set(entry.external_id, entry.transport);
      }
      this.resolved('transports');
    } catch (err) {
      this.problem('transports', `Transports refused: ${err.message}`);
    }
  }

  connectionStatus() {
    if (!this.config.url) {
      return {
        connected: false,
        message: this.config.urlTyped ? CONNECTION_TEXT.invalidUrl : CONNECTION_TEXT.noUrl,
      };
    }
    if (!this.client) {
      return { connected: false, message: CONNECTION_TEXT.noToken };
    }
    if (this.error) {
      return { connected: false, message: ERROR_TEXT[this.error.kind] };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.resolved('connection-status');
    } catch (err) {
      this.problem('connection-status', `Connection status refused: ${err.message}`);
    }
  }

  refreshWidget() {
    const now = this.now();
    const signature = JSON.stringify([
      this.error?.kind ?? null,
      this.followed,
      this.open.map((ticket) => [ticket.id, ticket.state, isEscalated(ticket, now)]),
      localDay(now, this.timeZone).start,
    ]);
    if (signature !== this.widgetSignature) {
      this.widgetSignature = signature;
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  // --- Scene events ----------------------------------------------------------

  /**
   * The events since the previous successful reading (persisted under /data,
   * so a restart neither repeats nor loses one, within the hour):
   *   - a ticket whose id is above the highest one already seen, created less
   *     than an hour ago, whatever its state now;
   *   - an open ticket past its escalation time, once per escalation time (a
   *     new time set by the SLA, after an answer, fires again).
   */
  async fireEvents(now) {
    const scope = this.config.url;
    const seen = Math.max(maxId(this.open), maxId(this.created));
    const escalatedNow = this.open
      .filter((ticket) => isEscalated(ticket, now))
      .sort((a, b) => a.escalationAt - b.escalationAt);
    if (this.saved.scope !== scope || this.saved.readAt === 0) {
      // First reading of this instance: what already exists is not news.
      this.saved = {
        scope,
        readAt: now,
        maxId: seen,
        escalated: escalatedNow.map(escalationKey),
      };
      this.store.save(this.saved);
      return;
    }
    const late = now - this.timings.maxLateMs;

    let highest = this.saved.maxId;
    const byId = new Map([...this.created, ...this.open].map((ticket) => [ticket.id, ticket]));
    const fresh = [...byId.values()]
      .filter((ticket) => Number(ticket.id) > this.saved.maxId)
      .sort((a, b) => Number(a.id) - Number(b.id));
    for (const ticket of fresh) {
      if (ticket.createdAt !== null && ticket.createdAt >= late) {
        // Gladys refused (restarting?): this ticket and the next ones are
        // tried again at the next reading.
        if (!(await this.fire(TRIGGERS.CREATED, this.eventData(ticket)))) {
          break;
        }
      }
      highest = Number(ticket.id);
    }

    const known = new Set(this.saved.escalated);
    const escalated = [];
    for (const ticket of escalatedNow) {
      const key = escalationKey(ticket);
      if (
        !known.has(key) &&
        ticket.escalationAt >= late &&
        !(await this.fire(TRIGGERS.ESCALATED, {
          ...this.eventData(ticket),
          escalation_at: iso(ticket.escalationAt),
        }))
      ) {
        continue;
      }
      escalated.push(key);
    }

    this.saved = {
      scope,
      readAt: now,
      maxId: highest,
      escalated: escalated.slice(-MAX_REMEMBERED),
    };
    this.store.save(this.saved);
  }

  eventData(ticket) {
    return {
      ticket_id: ticket.id,
      number: ticket.number,
      title: ticket.title,
      group: ticket.group,
      priority: ticket.priority,
      state: ticket.state,
      customer: ticket.customer,
      url: this.ticketUrl(ticket),
    };
  }

  async fire(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.resolved('scene-event');
      return true;
    } catch (err) {
      this.problem('scene-event', `Scene event ${key} refused: ${err.message}`);
      return false;
    }
  }

  // --- Commands --------------------------------------------------------------

  /** A Zammad error, in words for the user (the server's text stays in the logs). */
  explain(err) {
    if (!(err instanceof ZammadError)) {
      return err;
    }
    const language = this.language;
    const colon = language === 'fr' ? ' : ' : ': ';
    const status = err.status ? ` (HTTP ${err.status})` : '';
    return new Error(`Zammad${colon}${pick(ERROR_TEXT[err.kind], language)}${status}`, {
      cause: err,
    });
  }

  fail(key) {
    return new Error(pick(ACTION_TEXT[key], this.language));
  }

  requireClient() {
    if (!this.client) {
      throw this.fail('notConfigured');
    }
    return this.client;
  }

  /** Read again now, and wait for it a little (the scene should not lag). */
  async refreshSoon() {
    const refresh = this.poll().catch(() => {});
    let timer;
    await Promise.race([
      refresh,
      new Promise((resolve) => {
        timer = setTimeout(resolve, REFRESH_WAIT_MS);
      }),
    ]);
    clearTimeout(timer);
  }

  /**
   * Create a ticket. Group: id or name, empty: the first followed group, else
   * the first group of the agent. Customer: an e-mail address (found, or
   * created by Zammad), empty: the token's user.
   */
  async createTicket({ title, group: groupQuery, text, priority, customer }) {
    const client = this.requireClient();
    const name = String(title ?? '').trim();
    if (!name) {
      throw this.fail('emptyTitle');
    }
    let created;
    let group;
    try {
      const groups = parseGroups(await client.groups());
      if (String(groupQuery ?? '').trim() === '') {
        group =
          groups.find((item) => this.followed.some((followed) => followed.id === item.id)) ??
          groups[0];
        if (!group) {
          throw this.fail('noGroup');
        }
      } else {
        group = findByIdOrName(groups, groupQuery);
        if (!group) {
          throw this.fail('groupNotFound');
        }
      }
      const email = String(customer ?? '').trim();
      let customerId;
      if (email) {
        customerId = `guess:${email}`;
      } else {
        const me = await client.me();
        customerId = me.id;
      }
      const body = String(text ?? '').trim() || name;
      created = await client.createTicket({
        title: name.slice(0, MAX_TITLE),
        group: group.name,
        customer: customerId,
        body: body.slice(0, MAX_BODY),
        priority: String(priority ?? '').trim(),
      });
    } catch (err) {
      throw this.explain(err);
    }
    logger.info(`Ticket ${created.number ?? created.id} created in group ${group.id} from Gladys`);
    await this.refreshSoon();
    return {
      ticket_id: String(created.id),
      number: String(created.number ?? created.id),
      title: typeof created.title === 'string' ? created.title : name,
      group: group.name,
      url: this.ticketUrl({ id: created.id }),
    };
  }

  /** The "Test the connection" action: read now, report. */
  async testConnection() {
    await this.poll();
    const status = this.connectionStatus();
    if (!status.connected) {
      const message = allLanguages((language) =>
        REPORT_TEXT[language].failed(pick(status.message, language)),
      );
      throw new Error(message[this.language]);
    }
    const summary = this.summary();
    return allLanguages((language) => {
      const unknown =
        this.unknownGroups.length > 0
          ? ` ${UNKNOWN_GROUPS[language](this.unknownGroups.join(', '))}`
          : '';
      return `${REPORT_TEXT[language].ok(summary.open, summary.escalated)}${unknown}`;
    });
  }
}
