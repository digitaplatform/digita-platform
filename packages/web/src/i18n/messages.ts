import type { Locale } from "./config";

/**
 * Chrome strings (the few fixed UI labels). The bulk of the site's text is
 * CONTENT from the engine; this only covers wrapper chrome. All six locales are
 * populated; any missing key falls back to English.
 */
const MESSAGES = {
  en: {
    skipToContent: "Skip to content",
    language: "Language",
    home: "Home",
    navigation: "Navigation",
    openMenu: "Open menu",
    closeMenu: "Close menu",
    toggleTheme: "Toggle theme",
  },
  de: {
    skipToContent: "Zum Inhalt springen",
    language: "Sprache",
    home: "Start",
    navigation: "Navigation",
    openMenu: "Menü öffnen",
    closeMenu: "Menü schließen",
    toggleTheme: "Design wechseln",
  },
  it: {
    skipToContent: "Vai al contenuto",
    language: "Lingua",
    home: "Home",
    navigation: "Navigazione",
    openMenu: "Apri menu",
    closeMenu: "Chiudi menu",
    toggleTheme: "Cambia tema",
  },
  fr: {
    skipToContent: "Aller au contenu",
    language: "Langue",
    home: "Accueil",
    navigation: "Navigation",
    openMenu: "Ouvrir le menu",
    closeMenu: "Fermer le menu",
    toggleTheme: "Changer de thème",
  },
  es: {
    skipToContent: "Saltar al contenido",
    language: "Idioma",
    home: "Inicio",
    navigation: "Navegación",
    openMenu: "Abrir menú",
    closeMenu: "Cerrar menú",
    toggleTheme: "Cambiar tema",
  },
  tr: {
    skipToContent: "İçeriğe geç",
    language: "Dil",
    home: "Ana sayfa",
    navigation: "Gezinme",
    openMenu: "Menüyü aç",
    closeMenu: "Menüyü kapat",
    toggleTheme: "Temayı değiştir",
  },
} as const;

type MessageKey = keyof (typeof MESSAGES)["en"];

export function t(locale: Locale, key: MessageKey): string {
  const dict = (MESSAGES as Record<string, Partial<Record<MessageKey, string>>>)[locale];
  return dict?.[key] ?? MESSAGES.en[key];
}
