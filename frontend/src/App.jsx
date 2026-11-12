import { useState, useEffect, createContext, useContext, useCallback, useMemo } from "react";
import { api, setTokens, clearTokens } from "./api.js";

// ==========================================
// GEOGRAPHY & CROPS
// ==========================================
const DIS = [
  ["Kampala",0.35,32.58],["Wakiso",0.40,32.46],["Mukono",0.35,32.75],
  ["Masaka",-0.34,31.73],["Mpigi",0.23,32.31],["Jinja",0.43,33.20],
  ["Mbale",1.08,34.17],["Soroti",1.71,33.61],["Tororo",0.69,34.18],
  ["Busia",0.47,34.09],["Lira",2.25,32.90],["Gulu",2.77,32.30],
  ["Arua",3.02,30.91],["Kitgum",3.28,32.89],["Apac",1.98,32.54],
  ["Mbarara",-0.61,30.66],["Kabale",-1.25,29.99],["Fort Portal",0.67,30.27],
  ["Kasese",0.18,30.08],["Hoima",1.43,31.35]
];
const DN = DIS.map(d=>d[0]).sort();

async function readJsonResponse(response){
  const text=await response.text();
  if(!text) throw new Error(`The API returned an empty response (HTTP ${response.status}). Check that the backend and load balancer are running.`);
  try{return JSON.parse(text);}
  catch{throw new Error(`The API returned an invalid response (HTTP ${response.status}). Check the backend and proxy configuration.`);}
}

const CROP_IMAGES = {
  Maize:"/maize.webp", Groundnuts:"/gnuts.jpg", Matooke:"/matooke.jpg",
  Tomatoes:"/tomatoes.jpg", Beans:"/beans.jpg", Rice:"/rice.jpg",
  "Irish potatoes":"/irish.jpg", "Sweet potatoes":"/sweet potatoes.jpg",
  Plantain:"/plantain.jpg", Peas:"/peas.jpg",
};

const CROPS = {
  Maize:          { emoji:"ð½", unit:"kg",    grad:"135deg,#f2c14e,#d99a1e" },
  Groundnuts:     { emoji:"ð¥", unit:"kg",    grad:"135deg,#d9a066,#a8703a" },
  Matooke:        { emoji:"ð", unit:"bunch", grad:"135deg,#b5dc6a,#79a73a" },
  Tomatoes:       { emoji:"ð", unit:"crate", grad:"135deg,#f07a5a,#d2452a" },
  Beans:          { emoji:"ð«", unit:"kg",    grad:"135deg,#c2705a,#8f4332" },
  Rice:           { emoji:"🌾", unit:"kg",    grad:"135deg,#e8dcae,#c2b27a" },
  "Irish potatoes":{ emoji:"ð¥", unit:"bag",  grad:"135deg,#c5a059,#8c6a32" },
  "Sweet potatoes":{ emoji:"ð ", unit:"bag",  grad:"135deg,#c71585,#800080" },
  Peas:           { emoji:"ð«", unit:"kg",    grad:"135deg,#6aad3a,#3d7a20" },
  Plantain:       { emoji:"ð", unit:"bunch", grad:"135deg,#c5d454,#8a9e2a" },
};

const DEMO_ACCOUNTS = [
  { phone:"0700000001", name:"Akello Grace",  role:"farmer",      icon:"🌾", desc:"Farmer (Lira)" },
  { phone:"0700000003", name:"Nakato Sarah",  role:"buyer",       icon:"🛒", desc:"Buyer (Kampala)" },
  { phone:"0700000004", name:"Okot Daniel",   role:"transporter", icon:"🚚", desc:"Transporter (Gulu)" },
  { phone:"0700000009", name:"Admin Office",  role:"admin",       icon:"🛡️", desc:"Admin" },
];

function km(a,b){
  const p=DIS.find(x=>x[0]===a)||DIS[0],q=DIS.find(x=>x[0]===b)||DIS[0],r=Math.PI/180;
  const dl=(q[1]-p[1])*r,dn=(q[2]-p[2])*r;
  const h=Math.pow(Math.sin(dl/2),2)+Math.cos(p[1]*r)*Math.cos(q[1]*r)*Math.pow(Math.sin(dn/2),2);
  return Math.max(5,Math.round(12742*Math.asin(Math.sqrt(h))*1.3));
}
function eta(k){ const m=Math.round((k/50)*60); return m<60?`${m} min`:`${Math.floor(m/60)} h ${m%60} min`; }
const ugx = n=>"UGX "+Number(n||0).toLocaleString();
const num = n=>Number(n||0).toLocaleString(undefined,{maximumFractionDigits:1});
const fmt = t=>t?new Date(t).toLocaleString([],{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}):"";
const getCropImg = n=>CROP_IMAGES[n]||null;

function pwStrength(pw){
  if(!pw) return {score:0,label:""};
  const letters=(pw.match(/[a-zA-Z]/g)||[]).length;
  const numbers=(pw.match(/[0-9]/g)||[]).length;
  const symbols=(pw.match(/[^a-zA-Z0-9]/g)||[]).length;
  if(pw.length<8||letters<2||numbers<2||symbols<1) return {score:1,label:"Weak — need 8+ chars, 2 letters, 2 numbers, 1 symbol"};
  if(pw.length<12) return {score:2,label:"Fair"};
  return {score:3,label:"Strong â"};
}
function validatePhone(ph){ return /^07\d{8}$/.test(ph.trim()); }
function validateName(n){ return /^[a-zA-Z\s'-]+$/.test(n.trim()) && n.trim().length>=2; }

// ==========================================
// CONTEXT
// ==========================================
const AppContext = createContext();

function useData(path, interval=0){
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(false);
  const load=useCallback(async()=>{
    if(!path)return;
    setLoading(true);
    try{ setData(await api(path)); } catch(e){}
    finally{ setLoading(false); }
  },[path]);
  useEffect(()=>{
    load();
    if(interval>0){ const i=setInterval(load,interval); return()=>clearInterval(i); }
  },[load,interval]);
  return [data,load,loading];
}

// ==========================================
// APP ROOT
// ==========================================
export default function App(){
  const [user,setUser]=useState(null);
  const [loadingUser,setLoadingUser]=useState(true);
  const [authScreen,setAuthScreen]=useState(false);
  const [toastMsg,setToastMsg]=useState("");
  const [openListing,setOpenListing]=useState(null);
  const [openPayOrder,setOpenPayOrder]=useState(null);
  const [openNewListing,setOpenNewListing]=useState(false);
  const [openTracking,setOpenTracking]=useState(null);
  const [openProfile,setOpenProfile]=useState(false);
  const [openCart,setOpenCart]=useState(false);
  const [farmerTab,setFarmerTab]=useState("inventory");
  const [transporterTab,setTransporterTab]=useState("active");
  const [searchQ,setSearchQ]=useState("");
  const [filterDistrict,setFilterDistrict]=useState("");
  const [filterCrop,setFilterCrop]=useState("");
  // Cart: Map of listingId â { listing, qty }
  const [cart,setCart]=useState(new Map());

  const toast=msg=>{ setToastMsg(msg); setTimeout(()=>setToastMsg(""),3500); };

  const addToCart=(listing,qty=1)=>{
    setCart(prev=>{
      const next=new Map(prev);
      const cur=next.get(listing.id);
      const newQty=Math.min(Number(listing.quantity_available), (cur?.qty||0)+qty);
      next.set(listing.id,{listing,qty:newQty});
      return next;
    });
  };
  const updateCartQty=(listingId,qty)=>{
    setCart(prev=>{
      const next=new Map(prev);
      if(qty<=0) next.delete(listingId);
      else { const item=next.get(listingId); if(item) next.set(listingId,{...item,qty}); }
      return next;
    });
  };
  const removeFromCart=listingId=>{
    setCart(prev=>{ const next=new Map(prev); next.delete(listingId); return next; });
  };
  const clearCart=()=>setCart(new Map());
  const cartCount=[...cart.values()].reduce((s,v)=>s+v.qty,0);
  const cartTotal=[...cart.values()].reduce((s,v)=>s+v.qty*Number(v.listing.price_per_unit),0);

  const loadMe=useCallback(async()=>{
    if(localStorage.getItem("ac_a")){
      try{ setUser(await api("/users/me/")); }
      catch(e){ clearTokens(); setUser(null); }
    }
    setLoadingUser(false);
  },[]);

  useEffect(()=>{ loadMe(); },[loadMe]);
  const logout=()=>{ clearTokens(); setUser(null); setAuthScreen(true); clearCart(); toast("Logged out. See you soon!"); };

  const [produceData,refreshProduce]=useData("/marketplace/produce/?page_size=60",12000);
  const listings=produceData?.results||[];
  const totalBoardValue=useMemo(()=>listings.reduce((s,l)=>s+(l.status==="active"?l.quantity_available*l.price_per_unit:0),0),[listings]);
  const liveListingsCount=useMemo(()=>listings.filter(l=>l.status==="active").length,[listings]);
  const uniqueDistrictsCount=useMemo(()=>new Set(listings.map(l=>l.district_name).filter(Boolean)).size,[listings]);
  const role=user?.role||"guest";

  const ctxValue={
    user,setUser,role,loadMe,toast,
    produceListings:listings,refreshProduce,
    totalBoardValue,liveListingsCount,uniqueDistrictsCount,
    setOpenListing,setOpenPayOrder,setOpenNewListing,setOpenTracking,
    setOpenProfile,setOpenCart,
    cart,addToCart,updateCartQty,removeFromCart,clearCart,cartCount,cartTotal,
    farmerTab,setFarmerTab,transporterTab,setTransporterTab,setAuthScreen
  };

  if(loadingUser) return(
    <div className="splash">
      <div className="splash-logo-wrap">
        <AgriLogo size={56}/>
        <span className="splash-logo">Agri<b>Connect</b></span>
      </div>
      <div className="splash-sub">Uganda's Farm-to-Market Platform</div>
      <div className="splash-spinner"/>
    </div>
  );

  if(!user||authScreen) return(
    <AppContext.Provider value={ctxValue}>
      <AuthScreen onAuth={()=>setAuthScreen(false)}/>
      {toastMsg&&<div className="toast">{toastMsg}</div>}
    </AppContext.Provider>
  );

  return(
    <AppContext.Provider value={ctxValue}>
      <div id="app-container">
        <HeroHeader searchQ={searchQ} setSearchQ={setSearchQ} logout={logout} openProfile={()=>setOpenProfile(true)}/>
        <div className="body">
          {role==="transporter"?<TransporterView/>
          :role==="farmer"?<FarmerView/>
          :role==="admin"?<AdminView/>
          :<BuyerView searchQ={searchQ} setSearchQ={setSearchQ}
              filterDistrict={filterDistrict} setFilterDistrict={setFilterDistrict}
              filterCrop={filterCrop} setFilterCrop={setFilterCrop}/>}
        </div>
        <BottomNav/>
        {openProfile&&<ProfileModal onClose={()=>setOpenProfile(false)}/>}
        {openListing&&<ProductDetailSheet listing={openListing} onClose={()=>setOpenListing(null)}/>}
        {openCart&&<CartModal onClose={()=>setOpenCart(false)}/>}
        {openPayOrder&&<PaymentModal order={openPayOrder} onClose={()=>setOpenPayOrder(null)}/>}
        {openNewListing&&<NewListingModal onClose={()=>setOpenNewListing(false)} onSaved={refreshProduce}/>}
        {openTracking&&<TrackingModal deliveryId={openTracking} onClose={()=>setOpenTracking(null)}/>}
        {toastMsg&&<div className="toast">{toastMsg}</div>}
      </div>
    </AppContext.Provider>
  );
}

// ==========================================
// LOGO SVG
// ==========================================
function AgriLogo({size=32,style={}}){
  return(
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" style={style}>
      <circle cx="24" cy="24" r="24" fill="#1f5a3d"/>
      {/* leaf */}
      <path d="M24 36 C24 36 12 28 12 18 C12 12 18 8 24 8 C30 8 36 12 36 18 C36 28 24 36 24 36Z" fill="#9be15d"/>
      {/* stem */}
      <line x1="24" y1="36" x2="24" y2="42" stroke="#9be15d" strokeWidth="2.5" strokeLinecap="round"/>
      {/* vein */}
      <path d="M24 20 L18 14" stroke="#1f5a3d" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M24 24 L30 18" stroke="#1f5a3d" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

// ==========================================
// AUTH SCREEN
// ==========================================
function AuthScreen({onAuth}){
  const {setUser,toast}=useContext(AppContext);
  const [mode,setMode]=useState("login");
  const [role,setRole]=useState("farmer");
  const [phone,setPhone]=useState("");
  const [password,setPassword]=useState("");
  const [confirmPw,setConfirmPw]=useState("");
  const [fullName,setFullName]=useState("");
  const [district,setDistrict]=useState("Kampala");
  const [doc,setDoc]=useState("");
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [showPw,setShowPw]=useState(false);
  const [rememberMe,setRememberMe]=useState(false);

  const pw=pwStrength(password);

  // Convert 07XXXXXXXX â +256XXXXXXXX (matches seed data format)
  const toFullPhone = ph => "+256" + ph.replace(/^0/,"");

  const handleLogin=async e=>{
    e.preventDefault(); setError(""); setLoading(true);
    try{
      const res=await fetch("/api/v1/auth/login/",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({phone:toFullPhone(phone),password})
      });
      const data=await readJsonResponse(res);
      if(!res.ok) throw new Error(data.detail||"Invalid phone or password.");
      setTokens(data);
      const u=await api("/users/me/");
      setUser(u); toast(`Welcome back, ${u.full_name.split(" ")[0]}!`); onAuth();
    }catch(err){ setError(err.message); }
    finally{ setLoading(false); }
  };

  const handleSignUp=async e=>{
    e.preventDefault(); setError(""); 
    if(!validatePhone(phone)){ setError("Phone must start with 07 and have 10 digits (e.g. 0712345678)."); return; }
    if(!validateName(fullName)){ setError("Name must contain only letters and be at least 2 characters."); return; }
    if(pw.score<2){ setError("Password too weak. Need 8+ chars, 2 letters, 2 numbers, 1 symbol."); return; }
    if(password!==confirmPw){ setError("Passwords do not match."); return; }
    setLoading(true);
    try{
      const res=await fetch("/api/v1/auth/register/",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({phone:toFullPhone(phone),password,full_name:fullName,role,district:null,verification_doc:doc})
      });
      const data=await readJsonResponse(res);
      if(!res.ok){
        const msg=Object.entries(data).map(([k,v])=>`${k}: ${[].concat(v).join(" ")}`).join(" Â· ");
        throw new Error(msg||"Could not register account.");
      }
      setTokens(data);
      const u=await api("/users/me/");
      setUser(u);
      toast(u.is_verified?"Account created! Welcome to AgriConnect.":"Account created! Admin is reviewing your credentials.");
      onAuth();
    }catch(err){ setError(err.message); }
    finally{ setLoading(false); }
  };

  return(
    <div className={mode==="login"?"auth-bg auth-bg-login":"auth-bg"}>
      <div className="auth-bg-image"/>

      {mode==="login" ? (
        <>
        <div className="auth-produce" aria-hidden="true">
          <img className="auth-produce-maize" src="/maize.webp" alt=""/>
          <img className="auth-produce-tomatoes" src="/tomatoes.jpg" alt=""/>
          <img className="auth-produce-beans" src="/beans.jpg" alt=""/>
        </div>
        <div className="glass-card glass-card-login">
          {/* Logo at top */}
          <div className="glass-logo-row">
            <AgriLogo size={36}/>
            <span className="glass-logo-text">Agri<b>Connect</b></span>
          </div>

          <h2 className="glass-title">Login</h2>
          <p className="glass-sub">Welcome back, please login to your account</p>

          {error&&<div className="err" style={{marginBottom:12}}>{error}</div>}

          <form onSubmit={handleLogin}>
            {/* Phone */}
            <div className="glass-field">
              <input
                type="tel"
                required
                placeholder="Phone Number (07XXXXXXXX)"
                value={phone}
                onChange={e=>setPhone(e.target.value.replace(/[^0-9]/g,"").slice(0,10))}
                className="glass-input"
                maxLength={10}
              />
              <span className="glass-field-icon"><PersonIcon/></span>
            </div>

            {/* Password */}
            <div className="glass-field">
              <input
                type={showPw?"text":"password"}
                required
                placeholder="Password"
                value={password}
                onChange={e=>setPassword(e.target.value)}
                className="glass-input"
              />
              <button type="button" className="glass-eye" onClick={()=>setShowPw(!showPw)} tabIndex={-1}>
                {showPw ? <EyeOffIcon/> : <EyeOffIcon/>}
              </button>
            </div>

            {/* Remember me */}
            <label className="glass-remember">
              <input type="checkbox" checked={rememberMe} onChange={e=>setRememberMe(e.target.checked)} className="glass-check"/>
              Remember me
            </label>

            <button className="glass-btn" disabled={loading}>
              {loading?<><span className="btn-spinner"/> Signing in...</>:"Login"}
            </button>

            <p className="glass-switch">
              Don't have an account?{" "}
              <button type="button" className="glass-link" onClick={()=>{setMode("signup");setError("");}}>Signup</button>
            </p>
          </form>

          {/* Demo accounts */}
          <div className="glass-demo">
            <div className="glass-demo-label">Demo accounts (password: demo1234)</div>
            <div className="demo-grid">
              {DEMO_ACCOUNTS.map(p=>(
                <button key={p.phone} type="button" className="demo-btn"
                  onClick={()=>{setPhone(p.phone);setPassword("demo1234");setError("");}}>
                  <span className="demo-icon">{p.icon}</span>
                  <span className="demo-label">{p.desc}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        </>

      ) : (
        /* Sign-up form inside a scrollable card */
        <div className="glass-card glass-card-signup">
          <div className="glass-logo-row">
            <AgriLogo size={36}/>
            <span className="glass-logo-text">Agri<b>Connect</b></span>
          </div>

          <h2 className="glass-title">Create Account</h2>

          {error&&<div className="err" style={{marginBottom:12}}>{error}</div>}

          <form onSubmit={handleSignUp} autoComplete="off">
            {/* Role */}
            <div className="signup-section">
              <div className="signup-section-label"><span className="signup-step">1</span>Choose your role</div>
              <div className="role-cards">
                {[
                  {id:"farmer",emoji:"🌾",title:"Farmer"},
                  {id:"buyer",emoji:"🛒",title:"Buyer"},
                  {id:"transporter",emoji:"🚚",title:"Transporter"},
                ].map(r=>(
                  <button key={r.id} type="button"
                    className={"role-card"+(role===r.id?" selected":"")}
                    onClick={()=>setRole(r.id)}>
                    <span className="role-card-emoji">{r.emoji}</span>
                    <span className="role-card-title">{r.title}</span>
                    {role===r.id&&<span className="role-card-check">â</span>}
                  </button>
                ))}
              </div>
            </div>

            {/* Personal details */}
            <div className="signup-section">
              <div className="signup-section-label"><span className="signup-step">2</span>Personal details</div>
              <div className="glass-field">
                <input required placeholder="Full name (letters only)" className="glass-input"
                  value={fullName} onChange={e=>setFullName(e.target.value.replace(/[^a-zA-Z\s'-]/g,""))}/>
                <span className="glass-field-icon"><PersonIcon/></span>
              </div>
              <div className="glass-field">
                <input required type="tel" placeholder="Phone (07XXXXXXXX)" className="glass-input"
                  value={phone} maxLength={10}
                  onChange={e=>setPhone(e.target.value.replace(/[^0-9]/g,"").slice(0,10))}/>
                <span className="glass-field-icon"><PhoneIcon/></span>
              </div>
              <div className="glass-field">
                <select className="glass-input" value={district} onChange={e=>setDistrict(e.target.value)}>
                  {DN.map(d=><option key={d} value={d}>{d}</option>)}
                </select>
                <span className="glass-field-icon"><MapPinIcon/></span>
              </div>
            </div>

            {/* Verification doc */}
            {role!=="buyer"&&(
              <div className="signup-section">
                <div className="signup-section-label"><span className="signup-step">3</span>Verification document</div>
                <div className="verify-hint">
                  <LockIcon size={16}/>
                  <span>{role==="farmer"?"NIN verified by admin before listings go live.":"Permit reviewed before accepting delivery jobs."}</span>
                </div>
                <div className="glass-field">
                  <input required className="glass-input"
                    placeholder={role==="farmer"?"National ID (CM901234567)":"Vehicle Permit (PERMIT-TR-4491)"}
                    value={doc} onChange={e=>setDoc(e.target.value)}/>
                  <span className="glass-field-icon"><DocIcon/></span>
                </div>
              </div>
            )}

            {/* Password */}
            <div className="signup-section">
              <div className="signup-section-label">
                <span className="signup-step">{role!=="buyer"?"4":"3"}</span>Password
              </div>
              <div className="glass-field">
                <input required type={showPw?"text":"password"} minLength={8}
                  placeholder="Password (8+ chars, letters, numbers, symbol)"
                  className="glass-input" value={password} onChange={e=>setPassword(e.target.value)}/>
                <button type="button" className="glass-eye" onClick={()=>setShowPw(!showPw)} tabIndex={-1}>
                  <EyeOffIcon/>
                </button>
              </div>
              {password.length>0&&(
                <div className="pw-strength">
                  <div className="pw-bar" data-strength={pw.score===1?"weak":pw.score===2?"fair":"strong"}
                    style={{width:`${(pw.score/3)*100}%`}}/>
                  <span className="mute" style={{fontSize:"0.72rem"}}>{pw.label}</span>
                </div>
              )}
              <div className="glass-field" style={{marginTop:8}}>
                <input required type="password" placeholder="Confirm password"
                  className="glass-input" value={confirmPw} onChange={e=>setConfirmPw(e.target.value)}/>
                <span className="glass-field-icon"><LockIcon/></span>
              </div>
              {confirmPw.length>0&&password!==confirmPw&&(
                <p style={{color:"var(--danger)",fontSize:"0.76rem",margin:"2px 0 0"}}>Passwords do not match</p>
              )}
            </div>

            <button className="glass-btn" disabled={loading}>
              {loading?<><span className="btn-spinner"/> Creatingâ¦</>:"Create Account"}
            </button>

            <p className="glass-switch">
              Already have an account?{" "}
              <button type="button" className="glass-link" onClick={()=>{setMode("login");setError("");}}>Login</button>
            </p>
          </form>
        </div>
      )}
    </div>
  );
}

// ==========================================
// SMALL SVG ICONS (no emoji)
// ==========================================
const PersonIcon=()=><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>;
const PhoneIcon=()=><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C9.6 21 3 14.4 3 6.5c0-.6.4-1 1-1H7c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg>;
const LockIcon=({size=16})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>;
const EyeOffIcon=()=><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>;
const MapPinIcon=()=><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 6-9 13-9 13S3 16 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>;
const DocIcon=()=><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>;
const MailIcon=()=><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>;
const GlobeIcon=()=><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>;
const BlueTick=()=><svg width="14" height="14" viewBox="0 0 24 24" fill="#1d9bf0"><circle cx="12" cy="12" r="12"/><path d="M9 12l2 2 4-4" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>;

// ==========================================
// HERO HEADER
// ==========================================
function HeroHeader({searchQ,setSearchQ,logout,openProfile}){
  const {user,role,totalBoardValue,liveListingsCount,uniqueDistrictsCount,cartCount,setOpenCart}=useContext(AppContext);
  const heroClass=role==="transporter"?"transporter-hero":role==="admin"?"admin-hero":role==="farmer"?"farmer-hero":"buyer-hero";
  const gaugePercent=Math.min(1,totalBoardValue/80000000);
  const arcLength=188.5;
  return(
    <div className={`hero ${heroClass}`}>
      <div className="top">
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <AgriLogo size={28}/>
          <span className="logo">Agri<b>Connect</b></span>
        </div>
        <div className="user-menu">
          {/* Cart icon — buyers only */}
          {role==="buyer"&&(
            <button className="cart-icon-btn" onClick={()=>setOpenCart(true)} title="My Cart">
              <CartIcon/>
              {cartCount>0&&<span className="cart-badge">{cartCount}</span>}
            </button>
          )}
          <div className="roles-box">
            <button className="on" onClick={openProfile} title="Edit Profile">
              {user.full_name.split(" ")[0]} Â· {user.role.toUpperCase()}
              {user.is_verified&&<span style={{marginLeft:4,display:"inline-flex",verticalAlign:"middle"}}><BlueTick/></span>}
            </button>
            <button onClick={logout} style={{color:"rgba(255,255,255,0.75)"}}>Log out</button>
          </div>
        </div>
      </div>

      {role==="transporter"?(
        <div style={{marginTop:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <h1>🚚 Transporter Dispatch Hub</h1>
            <span className={"pill "+(user?.is_verified?"g":"o")}>{user?.is_verified?"â Verified":"â³ Pending"}</span>
          </div>
          <p style={{opacity:0.9,fontSize:"0.9rem"}}>Check haulage jobs, update route checkpoints, and manage deliveries.</p>
        </div>
      ):role==="farmer"?(
        <div style={{marginTop:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <h1>🌾 Farm Harvest & Sales Hub</h1>
            <span className={"pill "+(user?.is_verified?"g":"o")}>{user?.is_verified?"â Verified":"â³ Pending"}</span>
          </div>
          <p style={{opacity:0.9,fontSize:"0.9rem"}}>Post produce, answer buyer requests, and dispatch harvests from your farm gate.</p>
        </div>
      ):role==="admin"?(
        <div style={{marginTop:14}}>
          <h1>🛡️ Central Network Administration</h1>
          <p style={{opacity:0.9,fontSize:"0.9rem"}}>Manage users, approve verifications, and view all nationwide activity.</p>
        </div>
      ):(
        /* BUYER hero — clean greeting like the reference */
        <div style={{marginTop:10}}>
          <h1 style={{fontSize:"1.4rem",margin:"0 0 4px"}}>
            Hi, {user.full_name.split(" ")[0]} ð
          </h1>
          <p style={{opacity:0.85,fontSize:"0.9rem",margin:"0 0 12px"}}>What would you like to buy today?</p>
          <div className="search">
            <span>🔍</span>
            <input placeholder="Search for produceâ¦" value={searchQ} onChange={e=>setSearchQ(e.target.value)}/>
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// PROFILE MODAL
// ==========================================
function ProfileModal({onClose}){
  const {user,setUser,toast}=useContext(AppContext);
  const [fullName,setFullName]=useState(user?.full_name||"");
  const [email,setEmail]=useState(user?.email||"");
  const [district,setDistrict]=useState(user?.district_name||"Kampala");
  const [lang,setLang]=useState(user?.preferred_language||"en");
  const [newPw,setNewPw]=useState("");
  const [confirmPw,setConfirmPw]=useState("");
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [backendDistricts]=useData("/locations/districts/");
  const pw=pwStrength(newPw);

  const handleSave=async e=>{
    e.preventDefault(); setError("");
    if(!validateName(fullName)){ setError("Name must contain only letters."); return; }
    if(newPw){
      if(pw.score<2){ setError("New password too weak. Need 8+ chars, 2 letters, 2 numbers, 1 symbol."); return; }
      if(newPw!==confirmPw){ setError("Passwords do not match."); return; }
    }
    setLoading(true);
    try{
      const distObj=(backendDistricts||[]).find(d=>d.name.toLowerCase()===district.toLowerCase());
      const payload={full_name:fullName,email:email||null,preferred_language:lang};
      if(distObj) payload.district=distObj.id;
      if(newPw) payload.password=newPw;
      const updated=await api("/users/me/",{method:"PATCH",body:payload});
      setUser(updated); toast("Profile updated!"); onClose();
    }catch(err){ setError(err.message); }
    finally{ setLoading(false); }
  };

  return(
    <div className="sheet" onClick={onClose}>
      <div onClick={e=>e.stopPropagation()}>
        <div className="profile-header">
          <div className="profile-avatar">{fullName?fullName[0].toUpperCase():"?"}</div>
          <div>
            <h2 style={{margin:0}}>{user?.full_name}</h2>
            <div className="profile-role-badge">
              <span>{user?.role==="farmer"?"🌾":user?.role==="transporter"?"🚚":user?.role==="buyer"?"🛒":"🛡️"}</span>
              <span>{user?.role?.toUpperCase()}</span>
              {user?.is_verified&&<BlueTick/>}
              <span className={"pill "+(user?.is_verified?"g":"o")} style={{fontSize:"0.62rem"}}>
                {user?.is_verified?"Verified":"Pending"}
              </span>
            </div>
            <div className="mute" style={{fontSize:"0.78rem",marginTop:2}}>ð± {user?.phone}</div>
          </div>
        </div>

        {error&&<div className="err">{error}</div>}

        <form onSubmit={handleSave}>
          <div className="profile-section-label">Edit Details</div>

          <div className="profile-field">
            <div className="profile-field-icon"><PersonIcon/></div>
            <div className="profile-field-body">
              <label className="profile-field-label">Full Name</label>
              <input required className="profile-input" value={fullName}
                onChange={e=>setFullName(e.target.value.replace(/[^a-zA-Z\s'-]/g,""))} placeholder="Your full name"/>
            </div>
          </div>

          <div className="profile-field">
            <div className="profile-field-icon"><MailIcon/></div>
            <div className="profile-field-body">
              <label className="profile-field-label">Email <span className="mute" style={{fontWeight:400}}>(optional)</span></label>
              <input type="email" className="profile-input" value={email}
                onChange={e=>setEmail(e.target.value)} placeholder="your@email.com"/>
            </div>
          </div>

          <div className="profile-field">
            <div className="profile-field-icon"><MapPinIcon/></div>
            <div className="profile-field-body">
              <label className="profile-field-label">District / Location</label>
              <select className="profile-input" value={district} onChange={e=>setDistrict(e.target.value)}>
                {(backendDistricts||DN.map(n=>({name:n}))).map(d=><option key={d.name} value={d.name}>{d.name}</option>)}
              </select>
            </div>
          </div>

          <div className="profile-field">
            <div className="profile-field-icon"><GlobeIcon/></div>
            <div className="profile-field-body">
              <label className="profile-field-label">Language</label>
              <select className="profile-input" value={lang} onChange={e=>setLang(e.target.value)}>
                <option value="en">English</option>
                <option value="lg">Luganda</option>
                <option value="ac">Acholi</option>
                <option value="lgg">Lugbara</option>
              </select>
            </div>
          </div>

          <div className="profile-section-label" style={{marginTop:16}}>Change Password <span className="mute" style={{fontWeight:400,textTransform:"none"}}>(leave blank to keep current)</span></div>

          <div className="profile-field">
            <div className="profile-field-icon"><LockIcon/></div>
            <div className="profile-field-body">
              <label className="profile-field-label">New Password</label>
              <input type="password" className="profile-input" value={newPw}
                onChange={e=>setNewPw(e.target.value)} placeholder="New password (8+ chars)"/>
            </div>
          </div>
          {newPw.length>0&&(
            <div className="pw-strength" style={{marginLeft:56,marginTop:-6,marginBottom:8}}>
              <div className="pw-bar" data-strength={pw.score===1?"weak":pw.score===2?"fair":"strong"} style={{width:`${(pw.score/3)*100}%`}}/>
              <span className="mute" style={{fontSize:"0.72rem"}}>{pw.label}</span>
            </div>
          )}
          <div className="profile-field">
            <div className="profile-field-icon"><LockIcon/></div>
            <div className="profile-field-body">
              <label className="profile-field-label">Confirm Password</label>
              <input type="password" className="profile-input" value={confirmPw}
                onChange={e=>setConfirmPw(e.target.value)} placeholder="Repeat new password"/>
            </div>
          </div>

          <button className="btn w signup-submit" style={{marginTop:20}} disabled={loading}>
            {loading?<><span className="btn-spinner"/> Savingâ¦</>:"Save Profile"}
          </button>
        </form>
        <button className="btn alt w" style={{marginTop:10}} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

// ==========================================
// TRANSPORTER VIEW
// ==========================================
function TransporterView(){
  const {user,toast,setOpenTracking,transporterTab,setTransporterTab}=useContext(AppContext);
  const [jobs,refreshJobs]=useData("/transport/jobs/",8000);
  const [myDeliveries,refreshMyDeliveries]=useData("/transport/deliveries/",8000);
  const subTab=transporterTab;
  const setSubTab=setTransporterTab;

  const activeDeliveries=(myDeliveries||[]).filter(d=>d.status!=="delivered"&&d.status!=="cancelled");
  const completedDeliveries=(myDeliveries||[]).filter(d=>d.status==="delivered");

  const acceptJob=async jobId=>{
    if(!user?.is_verified) return toast("Your account is awaiting admin verification.");
    try{
      await api(`/transport/jobs/${jobId}/accept/`,{method:"POST"});
      toast("Job accepted!"); refreshJobs(); refreshMyDeliveries(); setTransporterTab("active");
    }catch(e){ toast(e.message); }
  };

  const advance=async(deliveryId,nextStatus)=>{
    try{
      await api(`/transport/deliveries/${deliveryId}/status/`,{method:"PATCH",body:{status:nextStatus}});
      toast(`Updated to ${nextStatus.replace("_"," ")}`); refreshMyDeliveries();
    }catch(e){ toast(e.message); }
  };

  const nextStepMap={
    accepted:{status:"picked_up",label:"📦 Cargo Loaded"},
    picked_up:{status:"in_transit",label:"ð£ï¸ On Highway"},
    in_transit:{status:"delivered",label:"🏁 Mark Delivered"}
  };

  return(
    <div>
      {!user?.is_verified&&<div className="warn">â³ Verification pending. You can browse jobs but cannot accept until verified.</div>}

      <div className="chips" style={{marginBottom:14}}>
        <button className={"chip"+(subTab==="active"?" on":"")} onClick={()=>setSubTab("active")}>
          🚚 Active Trips ({activeDeliveries.length})
        </button>
        <button className={"chip"+(subTab==="jobs"?" on":"")} onClick={()=>setSubTab("jobs")}>
          📋 Open Jobs ({(jobs||[]).length})
        </button>
        <button className={"chip"+(subTab==="history"?" on":"")} onClick={()=>setSubTab("history")}>
          🏁 Completed ({completedDeliveries.length})
        </button>
      </div>

      {subTab==="active"&&(
        <div>
          <h2>Current Shipments</h2>
          {activeDeliveries.length===0?(
            <div className="card empty">
              <p>No active runs right now.</p>
              <button className="btn sm" onClick={()=>setSubTab("jobs")}>Browse Open Jobs</button>
            </div>
          ):(
            activeDeliveries.map(d=>{
              const distKm=km(d.pickup,d.dropoff);
              const next=nextStepMap[d.status];
              return(
                <div className="card" key={d.id}>
                  <div className="row">
                    <div>
                      <h3>{d.item}</h3>
                      <div className="mute">Order #{d.order_number} Â· {num(d.quantity)} {d.unit}</div>
                    </div>
                    <span className="pill o">{d.status.replace("_"," ")}</span>
                  </div>

                  {/* Route display */}
                  <div style={{margin:"10px 0",background:"var(--bg)",borderRadius:12,padding:"10px 12px",border:"1px solid var(--line)"}}>
                    <div style={{display:"flex",justifyContent:"space-between",fontWeight:700,fontSize:"0.85rem",marginBottom:6}}>
                      <span>ð From: <span style={{color:"var(--pri)"}}>{d.pickup}</span></span>
                      <span>🏁 To: <span style={{color:"var(--pri)"}}>{d.dropoff}</span></span>
                    </div>
                    <div className="steps">
                      <i className="on"/>
                      <i className={["picked_up","in_transit","delivered"].includes(d.status)?"on":""}/>
                      <i className={["in_transit","delivered"].includes(d.status)?"on":""}/>
                      <i className={d.status==="delivered"?"on":""}/>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:"0.76rem",color:"var(--mute)"}}>
                      <span>Accepted</span><span>Loaded</span><span>In Transit</span><span>Delivered</span>
                    </div>
                  </div>

                  <div className="stats-grid">
                    <div className="stat-box"><b>{distKm} km</b><small>Route</small></div>
                    <div className="stat-box"><b>{eta(distKm)}</b><small>Est. Time</small></div>
                    <div className="stat-box"><b>{ugx(d.total_amount)}</b><small>Cargo Value</small></div>
                  </div>

                  {/* Contact info */}
                  <div style={{background:"var(--bg)",borderRadius:12,padding:"8px 12px",margin:"10px 0",border:"1px solid var(--line)",fontSize:"0.82rem"}}>
                    <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
                      <span>🌾 Farmer: <b>{d.farmer_name}</b> Â· <a href={`tel:${d.pickup_phone}`} style={{color:"var(--pri)"}}>{d.pickup_phone}</a></span>
                      <span>🛒 Buyer: <b>{d.buyer_name}</b> Â· <a href={`tel:${d.dropoff_phone}`} style={{color:"var(--pri)"}}>{d.dropoff_phone}</a></span>
                    </div>
                  </div>

                  <div style={{display:"flex",gap:8,marginTop:10,flexWrap:"wrap"}}>
                    {next&&<button className="btn sm" onClick={()=>advance(d.id,next.status)}>{next.label}</button>}
                    <button className="btn sm alt" onClick={()=>setOpenTracking(d.id)}>ðºï¸ View Timeline</button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {subTab==="jobs"&&(
        <div>
          <h2>Open Haulage Jobs</h2>
          {!jobs||jobs.length===0?(
            <div className="card empty">
              <p>No open jobs right now.</p>
              <small>Jobs appear when buyers purchase produce requiring delivery.</small>
            </div>
          ):(
            jobs.map(j=>{
              const distKm=km(j.pickup,j.dropoff);
              return(
                <div className="card" key={j.id}>
                  <div className="row">
                    <div>
                      <h3>{j.item}</h3>
                      <div className="mute"><b>{j.pickup} â {j.dropoff}</b> Â· {num(j.quantity)} {j.unit}</div>
                      <div className="mute" style={{marginTop:4}}>~{distKm} km Â· ~{eta(distKm)}</div>
                      {/* Farmer contact for transporters viewing jobs */}
                      <div className="mute" style={{marginTop:4}}>
                        🌾 Farmer: {j.farmer_name} Â· <a href={`tel:${j.pickup_phone}`} style={{color:"var(--pri)"}}>{j.pickup_phone}</a>
                      </div>
                    </div>
                    <button className="btn sm" onClick={()=>acceptJob(j.id)} disabled={!user?.is_verified}>
                      {user?.is_verified?"Accept 🚚":"Awaiting Verification"}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {subTab==="history"&&(
        <div>
          <h2>Completed Trips</h2>
          {completedDeliveries.length===0?<div className="card empty">No completed trips yet.</div>:(
            completedDeliveries.map(d=>(
              <div className="card row" key={d.id}>
                <div>
                  <h3>{d.item}</h3>
                  <div className="mute">{d.pickup} â {d.dropoff} Â· {num(d.quantity)} {d.unit} Â· {fmt(d.created_at)}</div>
                </div>
                <span className="pill g">Delivered â</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ==========================================
// FARMER VIEW
// ==========================================
function FarmerView(){
  const {user,toast,setOpenNewListing,produceListings,refreshProduce,farmerTab,setFarmerTab}=useContext(AppContext);
  const [requests,refreshRequests]=useData("/orders/requests/",8000);
  const [orders,refreshOrders]=useData("/orders/",8000);
  const subTab=farmerTab;
  const setSubTab=setFarmerTab;

  const myListings=(produceListings||[]).filter(l=>l.farmer===user?.id);
  const pendingRequests=(requests||[]).filter(r=>r.status==="pending");

  const decideRequest=async(id,action)=>{
    try{
      await api(`/orders/requests/${id}/`,{method:"PATCH",body:{action}});
      toast(`Request ${action==="accept"?"accepted!":"declined."}`);
      refreshRequests(); refreshOrders(); refreshProduce();
    }catch(e){ toast(e.message); }
  };

  const updateOrderStatus=async(id,status)=>{
    try{
      await api(`/orders/${id}/status/`,{method:"PATCH",body:{status}});
      toast(`Order marked as ${status.replace("_"," ")}`); refreshOrders();
    }catch(e){ toast(e.message); }
  };

  const removeListing=async id=>{
    if(!window.confirm("Remove this listing? Buyers will no longer see it.")) return;
    try{
      await api(`/marketplace/produce/${id}/`,{method:"DELETE"});
      toast("Listing removed."); refreshProduce();
    }catch(e){ toast(e.message); }
  };

  return(
    <div>
      {!user?.is_verified&&<div className="warn">â³ Account awaiting admin verification. Listings go live once approved.</div>}

      <div className="stats-grid">
        <div className="stat-box"><b>{myListings.length}</b><small>Listings</small></div>
        <div className="stat-box"><b>{pendingRequests.length}</b><small>Requests</small></div>
        <div className="stat-box"><b>{(orders||[]).length}</b><small>Orders</small></div>
      </div>

      {subTab==="inventory"&&(
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",margin:"14px 0 12px"}}>
            <h2 style={{margin:0}}>My Produce</h2>
            <button className="btn sm" onClick={()=>setOpenNewListing(true)}>+ Add Produce</button>
          </div>
          {myListings.length===0?(
            <div className="card empty">
              <p>No produce listed yet.</p>
              <button className="btn sm" onClick={()=>setOpenNewListing(true)}>Post Harvest Now</button>
            </div>
          ):(
            <div className="farmer-produce-grid">
              {myListings.map(l=>{
                const photo=l.image||l.image_url||getCropImg(l.crop_name);
                return(
                  <div className="farmer-pc" key={l.id}>
                    <div className="farmer-ph" style={{background:photo?`url(${photo}) center/cover no-repeat`:`linear-gradient(${CROPS[l.crop_name]?.grad||"135deg,#5f8f3a,#3d6028"})`}}>
                      {!photo&&<span style={{fontSize:"2.2rem"}}>{CROPS[l.crop_name]?.emoji||"ð±"}</span>}
                      <span className={"pill "+(l.status==="active"?"g":"o")} style={{position:"absolute",top:8,right:8}}>{l.status}</span>
                    </div>
                    <div style={{padding:"10px 12px"}}>
                      <h3 style={{margin:"0 0 4px",fontSize:"0.95rem"}}>{l.title}</h3>
                      <div className="mute" style={{fontSize:"0.78rem"}}>{l.district_name} Â· Grade {l.quality_grade}</div>
                      <div style={{fontWeight:800,marginTop:4,fontSize:"0.9rem"}}>{ugx(l.price_per_unit)}<span className="mute">/{l.unit}</span></div>
                      <div className="mute" style={{fontSize:"0.78rem"}}>{num(l.quantity_available)} {l.unit} in stock</div>
                      <button className="btn sm bad" style={{marginTop:8,width:"100%"}} onClick={()=>removeListing(l.id)}>Remove Listing</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {subTab==="requests"&&(
        <div>
          <h2>Buyer Requests</h2>
          {pendingRequests.length===0?<div className="card empty">No pending requests.</div>:(
            pendingRequests.map(r=>(
              <div className="card" key={r.id}>
                <div className="row">
                  <div>
                    <h3>{r.title}</h3>
                    <div className="mute">Buyer: <b>{r.buyer}</b> Â· {num(r.quantity)} {r.unit}{r.offered_price&&` Â· Offer: ${ugx(r.offered_price)}/${r.unit}`}</div>
                    <div className="mute" style={{marginTop:4}}>
                      {r.delivery_needed?`Deliver to ${r.delivery_district||"Buyer's district"}`:"Farm gate collection"}
                      {r.preferred_transporter_name&&` Â· 🚚 ${r.preferred_transporter_name}`}
                    </div>
                    {/* Buyer contact */}
                    <div style={{marginTop:6,fontSize:"0.82rem"}}>
                      ð± Buyer phone: <a href={`tel:${r.buyer_phone||""}`} style={{color:"var(--pri)",fontWeight:700}}>{r.buyer_phone||"—"}</a>
                    </div>
                    {r.message&&<p style={{fontStyle:"italic",marginTop:6,fontSize:"0.85rem"}}>"{r.message}"</p>}
                  </div>
                  <div style={{display:"flex",gap:6}}>
                    <button className="btn sm" onClick={()=>decideRequest(r.id,"accept")}>Accept</button>
                    <button className="btn sm bad" onClick={()=>decideRequest(r.id,"reject")}>Decline</button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {subTab==="orders"&&(
        <div>
          <h2>Orders</h2>
          {(!orders||orders.length===0)?<div className="card empty">No orders yet.</div>:(
            orders.map(o=>(
              <div className="card" key={o.id}>
                <div className="row">
                  <div>
                    <h3>{o.item_title}</h3>
                    <div className="mute">#{o.order_number} Â· {num(o.quantity)} {o.unit} Â· {ugx(o.total_amount)}</div>
                    <div className="mute" style={{marginTop:4}}>Buyer: {o.other_name} Â· Escrow: <b>{o.payment_status?.toUpperCase()}</b></div>
                    <div style={{marginTop:6,fontSize:"0.82rem"}}>ð± <a href={`tel:${o.buyer_phone}`} style={{color:"var(--pri)",fontWeight:700}}>{o.buyer_phone}</a></div>
                  </div>
                  <span className="pill g">{o.status.replace("_"," ")}</span>
                </div>
                <div style={{display:"flex",gap:8,marginTop:12}}>
                  {o.status==="confirmed"&&<button className="btn sm" onClick={()=>updateOrderStatus(o.id,"ready_for_pickup")}>â Ready for Pickup</button>}
                  {o.status==="ready_for_pickup"&&!o.delivery_required&&<button className="btn sm" onClick={()=>updateOrderStatus(o.id,"delivered")}>ð¤ Handed Over</button>}
                  <span className="mute" style={{alignSelf:"center",fontSize:"0.8rem"}}>{o.delivery_required?"🚚 Transporter handover":"ð Farm gate pickup"}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ==========================================
// CART ICON SVG
// ==========================================
const CartIcon=({size=22})=><svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>;
const HomeIcon=()=><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>;

// ==========================================
// BUYER VIEW — Vegigo-style marketplace
// ==========================================
function BuyerView({searchQ,setSearchQ,filterDistrict,setFilterDistrict,filterCrop,setFilterCrop}){
  const {produceListings,setOpenListing,setOpenPayOrder,setOpenTracking,toast,user,
         cart,addToCart,cartCount,setOpenCart}=useContext(AppContext);
  const [orders,refreshOrders]=useData("/orders/",8000);
  const [requests]=useData("/orders/requests/",8000);
  const [subTab,setSubTab]=useState("shop"); // shop | orders | requests
  const filtered=useMemo(()=>(produceListings||[]).filter(l=>{
    if(l.status!=="active") return false;
    if(filterDistrict&&l.district_name!==filterDistrict) return false;
    if(filterCrop&&l.crop_name!==filterCrop) return false;
    if(searchQ){
      const q=searchQ.toLowerCase();
      if(!l.title.toLowerCase().includes(q)&&!l.crop_name.toLowerCase().includes(q)&&!(l.district_name||"").toLowerCase().includes(q)) return false;
    }
    return true;
  }),[produceListings,filterDistrict,filterCrop,searchQ]);

  const confirmReceived=async orderId=>{
    try{
      await api(`/orders/${orderId}/status/`,{method:"PATCH",body:{status:"completed"}});
      toast("Receipt confirmed! Payment released to farmer."); refreshOrders();
    }catch(e){ toast(e.message); }
  };

  return(
    <div className="buyer-root">
      {subTab==="shop"&&(
        <div>
          <div className="promo-banner">
            <div className="promo-copy">
              <span className="promo-eyebrow">From farm to table</span>
              <div className="promo-title">Fresh &amp; Direct</div>
              <div className="promo-sub">Straight from Uganda's farms to your door</div>
              <button type="button" className="promo-action" onClick={()=>{setFilterCrop("");setFilterDistrict("");}}>
                Discover produce
              </button>
            </div>
            <img src={getCropImg("Tomatoes")||""} alt="" className="promo-img" onError={e=>e.target.style.display="none"}/>
          </div>
          <div className="buyer-section-heading">
            <h3>Shop by category</h3>
          </div>
          <div className="cat-row">
            <button className={"cat-chip"+(!filterCrop?" active":"")} onClick={()=>setFilterCrop("")}>
              <span className="cat-image cat-image-all">✦</span><span>All</span>
            </button>
            {Object.entries(CROPS).map(([name,c])=>(
              <button key={name} className={"cat-chip"+(filterCrop===name?" active":"")}
                onClick={()=>setFilterCrop(filterCrop===name?"":name)}>
                <span className="cat-image">
                  {getCropImg(name)?<img src={getCropImg(name)} alt=""/>:<span>{c.emoji}</span>}
                </span>
                <span>{name.split(" ")[0]}</span>
              </button>
            ))}
          </div>
          <div className="buyer-filter-row">
            <label htmlFor="buyer-district-filter">Fresh near you</label>
            <select value={filterDistrict} onChange={e=>setFilterDistrict(e.target.value)}
              id="buyer-district-filter"
              style={{width:"100%",padding:"10px 14px",borderRadius:12,border:"1.5px solid var(--line)",background:"var(--surf)",color:"var(--ink)",font:"inherit",outline:0}}>
              <option value="">All Districts</option>
              {DN.map(d=><option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="buyer-section-heading buyer-popular-heading">
            <div>
              <h3>{filterCrop||"Popular produce"}</h3>
              {filterDistrict&&<span className="buyer-filter-caption">Available in {filterDistrict}</span>}
            </div>
            <button type="button" onClick={()=>{setFilterCrop("");setFilterDistrict("");setSearchQ("");}}>
              View all
            </button>
          </div>
          {filtered.length===0?(
            <div className="card empty">No produce matches your filters right now.</div>
          ):(
            <div className="shop-grid">
              {filtered.map(l=>{
                const meta=CROPS[l.crop_name]||{emoji:"?",grad:"135deg,#79a73a,#5f8f3a"};
                const photo=l.image||l.image_url||getCropImg(l.crop_name);
                const inCart=cart.has(l.id),cartQty=cart.get(l.id)?.qty||0;
                return(
                  <div className="shop-card" key={l.id} onClick={()=>setOpenListing(l)}>
                    <div className="shop-card-img">
                      {photo?<img src={photo} alt={l.title}/>:<div className="shop-card-emoji" style={{background:`linear-gradient(${meta.grad})`}}>{meta.emoji}</div>}
                      {l.farmer_verified&&<span className="shop-verified"><BlueTick/></span>}
                    </div>
                    <div className="shop-card-body">
                      <div className="shop-card-name">{l.crop_name}</div>
                      <div className="shop-card-sub">{l.district_name}</div>
                      <div className="shop-card-price">UGX {Number(l.price_per_unit).toLocaleString()}<span className="shop-card-unit">/{l.unit}</span></div>
                      <button className={"shop-add-btn"+(inCart?" in-cart":"")}
                        onClick={e=>{e.stopPropagation();addToCart(l,1);toast(`${l.crop_name} added to cart`);}}>
                        {inCart?`${cartQty} in cart`:"+ Add"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {subTab==="orders"&&(
        <div>
          <h2>My Purchases</h2>
          {(!orders||orders.length===0)?(
            <div className="card empty"><p>No orders yet.</p><button className="btn sm" onClick={()=>setSubTab("shop")}>Browse Market</button></div>
          ):orders.map(o=>(
            <div className="order-card" key={o.id}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div style={{flex:1}}>
                  <div style={{fontWeight:700,fontSize:"1rem"}}>{o.item_title}</div>
                  <div className="mute" style={{marginTop:2}}>#{o.order_number} · {num(o.quantity)} {o.unit}</div>
                  <div style={{fontWeight:800,color:"var(--pri)",marginTop:4,fontSize:"1rem"}}>{ugx(o.total_amount)}</div>
                  <div className="mute" style={{marginTop:4,fontSize:"0.8rem"}}>
                    Farmer: {o.other_name} · <a href={`tel:${o.seller_phone}`} style={{color:"var(--pri)",fontWeight:700}}>{o.seller_phone}</a>
                  </div>
                  {o.transporter_name&&<div className="mute" style={{fontSize:"0.8rem"}}>
                    Transporter: {o.transporter_name} {o.transporter_phone&&<a href={`tel:${o.transporter_phone}`} style={{color:"var(--pri)",fontWeight:700}}>· {o.transporter_phone}</a>}
                  </div>}
                  <div style={{display:"flex",gap:6,marginTop:6,flexWrap:"wrap"}}>
                    <span className={"status-pill "+(o.status==="completed"?"done":"active")}>{o.status.replace(/_/g," ")}</span>
                    <span className={"status-pill "+(o.payment_status==="held"||o.payment_status==="released"?"done":"pending")}>{o.payment_status}</span>
                  </div>
                </div>
              </div>
              <div style={{display:"flex",gap:8,marginTop:12,flexWrap:"wrap"}}>
                {o.payment_status==="unpaid"&&<button className="btn sm" onClick={()=>setOpenPayOrder(o)}>Pay Now</button>}
                {o.status==="delivered"&&<button className="btn sm" onClick={()=>confirmReceived(o.id)}>Confirm Receipt</button>}
                {o.delivery_id&&<button className="btn sm alt" onClick={()=>setOpenTracking(o.delivery_id)}>Track</button>}
              </div>
            </div>
          ))}
        </div>
      )}
      {subTab==="requests"&&(
        <div>
          <h2>Sent Requests</h2>
          {(!requests||requests.length===0)?<div className="card empty">No sent requests yet.</div>:requests.map(r=>(
            <div className="order-card" key={r.id}>
              <div style={{fontWeight:700}}>{r.title}</div>
              <div className="mute">Farmer: {r.farmer} · {num(r.quantity)} {r.unit}{r.offered_price&&` · Offer: ${ugx(r.offered_price)}`}</div>
              <div className="mute">{r.delivery_needed?`Deliver to ${r.delivery_district}`:"Self pickup"}</div>
              <span className={"status-pill "+(r.status==="accepted"?"done":r.status==="rejected"?"bad":"active")} style={{marginTop:8,display:"inline-block"}}>{r.status}</span>
            </div>
          ))}
        </div>
      )}
      <nav className="buyer-bottom-nav">
        <button className={subTab==="shop"?"active":""} onClick={()=>setSubTab("shop")}><HomeIcon/><span>Home</span></button>
        <button className={subTab==="orders"?"active":""} onClick={()=>setSubTab("orders")}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/></svg>
          <span>Orders</span>
        </button>
        <button className={subTab==="requests"?"active":""} onClick={()=>setSubTab("requests")}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <span>Requests</span>
        </button>
        <button className={cartCount>0?"active":""} onClick={()=>setOpenCart(true)} style={{position:"relative"}}>
          <CartIcon size={22}/>{cartCount>0&&<em>{cartCount}</em>}<span>Cart</span>
        </button>
      </nav>
    </div>
  );
}

// ==========================================
// ADMIN VIEW
// ==========================================
function AdminView(){
  const {toast}=useContext(AppContext);
  const [users,refreshUsers]=useData("/admin/users/",8000);
  const [summary]=useData("/admin/reports/summary/",8000);
  const [allOrders]=useData("/admin/all_orders/",8000);
  const [allDeliveries]=useData("/admin/all_deliveries/",8000);
  const [subTab,setSubTab]=useState("approvals");
  const pendingUsers=(users||[]).filter(u=>!u.is_verified);

  const verifyUser=async(id,approve)=>{
    try{
      await api(`/users/${id}/verify/`,{method:"POST",body:{approve}});
      toast(`User ${approve?"approved!":"rejected."}`); refreshUsers();
    }catch(e){ toast(e.message); }
  };

  return(
    <div>
      <div className="stats-grid">
        <div className="stat-box"><b>{summary?.farmers||0}</b><small>Farmers</small></div>
        <div className="stat-box"><b>{summary?.transporters||0}</b><small>Transporters</small></div>
        <div className="stat-box"><b>{summary?.buyers||0}</b><small>Buyers</small></div>
        <div className="stat-box"><b>{pendingUsers.length}</b><small>Pending</small></div>
        <div className="stat-box"><b>{summary?.orders||0}</b><small>Orders</small></div>
        <div className="stat-box"><b>UGX {((summary?.order_value||0)/1000000).toFixed(1)}M</b><small>GMV</small></div>
      </div>
      <div className="chips" style={{marginBottom:14}}>
        <button className={"chip"+(subTab==="approvals"?" on":"")} onClick={()=>setSubTab("approvals")}>🛡️ Queue ({pendingUsers.length})</button>
        <button className={"chip"+(subTab==="orders"?" on":"")} onClick={()=>setSubTab("orders")}>📋 Orders ({(allOrders||[]).length})</button>
        <button className={"chip"+(subTab==="deliveries"?" on":"")} onClick={()=>setSubTab("deliveries")}>🚚 Deliveries ({(allDeliveries||[]).length})</button>
      </div>
      {subTab==="approvals"&&(
        <div>
          <h2>Verification Requests</h2>
          {pendingUsers.length===0?<div className="card empty">No pending requests.</div>:(
            pendingUsers.map(u=>(
              <div className="card row" key={u.id}>
                <div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}><h3>{u.full_name}</h3><span className="pill o">{u.role}</span></div>
                  <div className="mute">{u.phone} Â· {u.district_name||"Uganda"}</div>
                  <div className="mute">Doc: <b>{u.verification_doc||"None"}</b></div>
                </div>
                <div style={{display:"flex",gap:6}}>
                  <button className="btn sm" onClick={()=>verifyUser(u.id,true)}>Approve â</button>
                  <button className="btn sm bad" onClick={()=>verifyUser(u.id,false)}>Reject â</button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
      {subTab==="orders"&&(
        <div>
          <h2>All Orders</h2>
          {(!allOrders||allOrders.length===0)?<div className="card empty">No orders recorded.</div>:(
            allOrders.map(o=>(
              <div className="card" key={o.id}>
                <div className="row">
                  <div>
                    <h3>{o.item_title}</h3>
                    <div className="mute">#{o.order_number} Â· {num(o.quantity)} {o.unit} Â· <b>{ugx(o.total_amount)}</b></div>
                    <div className="mute">{o.seller_name} ({o.seller_phone}) â {o.buyer_name} ({o.buyer_phone})</div>
                    <div className="mute">{o.pickup_district} â {o.dropoff_district||"Farm gate"}</div>
                  </div>
                  <span className="pill g">{o.status}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
      {subTab==="deliveries"&&(
        <div>
          <h2>All Deliveries</h2>
          {(!allDeliveries||allDeliveries.length===0)?<div className="card empty">No deliveries.</div>:(
            allDeliveries.map(d=>(
              <div className="card" key={d.id}>
                <div className="row">
                  <div>
                    <h3>{d.item}</h3>
                    <div className="mute">{d.pickup} â {d.dropoff} Â· {d.transporter_name||"Unassigned"}</div>
                  </div>
                  <span className={"pill "+(d.status==="delivered"?"g":"o")}>{d.status}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ==========================================
// PRODUCT DETAIL SHEET
// ==========================================
function ProductDetailSheet({listing,onClose}){
  const {user,toast,cart,addToCart,produceListings,setOpenListing}=useContext(AppContext);
  const maxQty=Number(listing.quantity_available);
  const [qty,setQty]=useState(Math.min(maxQty,cart.get(listing.id)?.qty||1));
  const [transporters]=useData("/transport/transporters/");
  const [backendDistricts]=useData("/locations/districts/");
  const [deliveryNeeded,setDeliveryNeeded]=useState(true);
  const [destDistrict,setDestDistrict]=useState(user?.district_name||"Kampala");
  const [chosenTransporter,setChosenTransporter]=useState("");
  const [message,setMessage]=useState("");
  const [submitting,setSubmitting]=useState(false);
  const meta=CROPS[listing.crop_name]||{emoji:"?",grad:"135deg,#79a73a,#5f8f3a"};
  const photo=listing.image||listing.image_url||getCropImg(listing.crop_name);
  const similar=(produceListings||[]).filter(l=>l.id!==listing.id&&l.crop_name===listing.crop_name&&l.status==="active").slice(0,4);
  const districtId=(backendDistricts||[]).find(d=>d.name.toLowerCase()===destDistrict.toLowerCase())?.id;

  const sendRequest=async()=>{
    if(user?.role!=="buyer") return toast("Only buyers can purchase produce.");
    setSubmitting(true);
    try{
      await api("/orders/requests/",{method:"POST",body:{
        listing:listing.id,quantity:qty,offered_price:null,delivery_needed:deliveryNeeded,
        delivery_district:deliveryNeeded?(districtId||null):null,
        preferred_transporter:deliveryNeeded&&chosenTransporter?chosenTransporter:null,message
      }});
      toast(`Request sent to ${listing.farmer_name}!`); onClose();
    }catch(e){ toast(e.message); }
    finally{ setSubmitting(false); }
  };

  return(
    <div className="sheet pds-sheet" onClick={onClose}>
      <div onClick={e=>e.stopPropagation()}>
        <div className="pds-hero">
          {photo?<img src={photo} alt={listing.title} className="pds-img"/>
            :<div className="pds-emoji-bg" style={{background:`linear-gradient(${meta.grad})`}}><span>{meta.emoji}</span></div>}
        </div>
        <div className="pds-body">
          <h2 className="pds-title">{listing.title}</h2>
          <div className="pds-farmer">{listing.crop_name} · {listing.district_name} · Grade {listing.quality_grade}</div>
          <div className="pds-farmer">Farmer: {listing.farmer_name} · {listing.farmer_phone}</div>
          <div className="pds-price-row"><span className="pds-price">{ugx(listing.price_per_unit)}</span><span className="pds-unit"> / {listing.unit}</span></div>
          <div className="mute" style={{fontSize:"0.82rem",marginBottom:16}}>{num(maxQty)} {listing.unit} available</div>
          {user?.role==="transporter"?<div className="warn">Transporters cannot place orders.</div>
            :user?.role==="farmer"&&user?.id===listing.farmer?<div className="warn">This is your own listing.</div>:(
              <>
                <div className="pds-stepper-row">
                  <div className="pds-stepper">
                    <button className="pds-step-btn" onClick={()=>setQty(q=>Math.max(1,q-1))}>-</button>
                    <input type="number" className="pds-step-input" value={qty} min={1} max={maxQty}
                      onChange={e=>setQty(Math.min(maxQty,Math.max(1,parseInt(e.target.value)||1)))}/>
                    <span className="pds-unit-lbl">{listing.unit}</span>
                    <button className="pds-step-btn" onClick={()=>setQty(q=>Math.min(maxQty,q+1))}>+</button>
                  </div>
                  <div className="pds-line-total">{ugx(qty*Number(listing.price_per_unit))}</div>
                </div>
                <button className="pds-cart-btn" onClick={()=>{addToCart(listing,qty);toast(`${listing.crop_name} added to cart.`);onClose();}}>Add to Cart</button>
                <details className="pds-delivery">
                  <summary>Delivery options</summary>
                  <div style={{padding:"10px 0 4px"}}>
                    <label><input type="checkbox" checked={deliveryNeeded} onChange={e=>setDeliveryNeeded(e.target.checked)}/> Deliver to my district</label>
                    {deliveryNeeded&&<>
                      <select value={destDistrict} onChange={e=>setDestDistrict(e.target.value)}>
                        {DN.map(d=><option key={d} value={d}>{d}</option>)}
                      </select>
                      <select value={chosenTransporter} onChange={e=>setChosenTransporter(e.target.value)}>
                        <option value="">Any Verified Transporter</option>
                        {(transporters||[]).map(t=><option key={t.id} value={t.id}>{t.name} · {t.phone}</option>)}
                      </select>
                    </>}
                    <textarea rows={2} placeholder="Note to farmer (optional)..." value={message} onChange={e=>setMessage(e.target.value)}/>
                    <button className="btn w" style={{marginTop:8}} onClick={sendRequest} disabled={submitting}>
                      {submitting?"Sending...":"Send Purchase Request Directly"}
                    </button>
                  </div>
                </details>
                {similar.length>0&&<div style={{marginTop:20}}>
                  <h3 style={{margin:"0 0 10px"}}>Similar Products</h3>
                  <div className="similar-row">{similar.map(item=>(
                    <button type="button" className="similar-card" key={item.id} onClick={()=>{onClose();setTimeout(()=>setOpenListing(item),100);}}>
                      <div className="similar-img">{(item.image||item.image_url||getCropImg(item.crop_name))
                        ?<img src={item.image||item.image_url||getCropImg(item.crop_name)} alt={item.title}/>
                        :<span>{(CROPS[item.crop_name]||meta).emoji}</span>}</div>
                      <div>{item.crop_name}</div><div>{item.district_name}</div>
                      <div>{ugx(item.price_per_unit)}</div>
                    </button>
                  ))}</div>
                </div>}
              </>
            )}
          <button className="btn alt w" style={{marginTop:16}} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// CART MODAL
// ==========================================
function CartModal({onClose}){
  const {cart,updateCartQty,removeFromCart,clearCart,cartTotal,toast,user}=useContext(AppContext);
  const [backendDistricts]=useData("/locations/districts/");
  const [transporters]=useData("/transport/transporters/");
  const [deliveryNeeded,setDeliveryNeeded]=useState(true);
  const [destDistrict,setDestDistrict]=useState(user?.district_name||"Kampala");
  const [chosenTransporter,setChosenTransporter]=useState("");
  const [submitting,setSubmitting]=useState(false);
  const items=[...cart.values()];
  const districtId=(backendDistricts||[]).find(d=>d.name.toLowerCase()===destDistrict.toLowerCase())?.id;

  const placeOrders=async()=>{
    if(!items.length) return toast("Your cart is empty.");
    if(user?.role!=="buyer") return toast("Only buyers can place orders.");
    setSubmitting(true);
    const completed=[];
    for(const {listing,qty} of items){
      try{
        await api("/orders/requests/",{method:"POST",body:{
          listing:listing.id,quantity:qty,offered_price:null,delivery_needed:deliveryNeeded,
          delivery_district:deliveryNeeded?(districtId||null):null,
          preferred_transporter:deliveryNeeded&&chosenTransporter?chosenTransporter:null,message:""
        }});
        completed.push(listing.id);
      }catch(e){ toast(`${listing.crop_name}: ${e.message}`); }
    }
    completed.forEach(removeFromCart);
    setSubmitting(false);
    if(completed.length){
      toast(`${completed.length} purchase request${completed.length>1?"s":""} sent to farmers!`);
      if(completed.length===items.length) onClose();
    }
  };

  return(
    <div className="sheet" onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <h2 style={{margin:0}}>My Cart ({items.length})</h2>
          {items.length>0&&<button className="btn sm bad" onClick={clearCart}>Clear</button>}
        </div>
        {!items.length?<div className="card empty"><p>Your cart is empty.</p><p className="mute">Add produce from the marketplace.</p></div>:<>
          {items.map(({listing,qty})=>{
            const photo=listing.image||listing.image_url||getCropImg(listing.crop_name);
            const meta=CROPS[listing.crop_name]||{emoji:"?",grad:"135deg,#79a73a,#5f8f3a"};
            const maxQty=Number(listing.quantity_available);
            return <div className="cart-item" key={listing.id}>
              <div className="cart-item-img">{photo?<img src={photo} alt={listing.crop_name}/>:<span>{meta.emoji}</span>}</div>
              <div className="cart-item-info">
                <div className="cart-item-name">{listing.crop_name}</div>
                <div className="cart-item-sub">{listing.district_name} · {listing.farmer_name}</div>
                <div className="cart-item-price">{ugx(listing.price_per_unit)}/{listing.unit}</div>
              </div>
              <div className="cart-item-controls">
                <div className="cart-stepper">
                  <button onClick={()=>updateCartQty(listing.id,qty-1)}>-</button>
                  <input type="number" value={qty} min={1} max={maxQty}
                    onChange={e=>updateCartQty(listing.id,Math.min(maxQty,Math.max(1,parseInt(e.target.value)||1)))}/>
                  <button onClick={()=>updateCartQty(listing.id,Math.min(maxQty,qty+1))}>+</button>
                </div>
                <div className="cart-line-total">{ugx(qty*Number(listing.price_per_unit))}</div>
                <button className="cart-remove" onClick={()=>removeFromCart(listing.id)}>×</button>
              </div>
            </div>;
          })}
          <div className="cart-total-row"><span>Total</span><span className="cart-total-amount">{ugx(cartTotal)}</span></div>
          <div className="cart-delivery">
            <h3 style={{margin:"0 0 10px"}}>Delivery</h3>
            <label><input type="checkbox" checked={deliveryNeeded} onChange={e=>setDeliveryNeeded(e.target.checked)}/> Deliver to my district</label>
            {deliveryNeeded&&<>
              <select value={destDistrict} onChange={e=>setDestDistrict(e.target.value)}>
                {DN.map(d=><option key={d} value={d}>{d}</option>)}
              </select>
              <select value={chosenTransporter} onChange={e=>setChosenTransporter(e.target.value)}>
                <option value="">Any Verified Transporter</option>
                {(transporters||[]).map(t=><option key={t.id} value={t.id}>{t.name} · {t.phone}</option>)}
              </select>
            </>}
          </div>
          <button className="glass-btn" style={{marginTop:16,background:"linear-gradient(135deg,#2d7a54,#1f5a3d)"}}
            onClick={placeOrders} disabled={submitting}>
            {submitting?"Sending requests...":`Place Order · ${ugx(cartTotal)}`}
          </button>
        </>}
        <button className="btn alt w" style={{marginTop:10}} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

// ==========================================
// PAYMENT MODAL — MTN + Airtel links
// ==========================================
function PaymentModal({order,onClose}){
  const {toast}=useContext(AppContext);
  const [processing,setProcessing]=useState(false);

  const handlePay=async(method)=>{
    setProcessing(true);
    try{
      await api(`/orders/${order.id}/pay/`,{method:"POST",body:{method}});
      toast(`Payment of ${ugx(order.total_amount)} held in escrow!`); onClose();
    }catch(e){ toast(e.message); }
    finally{ setProcessing(false); }
  };

  return(
    <div className="sheet" onClick={onClose}>
      <div onClick={e=>e.stopPropagation()}>
        <h2>Pay with Mobile Money</h2>
        <p className="mute">AgriConnect holds funds safely until you confirm delivery.</p>
        <div className="card" style={{background:"rgba(31,90,61,0.06)",border:"1.5px solid var(--pri)",textAlign:"center",marginBottom:20}}>
          <small>Total Escrow Amount</small>
          <b style={{fontSize:"1.4rem",color:"var(--pri)",display:"block"}}>{ugx(order.total_amount)}</b>
          <small className="mute">#{order.order_number} Â· {order.item_title}</small>
        </div>
        <p style={{fontWeight:700,marginBottom:12}}>Choose your network:</p>
        <button className="pay-network-btn mtn"
          onClick={()=>{ window.open("tel:*165*3*1#","_self"); handlePay("MTN MoMo"); }}
          disabled={processing}>
          <MtnLogo/>
          <div>
            <div style={{fontWeight:800}}>MTN Mobile Money</div>
            <div style={{fontSize:"0.76rem",opacity:0.8}}>Dial *165# Â· Pay {ugx(order.total_amount)}</div>
          </div>
        </button>
        <button className="pay-network-btn airtel"
          onClick={()=>{ window.open("tel:*185*1*1#","_self"); handlePay("Airtel Money"); }}
          disabled={processing} style={{marginTop:10}}>
          <AirtelLogo/>
          <div>
            <div style={{fontWeight:800}}>Airtel Money</div>
            <div style={{fontSize:"0.76rem",opacity:0.8}}>Dial *185# Â· Pay {ugx(order.total_amount)}</div>
          </div>
        </button>
        <button className="btn alt w" style={{marginTop:14}} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

function MtnLogo(){
  return(<svg width="44" height="44" viewBox="0 0 44 44"><circle cx="22" cy="22" r="22" fill="#FFCC00"/><text x="22" y="28" textAnchor="middle" fontWeight="900" fontSize="13" fill="#000">MTN</text></svg>);
}
function AirtelLogo(){
  return(<svg width="44" height="44" viewBox="0 0 44 44"><circle cx="22" cy="22" r="22" fill="#E40612"/><text x="22" y="29" textAnchor="middle" fontWeight="900" fontSize="11" fill="#fff">airtel</text></svg>);
}

// ==========================================
// NEW LISTING MODAL (Farmer)
// ==========================================
function NewListingModal({onClose,onSaved}){
  const {user,toast}=useContext(AppContext);
  const [crop,setCrop]=useState("Maize");
  const [title,setTitle]=useState("Fresh Maize");
  const [qty,setQty]=useState(1000);
  const [price,setPrice]=useState(1200);
  const [district,setDistrict]=useState(user?.district_name||"Lira");
  const [grade,setGrade]=useState("A");
  const [desc,setDesc]=useState("");
  const [photoPreview,setPhotoPreview]=useState(getCropImg("Maize")||"");
  const [photoFile,setPhotoFile]=useState(null);
  const [submitting,setSubmitting]=useState(false);
  const [backendCrops]=useData("/locations/crops/");
  const [backendDistricts]=useData("/locations/districts/");

  const handleFileChange=e=>{
    const file=e.target.files[0];
    if(file){ setPhotoFile(file); const r=new FileReader(); r.onload=ev=>setPhotoPreview(ev.target.result); r.readAsDataURL(file); }
  };

  const handleSubmit=async()=>{
    if(!title||qty<=0||price<=0) return toast("Enter title, quantity, and price.");
    setSubmitting(true);
    try{
      const cropObj=(backendCrops||[]).find(c=>c.name.toLowerCase()===crop.toLowerCase())||(backendCrops||[])[0];
      const distObj=(backendDistricts||[]).find(d=>d.name.toLowerCase()===district.toLowerCase())||(backendDistricts||[])[0];
      await api("/marketplace/produce/",{method:"POST",body:{
        crop:cropObj?.id,title,quantity_available:qty,unit:cropObj?.default_unit||"kg",
        price_per_unit:price,district:distObj?.id,quality_grade:grade,image_url:photoPreview,description:desc
      }});
      toast(user?.is_verified?"Harvest published!":"Saved! Awaiting admin verification.");
      onSaved&&onSaved(); onClose();
    }catch(e){ toast(e.message); }
    finally{ setSubmitting(false); }
  };

  return(
    <div className="sheet" onClick={onClose}>
      <div onClick={e=>e.stopPropagation()}>
        <h2>🌾 Add Farm Produce</h2>
        <label>Crop</label>
        <select value={crop} onChange={e=>{ const c=e.target.value; setCrop(c); setTitle(`Fresh ${c}`); if(!photoFile) setPhotoPreview(getCropImg(c)||""); }}>
          {Object.keys(CROPS).map(c=><option key={c} value={c}>{CROPS[c].emoji} {c}</option>)}
        </select>
        <label>Title</label>
        <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. Dry Maize, 2 Tonnes"/>
        <label>Picture</label>
        <div className="img-upload-box" onClick={()=>document.getElementById("produce-img").click()}>
          <input id="produce-img" type="file" accept="image/*" style={{display:"none"}} onChange={handleFileChange}/>
          <div style={{fontSize:"1.8rem"}}>ð·</div>
          <b>Tap to upload photo</b>
          <div className="mute" style={{fontSize:"0.76rem"}}>Default crop image used if none selected</div>
        </div>
        {photoPreview&&<img src={photoPreview} alt="Preview" className="img-preview"/>}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div>
            <label>Quantity ({CROPS[crop]?.unit||"kg"})</label>
            <div className="qty-stepper">
              <button type="button" className="qty-btn" onClick={()=>setQty(q=>Math.max(1,q-1))}>â</button>
              <input type="number" value={qty} onChange={e=>setQty(parseFloat(e.target.value)||0)} className="qty-input"/>
              <button type="button" className="qty-btn" onClick={()=>setQty(q=>q+1)}>+</button>
            </div>
          </div>
          <div>
            <label>Price/Unit (UGX)</label>
            <input type="number" value={price} onChange={e=>setPrice(parseFloat(e.target.value)||0)}/>
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:10}}>
          <div>
            <label>District</label>
            <select value={district} onChange={e=>setDistrict(e.target.value)}>
              {DN.map(d=><option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label>Grade</label>
            <select value={grade} onChange={e=>setGrade(e.target.value)}>
              <option value="A">A</option><option value="B">B</option><option value="C">C</option>
            </select>
          </div>
        </div>
        <label>Notes</label>
        <textarea placeholder="e.g. Well-dried, 50kg bags, ready for pickup." value={desc} onChange={e=>setDesc(e.target.value)} rows={2}/>
        <button className="btn w" style={{marginTop:14}} onClick={handleSubmit} disabled={submitting}>
          {submitting?"Publishingâ¦":"Publish Listing"}
        </button>
        <button className="btn alt w" style={{marginTop:8}} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

// ==========================================
// TRACKING MODAL
// ==========================================
function TrackingModal({deliveryId,onClose}){
  const [delivery]=useData(`/transport/deliveries/${deliveryId}/tracking/`,5000);
  const distKm=delivery?km(delivery.pickup,delivery.dropoff):100;
  const prog={open:0.05,accepted:0.25,picked_up:0.5,in_transit:0.75,delivered:1.0}[delivery?.status||"open"]||0.1;
  const truckX=Math.round(24+272*prog);

  return(
    <div className="sheet" onClick={onClose}>
      <div onClick={e=>e.stopPropagation()}>
        <h2>🚚 Delivery Tracking</h2>
        {delivery&&<div className="mute">#{delivery.order_number} Â· {delivery.item}</div>}
        <div style={{margin:"16px 0",background:"var(--surf)",borderRadius:16,padding:14,border:"1px solid var(--line)"}}>
          <svg viewBox="0 0 320 80" className="route-svg">
            <line x1="24" y1="46" x2="296" y2="46" stroke="var(--line)" strokeWidth="6" strokeLinecap="round"/>
            <line x1="24" y1="46" x2={truckX} y2="46" stroke="var(--pri)" strokeWidth="6" strokeLinecap="round"/>
            <circle cx="24" cy="46" r="8" fill="var(--pri)"/>
            <circle cx="296" cy="46" r="8" fill={prog>=1?"var(--lime)":"var(--acc)"}/>
            <text x={truckX} y="32" fontSize="22" textAnchor="middle">🚚</text>
            <text x="24" y="70" fontSize="11" fill="currentColor" fontWeight="700">{delivery?.pickup||"Origin"}</text>
            <text x="296" y="70" fontSize="11" textAnchor="end" fill="currentColor" fontWeight="700">{delivery?.dropoff||"Dest"}</text>
          </svg>
          <div className="stats-grid">
            <div className="stat-box"><b>{distKm} km</b><small>Distance</small></div>
            <div className="stat-box"><b>{Math.round(distKm*(1-prog))} km</b><small>Remaining</small></div>
            <div className="stat-box"><b>{prog>=1?"Delivered":eta(Math.round(distKm*(1-prog)))}</b><small>ETA</small></div>
          </div>
          {delivery?.transporter_name&&(
            <div style={{marginTop:10,fontSize:"0.82rem",background:"var(--bg)",borderRadius:10,padding:"8px 12px"}}>
              🚚 Transporter: <b>{delivery.transporter_name}</b>
              {delivery.transporter_phone&&<a href={`tel:${delivery.transporter_phone}`} style={{color:"var(--pri)",fontWeight:700,marginLeft:8}}>{delivery.transporter_phone}</a>}
            </div>
          )}
        </div>
        <h3>Waypoint Timeline</h3>
        {(!delivery?.updates||delivery.updates.length===0)?<div className="empty">No checkpoints yet.</div>:(
          <ul className="tl">
            {delivery.updates.slice().reverse().map((u,i)=>(
              <li key={i}><b>{u.status?.replace("_"," ").toUpperCase()}</b>: {u.note||"Checkpoint"}<div className="mute">{fmt(u.created_at)}</div></li>
            ))}
          </ul>
        )}
        <button className="btn alt w" style={{marginTop:14}} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

// ==========================================
// BOTTOM NAVIGATION
// ==========================================
function BottomNav(){
  const {role,setOpenProfile,farmerTab,setFarmerTab,transporterTab,setTransporterTab}=useContext(AppContext);

  if(role==="transporter") return(
    <nav className="bottom-nav">
      <button className={transporterTab==="active"?"on":""} onClick={()=>setTransporterTab("active")}><span>🚚</span> Active Trips</button>
      <button className={transporterTab==="jobs"?"on":""} onClick={()=>setTransporterTab("jobs")}><span>📋</span> Open Jobs</button>
      <button className={transporterTab==="history"?"on":""} onClick={()=>setTransporterTab("history")}><span>🏁</span> Completed</button>
      <button onClick={()=>setOpenProfile(true)}><span>👤</span> Profile</button>
    </nav>
  );

  if(role==="farmer") return(
    <nav className="bottom-nav">
      <button className={farmerTab==="inventory"?"on":""} onClick={()=>setFarmerTab("inventory")}><span>🌾</span> My Farm</button>
      <button onClick={()=>setOpenProfile(true)}><span>👤</span> Profile</button>
    </nav>
  );

  if(role==="admin") return(
    <nav className="bottom-nav">
      <button><span>🛡️</span> Dashboard</button>
      <a href="/admin/" target="_blank" rel="noreferrer"
        style={{textDecoration:"none",color:"inherit",flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2}}>
        <span style={{fontSize:"1.3rem"}}>âï¸</span>
        <span style={{fontSize:"0.72rem",fontWeight:600}}>Django DB</span>
      </a>
      <button onClick={()=>setOpenProfile(true)}><span>👤</span> Profile</button>
    </nav>
  );

  // Buyer — handled by the buyer-bottom-nav inside BuyerView; this renders nothing
  return null;
}
