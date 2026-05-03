import { Download, ArrowLeft, Printer } from "lucide-react";
import { Button } from "../ui/Button";

type Meta = {
  days: number;
  totalSamples: number;
  metricsWithData: number;
  model: string;
  focus: string | null;
  createdAt: string;
};

export default function HealthAnalysisActions({
  id,
  text,
  fromIso,
  toIso,
  meta,
}: {
  id: string;
  text: string;
  fromIso: string;
  toIso: string;
  meta: Meta;
}) {
  void id;

  function downloadMarkdown() {
    const header =
      `# Analýza zdravotních dat\n\n` +
      `- Období: **${fromIso} → ${toIso}** (${meta.days} dní)\n` +
      `- Záznamů: ${meta.totalSamples.toLocaleString("cs-CZ")}\n` +
      `- Metrik s daty: ${meta.metricsWithData}\n` +
      `- Model: ${meta.model}\n` +
      (meta.focus ? `- Pokyn: ${meta.focus}\n` : "") +
      `- Vygenerováno: ${new Date(meta.createdAt).toLocaleString("cs-CZ")}\n\n---\n\n`;
    const blob = new Blob([header + text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `health-${fromIso}_${toIso}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <a
        href="/health"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-white/5 hover:bg-white/10 text-sm transition-colors"
      >
        <ArrowLeft className="size-4" /> Zpět
      </a>
      <Button variant="outline" size="sm" onClick={downloadMarkdown}>
        <Download /> Stáhnout (.md)
      </Button>
      <Button variant="outline" size="sm" onClick={() => window.print()}>
        <Printer /> Vytisknout / PDF
      </Button>
    </div>
  );
}
