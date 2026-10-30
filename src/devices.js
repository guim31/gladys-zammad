// -----------------------------------------------------------------------------
// Gladys devices: one for the Zammad instance, and one per followed group.
//
// Identity: `zammad` / `instance` (one instance per integration: changing the
// address keeps the device and its history) and `zammad` / `group-<id>`, the
// id Zammad gives the group (renaming a group keeps its device).
//
// Features, all counter-sensor/integer (definitions in src/zammad/model.js):
// open, new, pending, escalated, unassigned, created today; "assigned to me"
// (the token's user) on the instance only.
//
// The devices are published with should_poll: false: the integration reads
// Zammad on its own timer (src/hub.js), every 1 to 10 minutes.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

export const DEVICE_TYPE = 'zammad';
export const INSTANCE_ID = 'instance';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  OPEN: 'open',
  NEW: 'new',
  PENDING: 'pending',
  ESCALATED: 'escalated',
  UNASSIGNED: 'unassigned',
  MINE: 'mine',
  CREATED_TODAY: 'created_today',
});

// The summary field (src/zammad/model.js) of each feature.
const SUMMARY_FIELD = {
  [FEATURE_KEYS.OPEN]: 'open',
  [FEATURE_KEYS.NEW]: 'new',
  [FEATURE_KEYS.PENDING]: 'pending',
  [FEATURE_KEYS.ESCALATED]: 'escalated',
  [FEATURE_KEYS.UNASSIGNED]: 'unassigned',
  [FEATURE_KEYS.MINE]: 'mine',
  [FEATURE_KEYS.CREATED_TODAY]: 'createdToday',
};

const INSTANCE_FEATURES = Object.values(FEATURE_KEYS);
const GROUP_FEATURES = INSTANCE_FEATURES.filter((key) => key !== FEATURE_KEYS.MINE);

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    open: 'Open tickets',
    new: 'New tickets',
    pending: 'Pending tickets',
    escalated: 'Escalated tickets',
    unassigned: 'Unassigned tickets',
    mine: 'Tickets assigned to me',
    created_today: 'Tickets created today',
  },
  fr: {
    open: 'Tickets ouverts',
    new: 'Nouveaux tickets',
    pending: 'Tickets en attente',
    escalated: 'Tickets en retard d’escalade',
    unassigned: 'Tickets non assignés',
    mine: 'Tickets qui me sont assignés',
    created_today: 'Tickets créés aujourd’hui',
  },
  de: {
    open: 'Offene Tickets',
    new: 'Neue Tickets',
    pending: 'Wartende Tickets',
    escalated: 'Eskalierte Tickets',
    unassigned: 'Nicht zugewiesene Tickets',
    mine: 'Mir zugewiesene Tickets',
    created_today: 'Heute erstellte Tickets',
  },
  es: {
    open: 'Tickets abiertos',
    new: 'Tickets nuevos',
    pending: 'Tickets pendientes',
    escalated: 'Tickets escalados',
    unassigned: 'Tickets sin asignar',
    mine: 'Tickets asignados a mí',
    created_today: 'Tickets creados hoy',
  },
};

// Display bound (the core never applies it on write).
const COUNTER_MAX = 100000;

const COUNTER = {
  category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
  type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  min: 0,
  max: COUNTER_MAX,
};

export const instanceIds = (gladys) => gladys.externalIds(DEVICE_TYPE, INSTANCE_ID);
export const groupIds = (gladys, groupId) => gladys.externalIds(DEVICE_TYPE, `group-${groupId}`);

const featureKeys = (group) => (group ? GROUP_FEATURES : INSTANCE_FEATURES);

/**
 * @param {object} gladys
 * @param {{ id: string, name: string }|null} group null: the instance
 * @param {string} language
 */
export function buildDevice(gladys, group, language = 'en') {
  const ids = group ? groupIds(gladys, group.id) : instanceIds(gladys);
  const names = NAMES[language] ?? NAMES.en;
  return {
    name: group ? `Zammad ${group.name}`.slice(0, 60) : 'Zammad',
    external_id: ids.device,
    should_poll: false,
    features: featureKeys(group).map((key) => ({
      ...COUNTER,
      name: names[key],
      external_id: ids.feature(key),
    })),
  };
}

/**
 * The states of every feature of a device, in the `publishStates` format.
 * @returns {Array<{ device_feature_external_id: string, state: number }>}
 */
export function featureStates(gladys, group, summary) {
  const ids = group ? groupIds(gladys, group.id) : instanceIds(gladys);
  return featureKeys(group).map((key) => ({
    device_feature_external_id: ids.feature(key),
    state: Math.min(COUNTER_MAX, summary[SUMMARY_FIELD[key]]),
  }));
}
