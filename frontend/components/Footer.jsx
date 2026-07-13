import { C } from "../theme.js";

// ─── Footer ────────────────────────────────────────────────────────────────
// Extracted verbatim from the old unconditional App.jsx footer. Now rendered
// only on non-home pages (Business/Events/About/Contact) — the redesigned
// full-viewport home landing page has no footer of its own.
export default function Footer({ setLegalDoc }) {
  return (
    <div style={{background:C.black,color:C.lightGold,textAlign:"center",padding:"20px",fontSize:"0.7rem",position:"relative",overflow:"hidden"}}>
      <div style={{position:"absolute",top:0,left:0,right:0,height:5,background:`linear-gradient(90deg,${C.ghRed} 33%,${C.ghGold} 33%,${C.ghGold} 66%,${C.ghGreen} 66%)`}}/>
      <div style={{paddingTop:8}}>
        <div style={{marginBottom:4}}>
          <span style={{color:C.ghRed}}>★</span><span style={{color:C.ghGold}}>★</span><span style={{color:C.ghGreen}}>★</span>
          {"  "}<strong style={{color:C.gold}}>AshantiHub</strong>{"  "}
          <span style={{color:C.ghGreen}}>★</span><span style={{color:C.ghGold}}>★</span><span style={{color:C.ghRed}}>★</span>
        </div>
        <div style={{fontSize:"0.65rem",color:C.gold,fontWeight:600,marginBottom:4}}>The Marketplace of Ashanti 👑 • The Pride of Ghana 🇬🇭</div>
        <div style={{opacity:0.6,marginBottom:10,fontSize:"0.62rem"}}>Kumasi, Ashanti Region, Ghana • info@ashantihub.com</div>
        <div style={{display:"flex",justifyContent:"center",gap:12,flexWrap:"wrap",marginBottom:8}}>
          {[["terms","Terms & Conditions"],["privacy","Privacy Policy"],["business","Business Agreement"]].map(([doc,label])=>(
            <span key={doc} onClick={()=>setLegalDoc(doc)} style={{color:C.gold,cursor:"pointer",textDecoration:"underline",fontWeight:600,fontSize:"0.65rem"}}>{label}</span>
          ))}
        </div>
        <div style={{opacity:0.4,fontSize:"0.58rem"}}>© 2026 AshantiHub Ltd. All Rights Reserved • Registered under Ghana Companies Act 2019 • Data Protection Commission Registered</div>
      </div>
    </div>
  );
}
