// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the "Test the connection" report, scene action
// errors. Four languages, the four of the Gladys interface; German says
// "du", Spanish "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './zammad/client.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noUrl: {
    en: 'Enter the address of your Zammad in the configuration.',
    fr: "Saisissez l'adresse de votre Zammad dans la configuration.",
    de: 'Gib die Adresse deines Zammad in der Konfiguration ein.',
    es: 'Introduzca la dirección de su Zammad en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. https://helpdesk.example.org',
    fr: 'Adresse incomprise, ex. https://helpdesk.example.org',
    de: 'Adresse nicht verstanden, z. B. https://helpdesk.example.org',
    es: 'Dirección no válida, p. ej. https://helpdesk.example.org',
  },
  noToken: {
    en: 'Enter a Zammad access token in the configuration.',
    fr: "Saisissez un jeton d'accès Zammad dans la configuration.",
    de: 'Gib in der Konfiguration ein Zammad-Zugriffstoken ein.',
    es: 'Introduzca un token de acceso de Zammad en la configuración.',
  },
};

// One short explanation per error kind (src/zammad/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'Zammad does not answer',
    fr: 'Zammad ne répond pas',
    de: 'Zammad antwortet nicht',
    es: 'Zammad no responde',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: tick "Accept self-signed certificates"',
    fr: 'certificat refusé : cochez « Accepter les certificats auto-signés »',
    de: 'Zertifikat abgelehnt: Aktiviere „Selbstsignierte Zertifikate akzeptieren“',
    es: 'certificado rechazado: marque «Aceptar certificados autofirmados»',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'access token refused (wrong, expired or revoked)',
    fr: "jeton d'accès refusé (erroné, expiré ou révoqué)",
    de: 'Zugriffstoken abgelehnt (falsch, abgelaufen oder widerrufen)',
    es: 'token de acceso rechazado (erróneo, caducado o revocado)',
  },
  [ERROR_KINDS.FORBIDDEN]: {
    en: 'the token lacks the "Agent tickets" permission',
    fr: "le jeton n'a pas la permission « tickets agent »",
    de: 'dem Token fehlt die Berechtigung „Agenten-Tickets“',
    es: 'el token no tiene el permiso «tickets de agente»',
  },
  [ERROR_KINDS.NOT_FOUND]: {
    en: 'not found in Zammad',
    fr: 'introuvable dans Zammad',
    de: 'in Zammad nicht gefunden',
    es: 'no encontrado en Zammad',
  },
  [ERROR_KINDS.INVALID]: {
    en: 'Zammad refused a value (group, priority or customer)',
    fr: 'Zammad a refusé une valeur (groupe, priorité ou client)',
    de: 'Zammad hat einen Wert abgelehnt (Gruppe, Priorität oder Kunde)',
    es: 'Zammad rechazó un valor (grupo, prioridad o cliente)',
  },
  [ERROR_KINDS.NOT_ZAMMAD]: {
    en: 'this address does not answer like Zammad',
    fr: 'cette adresse ne répond pas comme Zammad',
    de: 'diese Adresse antwortet nicht wie Zammad',
    es: 'esta dirección no responde como Zammad',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'redirected: give the https:// address of Zammad',
    fr: "redirigé : indiquez l'adresse https:// de Zammad",
    de: 'umgeleitet: Gib die https://-Adresse von Zammad an',
    es: 'redirigido: indique la dirección https:// de Zammad',
  },
  [ERROR_KINDS.RATE_LIMIT]: {
    en: 'too many requests (reverse proxy limit)',
    fr: 'trop de requêtes (limite du proxy inverse)',
    de: 'zu viele Anfragen (Limit des Reverse-Proxys)',
    es: 'demasiadas solicitudes (límite del proxy inverso)',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    ok: (open, escalated) => `Zammad OK: ${open} open ticket(s), ${escalated} escalated.`,
    failed: (reason) => `Zammad: ${reason}.`,
  },
  fr: {
    ok: (open, escalated) =>
      `Zammad OK : ${open} ticket(s) ouvert(s), ${escalated} en retard d’escalade.`,
    failed: (reason) => `Zammad : ${reason}.`,
  },
  de: {
    ok: (open, escalated) => `Zammad OK: ${open} offene(s) Ticket(s), ${escalated} eskaliert.`,
    failed: (reason) => `Zammad: ${reason}.`,
  },
  es: {
    ok: (open, escalated) => `Zammad OK: ${open} ticket(s) abierto(s), ${escalated} escalado(s).`,
    failed: (reason) => `Zammad: ${reason}.`,
  },
};

// Logged and shown when a group typed in the configuration does not exist.
export const UNKNOWN_GROUPS = {
  en: (names) => `Unknown group(s) ignored: ${names}.`,
  fr: (names) => `Groupe(s) inconnu(s) ignoré(s) : ${names}.`,
  de: (names) => `Unbekannte Gruppe(n) ignoriert: ${names}.`,
  es: (names) => `Grupo(s) desconocido(s) ignorado(s): ${names}.`,
};

// Errors of the scene action (shown in Gladys).
export const ACTION_TEXT = {
  notConfigured: {
    en: 'Zammad is not configured.',
    fr: "Zammad n'est pas configuré.",
    de: 'Zammad ist nicht konfiguriert.',
    es: 'Zammad no está configurado.',
  },
  emptyTitle: {
    en: 'Give the title of the new ticket.',
    fr: 'Indiquez le titre du nouveau ticket.',
    de: 'Gib den Titel des neuen Tickets an.',
    es: 'Indique el título del nuevo ticket.',
  },
  groupNotFound: {
    en: 'No Zammad group of this agent has this name.',
    fr: 'Aucun groupe Zammad de cet agent ne porte ce nom.',
    de: 'Keine Zammad-Gruppe dieses Agenten hat diesen Namen.',
    es: 'Ningún grupo de Zammad de este agente tiene este nombre.',
  },
  noGroup: {
    en: 'This Zammad agent has no group to create the ticket in.',
    fr: "Cet agent Zammad n'a aucun groupe où créer le ticket.",
    de: 'Dieser Zammad-Agent hat keine Gruppe für das Ticket.',
    es: 'Este agente de Zammad no tiene ningún grupo donde crear el ticket.',
  },
};

export const LANGUAGE_FALLBACK = 'en';

export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

/** A multi-language object from a function of the language. */
export const allLanguages = (render) =>
  Object.fromEntries(Object.keys(INIT_FAILED).map((language) => [language, render(language)]));
