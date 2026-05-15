/**
 * Minimalistický parser .vcf (vCard 2.1 / 3.0 / 4.0).
 *
 * Řeší to, co iPhone Kontakty reálně exportují:
 *   BEGIN:VCARD / END:VCARD bloky
 *   FN / N:Prijmeni;Jmeno;...
 *   TEL;type=CELL;type=VOICE:+420777...
 *   TEL;TYPE=CELL:...
 *   EMAIL;type=INTERNET;type=HOME:foo@bar.cz
 *   UID:xxxxx
 *   NOTE:...
 *
 * Quoted-printable a BASE64 fotky ignorujeme.
 * Continuation lines (řádek začíná mezerou) skládáme zpět.
 */

export interface ParsedContact {
  displayName: string;
  firstName?: string;
  lastName?: string;
  note?: string;
  externalId?: string;
  phones: { number: string; label?: string }[];
  emails: { email: string; label?: string }[];
}

function unfoldLines(text: string): string[] {
  // vCard spec: řádky začínající mezerou nebo tabulátorem jsou continuation
  // předchozího logického řádku.
  const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

function extractLabel(params: string[]): string | undefined {
  // Hledej TYPE= hodnotu (mobile/work/home/...)
  const typeParam = params.find((p) => p.toUpperCase().startsWith("TYPE="));
  if (typeParam) {
    const values = typeParam.substring(5).split(",");
    const priority = ["CELL", "MOBILE", "IPHONE", "WORK", "HOME", "OTHER", "INTERNET", "VOICE"];
    for (const v of values) {
      const upper = v.toUpperCase();
      if (priority.includes(upper)) {
        if (upper === "CELL" || upper === "MOBILE" || upper === "IPHONE") return "mobile";
        return upper.toLowerCase();
      }
    }
  }
  // Nebo bez TYPE= (vCard 2.1: TEL;CELL;VOICE:...)
  for (const p of params) {
    const upper = p.toUpperCase();
    if (upper === "CELL" || upper === "MOBILE" || upper === "IPHONE") return "mobile";
    if (["WORK", "HOME", "OTHER"].includes(upper)) return upper.toLowerCase();
  }
  return undefined;
}

function decodeValue(raw: string, params: string[]): string {
  // Quoted-printable podpora (vCard 2.1)
  const isQP = params.some((p) => p.toUpperCase() === "ENCODING=QUOTED-PRINTABLE");
  if (isQP) {
    try {
      return raw.replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
    } catch {
      return raw;
    }
  }
  return raw.replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\n/gi, "\n").replace(/\\\\/g, "\\");
}

function parseVCard(block: string[]): ParsedContact | null {
  const contact: ParsedContact = {
    displayName: "",
    phones: [],
    emails: [],
  };

  for (const line of block) {
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const head = line.slice(0, colonIdx);
    const value = line.slice(colonIdx + 1);
    const parts = head.split(";");
    const key = parts[0].toUpperCase();
    const params = parts.slice(1);
    const decoded = decodeValue(value, params);

    if (key === "FN") {
      contact.displayName = decoded.trim();
    } else if (key === "N") {
      // N:Prijmeni;Jmeno;Middle;Prefix;Suffix
      const nparts = decoded.split(";");
      if (nparts[0]) contact.lastName = nparts[0].trim() || undefined;
      if (nparts[1]) contact.firstName = nparts[1].trim() || undefined;
    } else if (key === "TEL") {
      const label = extractLabel(params);
      const num = decoded.trim();
      if (num) contact.phones.push({ number: num, label });
    } else if (key === "EMAIL") {
      const label = extractLabel(params);
      const em = decoded.trim();
      if (em) contact.emails.push({ email: em, label });
    } else if (key === "NOTE") {
      contact.note = decoded.trim() || undefined;
    } else if (key === "UID") {
      contact.externalId = decoded.trim() || undefined;
    }
  }

  // Fallback na displayName z N:
  if (!contact.displayName) {
    const full = [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim();
    contact.displayName = full || "(bez jména)";
  }

  // Kontakty bez telefonu ani emailu přeskakujeme
  if (contact.phones.length === 0 && contact.emails.length === 0) return null;

  return contact;
}

export function parseVCardFile(text: string): ParsedContact[] {
  const lines = unfoldLines(text);
  const contacts: ParsedContact[] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    const upper = line.toUpperCase().trim();
    if (upper === "BEGIN:VCARD") {
      current = [];
    } else if (upper === "END:VCARD") {
      if (current) {
        const c = parseVCard(current);
        if (c) contacts.push(c);
      }
      current = null;
    } else if (current) {
      current.push(line);
    }
  }
  return contacts;
}

// ============================================================================
// iCloud CardDAV sync API (2026-05-14 — kontakty_brief.md fáze 1)
// ============================================================================
//
// Bohatší model než legacy ParsedContact — bere v úvahu ORG, ADR, BDAY,
// CATEGORIES (Apple skupiny), KIND (group vs individual).
//
// Vlastní implementace bez npm závislosti (Petr 2026-05-14).

export interface VCardContact {
  uid: string;
  fn: string;
  firstName: string;
  lastName: string;
  org: string | null;
  phones: { number: string; label: string | null }[];
  emails: { email: string; label: string | null }[];
  addressLines: string[];
  birthYear: number | null;
  birthMonth: number | null;
  birthDay: number | null;
  categories: string[];
  note: string | null;
  rev: string | null;
  kind: "individual" | "group" | "org" | null;
  groupMemberUids: string[];
}

/**
 * Bohatší parser než legacy parseVCard. Vrací VCardContact (nebo null).
 * Vstup je raw vCard string (bez BEGIN/END marker je OK, parser je tolerantní).
 */
export function parseVCardFull(raw: string): VCardContact | null {
  const lines = unfoldLines(raw);
  // Najdi BEGIN:VCARD..END:VCARD blok (pokud je jen jeden) nebo vezmi vše
  const beginIdx = lines.findIndex((l) => l.toUpperCase().trim() === "BEGIN:VCARD");
  const endIdx = lines.findIndex((l) => l.toUpperCase().trim() === "END:VCARD");
  const block = beginIdx >= 0 && endIdx > beginIdx
    ? lines.slice(beginIdx + 1, endIdx)
    : lines;

  const contact: VCardContact = {
    uid: "",
    fn: "",
    firstName: "",
    lastName: "",
    org: null,
    phones: [],
    emails: [],
    addressLines: [],
    birthYear: null,
    birthMonth: null,
    birthDay: null,
    categories: [],
    note: null,
    rev: null,
    kind: null,
    groupMemberUids: [],
  };

  for (const line of block) {
    if (/^VERSION:/i.test(line)) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const head = line.slice(0, colonIdx);
    const value = line.slice(colonIdx + 1);
    const parts = head.split(";");
    const keyRaw = parts[0].toUpperCase();
    const params = parts.slice(1);
    const key = keyRaw.replace(/^ITEM\d+\./, "");
    const decoded = decodeValue(value, params);

    switch (key) {
      case "UID":
        contact.uid = decoded.trim();
        break;
      case "FN":
        contact.fn = decoded.trim();
        break;
      case "N": {
        const np = decoded.split(";");
        contact.lastName = (np[0] ?? "").trim();
        contact.firstName = (np[1] ?? "").trim();
        break;
      }
      case "TEL": {
        const label = extractLabel(params) ?? null;
        const num = decoded.trim();
        if (num) contact.phones.push({ number: num, label });
        break;
      }
      case "EMAIL": {
        const label = extractLabel(params) ?? null;
        const em = decoded.trim().toLowerCase();
        if (em) contact.emails.push({ email: em, label });
        break;
      }
      case "ORG": {
        const orgParts = decoded.split(";");
        const company = (orgParts[0] ?? "").trim();
        contact.org = company || null;
        break;
      }
      case "ADR": {
        // POBox;Extended;Street;Locality;Region;PostalCode;Country
        const ap = decoded.split(";").map((s) => s.trim());
        const street = ap[2] ?? "";
        const cityZip = [ap[3], ap[5]].filter(Boolean).join(" ");
        const country = ap[6] ?? "";
        const addr = [street, cityZip, country].filter(Boolean).join("\n");
        if (addr) contact.addressLines.push(addr);
        break;
      }
      case "BDAY": {
        const m = decoded.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
        if (m) {
          const y = parseInt(m[1]!, 10);
          contact.birthYear = (y > 1700 && y < 2200) ? y : null;
          contact.birthMonth = parseInt(m[2]!, 10) || null;
          contact.birthDay = parseInt(m[3]!, 10) || null;
        }
        break;
      }
      case "CATEGORIES":
        contact.categories = decoded.split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "NOTE":
        contact.note = decoded.trim() || null;
        break;
      case "REV":
        contact.rev = decoded.trim() || null;
        break;
      case "KIND":
      case "X-ADDRESSBOOKSERVER-KIND": {
        const k = decoded.toLowerCase().trim();
        if (k === "group" || k === "individual" || k === "org") contact.kind = k;
        break;
      }
      case "X-ADDRESSBOOKSERVER-MEMBER":
      case "MEMBER": {
        const m = decoded.match(/urn:uuid:(.+)$/i) ?? decoded.match(/^(.+)$/);
        if (m) contact.groupMemberUids.push(m[1]!.trim());
        break;
      }
    }
  }

  if (!contact.fn) {
    contact.fn = [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim();
  }

  // Petr 2026-05-15: Apple iCloud má stub kontakty (Apple Contacts vlastní
  // bug — nedokončené editace, importy zanechávají vCardy jen s CR `\r` nebo
  // prázdné `FN:` polem). Plus některé XML responses obsahují raw `&#13;`
  // (HTML entity pro CR) jako displayName. Po decode entit + trim CR/whitespace
  // zjistime jestli kontakt má alespon něco užitečného. Pokud ne, odmítneme ho
  // (vrátíme null) — neukládáme prázdné kontakty.
  const cleanName = (contact.fn ?? "").replace(/&#1[03];/g, "").replace(/[\r\n\s]+/g, "").trim();
  const cleanFirst = (contact.firstName ?? "").replace(/&#1[03];/g, "").replace(/[\r\n\s]+/g, "").trim();
  const cleanLast = (contact.lastName ?? "").replace(/&#1[03];/g, "").replace(/[\r\n\s]+/g, "").trim();
  const hasName = cleanName.length > 0 || cleanFirst.length > 0 || cleanLast.length > 0;
  const hasContact = contact.phones.length > 0 || contact.emails.length > 0;
  const hasOrg = (contact.org ?? "").replace(/&#1[03];/g, "").trim().length > 0;

  // Kontakt musí mít buď (alespoň jméno) NEBO (alespoň 1 telefon/email/firma).
  // Pokud nic — je to stub, odmítáme.
  if (!hasName && !hasContact && !hasOrg) return null;

  return contact;
}

/**
 * Serializace VCardContact → vCard 3.0 string.
 * Pro PUT na iCloud CardDAV server. CRLF line endings (RFC 6350 spec).
 */
export function buildVCard(contact: VCardContact): string {
  const lines: string[] = ["BEGIN:VCARD", "VERSION:3.0"];
  if (contact.uid) lines.push(`UID:${contact.uid}`);
  lines.push(`FN:${escapeValue(contact.fn)}`);
  lines.push(`N:${escapeValue(contact.lastName)};${escapeValue(contact.firstName)};;;`);

  if (contact.org) lines.push(`ORG:${escapeValue(contact.org)}`);

  for (const p of contact.phones) {
    const param = p.label ? `;TYPE=${vcardTypeFromLabel(p.label)}` : "";
    lines.push(`TEL${param}:${escapeValue(p.number)}`);
  }
  for (const e of contact.emails) {
    const param = e.label ? `;TYPE=${vcardTypeFromLabel(e.label)}` : "";
    lines.push(`EMAIL${param}:${escapeValue(e.email)}`);
  }

  for (const addr of contact.addressLines) {
    const ap = addr.split(/\n/).map((s) => s.trim());
    const street = ap[0] ?? "";
    const cityZipMatch = (ap[1] ?? "").match(/^(.+?)\s+(\d{3}\s?\d{2}|\d{4,6})\s*$/);
    const city = cityZipMatch?.[1] ?? ap[1] ?? "";
    const zip = cityZipMatch?.[2] ?? "";
    const country = ap[2] ?? "";
    lines.push(`ADR;TYPE=HOME:;;${escapeValue(street)};${escapeValue(city)};;${escapeValue(zip)};${escapeValue(country)}`);
  }

  if (contact.birthYear || contact.birthMonth || contact.birthDay) {
    const y = contact.birthYear ?? 1604;
    const m = String(contact.birthMonth ?? 1).padStart(2, "0");
    const d = String(contact.birthDay ?? 1).padStart(2, "0");
    lines.push(`BDAY:${y}-${m}-${d}`);
  }

  if (contact.categories.length > 0) {
    lines.push(`CATEGORIES:${contact.categories.map(escapeValue).join(",")}`);
  }

  if (contact.note) lines.push(`NOTE:${escapeValue(contact.note)}`);

  if (contact.kind === "group") {
    lines.push("X-ADDRESSBOOKSERVER-KIND:group");
    for (const uid of contact.groupMemberUids) {
      lines.push(`X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:${uid}`);
    }
  }

  lines.push(`REV:${new Date().toISOString().replace(/\.\d{3}/, "")}`);
  lines.push("END:VCARD");
  return lines.join("\r\n") + "\r\n";
}

function escapeValue(s: string | null | undefined): string {
  if (!s) return "";
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function vcardTypeFromLabel(label: string): string {
  const l = label.toLowerCase();
  if (l === "mobile" || l === "cell" || l === "iphone") return "CELL";
  if (l === "work") return "WORK";
  if (l === "home") return "HOME";
  if (l === "fax") return "FAX";
  if (l === "other") return "OTHER";
  return label.toUpperCase();
}
