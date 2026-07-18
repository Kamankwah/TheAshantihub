import { useState } from "react";
import { C } from "../theme.js";
import { useSubscriptionPlans } from "../hooks/useSubscriptionPlans.js";

// ─── BusinessRegistrationFlow ─────────────────────────────────────────────
// The 5-stage business-owner registration wizard: Personal Information (only
// when no account exists yet) -> Business Information (KYC) -> Plan
// Selection (subscription plan + free trial) -> Payment Account Information
// (payout) -> Terms & Conditions. One component with internal step state,
// not five separate AshantiHub pages — these steps are a single sequential
// flow, matching how BusinessDashboard is one component with internal tabs
// rather than several pages.
//
// business_info/plan_selection/payment_info steps call auth.refreshUser()
// after their own submit and route to whatever registration_step the server
// reports next, rather than always advancing to a hardcoded next step — this
// is what makes the "Fix and Resubmit after rejection" entry point (from
// BusinessDashboard, starting at business_info) correctly skip straight
// back to the dashboard when that was the only thing missing, instead of
// forcing plan_selection/payment_info/terms to be redone.

const STEP_LABELS = {
  personal_info: "1 of 5: Personal Information",
  business_info: "2 of 5: Business Information",
  plan_selection: "3 of 5: Choose Your Plan",
  payment_info: "4 of 5: Payment Account Information",
  terms: "5 of 5: Terms & Conditions",
};

const CYCLE_OPTIONS = [1, 3, 6, 12];

const inputStyle={width:"100%",boxSizing:"border-box",padding:"10px 12px",borderRadius:10,border:"1.5px solid #ddd",marginBottom:10,fontSize:"0.82rem",fontFamily:"inherit"};
const labelStyle={display:"block",fontSize:"0.72rem",fontWeight:700,color:C.darkBrown,marginBottom:10};
const submitStyle={width:"100%",background:C.gold,color:C.darkBrown,border:"none",borderRadius:20,padding:"12px",fontWeight:900,fontSize:"0.85rem",cursor:"pointer",fontFamily:"inherit",marginTop:4};

const TERMS_COPY = `AshantiHub Business Agreement (summary)

1. Listing Accuracy — Every listing you publish must accurately represent a real, operating business you own or are authorized to represent. Misleading names, prices, or photos may result in listing removal.

2. Customer Contact — For customer safety, all enquiries are routed through AshantiHub Support rather than direct to your phone or WhatsApp. You may discuss and resolve enquiries with AshantiHub Support, but must not attempt to contact customers directly outside the platform, and must not use contact details obtained through AshantiHub for unrelated marketing.

3. Payout Terms — Payouts are made to the bank or mobile money account you provide. You are responsible for keeping these details accurate and up to date; AshantiHub is not liable for payouts sent to details you failed to update. A service fee may apply to processed payouts.

4. KYC Accuracy — The Ghana Card and business details you provide must be accurate and current. Misrepresentation is grounds for account suspension.

5. Suspension & Termination — AshantiHub may suspend or terminate a business account for fraudulent listings, repeated customer complaints, or violation of these terms.`;

export default function BusinessRegistrationFlow({ user, auth, initialStep, prefill, setPage, setShowBizDash }) {
  const [step, setStep] = useState(initialStep || "personal_info");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Step 1 — Personal Information
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Step 2 — Business Information
  const [ghanaCardNumber, setGhanaCardNumber] = useState(prefill?.ghana_card_number || "");
  const [ghanaCardFront, setGhanaCardFront] = useState(null);
  const [ghanaCardBack, setGhanaCardBack] = useState(null);
  const [gpsAddress, setGpsAddress] = useState(prefill?.gps_address || "");
  const [businessContactPhone, setBusinessContactPhone] = useState(prefill?.business_contact_phone || "");
  const [isFormal, setIsFormal] = useState(prefill?.is_formal || false);
  const [businessRegCertificate, setBusinessRegCertificate] = useState(null);
  const [tin, setTin] = useState(prefill?.tin || "");

  // Step 3 — Plan Selection
  const [businessKind, setBusinessKind] = useState(null);
  const [selectedPlanTier, setSelectedPlanTier] = useState(null);
  const [cycleMonths, setCycleMonths] = useState(1);
  const plansQuery = useSubscriptionPlans();

  // Step 4 — Payment Account Information
  const [payoutMomoNumber, setPayoutMomoNumber] = useState("");
  const [payoutMomoName, setPayoutMomoName] = useState("");
  const [payoutMomoNetwork, setPayoutMomoNetwork] = useState("");
  const [payoutBankAccountNumber, setPayoutBankAccountNumber] = useState("");
  const [payoutBankAccountName, setPayoutBankAccountName] = useState("");
  const [payoutBankName, setPayoutBankName] = useState("");
  const [defaultPayoutMethod, setDefaultPayoutMethod] = useState("momo");

  // Step 5 — Terms
  const [agreed, setAgreed] = useState(false);

  const handlePersonalInfoSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await auth.registerBusinessOwner({ full_name: fullName, login_phone: phone, email: email || undefined, password });
      setStep("business_info");
    } catch (err) {
      setError("Could not create your account. Please check your details.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleBusinessInfoSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    // Ghana Card + a valid Ashanti Region Ghana Post address are required.
    if (!ghanaCardNumber.trim()) { setError("Your Ghana Card number is required."); return; }
    const gps = gpsAddress.trim().toUpperCase();
    if (!/^[A-Z]{2}-\d{3,4}-\d{4}$/.test(gps)) {
      setError("Enter a valid Ghana Post GPS address, e.g. AK-039-5028."); return;
    }
    if (gps[0] !== "A") {
      setError("AshantiHub only admits businesses in the Ashanti Region — your Ghana Post address must be an Ashanti Region address (it begins with “A”, e.g. AK-039-5028)."); return;
    }
    setSubmitting(true);
    try {
      await auth.submitBusinessInfo({
        ghana_card_number: ghanaCardNumber,
        ghana_card_front_image: ghanaCardFront,
        ghana_card_back_image: ghanaCardBack,
        gps_address: gps,
        business_contact_phone: businessContactPhone,
        is_formal: isFormal,
        business_reg_certificate: isFormal ? businessRegCertificate : undefined,
        tin: isFormal ? tin : undefined,
      });
      const fresh = await auth.refreshUser();
      if (fresh.registration_step === "complete") {
        setShowBizDash(true);
      } else if (["business_info", "plan_selection", "payment_info", "terms"].includes(fresh.registration_step)) {
        setStep(fresh.registration_step);
      } else {
        setError("Something went wrong determining your next step. Please refresh the page and try again.");
      }
    } catch (err) {
      const detail = err?.body && typeof err.body === "object"
        ? [].concat(...Object.values(err.body))[0]
        : null;
      setError(detail || "Could not save your business information. Please check your details.");
    } finally {
      setSubmitting(false);
    }
  };

  const handlePlanSelectionSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await auth.submitPlanSelection({
        business_kind: businessKind,
        plan: selectedPlanTier,
        cycle_months: cycleMonths,
      });
      const fresh = await auth.refreshUser();
      if (fresh.registration_step === "complete") {
        setShowBizDash(true);
      } else if (["business_info", "plan_selection", "payment_info", "terms"].includes(fresh.registration_step)) {
        setStep(fresh.registration_step);
      } else {
        setError("Something went wrong determining your next step. Please refresh the page and try again.");
      }
    } catch (err) {
      setError("Could not save your plan selection. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handlePaymentInfoSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await auth.submitPayoutInfo({
        default_payout_method: defaultPayoutMethod,
        payout_momo_number: payoutMomoNumber || undefined,
        payout_momo_name: payoutMomoName || undefined,
        payout_momo_network: payoutMomoNetwork || undefined,
        payout_bank_account_number: payoutBankAccountNumber || undefined,
        payout_bank_account_name: payoutBankAccountName || undefined,
        payout_bank_name: payoutBankName || undefined,
      });
      const fresh = await auth.refreshUser();
      if (fresh.registration_step === "complete") {
        setShowBizDash(true);
      } else if (["business_info", "plan_selection", "payment_info", "terms"].includes(fresh.registration_step)) {
        setStep(fresh.registration_step);
      } else {
        setError("Something went wrong determining your next step. Please refresh the page and try again.");
      }
    } catch (err) {
      setError("Could not save your payment details. Please check your details.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleTermsSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await auth.acceptBusinessTerms();
      await auth.refreshUser();
      setPage("home");
      setShowBizDash(true);
    } catch (err) {
      setError("Could not record your acceptance. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{fontFamily:"'Georgia',serif",background:"#f4f5f7",minHeight:"100vh"}}>
      <div style={{background:`linear-gradient(135deg,${C.darkBrown},${C.black})`,padding:"0 16px",position:"sticky",top:0,zIndex:100,boxShadow:"0 2px 20px rgba(0,0,0,0.4)"}}>
        <div style={{position:"absolute",top:0,left:0,right:0,height:4,background:`linear-gradient(90deg,${C.ghRed} 33%,${C.ghGold} 33%,${C.ghGold} 66%,${C.ghGreen} 66%)`}}/>
        <div style={{maxWidth:520,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",height:58}}>
          <div style={{color:C.gold,fontWeight:900,fontSize:"0.92rem"}}>👑 AshantiHub — Business Registration</div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <button onClick={()=>setPage("home")} style={{background:"none",border:"1px solid #444",color:"#aaa",borderRadius:20,padding:"4px 12px",fontSize:"0.68rem",cursor:"pointer",fontFamily:"inherit"}}>← Home</button>
            {user && <button onClick={()=>auth.logout()} style={{background:"none",border:"1px solid #444",color:"#aaa",borderRadius:20,padding:"4px 12px",fontSize:"0.68rem",cursor:"pointer",fontFamily:"inherit"}}>Sign Out</button>}
          </div>
        </div>
      </div>

      <div style={{maxWidth:440,margin:"0 auto",padding:"24px 20px 60px"}}>
        <div style={{fontSize:"0.68rem",fontWeight:800,color:C.kente2,marginBottom:16,letterSpacing:1}}>STEP {STEP_LABELS[step]}</div>

        {error && <div style={{background:"#fdecea",color:"#b00020",borderRadius:10,padding:"10px 12px",marginBottom:14,fontSize:"0.78rem"}}>{error}</div>}

        {step==="personal_info" && (
          <form onSubmit={handlePersonalInfoSubmit}>
            <h2 style={{color:C.darkBrown,fontSize:"1.05rem",margin:"0 0 14px"}}>Create your business account</h2>
            <input value={fullName} onChange={e=>setFullName(e.target.value)} placeholder="Full name" required style={inputStyle}/>
            <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="Phone (+233...)" required style={inputStyle}/>
            <input value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="Email" style={inputStyle}/>
            <input value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="Password (min 8 characters)" required minLength={8} style={inputStyle}/>
            <button type="submit" disabled={submitting} style={submitStyle}>{submitting?"Creating account…":"Continue"}</button>
          </form>
        )}

        {step==="business_info" && (
          <form onSubmit={handleBusinessInfoSubmit}>
            <h2 style={{color:C.darkBrown,fontSize:"1.05rem",margin:"0 0 14px"}}>Tell us about your business</h2>
            <input value={ghanaCardNumber} onChange={e=>setGhanaCardNumber(e.target.value)} placeholder="Ghana Card number" required style={inputStyle}/>
            <label style={labelStyle}>Ghana Card — front
              <input type="file" accept="image/*" required onChange={e=>setGhanaCardFront(e.target.files[0])} style={inputStyle}/>
            </label>
            <label style={labelStyle}>Ghana Card — back
              <input type="file" accept="image/*" required onChange={e=>setGhanaCardBack(e.target.files[0])} style={inputStyle}/>
            </label>
            <input value={gpsAddress} onChange={e=>setGpsAddress(e.target.value)} placeholder="Ghana Post GPS address (e.g. AK-039-5028)" required style={inputStyle}/>
            <div style={{color:"#8a6d1a",fontSize:"0.68rem",margin:"-6px 0 10px",lineHeight:1.4}}>📍 Ashanti Region only — your Ghana Post address must be an Ashanti Region address (it begins with “A”).</div>
            <input value={businessContactPhone} onChange={e=>setBusinessContactPhone(e.target.value)} placeholder="Business contact phone (public)" required style={inputStyle}/>
            <label style={{...labelStyle,display:"flex",alignItems:"center",gap:8}}>
              <input type="checkbox" checked={isFormal} onChange={e=>setIsFormal(e.target.checked)}/>
              My business is formally registered with the Registrar General's Department
            </label>
            {isFormal && <>
              <label style={labelStyle}>Business registration certificate
                <input type="file" accept="application/pdf,image/*" required onChange={e=>setBusinessRegCertificate(e.target.files[0])} style={inputStyle}/>
              </label>
              <input value={tin} onChange={e=>setTin(e.target.value)} placeholder="TIN" required style={inputStyle}/>
            </>}
            <button type="submit" disabled={submitting} style={submitStyle}>{submitting?"Saving…":"Continue"}</button>
          </form>
        )}

        {step==="plan_selection" && (
          <form onSubmit={handlePlanSelectionSubmit}>
            <h2 style={{color:C.darkBrown,fontSize:"1.05rem",margin:"0 0 14px"}}>Choose your plan</h2>

            <label style={labelStyle}>What do you sell?</label>
            <div style={{display:"flex",gap:10,marginBottom:14}}>
              <button
                type="button"
                onClick={()=>{ setBusinessKind("product"); setSelectedPlanTier(null); }}
                style={{
                  flex:1,padding:"12px",borderRadius:12,cursor:"pointer",fontFamily:"inherit",fontWeight:800,fontSize:"0.8rem",
                  border:businessKind==="product"?`2px solid ${C.gold}`:"1.5px solid #ddd",
                  background:businessKind==="product"?"#fff8e6":"#fff",
                  color:C.darkBrown,
                }}
              >📦 I sell products</button>
              <button
                type="button"
                onClick={()=>{ setBusinessKind("service"); setSelectedPlanTier(null); }}
                style={{
                  flex:1,padding:"12px",borderRadius:12,cursor:"pointer",fontFamily:"inherit",fontWeight:800,fontSize:"0.8rem",
                  border:businessKind==="service"?`2px solid ${C.gold}`:"1.5px solid #ddd",
                  background:businessKind==="service"?"#fff8e6":"#fff",
                  color:C.darkBrown,
                }}
              >🛠️ I offer services</button>
            </div>

            {businessKind && (
              <>
                <div style={{background:"#eafaf0",color:"#0a7d3c",borderRadius:10,padding:"10px 12px",marginBottom:14,fontSize:"0.76rem",fontWeight:700}}>
                  🎉 Your first billing cycle is FREE — nothing is due now.
                </div>

                {plansQuery.isLoading && <div style={{fontSize:"0.8rem",color:"#777",marginBottom:14}}>Loading plans…</div>}
                {plansQuery.isError && <div style={{fontSize:"0.8rem",color:"#b00020",marginBottom:14}}>Could not load plans. Please try again.</div>}

                {plansQuery.data && (
                  <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:16}}>
                    {plansQuery.data.filter(p=>p.kind===businessKind).map(plan=>(
                      <div
                        key={plan.id}
                        onClick={()=>setSelectedPlanTier(plan.tier)}
                        style={{
                          padding:"12px 14px",borderRadius:12,cursor:"pointer",position:"relative",
                          border:selectedPlanTier===plan.tier?`2px solid ${C.gold}`:"1.5px solid #ddd",
                          background:selectedPlanTier===plan.tier?"#fff8e6":"#fff",
                        }}
                      >
                        {plan.is_recommended && (
                          <span style={{position:"absolute",top:-9,right:12,background:C.gold,color:C.darkBrown,fontSize:"0.6rem",fontWeight:900,padding:"2px 8px",borderRadius:10}}>RECOMMENDED</span>
                        )}
                        <div style={{fontWeight:800,color:C.darkBrown,fontSize:"0.88rem"}}>{plan.name}</div>
                        <div style={{fontSize:"0.76rem",color:"#555",margin:"2px 0"}}>GHS {plan.monthly_price} / month</div>
                        <div style={{fontSize:"0.72rem",color:"#777"}}>
                          {plan.max_active_listings == null ? "Unlimited listings" : `${plan.max_active_listings} listings`}
                          {" · "}{plan.hero_days} hero days
                          {plan.boost_credits_per_month ? ` · ${plan.boost_credits_per_month} boost credits/mo` : ""}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {selectedPlanTier && plansQuery.data && (() => {
                  const plan = plansQuery.data.find(p=>p.tier===selectedPlanTier);
                  return (
                    <>
                      <label style={labelStyle}>Billing cycle</label>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:16}}>
                        {CYCLE_OPTIONS.map(months=>{
                          const total = plan ? (Number(plan.monthly_price) * months).toFixed(2) : "0.00";
                          return (
                            <button
                              type="button"
                              key={months}
                              onClick={()=>setCycleMonths(months)}
                              style={{
                                padding:"10px 4px",borderRadius:10,cursor:"pointer",fontFamily:"inherit",textAlign:"center",
                                border:cycleMonths===months?`2px solid ${C.gold}`:"1.5px solid #ddd",
                                background:cycleMonths===months?"#fff8e6":"#fff",
                                color:C.darkBrown,
                              }}
                            >
                              <div style={{fontWeight:800,fontSize:"0.76rem"}}>{months} mo</div>
                              <div style={{fontSize:"0.64rem",color:"#777"}}>GHS {total}</div>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  );
                })()}
              </>
            )}

            <button type="submit" disabled={submitting || !businessKind || !selectedPlanTier} style={submitStyle}>{submitting?"Saving…":"Start Free Trial"}</button>
          </form>
        )}

        {step==="payment_info" && (
          <form onSubmit={handlePaymentInfoSubmit}>
            <h2 style={{color:C.darkBrown,fontSize:"1.05rem",margin:"0 0 14px"}}>How should we pay you?</h2>
            <input value={payoutMomoNumber} onChange={e=>setPayoutMomoNumber(e.target.value)} placeholder="Mobile money number" required={defaultPayoutMethod==="momo"} style={inputStyle}/>
            <input value={payoutMomoName} onChange={e=>setPayoutMomoName(e.target.value)} placeholder="Mobile money account name" style={inputStyle}/>
            <select value={payoutMomoNetwork} onChange={e=>setPayoutMomoNetwork(e.target.value)} style={inputStyle}>
              <option value="">Mobile money network</option>
              <option value="MTN">MTN</option>
              <option value="Telecel">Telecel Cash</option>
              <option value="AirtelTigo">AirtelTigo</option>
            </select>
            <input value={payoutBankAccountNumber} onChange={e=>setPayoutBankAccountNumber(e.target.value)} placeholder="Bank account number" required={defaultPayoutMethod==="bank"} style={inputStyle}/>
            <input value={payoutBankAccountName} onChange={e=>setPayoutBankAccountName(e.target.value)} placeholder="Bank account name" style={inputStyle}/>
            <input value={payoutBankName} onChange={e=>setPayoutBankName(e.target.value)} placeholder="Bank name" style={inputStyle}/>
            <select value={defaultPayoutMethod} onChange={e=>setDefaultPayoutMethod(e.target.value)} style={inputStyle}>
              <option value="momo">Default payout: Mobile Money</option>
              <option value="bank">Default payout: Bank</option>
            </select>
            <button type="submit" disabled={submitting} style={submitStyle}>{submitting?"Saving…":"Continue"}</button>
          </form>
        )}

        {step==="terms" && (
          <form onSubmit={handleTermsSubmit}>
            <h2 style={{color:C.darkBrown,fontSize:"1.05rem",margin:"0 0 14px"}}>Business Agreement</h2>
            <div style={{background:"#f9f9f9",borderRadius:10,padding:"14px",fontSize:"0.74rem",color:"#444",lineHeight:1.6,whiteSpace:"pre-line",marginBottom:14,maxHeight:260,overflowY:"auto"}}>
              {TERMS_COPY}
            </div>
            <label style={{...labelStyle,display:"flex",alignItems:"center",gap:8}}>
              <input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)}/>
              I have read and agree to the AshantiHub Business Agreement
            </label>
            <button type="submit" disabled={submitting || !agreed} style={submitStyle}>{submitting?"Submitting…":"Submit for Verification"}</button>
          </form>
        )}
      </div>
    </div>
  );
}
