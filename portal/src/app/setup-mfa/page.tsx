"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { apiFetch, clearAllTokens, setToken } from "@/lib/auth";

type SetupStep = "loading" | "qr" | "recovery" | "error";

export default function SetupMfaPage() {
  const router = useRouter();

  const [step, setStep] = useState<SetupStep>("loading");
  const [secret, setSecret] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    apiFetch("/portal/auth/mfa/setup/start", { method: "POST" })
      .then(r => r.ok ? r.json() : Promise.reject(new Error("Could not start MFA setup")))
      .then(async (data: { secret?: string; provisioning_uri?: string }) => {
        if (!data.secret || !data.provisioning_uri) throw new Error("Invalid setup response");
        setSecret(data.secret);
        const dataUrl = await QRCode.toDataURL(data.provisioning_uri, { width: 200, margin: 1 });
        setQrDataUrl(dataUrl);
        setStep("qr");
      })
      .catch(err => {
        setError((err as Error).message ?? "Failed to start MFA setup");
        setStep("error");
      });
  }, []);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/portal/auth/mfa/setup/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otp_code: otpCode.trim() }),
      });
      const data = await res.json() as {
        ok?: boolean;
        access_token?: string;
        recovery_codes?: string[];
        detail?: string;
      };
      if (!res.ok) throw new Error(data.detail ?? "Verification failed");
      if (data.access_token) setToken(data.access_token);
      setRecoveryCodes(data.recovery_codes ?? []);
      setStep("recovery");
    } catch (err) {
      setError((err as Error).message);
      setOtpCode("");
    } finally {
      setLoading(false);
    }
  }

  function handleDecline() {
    clearAllTokens();
    router.replace("/login");
  }

  function handleCopyCodes() {
    void navigator.clipboard.writeText(recoveryCodes.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }


  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold" style={{ color: "#F26624" }}>NZInsights</h1>
          <p className="mt-2 text-sm text-gray-500">Two-factor authentication setup</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">

          {step === "loading" && (
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="h-8 w-8 rounded-full border-2 border-orange-500 border-t-transparent animate-spin" />
              <p className="text-sm text-gray-500">Preparing your authenticator…</p>
            </div>
          )}

          {step === "error" && (
            <div className="space-y-4">
              <p className="text-sm text-red-600">{error || "Something went wrong. Please sign in again."}</p>
              <button
                onClick={handleDecline}
                className="text-sm text-orange-600 hover:underline"
              >
                Back to sign in
              </button>
            </div>
          )}

          {step === "qr" && (
            <>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Set up authenticator</h2>
              <p className="text-sm text-gray-500 mb-5">
                Two-factor authentication is required to access your portal. Scan the QR code below using an authenticator app (e.g. Google Authenticator, Microsoft Authenticator, or 1Password), then enter the 6-digit code to confirm.
              </p>

              <div className="flex justify-center mb-5">
                {qrDataUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={qrDataUrl}
                    alt="TOTP QR code"
                    className="rounded-lg border border-gray-200 p-2 bg-white"
                    width={200}
                    height={200}
                  />
                )}
              </div>

              <details className="mb-5">
                <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600 select-none">
                  Can&apos;t scan? Enter the code manually
                </summary>
                <div className="mt-2 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
                  <p className="text-xs text-gray-500 mb-1">Enter this key in your app:</p>
                  <code className="text-xs font-mono text-gray-800 break-all">{secret}</code>
                </div>
              </details>

              <form onSubmit={e => void handleVerify(e)} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Authenticator code</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    autoFocus
                    value={otpCode}
                    onChange={e => setOtpCode(e.target.value.replace(/\D/g, ""))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-center tracking-[0.3em] text-xl focus:outline-none focus:ring-2 focus:ring-orange-400"
                    placeholder="000000"
                  />
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <button
                  type="submit"
                  disabled={loading || otpCode.length !== 6}
                  className="w-full rounded-lg py-2.5 text-sm font-semibold text-white disabled:opacity-50 transition-colors"
                  style={{ backgroundColor: "#F26624" }}
                >
                  {loading ? "Verifying…" : "Confirm and enable"}
                </button>
              </form>

              <button
                type="button"
                onClick={handleDecline}
                className="mt-4 text-sm text-gray-400 hover:underline"
              >
                Cancel &amp; sign out
              </button>
            </>
          )}

          {step === "recovery" && (
            <>
              <div className="flex items-center gap-2 mb-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100">
                  <svg className="h-4 w-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h2 className="text-lg font-semibold text-gray-900">MFA enabled</h2>
              </div>
              <p className="text-sm text-gray-500 mb-5">
                Save these recovery codes somewhere safe. Each can be used once if you lose access to your authenticator app.
              </p>

              <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 mb-4">
                <ul className="grid grid-cols-2 gap-y-1.5 gap-x-4">
                  {recoveryCodes.map((code, i) => (
                    <li key={i} className="font-mono text-sm text-gray-800">{code}</li>
                  ))}
                </ul>
              </div>

              <div className="flex gap-3 mb-5">
                <button
                  type="button"
                  onClick={handleCopyCodes}
                  className="flex-1 rounded-lg py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
                >
                  {copied ? "Copied!" : "Copy all codes"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const blob = new Blob([recoveryCodes.join("\n")], { type: "text/plain" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "nzinsights-recovery-codes.txt";
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="flex-1 rounded-lg py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
                >
                  Download
                </button>
              </div>

              <button
                type="button"
                onClick={() => router.replace("/dashboard")}
                className="w-full rounded-lg py-2.5 text-sm font-semibold text-white transition-colors"
                style={{ backgroundColor: "#F26624" }}
              >
                Continue to portal
              </button>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-gray-400">
          &copy; {new Date().getFullYear()} Net Zero International. All rights reserved.
        </p>
      </div>
    </div>
  );
}
