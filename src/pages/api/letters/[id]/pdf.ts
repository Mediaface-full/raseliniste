import type { APIRoute } from "astro";
import { promises as fs } from "node:fs";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { renderLetterPdf } from "@/lib/letter-pdf";
import { saveUpload, resolveUpload, uploadExists } from "@/lib/uploads";

export const prerender = false;

/**
 * GET /api/letters/:id/pdf
 *   Vrátí (a cache na disk) PDF dopisu. Pokud cache je platná, jen ji streamne.
 *   Cache se invaliduje při PATCH na content / redact (viz [id].ts a redact.ts).
 *
 * ?download=1 přidá Content-Disposition: attachment.
 */
export const GET: APIRoute = async ({ cookies, params, url }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const id = params.id;
  if (!id) return Response.json({ error: "INVALID_ID" }, { status: 400 });

  const letter = await prisma.letter.findFirst({
    where: { id, userId: session.uid },
    include: { sender: true },
  });
  if (!letter) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  // Cache check
  let pdfBuffer: Buffer;
  if (letter.pdfPath && (await uploadExists(letter.pdfPath))) {
    pdfBuffer = await fs.readFile(resolveUpload(letter.pdfPath));
  } else {
    // Vyrender
    pdfBuffer = await renderLetterPdf({
      sender: {
        name: letter.sender.name,
        legalName: letter.sender.legalName,
        ico: letter.sender.ico,
        dic: letter.sender.dic,
        addressLines: letter.sender.addressLines,
        email: letter.sender.email,
        phone: letter.sender.phone,
        web: letter.sender.web,
        bankAccount: letter.sender.bankAccount,
        logoPath: letter.sender.logoPath,
        signaturePath: letter.sender.signaturePath,
        pdfTheme: letter.sender.pdfTheme,
      },
      recipient: letter.recipientNameSnapshot
        ? {
            name: letter.recipientNameSnapshot,
            addressLines: letter.recipientAddressLinesSnapshot,
            showAddress: letter.showRecipientAddress,
          }
        : null,
      letterDate: letter.letterDate,
      place: letter.place,
      body: letter.bodyFinal,
    });

    const saved = await saveUpload(`letters/${id}`, pdfBuffer, "application/pdf");
    await prisma.letter.update({
      where: { id },
      data: { pdfPath: saved.relativePath, pdfGeneratedAt: new Date() },
    });
  }

  const filename = makeFilename(letter.sender.name, letter.recipientNameSnapshot, letter.letterDate);

  const isDownload = url.searchParams.get("download") === "1";
  // Convert Node Buffer → Uint8Array for Response body (Node Response handles both, but Uint8Array is safer)
  const bodyBytes = new Uint8Array(pdfBuffer.buffer, pdfBuffer.byteOffset, pdfBuffer.byteLength);
  return new Response(bodyBytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdfBuffer.byteLength),
      "Content-Disposition": `${isDownload ? "attachment" : "inline"}; filename="${filename}"`,
      "Cache-Control": "private, max-age=300",
    },
  });
};

function makeFilename(senderName: string, recipientName: string | null, date: Date): string {
  const safeSender = senderName.replace(/[^a-zA-Z0-9-_.]/g, "_").slice(0, 30);
  const safeRecipient = (recipientName ?? "dopis").replace(/[^a-zA-Z0-9-_.]/g, "_").slice(0, 30);
  const isoDate = date.toISOString().slice(0, 10);
  return `dopis_${safeSender}_${safeRecipient}_${isoDate}.pdf`;
}
