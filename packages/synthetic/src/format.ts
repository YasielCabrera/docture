/**
 * Display formatting with explicit patterns rather than `Intl`, so the printed text
 * and therefore the PDF bytes do not change with the ICU version of the runtime.
 */

export interface Locale {
  readonly code: string;
  readonly decimal: string;
  readonly group: string;
  /** `DD`, `MM`, `YYYY` and `MON` (short month name) are replaced. */
  readonly date: string;
  readonly months: readonly string[];
  readonly currency: { readonly symbol: string; readonly position: "before" | "after"; readonly space: boolean };
  /** The minus sign. Standard PDF fonts cannot draw U+2212, so the presets use `-`. */
  readonly minus: string;
}

const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const locales = {
  "en-US": { code: "en-US", decimal: ".", group: ",", date: "MM/DD/YYYY", months: EN_MONTHS, currency: { symbol: "$", position: "before", space: false }, minus: "-" },
  "en-GB": { code: "en-GB", decimal: ".", group: ",", date: "DD MON YYYY", months: EN_MONTHS, currency: { symbol: "£", position: "before", space: false }, minus: "-" },
  "de-DE": {
    code: "de-DE",
    decimal: ",",
    group: ".",
    date: "DD.MM.YYYY",
    months: ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"],
    currency: { symbol: "€", position: "after", space: true },
    minus: "-",
  },
  "fr-FR": {
    code: "fr-FR",
    decimal: ",",
    group: " ",
    date: "DD/MM/YYYY",
    months: ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."],
    currency: { symbol: "€", position: "after", space: true },
    minus: "-",
  },
  "es-ES": {
    code: "es-ES",
    decimal: ",",
    group: ".",
    date: "DD/MM/YYYY",
    months: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"],
    currency: { symbol: "€", position: "after", space: true },
    minus: "-",
  },
} as const satisfies Readonly<Record<string, Locale>>;

export interface Formatter {
  readonly locale: Locale;
  /** A number with `decimals` places and grouping. */
  number(value: number, decimals?: number): string;
  /** Integer minor units (cents) as money, such as `1234,50 €`. */
  money(minor: number, options?: { readonly symbol?: string; readonly decimals?: number }): string;
  /** An ISO date in the locale's pattern or `pattern`. */
  date(iso: string, pattern?: string): string;
}

export function formatter(locale: Locale): Formatter {
  const number = (value: number, decimals = 0): string => {
    const sign = value < 0 ? locale.minus : "";
    const [whole = "0", fraction] = Math.abs(value).toFixed(decimals).split(".");
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, locale.group);
    return sign + grouped + (fraction === undefined ? "" : locale.decimal + fraction);
  };
  return {
    locale,
    number,
    money(minor, options = {}) {
      const decimals = options.decimals ?? 2;
      const amount = number(minor / 10 ** decimals, decimals);
      const symbol = options.symbol ?? locale.currency.symbol;
      const gap = locale.currency.space ? " " : "";
      return locale.currency.position === "before" ? `${amount.startsWith(locale.minus) ? locale.minus : ""}${symbol}${gap}${amount.replace(locale.minus, "")}` : `${amount}${gap}${symbol}`;
    },
    date(iso, pattern = locale.date) {
      const [year = "", month = "", day = ""] = iso.slice(0, 10).split("-");
      return pattern.replace("YYYY", year).replace("MON", locale.months[Number(month) - 1] ?? month).replace("MM", month).replace("DD", day);
    },
  };
}
