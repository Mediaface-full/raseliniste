import { useState } from "react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { Fingerprint, KeyRound, Loader2, Lock, ShieldCheck, User } from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

type Step = "password" | "verify_passkey" | "enroll_passkey";
type ApiError =
  | "INVALID_CREDENTIALS" | "INVALID_INPUT" | "RATE_LIMITED"
  | "PREAUTH_MISSING" | "NO_PASSKEYS" | "UNKNOWN";

function humanError(code: ApiError | string, scope?: string): string {
  switch (code) {
    case "INVALID_CREDENTIALS": return "Špatné jméno nebo heslo.";
    case "INVALID_INPUT":       return "Vyplň prosím jméno i heslo.";
    case "RATE_LIMITED":
      return scope === "IP_LOCKED"
        ? "Příliš mnoho pokusů z této IP. Zkus to za 15 minut."
        : "Účet dočasně uzamčen. Zkus to za 15 minut.";
    case "PREAUTH_MISSING": return "Relace vypršela. Zadej heslo znovu.";
    case "NO_PASSKEYS":     return "Nemáš žádný passkey. Proveď enrollment.";
    default: return "Něco se pokazilo. Zkus to znovu.";
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground font-mono">
        {label}
      </div>
      {children}
    </div>
  );
}

export default function LoginForm() {
  const [step, setStep] = useState<Step>("password");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submitPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(humanError(data.error ?? "UNKNOWN", data.scope)); return; }
      setPassword("");
      // Petr 2026-06-18 dev bypass: pokud server v dev módu vystavil plnou
      // session rovnou (DEV_SKIP_PASSKEY=1 + localhost), redirect na /.
      if (data.next === "done") {
        window.location.assign("/");
        return;
      }
      setStep(data.next === "enroll_passkey" ? "enroll_passkey" : "verify_passkey");
    } catch { setError(humanError("UNKNOWN")); }
    finally { setPending(false); }
  }

  async function verifyPasskey() {
    setError(null);
    setPending(true);
    try {
      const optsRes = await fetch("/api/auth/passkey/auth-options", { method: "POST" });
      const options = await optsRes.json();
      if (!optsRes.ok) { setError(humanError(options.error ?? "UNKNOWN")); return; }
      const assertion = await startAuthentication({ optionsJSON: options });
      const verifyRes = await fetch("/api/auth/passkey/auth-verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(assertion),
      });
      const data = await verifyRes.json().catch(() => ({}));
      if (!verifyRes.ok) { setError(humanError(data.error ?? "UNKNOWN")); return; }
      window.location.assign("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Passkey se nepovedlo ověřit.");
    } finally { setPending(false); }
  }

  async function enrollPasskey() {
    setError(null);
    setPending(true);
    try {
      const optsRes = await fetch("/api/auth/passkey/register-options", { method: "POST" });
      const options = await optsRes.json();
      if (!optsRes.ok) { setError(humanError(options.error ?? "UNKNOWN")); return; }
      const attestation = await startRegistration({ optionsJSON: options });
      const verifyRes = await fetch("/api/auth/passkey/register-verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(attestation),
      });
      const data = await verifyRes.json().catch(() => ({}));
      if (!verifyRes.ok) { setError(humanError(data.error ?? "UNKNOWN")); return; }
      window.location.assign("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enrollment passkey selhal.");
    } finally { setPending(false); }
  }

  function backToPassword() { setStep("password"); setError(null); setPending(false); }

  if (step === "password") {
    return (
      <form onSubmit={submitPassword} autoComplete="on" className="space-y-4">
        <Field label="Jméno">
          <div className="relative">
            <User className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              name="username"
              autoComplete="username"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={pending}
              className="pl-9"
            />
          </div>
        </Field>

        <Field label="Heslo">
          <div className="relative">
            <Lock className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={pending}
              className="pl-9"
            />
          </div>
        </Field>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 text-destructive-foreground text-sm px-3 py-2" role="alert">
            {error}
          </div>
        )}

        <Button type="submit" className="w-full" disabled={pending || !username || !password}>
          {pending ? <><Loader2 className="animate-spin" /> Ověřuji…</> : <><KeyRound /> Pokračovat</>}
        </Button>
      </form>
    );
  }

  if (step === "verify_passkey") {
    return (
      <div className="space-y-5 text-center">
        <div className="mx-auto size-14 rounded-full border border-border grid place-items-center bg-white/5">
          <ShieldCheck className="size-6 text-primary" />
        </div>
        <div>
          <h3 className="font-serif text-xl">Druhý krok</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Potvrď identitu Touch ID nebo Face ID.
          </p>
        </div>
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2 text-left" role="alert">
            {error}
          </div>
        )}
        <div className="flex gap-2">
          <Button className="flex-1" onClick={verifyPasskey} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Fingerprint />}
            {pending ? "Čekám na passkey…" : "Ověřit passkey"}
          </Button>
          <Button variant="ghost" onClick={backToPassword} disabled={pending}>Zpět</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 text-center">
      <div className="mx-auto size-14 rounded-full border border-border grid place-items-center bg-white/5">
        <Fingerprint className="size-6 text-primary" />
      </div>
      <div>
        <h3 className="font-serif text-xl">Registrace passkey</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Nemáš zatím žádný passkey. Zaregistruj si ho teď — příště se přihlásíš jedním dotykem.
        </p>
      </div>
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2 text-left" role="alert">
          {error}
        </div>
      )}
      <div className="flex gap-2">
        <Button className="flex-1" onClick={enrollPasskey} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Fingerprint />}
          {pending ? "Zapisuji passkey…" : "Zaregistrovat passkey"}
        </Button>
        <Button variant="ghost" onClick={backToPassword} disabled={pending}>Zpět</Button>
      </div>
    </div>
  );
}
