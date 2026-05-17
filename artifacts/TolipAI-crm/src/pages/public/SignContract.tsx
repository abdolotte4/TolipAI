import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { Loader2, CheckCircle2, XCircle, FileSignature, AlertTriangle, Shield } from "lucide-react";

type ContractStatus = "loading" | "ready" | "signed" | "error" | "submitting" | "success";

interface ContractData {
  id: number;
  contractType: string;
  sellerName: string;
  buyerName: string;
  propertyAddress: string;
  purchasePrice: string;
  earnestMoney: string;
  closingDays: number;
  status: string;
  documentHtml: string;
  createdAt: string;
}

export default function SignContract() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [status, setStatus] = useState<ContractStatus>("loading");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [contract, setContract] = useState<ContractData | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [signerName, setSignerName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [nameError, setNameError] = useState("");

  useEffect(() => {
    if (!token) { setStatus("error"); setErrorMsg("Invalid signing link."); return; }
    fetch(`/api/crm/contracts/public/sign/${token}`)
      .then(async r => {
        const data = await r.json();
        if (!r.ok) { setErrorMsg(data.error || "Unable to load contract"); setStatus("error"); return; }
        if (data.status === "signed") { setStatus("signed"); return; }
        setContract(data);
        setStatus("ready");
      })
      .catch(() => { setErrorMsg("Network error. Please try again."); setStatus("error"); });
  }, [token]);

  async function handleSign(e: React.FormEvent) {
    e.preventDefault();
    if (!signerName.trim()) { setNameError("Please type your full legal name to sign."); return; }
    if (!agreed) { setNameError("You must agree to the terms before signing."); return; }
    if (!contract) return;

    setNameError("");
    setIsSubmitting(true);
    try {
      const r = await fetch(`/api/crm/contracts/public/sign/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signerName: signerName.trim(), agreed }),
      });
      const data = await r.json();
      if (!r.ok) { setErrorMsg(data.error || "Signing failed"); setStatus("error"); return; }
      setStatus("success");
    } catch { setErrorMsg("Network error. Please try again."); setStatus("error"); } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-4 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center">
              <FileSignature className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-slate-800 text-sm">TolipAI · E-Sign</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Shield className="w-3.5 h-3.5 text-emerald-500" />
            Secured &amp; Timestamped
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-10">

        {/* Loading */}
        {status === "loading" && (
          <div className="text-center py-24">
            <Loader2 className="w-8 h-8 animate-spin text-violet-600 mx-auto mb-4" />
            <p className="text-slate-500 text-sm">Loading your contract…</p>
          </div>
        )}

        {/* Error */}
        {status === "error" && (
          <div className="text-center py-24">
            <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
            <h1 className="text-xl font-bold text-slate-800 mb-2">Unable to Open Contract</h1>
            <p className="text-slate-500 text-sm max-w-sm mx-auto">{errorMsg}</p>
          </div>
        )}

        {/* Already signed */}
        {status === "signed" && (
          <div className="text-center py-24">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
            <h1 className="text-xl font-bold text-slate-800 mb-2">Already Signed</h1>
            <p className="text-slate-500 text-sm">This contract has already been executed. You will receive a copy by email.</p>
          </div>
        )}

        {/* Success */}
        {status === "success" && (
          <div className="text-center py-24">
            <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="w-10 h-10 text-emerald-600" />
            </div>
            <h1 className="text-2xl font-bold text-slate-800 mb-3">Contract Signed!</h1>
            <p className="text-slate-500 text-sm max-w-sm mx-auto mb-4">
              Your signature has been recorded for <strong>{contract?.propertyAddress}</strong>.
              A confirmation will be sent to your email if provided.
            </p>
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 border border-emerald-200 px-4 py-2 text-sm text-emerald-700 font-medium">
              <Shield className="w-4 h-4" />
              Signed by: {signerName} · {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            </div>
          </div>
        )}

        {/* Ready to sign */}
        {status === "ready" && contract && (
          <div className="space-y-6">
            {/* Property banner */}
            <div className="bg-violet-50 border border-violet-200 rounded-2xl p-5">
              <p className="text-xs font-semibold text-violet-600 uppercase tracking-wide mb-1">
                {contract.contractType === "assignment" ? "Assignment of Contract" : "Purchase Agreement"}
              </p>
              <p className="text-lg font-bold text-slate-800">{contract.propertyAddress}</p>
              <div className="flex flex-wrap gap-4 mt-3 text-sm text-slate-600">
                <span><span className="font-medium">Seller:</span> {contract.sellerName}</span>
                <span><span className="font-medium">Buyer:</span> {contract.buyerName}</span>
                <span><span className="font-medium">Price:</span> ${parseFloat(contract.purchasePrice).toLocaleString()}</span>
                <span><span className="font-medium">Closes in:</span> {contract.closingDays} days</span>
              </div>
            </div>

            {/* Document preview */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="bg-slate-50 border-b border-slate-200 px-5 py-3 flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-700">Full Agreement</span>
                <span className="text-xs text-slate-400">Scroll to read before signing</span>
              </div>
              <div
                className="p-0 overflow-y-auto max-h-[500px]"
                dangerouslySetInnerHTML={{ __html: contract.documentHtml }}
              />
            </div>

            {/* Signing form */}
            <form onSubmit={handleSign} className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-5">
              <div>
                <h2 className="text-base font-bold text-slate-800 mb-1">Sign this Agreement</h2>
                <p className="text-sm text-slate-500">Type your full legal name below to apply your electronic signature.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Full Legal Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={signerName}
                  onChange={e => { setSignerName(e.target.value); setNameError(""); }}
                  placeholder="e.g. John Michael Smith"
                  className="w-full border border-slate-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent font-medium tracking-wide"
                  style={{ fontFamily: "'Dancing Script', cursive, sans-serif", fontSize: "16px" }}
                />
                {signerName && (
                  <div className="mt-2 p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <p className="text-xs text-slate-400 mb-1">Signature preview</p>
                    <p className="text-xl text-slate-700" style={{ fontFamily: "'Brush Script MT', cursive" }}>
                      {signerName}
                    </p>
                  </div>
                )}
              </div>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={e => { setAgreed(e.target.checked); setNameError(""); }}
                  className="mt-0.5 w-4 h-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                />
                <span className="text-sm text-slate-600 leading-relaxed">
                  I have read and understand the full agreement above. I agree to all terms and conditions, and I understand that this electronic signature is legally binding.
                </span>
              </label>

              {nameError && (
                <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {nameError}
                </div>
              )}

              <button
                type="submit"
                disabled={!signerName || !agreed || isSubmitting}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3.5 text-sm transition-colors"
              >
                {isSubmitting ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Signing…</>
                ) : (
                  <><FileSignature className="w-4 h-4" /> Sign Agreement</>
                )}
              </button>

              <p className="text-center text-xs text-slate-400">
                By signing, you agree that this constitutes your legal electronic signature.
                Your IP address and timestamp will be recorded.
              </p>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
