// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `open_tickets`.
//
// The use case: the office or workshop screen shows the latest open tickets,
// the escalated ones in red, without opening Zammad. For the whole instance,
// or for one followed group (a group device chosen in the widget settings).
//
// Budget (8 components, 2 texts): a caption when Zammad stopped answering,
// two tiles (open, escalated: hidden by a setting) and one status list of the
// 10 latest open tickets. The figures are values, not bound to device
// features, so the widget works before any device is added. No button: a
// ticket is answered in Zammad, not from a tablet.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from './hub.js';
import { isEscalated } from './zammad/model.js';
import { pick } from './texts.js';

export const MAX_ROWS = 10;

export const TEXT = {
  configure: {
    en: 'Enter the address of your Zammad and an access token in the configuration of the integration.',
    fr: "Saisissez l'adresse de votre Zammad et un jeton d'accès dans la configuration de l'intégration.",
    de: 'Gib die Adresse deines Zammad und ein Zugriffstoken in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección de su Zammad y un token de acceso en la configuración de la integración.',
  },
  unknown: {
    en: 'This group is no longer followed: choose another device in the widget settings.',
    fr: "Ce groupe n'est plus suivi : choisissez un autre appareil dans les réglages du widget.",
    de: 'Diese Gruppe wird nicht mehr verfolgt: Wähle ein anderes Gerät in den Widget-Einstellungen.',
    es: 'Este grupo ya no se sigue: elija otro dispositivo en la configuración del widget.',
  },
  noAnswer: {
    en: 'Zammad does not answer: see the Configuration screen of the integration.',
    fr: "Zammad ne répond pas : voir l'écran Configuration de l'intégration.",
    de: 'Zammad antwortet nicht: Sieh dir die Konfiguration der Integration an.',
    es: 'Zammad no responde: consulte la pantalla de configuración de la integración.',
  },
  stale: {
    en: 'Zammad does not answer: last known tickets.',
    fr: 'Zammad ne répond pas : derniers tickets connus.',
    de: 'Zammad antwortet nicht: zuletzt bekannte Tickets.',
    es: 'Zammad no responde: últimos tickets conocidos.',
  },
  nothing: {
    en: 'No open ticket.',
    fr: 'Aucun ticket ouvert.',
    de: 'Kein offenes Ticket.',
    es: 'Ningún ticket abierto.',
  },
  open: { en: 'Open', fr: 'Ouverts', de: 'Offen', es: 'Abiertos' },
  escalated: { en: 'Escalated', fr: 'En retard', de: 'Eskaliert', es: 'Escalados' },
  new: { en: 'New', fr: 'Nouveau', de: 'Neu', es: 'Nuevo' },
  pending: { en: 'Pending', fr: 'En attente', de: 'Wartend', es: 'Pendiente' },
};

// What the state of an open ticket is called in the row (`open` is its own word).
const KIND_TEXT = {
  new: TEXT.new,
  open: { en: 'Open', fr: 'Ouvert', de: 'Offen', es: 'Abierto' },
  pending: TEXT.pending,
};

const t = (text, language) => pick(text, language);
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

/** The status row of a ticket: number and title; escalated or state, and group. */
function ticketRow(ticket, { now, showGroup, language }) {
  const escalated = isEscalated(ticket, now);
  const when = escalated ? t(TEXT.escalated, language) : t(KIND_TEXT[ticket.kind], language);
  const value = showGroup && ticket.group ? `${when} · ${ticket.group}` : when;
  return {
    label: fit(`#${ticket.number} ${ticket.title}`, 40),
    icon: escalated ? 'alert-circle' : ticket.kind === 'pending' ? 'clock' : 'inbox',
    value: fit(value, 40),
    color: escalated
      ? WIDGET_COLORS.DANGER
      : ticket.kind === 'new'
        ? WIDGET_COLORS.WARNING
        : WIDGET_COLORS.NEUTRAL,
  };
}

const showCounters = (settings) =>
  settings?.show_counters !== false && settings?.show_counters !== 'false';

async function get(hub, { settings, language = 'en' }) {
  if (!hub.client) {
    return message(TEXT.configure, language);
  }
  if (hub.error && hub.readAt === 0) {
    return message(TEXT.noAnswer, language);
  }
  const { group, unknown } = hub.view(settings?.device || null);
  if (unknown) {
    return message(TEXT.unknown, language);
  }
  const now = hub.now();
  const summary = hub.summary(group);
  const components = [];
  if (hub.error) {
    components.push({ type: 'text', variant: 'caption', text: t(TEXT.stale, language) });
  }
  if (showCounters(settings)) {
    components.push(
      { type: 'value', value: summary.open, label: t(TEXT.open, language), icon: 'inbox' },
      {
        type: 'value',
        value: summary.escalated,
        label: t(TEXT.escalated, language),
        icon: 'alert-circle',
        color: summary.escalated > 0 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
      },
    );
  }
  if (summary.latest.length === 0) {
    components.push({ type: 'text', variant: 'body', text: t(TEXT.nothing, language) });
    return { ttl_seconds: 300, components };
  }
  const rows = summary.latest
    .slice(0, MAX_ROWS)
    .map((ticket) => ticketRow(ticket, { now, showGroup: !group, language }));
  components.push({ type: 'status', items: rows });
  return { ttl_seconds: 300, components };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get },
};
