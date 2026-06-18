import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

const STATUS_LABEL: Record<string, string> = {
  aktivni: "Aktivní",
  uzavrene_jdu: "Uzavřeno: Šlo do toho",
  uzavrene_nejdu: "Uzavřeno: Nešlo do toho",
  odlozene: "Odložené",
  archivovane: "Archivováno",
};

const TYP_LABEL: Record<string, string> = {
  novy_fakt_zvenci: "Nový fakt zvenčí",
  nova_uvaha: "Nová úvaha",
  napadlo_me: "Napadlo mě",
  reakce_na_udalost: "Reakce na událost",
};

export const GET: APIRoute = async ({ cookies, params }) => {
  const session = await readSession(cookies);
  if (!session) return new Response("UNAUTHENTICATED", { status: 401 });
  const id = params.id;
  if (!id) return new Response("INVALID_ID", { status: 400 });

  const d = await prisma.decision.findFirst({
    where: { id, userId: session.uid },
    include: {
      entries: { orderBy: { datum: "asc" } },
      evaluations: { orderBy: { datum: "asc" } },
      reopenings: { orderBy: { datum: "asc" } },
    },
  });
  if (!d) return new Response("NOT_FOUND", { status: 404 });

  const lines: string[] = [];
  lines.push(`# ${d.nazev}`, "");
  lines.push(`> ${d.otazka}`, "");
  lines.push(`**Status:** ${STATUS_LABEL[d.status] ?? d.status}  `);
  lines.push(`**Kontext:** ${d.kontext}  `);
  lines.push(`**Vytvořeno:** ${d.datumVytvoreni.toLocaleString("cs-CZ")}  `);
  lines.push(`**Deadline:** ${d.deadlineRozhodnuti.toLocaleDateString("cs-CZ")}  `);
  if (d.datumUzavreni) lines.push(`**Uzavřeno:** ${d.datumUzavreni.toLocaleString("cs-CZ")}  `);
  if (d.datumRevize) lines.push(`**Revize:** ${d.datumRevize.toLocaleDateString("cs-CZ")}  `);
  lines.push("");

  lines.push("## Zarámování");
  lines.push("");
  lines.push("### Varianty");
  (d.varianty as string[]).forEach((v, i) => lines.push(`${i + 1}. ${v}`));
  lines.push("");
  lines.push("### Předpoklady");
  (d.predpoklady as string[]).forEach((p) => lines.push(`- ${p}`));
  lines.push("");

  lines.push(`## Zápisy (${d.entries.length})`);
  lines.push("");
  d.entries.forEach((e) => {
    lines.push(`### ${e.datum.toLocaleString("cs-CZ")}  ·  nálada ${e.nalada}/5`);
    lines.push(`*${TYP_LABEL[e.typVstupu] ?? e.typVstupu} · úhel: ${e.uhelPohledu}${e.uhelPohleduAi ? ` (AI: ${e.uhelPohleduAi})` : ""}*`);
    lines.push("");
    lines.push(e.obsah);
    if (e.audioPath) lines.push(`\n_(audio: ${e.audioPath})_`);
    lines.push("");
  });

  if (d.evaluations.length > 0) {
    lines.push(`## Vyhodnocení (${d.evaluations.length})`);
    lines.push("");
    d.evaluations.forEach((ev) => {
      lines.push(`### ${ev.typ === "finalni" ? "Finální" : "Průběžné"} · ${ev.datum.toLocaleString("cs-CZ")}`);
      lines.push(`_${ev.pocetVstupuVDobeGenerovani} zápisů, model ${ev.modelName ?? "—"}_`);
      lines.push("");
      lines.push("```json");
      lines.push(JSON.stringify(ev.obsahStrukturovany, null, 2));
      lines.push("```");
      lines.push("");
    });
  }

  if (d.reopenings.length > 0) {
    lines.push(`## Znovuotevření (${d.reopenings.length})`);
    lines.push("");
    d.reopenings.forEach((r) => {
      lines.push(`- **${r.datum.toLocaleString("cs-CZ")}** ${r.schvaleno ? "" : ""} — ${r.popisNovehoFaktu}`);
    });
    lines.push("");
  }

  if (d.verdiktText) {
    lines.push("## Finální verdikt");
    lines.push("");
    lines.push(d.verdiktText);
    if (d.coByZmeniloVerdikt) {
      lines.push("");
      lines.push(`**Co by ho překlopilo:** ${d.coByZmeniloVerdikt}`);
    }
    lines.push("");
  }

  const md = lines.join("\n");
  const filename = `bwmys-${d.nazev.replace(/[^a-z0-9-]/gi, "_").slice(0, 60)}-${d.id.slice(-6)}.md`;

  return new Response(md, {
    status: 200,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
};
