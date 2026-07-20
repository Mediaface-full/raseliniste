import { useEffect, useRef, useState } from "react";
import { Upload, Loader2, Trash2, FileText, RefreshCw, AlertTriangle, Check } from "lucide-react";
import { Button } from "../ui/Button";

interface LabReport {
  id: string;
  filename: string;
  sampledAt: string | null;
  labName: string | null;
  status: string;
  processingError: string | null;
  createdAt: string;
  resultCount: number;
}

/**
 * Upload PDF + seznam reportů. Fire-and-forget pattern: po uploadu se objeví
 * řádek "zpracovává se", tiché polling à 4 s; po dokončení reload stránky
 * (grafy i tabulka jsou SSR).
 */
export default function LabReportsPanel({ initialReports }: { initialReports: LabReport[] }) {
  const [reports, setReports] = useState<LabReport[]>(initialReports);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hadProcessing = useRef(initialReports.some((r) => r.status === "processing"));

  async function refresh(): Promise<LabReport[]> {
    const res = await fetch("/api/health/labs");
    const data = await res.json();
    if (res.ok) setReports(data.reports);
    return data.reports ?? [];
  }

  // Tiché polling dokud něco běží; jakmile poslední doběhne, reload
  // stránky ať se překreslí SSR tabulka + grafy.
  useEffect(() => {
    const anyProcessing = reports.some((r) => r.status === "processing");
    if (anyProcessing) hadProcessing.current = true;
    if (!anyProcessing) {
      if (hadProcessing.current) window.location.reload();
      return;
    }
    const t = setTimeout(async () => { await refresh(); }, 4000);
    return () => clearTimeout(t);
  }, [reports]);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/health/labs", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) { setError(`${file.name}: ${data.error ?? "chyba"}`); break; }
      }
      await refresh();
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove(r: LabReport) {
    if (!confirm(`Smazat report „${r.filename}" včetně ${r.resultCount} hodnot?`)) return;
    const res = await fetch(`/api/health/labs/${r.id}`, { method: "DELETE" });
    if (res.ok) window.location.reload();
    else setError("Smazání se nepovedlo.");
  }

  async function retry(r: LabReport) {
    await fetch(`/api/health/labs/${r.id}`, { method: "POST" });
    await refresh();
  }

  const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString("cs-CZ") : "—");

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="hidden"
        onChange={(e) => upload(e.target.files)}
      />
      <div className="flex items-center gap-3 flex-wrap">
        <Button onClick={() => inputRef.current?.click()} disabled={uploading} variant="outline">
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          Nahrát PDF s výsledky
        </Button>
        <span className="text-xs text-muted-foreground">
          Lze vybrat víc souborů najednou — i starou historii.
        </span>
      </div>

      {error && <div className="text-sm text-[var(--destructive,#e5484d)]">{error}</div>}

      {reports.length > 0 && (
        <div className="space-y-1">
          {reports.map((r) => (
            <div key={r.id} className="flex items-center gap-3 text-sm rounded-md px-2 py-1.5 bg-black/10">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate">
                  <span className="font-mono text-xs text-muted-foreground mr-2">{fmtDate(r.sampledAt)}</span>
                  {r.filename}
                  {r.labName && <span className="text-muted-foreground"> · {r.labName}</span>}
                </div>
                {r.status === "error" && (
                  <div className="text-xs text-[var(--destructive,#e5484d)] truncate">{r.processingError}</div>
                )}
              </div>
              {r.status === "processing" && (
                <span className="text-xs font-mono text-muted-foreground">zpracovává se…</span>
              )}
              {r.status === "ready" && (
                <span className="inline-flex items-center gap-1 text-xs font-mono text-[var(--tint-sage)]">
                  <Check className="size-3.5" /> {r.resultCount} hodnot
                </span>
              )}
              {r.status === "error" && (
                <>
                  <AlertTriangle className="size-4 text-[var(--destructive,#e5484d)]" />
                  <Button variant="ghost" size="sm" onClick={() => retry(r)} title="Zkusit extrakci znovu">
                    <RefreshCw className="size-4" />
                  </Button>
                </>
              )}
              <a
                href={`/api/health/labs/${r.id}/pdf`}
                target="_blank"
                rel="noopener"
                className="text-xs font-mono text-[var(--tint-sky)] hover:underline shrink-0"
              >
                PDF
              </a>
              <Button variant="ghost" size="sm" onClick={() => remove(r)} title="Smazat report i hodnoty">
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
