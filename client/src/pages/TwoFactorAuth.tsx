import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Shield, ShieldCheck, ShieldOff, Key, Copy, Check, AlertTriangle, Smartphone, RefreshCw } from "lucide-react";

// Simulated TOTP secret (in production this comes from the server)
const MOCK_SECRET = "JBSWY3DPEHPK3PXP";
const MOCK_BACKUP_CODES = [
  "8f2a-9c4d", "3e7b-1f6a", "5d2c-8b3e", "7a4f-2d1c",
  "9b6e-4a3f", "1c8d-7e2b", "4f3a-6c9d", "2e5b-8f4a",
];

type Step = "status" | "setup-scan" | "setup-verify" | "setup-backup" | "setup-done" | "disable-confirm";

export default function TwoFactorAuth() {
  const { user } = useAuth();
  const [step, setStep] = useState<Step>("status");
  const [verifyCode, setVerifyCode] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [copiedCodes, setCopiedCodes] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  // Simulated 2FA enabled state (in production, read from user profile)
  const [is2FAEnabled, setIs2FAEnabled] = useState(false);
  const [usedBackupCodes, setUsedBackupCodes] = useState<Set<string>>(new Set());

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
    `otpauth://totp/HealthPoint:${user?.email ?? "user"}?secret=${MOCK_SECRET}&issuer=HealthPoint%20IDR`
  )}`;

  function handleVerify() {
    // Simulate TOTP verification (accept any 6-digit code for demo)
    if (!/^\d{6}$/.test(verifyCode)) {
      toast.error("Please enter a valid 6-digit code");
      return;
    }
    setStep("setup-backup");
    toast.success("Code verified successfully");
  }

  function handleSaveBackupCodes() {
    setStep("setup-done");
  }

  function handleFinish() {
    setIs2FAEnabled(true);
    setStep("status");
    toast.success("Two-factor authentication enabled");
  }

  function handleDisable() {
    if (!/^\d{6}$/.test(disableCode)) {
      toast.error("Please enter a valid 6-digit code");
      return;
    }
    setIs2FAEnabled(false);
    setStep("status");
    setDisableCode("");
    toast.success("Two-factor authentication disabled");
  }

  function copySecret() {
    navigator.clipboard.writeText(MOCK_SECRET);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 2000);
  }

  function copyBackupCodes() {
    navigator.clipboard.writeText(MOCK_BACKUP_CODES.join("\n"));
    setCopiedCodes(true);
    setTimeout(() => setCopiedCodes(false), 2000);
  }

  return (
    <DashboardLayout>
      <div className="p-6 max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${is2FAEnabled ? "bg-green-100" : "bg-slate-100"}`}>
            {is2FAEnabled ? <ShieldCheck size={20} className="text-green-600" /> : <Shield size={20} className="text-slate-500" />}
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Two-Factor Authentication</h1>
            <p className="text-sm text-slate-500">Add an extra layer of security to your account</p>
          </div>
          {is2FAEnabled && <Badge className="ml-auto bg-green-100 text-green-700">Enabled</Badge>}
        </div>

        {/* Status Screen */}
        {step === "status" && (
          <Card className="border-slate-200">
            <CardContent className="pt-6 space-y-4">
              {is2FAEnabled ? (
                <>
                  <div className="flex items-center gap-3 p-4 rounded-lg bg-green-50 border border-green-200">
                    <ShieldCheck size={20} className="text-green-600 shrink-0" />
                    <div>
                      <div className="font-semibold text-sm text-green-800">2FA is active</div>
                      <div className="text-xs text-green-600">Your account is protected with an authenticator app</div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-slate-700">Backup Codes</div>
                    <p className="text-xs text-slate-500">You have {MOCK_BACKUP_CODES.length - usedBackupCodes.size} of {MOCK_BACKUP_CODES.length} backup codes remaining.</p>
                    <Button variant="outline" size="sm" onClick={() => { setUsedBackupCodes(new Set()); toast.success("Backup codes regenerated"); }}>
                      <RefreshCw size={14} className="mr-2" />Regenerate Backup Codes
                    </Button>
                  </div>
                  <div className="border-t border-slate-200 pt-4">
                    <Button variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => setStep("disable-confirm")}>
                      <ShieldOff size={14} className="mr-2" />Disable Two-Factor Authentication
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-3 p-4 rounded-lg bg-amber-50 border border-amber-200">
                    <AlertTriangle size={20} className="text-amber-600 shrink-0" />
                    <div>
                      <div className="font-semibold text-sm text-amber-800">2FA is not enabled</div>
                      <div className="text-xs text-amber-600">Enable two-factor authentication to secure your account</div>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="text-sm text-slate-600">Two-factor authentication adds a second verification step when you sign in, protecting your account even if your password is compromised.</div>
                    <div className="grid grid-cols-1 gap-2">
                      {[
                        { icon: Smartphone, text: "Works with Google Authenticator, Authy, 1Password, and other TOTP apps" },
                        { icon: Key, text: "8 one-time backup codes for emergency access" },
                        { icon: Shield, text: "Required for admin operations and sensitive data access" },
                      ].map(item => (
                        <div key={item.text} className="flex items-start gap-2 text-xs text-slate-600">
                          <item.icon size={14} className="text-blue-500 mt-0.5 shrink-0" />
                          {item.text}
                        </div>
                      ))}
                    </div>
                  </div>
                  <Button onClick={() => setStep("setup-scan")} className="w-full">
                    <Shield size={14} className="mr-2" />Enable Two-Factor Authentication
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Step 1: Scan QR Code */}
        {step === "setup-scan" && (
          <Card className="border-slate-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center">1</span>
                Scan QR Code
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-slate-600">Open your authenticator app and scan the QR code below, or enter the secret key manually.</p>
              <div className="flex justify-center">
                <img src={qrUrl} alt="TOTP QR Code" className="w-48 h-48 rounded-lg border border-slate-200" />
              </div>
              <div className="space-y-2">
                <div className="text-xs font-medium text-slate-500">Manual entry key</div>
                <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 border border-slate-200">
                  <code className="flex-1 text-xs font-mono text-slate-700 tracking-wider">{MOCK_SECRET}</code>
                  <button onClick={copySecret} className="text-slate-400 hover:text-blue-600">
                    {copiedSecret ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                  </button>
                </div>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep("status")}>Cancel</Button>
                <Button onClick={() => setStep("setup-verify")} className="flex-1">Next: Verify Code</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Verify Code */}
        {step === "setup-verify" && (
          <Card className="border-slate-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center">2</span>
                Verify Your Authenticator
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-slate-600">Enter the 6-digit code from your authenticator app to confirm setup.</p>
              <Input
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={verifyCode}
                onChange={e => setVerifyCode(e.target.value.replace(/\D/g, ""))}
                className="text-center text-2xl font-mono tracking-widest h-14"
              />
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep("setup-scan")}>Back</Button>
                <Button onClick={handleVerify} className="flex-1" disabled={verifyCode.length !== 6}>
                  Verify Code
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Backup Codes */}
        {step === "setup-backup" && (
          <Card className="border-slate-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center">3</span>
                Save Backup Codes
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
                <AlertTriangle size={14} className="text-amber-600 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-800">Save these codes in a safe place. Each code can only be used once. You will not be able to see them again.</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {MOCK_BACKUP_CODES.map(code => (
                  <div key={code} className="p-2 rounded-lg bg-slate-50 border border-slate-200 text-center">
                    <code className="text-sm font-mono text-slate-700">{code}</code>
                  </div>
                ))}
              </div>
              <Button variant="outline" onClick={copyBackupCodes} className="w-full">
                {copiedCodes ? <Check size={14} className="mr-2 text-green-500" /> : <Copy size={14} className="mr-2" />}
                {copiedCodes ? "Copied!" : "Copy All Codes"}
              </Button>
              <Button onClick={handleSaveBackupCodes} className="w-full">I've saved my backup codes</Button>
            </CardContent>
          </Card>
        )}

        {/* Step 4: Done */}
        {step === "setup-done" && (
          <Card className="border-green-200 bg-green-50">
            <CardContent className="pt-6 text-center space-y-4">
              <div className="flex justify-center">
                <div className="p-4 rounded-full bg-green-100">
                  <ShieldCheck size={32} className="text-green-600" />
                </div>
              </div>
              <div>
                <h3 className="text-lg font-bold text-green-800">Setup Complete!</h3>
                <p className="text-sm text-green-600 mt-1">Two-factor authentication has been configured for your account.</p>
              </div>
              <Button onClick={handleFinish} className="bg-green-600 hover:bg-green-700 text-white">
                Done
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Disable Confirmation */}
        {step === "disable-confirm" && (
          <Card className="border-red-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-red-700 flex items-center gap-2">
                <ShieldOff size={14} />Disable Two-Factor Authentication
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-red-50 border border-red-200">
                <AlertTriangle size={14} className="text-red-600 mt-0.5 shrink-0" />
                <p className="text-xs text-red-800">Disabling 2FA will make your account less secure. You will need to re-enable it to access admin features.</p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Enter your current 2FA code to confirm</label>
                <Input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  value={disableCode}
                  onChange={e => setDisableCode(e.target.value.replace(/\D/g, ""))}
                  className="text-center text-xl font-mono tracking-widest h-12"
                />
              </div>
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep("status")}>Cancel</Button>
                <Button
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                  disabled={disableCode.length !== 6}
                  onClick={handleDisable}
                >
                  Disable 2FA
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
