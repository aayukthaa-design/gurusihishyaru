// ─── WhatsApp Click-to-Chat Utilities ─────────────────────────────────────────
//
// Wraps the official https://wa.me/<phone>?text=<message> deep link format.
// No WhatsApp Business API or backend involved — this only opens a prefilled
// chat that the user must review and send manually.

const DEFAULT_PHONE = import.meta.env.VITE_WHATSAPP_PHONE ?? '';
const DEFAULT_BUSINESS_NAME = import.meta.env.VITE_WHATSAPP_BUSINESS_NAME ?? 'Guru Shishyaru Tutorials';

/** The configured default WhatsApp number (e.g. the business's own number). */
export function getDefaultWhatsAppPhone(): string {
  return DEFAULT_PHONE;
}

export function getWhatsAppBusinessName(): string {
  return DEFAULT_BUSINESS_NAME;
}

/** Strips everything but digits so numbers like "+91 98765 43201" become "919876543201". */
export function normalizeWhatsAppPhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

/** Builds a wa.me deep link with a properly URL-encoded, multi-line message. */
export function buildWhatsAppUrl(phone: string, message: string): string {
  const digitsOnly = normalizeWhatsAppPhone(phone);
  return `https://wa.me/${digitsOnly}?text=${encodeURIComponent(message)}`;
}

export interface WhatsAppMessageField {
  label: string;
  value?: string | null;
}

export interface WhatsAppMessageOptions {
  /** Who the message is addressed to, e.g. a business name or a person's name. */
  greeting: string;
  intro?: string;
  /** Groups of fields; each group is separated by a blank line. Missing values are omitted. */
  sections?: WhatsAppMessageField[][];
  closing?: string;
}

/** Composes a wa.me message body, omitting any field whose value is missing/blank. */
export function composeWhatsAppMessage({ greeting, intro, sections = [], closing }: WhatsAppMessageOptions): string {
  const lines: string[] = [`Hi ${greeting},`];

  if (intro) {
    lines.push('', intro);
  }

  for (const section of sections) {
    const fieldLines = section
      .filter((field) => field.value !== undefined && field.value !== null && field.value.trim() !== '')
      .map((field) => `${field.label}: ${field.value}`);

    if (fieldLines.length > 0) {
      lines.push('', ...fieldLines);
    }
  }

  if (closing) {
    lines.push('', closing);
  }

  return lines.join('\n');
}

/** Opens a wa.me chat in a new tab. Never sends automatically — the user must press Send. */
export function openWhatsAppChat(phone: string, message: string): void {
  const url = buildWhatsAppUrl(phone, message);
  window.open(url, '_blank', 'noopener,noreferrer');
}
