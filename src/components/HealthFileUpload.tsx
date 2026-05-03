import { useState, useRef } from "react";
import { Upload, Loader2, Check, AlertTriangle } from "lucide-react";
import { Button } from "./ui/Button";

type Result = {
  ok?: boolean;
  parser?: { metricsTotal?: number; ecgsTotal?: number };
  db?: { metricsInserted?: number; metricsSkipped?: number; ecgsInserted?: number };
  error?: string;
  message?: string;
};

export default function HealthFileUpload() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setResult(null);
    setFileName(file.name);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/health/upload-file", { method: "POST", body: fd });
      const data: Result = await res.json();
      setResult(data);
    } catch (e) {
      setResult({ error: "NETWORK", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
        }}
      />
      <Button
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        variant="outline"
      >
        {busy ? <Loader2 className="animate-spin" /> : <Upload />}
        {busy ? "Nahrávám…" : "Vybrat JSON soubor"}
      </Button>

      {fileName && !busy && (
        <div className="text-xs font-mono text-muted-foreground">{fileName}</div>
      )}

      {result?.ok && (
        <div className="rounded-md border border-[var(--tint-sage)]/30 bg-[var(--tint-sage)]/10 p-3 text-sm flex items-start gap-2">
          <Check className="size-4 text-[var(--tint-sage)] shrink-0 mt-0.5" />
          <div>
            <div className="font-medium text-[var(--tint-sage)]">Hotovo</div>
            <div className="text-xs text-muted-foreground mt-1 font-mono">
              Vloženo: {result.db?.metricsInserted ?? 0} metrik
              {(result.db?.metricsSkipped ?? 0) > 0 && ` · přeskočeno ${result.db?.metricsSkipped} (duplikáty)`}
              {(result.db?.ecgsInserted ?? 0) > 0 && ` · ${result.db?.ecgsInserted} EKG`}
            </div>
          </div>
        </div>
      )}

      {result?.error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm flex items-start gap-2">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">Chyba: {result.error}</div>
            {result.message && <div className="text-xs text-muted-foreground mt-1">{result.message}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
