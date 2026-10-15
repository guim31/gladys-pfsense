// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widgets (src/widgets.js):
// connection status, errors, the reports of the configuration actions, the
// errors of the commands. Four languages, the four of the Gladys interface;
// German says "du", Spanish "usted". test/i18n.test.js checks every table.
// Product names (pfSense, REST API, Netgate) stay as is.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './pfsense/errors.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noUrl: {
    en: 'Enter the address of your pfSense firewall and an API key in the configuration.',
    fr: "Saisissez l'adresse de votre pare-feu pfSense et une clé d'API dans la configuration.",
    de: 'Gib die Adresse deiner pfSense-Firewall und einen API-Schlüssel in der Konfiguration ein.',
    es: 'Introduzca la dirección de su cortafuegos pfSense y una clave de API en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. https://192.168.1.1',
    fr: 'Adresse incomprise, ex. https://192.168.1.1',
    de: 'Adresse nicht verstanden, z. B. https://192.168.1.1',
    es: 'Dirección no válida, p. ej. https://192.168.1.1',
  },
  noKey: {
    en: 'Enter the API key created in System > REST API > Keys of pfSense.',
    fr: "Saisissez la clé d'API créée dans System > REST API > Keys de pfSense.",
    de: 'Gib den API-Schlüssel ein, der in System > REST API > Keys von pfSense erstellt wurde.',
    es: 'Introduzca la clave de API creada en System > REST API > Keys de pfSense.',
  },
  connecting: {
    en: 'Connecting to the firewall…',
    fr: 'Connexion au pare-feu…',
    de: 'Verbindung zur Firewall…',
    es: 'Conectando con el cortafuegos…',
  },
};

// One short explanation per error kind (src/pfsense/errors.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'the firewall does not answer at this address',
    fr: 'le pare-feu ne répond pas à cette adresse',
    de: 'die Firewall antwortet unter dieser Adresse nicht',
    es: 'el cortafuegos no responde en esta dirección',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: tick "Accept a self-signed certificate"',
    fr: 'certificat refusé : cochez « Accepter un certificat auto-signé »',
    de: 'Zertifikat abgelehnt: Aktiviere „Selbstsigniertes Zertifikat akzeptieren“',
    es: 'certificado rechazado: marque «Aceptar un certificado autofirmado»',
  },
  [ERROR_KINDS.NO_API]: {
    en: 'no REST API here: install the pfSense-pkg-RESTAPI package',
    fr: 'pas d’API REST ici : installez le paquet pfSense-pkg-RESTAPI',
    de: 'keine REST-API hier: Installiere das Paket pfSense-pkg-RESTAPI',
    es: 'no hay API REST aquí: instale el paquete pfSense-pkg-RESTAPI',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'API key refused by pfSense',
    fr: "clé d'API refusée par pfSense",
    de: 'API-Schlüssel von pfSense abgelehnt',
    es: 'clave de API rechazada por pfSense',
  },
  [ERROR_KINDS.PERMISSION]: {
    en: 'the pfSense user of the key lacks a privilege',
    fr: "il manque un privilège à l'utilisateur pfSense de la clé",
    de: 'dem pfSense-Benutzer des Schlüssels fehlt ein Recht',
    es: 'al usuario de pfSense de la clave le falta un privilegio',
  },
  [ERROR_KINDS.NOT_FOUND]: {
    en: 'this version of the REST API package lacks an endpoint',
    fr: 'il manque un point d’accès à cette version du paquet REST API',
    de: 'dieser Version des REST-API-Pakets fehlt ein Endpunkt',
    es: 'a esta versión del paquete REST API le falta un punto de acceso',
  },
  [ERROR_KINDS.PROTOCOL]: {
    en: 'unexpected answer from the firewall, see the logs',
    fr: 'réponse inattendue du pare-feu, voir les logs',
    de: 'unerwartete Antwort der Firewall, sieh in den Protokollen nach',
    es: 'respuesta inesperada del cortafuegos, consulte los registros',
  },
};

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    connected: (name, version) => `Connected to ${name} (pfSense ${version}).`,
    gateways: 'Gateways',
    noGateway: 'No gateway monitored by pfSense.',
    gatewaySource: {
      config: 'from the configuration',
      all: 'all gateways of pfSense',
    },
    up: 'online',
    down: 'down',
    missing: 'not found',
    clients: ({ arp, leases }) => `Seen now: ${arp} in ARP, ${leases} DHCP leases online.`,
    unavailable: (what) => `Not readable with this key: ${what}.`,
    ruleOn: 'rule found, enabled',
    ruleOff: 'rule found, disabled',
    ruleMissing: 'no rule with this description',
    commandsOn: 'Commands enabled.',
    commandsOff: 'Commands disabled (read only).',
    plainHint: 'The API key travels unencrypted on your network: prefer HTTPS.',
  },
  fr: {
    connected: (name, version) => `Connecté à ${name} (pfSense ${version}).`,
    gateways: 'Passerelles',
    noGateway: 'Aucune passerelle surveillée par pfSense.',
    gatewaySource: {
      config: 'de la configuration',
      all: 'toutes les passerelles de pfSense',
    },
    up: 'en ligne',
    down: 'coupée',
    missing: 'introuvable',
    clients: ({ arp, leases }) =>
      `Vus maintenant : ${arp} dans l’ARP, ${leases} baux DHCP en ligne.`,
    unavailable: (what) => `Illisible avec cette clé : ${what}.`,
    ruleOn: 'règle trouvée, activée',
    ruleOff: 'règle trouvée, désactivée',
    ruleMissing: 'aucune règle avec cette description',
    commandsOn: 'Commandes activées.',
    commandsOff: 'Commandes désactivées (lecture seule).',
    plainHint: "La clé d'API circule en clair sur votre réseau : préférez HTTPS.",
  },
  de: {
    connected: (name, version) => `Verbunden mit ${name} (pfSense ${version}).`,
    gateways: 'Gateways',
    noGateway: 'Kein von pfSense überwachtes Gateway.',
    gatewaySource: {
      config: 'aus der Konfiguration',
      all: 'alle Gateways von pfSense',
    },
    up: 'online',
    down: 'getrennt',
    missing: 'nicht gefunden',
    clients: ({ arp, leases }) => `Gerade gesehen: ${arp} im ARP, ${leases} DHCP-Leases online.`,
    unavailable: (what) => `Mit diesem Schlüssel nicht lesbar: ${what}.`,
    ruleOn: 'Regel gefunden, aktiviert',
    ruleOff: 'Regel gefunden, deaktiviert',
    ruleMissing: 'keine Regel mit dieser Beschreibung',
    commandsOn: 'Befehle aktiviert.',
    commandsOff: 'Befehle deaktiviert (nur lesen).',
    plainHint:
      'Der API-Schlüssel wird unverschlüsselt in deinem Netzwerk übertragen: Nutze lieber HTTPS.',
  },
  es: {
    connected: (name, version) => `Conectado a ${name} (pfSense ${version}).`,
    gateways: 'Puertas de enlace',
    noGateway: 'Ninguna puerta de enlace vigilada por pfSense.',
    gatewaySource: {
      config: 'de la configuración',
      all: 'todas las puertas de enlace de pfSense',
    },
    up: 'en línea',
    down: 'cortada',
    missing: 'no encontrada',
    clients: ({ arp, leases }) =>
      `Vistos ahora: ${arp} en ARP, ${leases} concesiones DHCP en línea.`,
    unavailable: (what) => `No legible con esta clave: ${what}.`,
    ruleOn: 'regla encontrada, activada',
    ruleOff: 'regla encontrada, desactivada',
    ruleMissing: 'ninguna regla con esta descripción',
    commandsOn: 'Órdenes activadas.',
    commandsOff: 'Órdenes desactivadas (solo lectura).',
    plainHint: 'La clave de API viaja sin cifrar por su red: es preferible HTTPS.',
  },
};

// The "List the firewall rules" report.
export const RULES_TEXT = {
  en: {
    intro: 'Firewall rules with a description (copy it into the configuration):',
    none: 'No firewall rule has a description: add one in Firewall > Rules.',
    on: 'enabled',
    off: 'disabled',
  },
  fr: {
    intro: 'Règles de pare-feu avec une description (copiez-la dans la configuration) :',
    none: "Aucune règle de pare-feu n'a de description : ajoutez-en une dans Firewall > Rules.",
    on: 'activée',
    off: 'désactivée',
  },
  de: {
    intro: 'Firewall-Regeln mit Beschreibung (kopiere sie in die Konfiguration):',
    none: 'Keine Firewall-Regel hat eine Beschreibung: Füge eine in Firewall > Rules hinzu.',
    on: 'aktiviert',
    off: 'deaktiviert',
  },
  es: {
    intro: 'Reglas de cortafuegos con descripción (cópiela en la configuración):',
    none: 'Ninguna regla de cortafuegos tiene descripción: añada una en Firewall > Rules.',
    on: 'activada',
    off: 'desactivada',
  },
};

// Errors of the commands (scene actions and widget buttons), shown in Gladys.
export const ACTION_TEXT = {
  disabled: {
    en: 'Commands are disabled: tick "Allow commands" in the configuration.',
    fr: 'Les commandes sont désactivées : cochez « Autoriser les commandes » dans la configuration.',
    de: 'Befehle sind deaktiviert: Aktiviere „Befehle erlauben“ in der Konfiguration.',
    es: 'Las órdenes están desactivadas: marque «Permitir órdenes» en la configuración.',
  },
  unknownRule: {
    en: 'This device is not a firewall rule followed in the configuration.',
    fr: "Cet appareil n'est pas une règle de pare-feu suivie dans la configuration.",
    de: 'Dieses Gerät ist keine in der Konfiguration verfolgte Firewall-Regel.',
    es: 'Este dispositivo no es una regla de cortafuegos seguida en la configuración.',
  },
  ruleNotFound: {
    en: 'No firewall rule of pfSense has this description any more.',
    fr: "Plus aucune règle de pare-feu de pfSense n'a cette description.",
    de: 'Keine Firewall-Regel von pfSense hat diese Beschreibung mehr.',
    es: 'Ninguna regla de cortafuegos de pfSense tiene ya esta descripción.',
  },
  permission: {
    en: 'Refused by pfSense: the user of the key needs the privileges of the commands (see the documentation).',
    fr: "Refusé par pfSense : l'utilisateur de la clé doit avoir les privilèges des commandes (voir la documentation).",
    de: 'Von pfSense abgelehnt: Der Benutzer des Schlüssels braucht die Rechte der Befehle (siehe Dokumentation).',
    es: 'Rechazado por pfSense: el usuario de la clave necesita los privilegios de las órdenes (vea la documentación).',
  },
};

export const LANGUAGE_FALLBACK = 'en';

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;
export const pick = (text, language) => text?.[language] ?? text?.[LANGUAGE_FALLBACK] ?? '';
