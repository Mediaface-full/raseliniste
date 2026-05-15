/**
 * CardDAV klient pro iCloud + Google Workspace sync.
 *
 * Petr 2026-05-14 (kontakty_brief.md fáze 1.2): vlastní implementace,
 * žádné npm závislosti. Pokrývá:
 *   - Service discovery (.well-known/carddav → principal → addressbook-home → addressbooks)
 *   - PROPFIND Depth:1 (list href + etag všech vCard v addressbook)
 *   - REPORT addressbook-multiget (bulk fetch vCard obsahu)
 *   - PUT vCard (s If-Match: etag pro optimistic concurrency)
 *   - DELETE vCard
 *
 * Auth: HTTP Basic (Apple ID / Google account email + app-specific password).
 *
 * iCloud podporuje plný RFC 6352 CardDAV. Google CardDAV je v experimentálním
 * stavu od 2024 (původně přes People API), ale Basic Auth funguje.
 */

import { Buffer } from "node:buffer";

export interface CardDavCredentials {
  serverUrl: string;        // např. "https://contacts.icloud.com"
  username: string;         // Apple ID / Google email
  password: string;         // app-specific password
}

export interface CardDavItem {
  href: string;             // server-relative path k vCard, např. "/123/carddavhome/card/ABC123.vcf"
  etag: string;             // ETag pro If-Match concurrency
  vcard: string | null;     // raw vCard string (jen po REPORT multiget)
}

const XML_NS = `xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav"`;

// ============================================================================
// Discovery
// ============================================================================

/**
 * Najde URL hlavního addressbooku pro daný user.
 *
 * Apple iCloud specifika:
 *   - .well-known/carddav existuje ale chová se nestabilně (někdy 401, někdy
 *     redirect bez Authorization header)
 *   - PROPFIND přímo na https://contacts.icloud.com/ vrací 207 s
 *     current-user-principal nebo 301 redirect na p<DC>-contacts.icloud.com
 *   - userId v URL je číselný (např. "/12345678/principal/")
 *
 * Strategie:
 *   1. PROPFIND na server root → najít current-user-principal (Apple typicky
 *      redirectne na p<DC> server, fetch follow=true to vyřeší)
 *   2. PROPFIND principal → addressbook-home-set
 *   3. PROPFIND home-set Depth:1 → najít resourcetype=addressbook
 *
 * Petr 2026-05-15: Apple kalendář funguje, kontakty selhávaly — fix přechodem
 * z .well-known na přímý PROPFIND root.
 */
export async function discoverAddressbook(creds: CardDavCredentials): Promise<string> {
  let baseHost = new URL(creds.serverUrl).origin;

  // Krok 1: PROPFIND root → current-user-principal
  // Apple iCloud někdy redirectne 301 na p<DC>-contacts.icloud.com. Pokud
  // fetch redirect zachytí, body parsing pokračuje normálně. Jinak retry s
  // novou URL.
  const principalRes = await davRequest(`${baseHost}/`, creds, "PROPFIND", `<?xml version="1.0"?>
<d:propfind ${XML_NS}>
  <d:prop>
    <d:current-user-principal/>
  </d:prop>
</d:propfind>`, { Depth: "0" });

  if (principalRes.status >= 400) {
    throw new Error(`CardDAV: PROPFIND root selhal (HTTP ${principalRes.status}). Body: ${principalRes.body.slice(0, 300)}`);
  }

  // Apple může přesměrovat redirect — fetch ho followuje. Detekuj nový host
  // ze samotného principal href (může být absolutní URL na p<DC>).
  let principalPath = "";
  // Apple iCloud používá default DAV: namespace (bez prefixu). Sabre/Radicale
  // používají `d:` prefix. Regex tolerantní na obě.
  const principalMatch = principalRes.body.match(/<(?:\w+:)?current-user-principal[^>]*>[\s\S]*?<(?:\w+:)?href[^>]*>([^<]+)<\/(?:\w+:)?href>/i);
  if (principalMatch) {
    principalPath = principalMatch[1].trim();
  }

  if (!principalPath) {
    throw new Error(`CardDAV: principal discovery selhala (žádný current-user-principal v response). Body preview: ${principalRes.body.slice(0, 400)}`);
  }

  // Sestav principal URL (může být absolutní nebo relativní)
  let principalUrl: string;
  if (principalPath.startsWith("http")) {
    principalUrl = principalPath;
    // Update baseHost pro další requesty (Apple může přesměrovat na p<DC>-)
    baseHost = new URL(principalUrl).origin;
  } else {
    principalUrl = `${baseHost}${principalPath}`;
  }

  // Krok 2: PROPFIND principal → addressbook-home-set
  const homeRes = await davRequest(principalUrl, creds, "PROPFIND", `<?xml version="1.0"?>
<d:propfind ${XML_NS}>
  <d:prop>
    <c:addressbook-home-set/>
  </d:prop>
</d:propfind>`, { Depth: "0" });

  if (homeRes.status >= 400) {
    throw new Error(`CardDAV: PROPFIND principal selhal (HTTP ${homeRes.status}). URL: ${principalUrl}. Body: ${homeRes.body.slice(0, 300)}`);
  }

  const homeHrefMatch = homeRes.body.match(/<(?:\w+:)?addressbook-home-set[^>]*>[\s\S]*?<(?:\w+:)?href[^>]*>([^<]+)<\/(?:\w+:)?href>/i);
  if (!homeHrefMatch) {
    throw new Error(`CardDAV: addressbook-home-set nenalezen v response. Body preview: ${homeRes.body.slice(0, 400)}`);
  }

  const homeHref = homeHrefMatch[1].trim();
  let homeUrl: string;
  if (homeHref.startsWith("http")) {
    homeUrl = homeHref;
    baseHost = new URL(homeUrl).origin;
  } else {
    homeUrl = `${baseHost}${homeHref}`;
  }

  // Krok 3: PROPFIND home-set Depth:1 → list addressbooků
  const addressbooksRes = await davRequest(homeUrl, creds, "PROPFIND", `<?xml version="1.0"?>
<d:propfind ${XML_NS}>
  <d:prop>
    <d:resourcetype/>
    <d:displayname/>
  </d:prop>
</d:propfind>`, { Depth: "1" });

  if (addressbooksRes.status >= 400) {
    throw new Error(`CardDAV: PROPFIND home-set selhal (HTTP ${addressbooksRes.status}). URL: ${homeUrl}. Body: ${addressbooksRes.body.slice(0, 300)}`);
  }

  // Najdi response s resourcetype/addressbook
  // Apple iCloud: `<addressbook xmlns="urn:ietf:params:xml:ns:carddav"/>` —
  // empty self-closing element s namespace declaration nebo bez prefixu.
  const responses = splitResponses(addressbooksRes.body);
  for (const resp of responses) {
    const isAddressbook = /<(?:\w+:)?addressbook[\s/>]/i.test(resp);
    if (!isAddressbook) continue;

    const href = extractHref(resp);
    if (!href) continue;
    // Skip pokud je to home-set samotný (nemá addressbook resourcetype, ale
    // některé servery to tak vrátí — defenzivně skipni endpoint na "/" alone)
    const normalizedHomeHref = new URL(homeUrl).pathname.replace(/\/$/, "");
    const normalizedHref = href.startsWith("http") ? new URL(href).pathname : href;
    if (normalizedHref.replace(/\/$/, "") === normalizedHomeHref) continue;

    return href.startsWith("http") ? href : `${baseHost}${href}`;
  }
  throw new Error(`CardDAV: žádný addressbook nenalezen v home-set ${homeUrl}. Response: ${addressbooksRes.body.slice(0, 400)}`);
}

// ============================================================================
// List + fetch
// ============================================================================

/**
 * PROPFIND Depth:1 — vrátí seznam všech vCard v addressbook (href + etag).
 * Bez obsahu vCard — to získáme bulk fetchem REPORT multiget.
 */
export async function listAddressbookItems(
  addressbookUrl: string,
  creds: CardDavCredentials,
): Promise<Array<{ href: string; etag: string }>> {
  const res = await davRequest(addressbookUrl, creds, "PROPFIND", `<?xml version="1.0"?>
<d:propfind ${XML_NS}>
  <d:prop>
    <d:getetag/>
  </d:prop>
</d:propfind>`, { Depth: "1" });

  const items: Array<{ href: string; etag: string }> = [];
  const responses = splitResponses(res.body);
  for (const resp of responses) {
    const href = extractHref(resp);
    const etag = (resp.match(/<(?:\w+:)?getetag[^>]*>([^<]+)<\/(?:\w+:)?getetag>/i)?.[1] ?? "").replace(/^"|"$/g, "");
    if (!href || !etag) continue;
    // Skip self (addressbook samotný — má prázdný etag nebo končí /)
    if (href.endsWith("/") || !etag) continue;
    items.push({ href, etag });
  }
  return items;
}

/**
 * REPORT addressbook-multiget — bulk fetch vCard obsahu pro seznam href.
 * Max ~100 href per call, Apple limit. Pro větší addressbooky chunk.
 */
export async function fetchAddressbookItems(
  addressbookUrl: string,
  creds: CardDavCredentials,
  hrefs: string[],
): Promise<CardDavItem[]> {
  if (hrefs.length === 0) return [];
  const CHUNK = 100;
  const out: CardDavItem[] = [];
  for (let i = 0; i < hrefs.length; i += CHUNK) {
    const chunk = hrefs.slice(i, i + CHUNK);
    const hrefXml = chunk.map((h) => `<d:href>${escapeXml(h)}</d:href>`).join("");
    const res = await davRequest(addressbookUrl, creds, "REPORT", `<?xml version="1.0"?>
<c:addressbook-multiget ${XML_NS}>
  <d:prop>
    <d:getetag/>
    <c:address-data/>
  </d:prop>
  ${hrefXml}
</c:addressbook-multiget>`, { Depth: "1" });

    const responses = splitResponses(res.body);
    for (const resp of responses) {
      const href = extractHref(resp);
      const etag = (resp.match(/<(?:\w+:)?getetag[^>]*>([^<]+)<\/(?:\w+:)?getetag>/i)?.[1] ?? "").replace(/^"|"$/g, "");
      const vcardMatch = resp.match(/<(?:\w+:)?address-data[^>]*>([\s\S]*?)<\/(?:\w+:)?address-data>/i);
      const vcard = vcardMatch ? decodeXmlEntities(vcardMatch[1]) : null;
      if (href && etag && vcard) {
        out.push({ href, etag, vcard });
      }
    }
  }
  return out;
}

// ============================================================================
// PUT + DELETE
// ============================================================================

/**
 * Upload vCard na CardDAV server. Pokud existingEtag, použije If-Match
 * (optimistic concurrency — server odmítne 412 pokud někdo mezitím
 * vCard upravil z jiného zařízení).
 *
 * Vrátí nový etag z `ETag` response header.
 */
export async function putVCard(
  url: string,
  creds: CardDavCredentials,
  vcardBody: string,
  existingEtag?: string | null,
): Promise<{ etag: string | null; status: number }> {
  const headers: Record<string, string> = {
    "Content-Type": "text/vcard; charset=utf-8",
  };
  if (existingEtag) headers["If-Match"] = existingEtag;
  else headers["If-None-Match"] = "*"; // jen new, ne overwrite

  const res = await rawRequest(url, creds, "PUT", vcardBody, headers);
  if (res.status === 412) {
    throw new Error(`CardDAV PUT 412 Precondition Failed — vCard byl upraven z jiného zařízení. Sync nejdřív stáhne změny a zkus znovu.`);
  }
  if (res.status >= 400) {
    throw new Error(`CardDAV PUT ${res.status}: ${res.body.slice(0, 200)}`);
  }
  const etag = res.headers.get("etag") ?? res.headers.get("ETag") ?? null;
  return { etag: etag?.replace(/^"|"$/g, "") ?? null, status: res.status };
}

export async function deleteVCard(
  url: string,
  creds: CardDavCredentials,
  existingEtag?: string | null,
): Promise<void> {
  const headers: Record<string, string> = {};
  if (existingEtag) headers["If-Match"] = existingEtag;
  const res = await rawRequest(url, creds, "DELETE", "", headers);
  if (res.status >= 400 && res.status !== 404) {
    throw new Error(`CardDAV DELETE ${res.status}: ${res.body.slice(0, 200)}`);
  }
}

// ============================================================================
// Test connection (pro Settings UI)
// ============================================================================

export async function testConnection(creds: CardDavCredentials): Promise<{
  ok: boolean;
  addressbookUrl?: string;
  itemCount?: number;
  error?: string;
}> {
  try {
    const ab = await discoverAddressbook(creds);
    const items = await listAddressbookItems(ab, creds);
    return { ok: true, addressbookUrl: ab, itemCount: items.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ============================================================================
// LOW-LEVEL HTTP
// ============================================================================

async function davRequest(
  url: string,
  creds: CardDavCredentials,
  method: "PROPFIND" | "REPORT",
  body: string,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; body: string; headers: Headers }> {
  return rawRequest(url, creds, method, body, {
    "Content-Type": "application/xml; charset=utf-8",
    ...extraHeaders,
  });
}

async function rawRequest(
  url: string,
  creds: CardDavCredentials,
  method: string,
  body: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: string; headers: Headers }> {
  const auth = Buffer.from(`${creds.username}:${creds.password}`).toString("base64");
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      ...headers,
    },
    body: body || undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text, headers: res.headers };
}

// ============================================================================
// XML PARSING HELPERS (jednoduché regex pro CardDAV-specific XML)
// ============================================================================

/**
 * Rozdělí PROPFIND/REPORT multistatus na jednotlivé <response> bloky.
 *
 * Apple iCloud používá DEFAULT XML namespace (`<multistatus xmlns="DAV:">`)
 * bez prefixu — `<response>`. Sabre/Radicale a další servery používají
 * prefix `<d:response>`. Regex tolerantní na obě varianty.
 */
function splitResponses(xml: string): string[] {
  const out: string[] = [];
  // (?:\w+:)? = volitelný prefix s `:` (např. `d:` nebo žádný)
  const re = /<(?:\w+:)?response[\s>][\s\S]*?<\/(?:\w+:)?response>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.push(m[0]);
  }
  return out;
}

function extractHref(responseXml: string): string | null {
  const m = responseXml.match(/<(?:\w+:)?href[^>]*>([^<]+)<\/(?:\w+:)?href>/i);
  return m?.[1]?.trim() ?? null;
}

function extractTagContent(xml: string, tagName: string): string {
  const re = new RegExp(`<(?:\\w+:)?${tagName}[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tagName}>`, "i");
  return xml.match(re)?.[1] ?? "";
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
