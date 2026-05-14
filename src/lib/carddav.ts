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
 * Postup (RFC 6764 + RFC 6352):
 *   1. PROPFIND `/.well-known/carddav` → current-user-principal
 *   2. PROPFIND principal → addressbook-home-set
 *   3. PROPFIND home-set → najít resourcetype=addressbook s největším počtem
 *      kontaktů (typicky první)
 *
 * Vrátí absolutní URL addressbooku.
 */
export async function discoverAddressbook(creds: CardDavCredentials): Promise<string> {
  // Krok 1: principal discovery
  const baseHost = new URL(creds.serverUrl).origin;
  const wellKnown = `${baseHost}/.well-known/carddav`;
  const principalRes = await davRequest(wellKnown, creds, "PROPFIND", `<?xml version="1.0"?>
<d:propfind ${XML_NS}>
  <d:prop>
    <d:current-user-principal/>
  </d:prop>
</d:propfind>`, { Depth: "0" });
  const principalPath = extractTagContent(principalRes.body, "current-user-principal")
    .replace(/<d:href[^>]*>([^<]+)<\/d:href>/i, "$1");
  if (!principalPath) throw new Error("CardDAV: principal discovery selhala (žádný current-user-principal)");

  // Krok 2: addressbook-home-set
  const principalUrl = principalPath.startsWith("http") ? principalPath : `${baseHost}${principalPath}`;
  const homeRes = await davRequest(principalUrl, creds, "PROPFIND", `<?xml version="1.0"?>
<d:propfind ${XML_NS}>
  <d:prop>
    <c:addressbook-home-set/>
  </d:prop>
</d:propfind>`, { Depth: "0" });
  const homeHrefMatch = homeRes.body.match(/<c:addressbook-home-set[^>]*>[\s\S]*?<d:href[^>]*>([^<]+)<\/d:href>/i);
  if (!homeHrefMatch) throw new Error("CardDAV: addressbook-home-set nenalezen");
  const homeUrl = homeHrefMatch[1].startsWith("http") ? homeHrefMatch[1] : `${baseHost}${homeHrefMatch[1]}`;

  // Krok 3: list addressbooků v home-set, vyber první addressbook
  const addressbooksRes = await davRequest(homeUrl, creds, "PROPFIND", `<?xml version="1.0"?>
<d:propfind ${XML_NS}>
  <d:prop>
    <d:resourcetype/>
    <d:displayname/>
  </d:prop>
</d:propfind>`, { Depth: "1" });
  // Najdi response s resourcetype/addressbook
  const responses = splitResponses(addressbooksRes.body);
  for (const resp of responses) {
    if (/<c:addressbook\s*\/>/i.test(resp) || /<carddav:addressbook/i.test(resp)) {
      const href = extractHref(resp);
      if (href && !href.endsWith(homeUrl.replace(baseHost, "")) && !href.endsWith("/")) {
        continue; // ne home samotný
      }
      if (href) {
        return href.startsWith("http") ? href : `${baseHost}${href}`;
      }
    }
  }
  throw new Error("CardDAV: žádný addressbook nenalezen v home-set");
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
    const etag = (resp.match(/<d:getetag[^>]*>([^<]+)<\/d:getetag>/i)?.[1] ?? "").replace(/^"|"$/g, "");
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
      const etag = (resp.match(/<d:getetag[^>]*>([^<]+)<\/d:getetag>/i)?.[1] ?? "").replace(/^"|"$/g, "");
      const vcardMatch = resp.match(/<c:address-data[^>]*>([\s\S]*?)<\/c:address-data>/i);
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

/** Rozdělí PROPFIND/REPORT multistatus na jednotlivé <d:response> bloky. */
function splitResponses(xml: string): string[] {
  const out: string[] = [];
  const re = /<d:response[\s>][\s\S]*?<\/d:response>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.push(m[0]);
  }
  if (out.length === 0) {
    // Některé servery (Google) můžou používat jiný prefix než `d:` — fallback
    const re2 = /<[^:>\s]+:response[\s>][\s\S]*?<\/[^:>\s]+:response>/gi;
    let m2: RegExpExecArray | null;
    while ((m2 = re2.exec(xml)) !== null) out.push(m2[0]);
  }
  return out;
}

function extractHref(responseXml: string): string | null {
  const m = responseXml.match(/<d:href[^>]*>([^<]+)<\/d:href>/i)
    ?? responseXml.match(/<href[^>]*>([^<]+)<\/href>/i);
  return m?.[1] ?? null;
}

function extractTagContent(xml: string, tagName: string): string {
  const re = new RegExp(`<[^:>]*:?${tagName}[^>]*>([\\s\\S]*?)<\\/[^:>]*:?${tagName}>`, "i");
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
