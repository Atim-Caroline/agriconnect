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
    accepted:{status:"picked_up",label:"Cargo Loaded"},
    picked_up:{status:"in_transit",label:"On Highway"},
    in_transit:{status:"delivered",label:"Mark Delivered"}
  };

  return(
    <div>
      {!user?.is_verified&&<div className="warn">Verification pending. You can browse jobs but cannot accept until verified.</div>}
      <div className="chips" style={{marginBottom:14}}>
        <button className={"chip"+(subTab==="active"?" on":"")} onClick={()=>setSubTab("active")}>Active Trips ({activeDeliveries.length})</button>
        <button className={"chip"+(subTab==="jobs"?" on":"")} onClick={()=>setSubTab("jobs")}>Open Jobs ({(jobs||[]).length})</button>
        <button className={"chip"+(subTab==="history"?" on":"")} onClick={()=>setSubTab("history")}>Completed ({completedDeliveries.length})</button>
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
                    <div><h3>{d.item}</h3><div className="mute">Order #{d.order_number} · {num(d.quantity)} {d.unit}</div></div>
                    <span className="pill o">{d.status.replace("_"," ")}</span>
                  </div>
                  <div style={{margin:"10px 0",background:"var(--bg)",borderRadius:12,padding:"10px 12px",border:"1px solid var(--line)"}}>
                    <div style={{display:"flex",justifyContent:"space-between",fontWeight:700,fontSize:"0.85rem",marginBottom:6}}>
                      <span>From: <span style={{color:"var(--pri)"}}>{d.pickup}</span></span>
                      <span>To: <span style={{color:"var(--pri)"}}>{d.dropoff}</span></span>
                    </div>
                    <div className="steps">
                      <i className="on"/>
                      <i className={["picked_up","in_transit","delivered"].includes(d.status)?"on":""}/>
                      <i className={["in_transit","delivered"].includes(d.status)?"on":""}/>
                      <i className={d.status==="delivered"?"on":""}/>
                    </div>
                  </div>
                  <div className="stats-grid">
                    <div className="stat-box"><b>{distKm} km</b><small>Route</small></div>
                    <div className="stat-box"><b>{eta(distKm)}</b><small>Est. Time</small></div>
                    <div className="stat-box"><b>{ugx(d.total_amount)}</b><small>Cargo Value</small></div>
                  </div>
                  <div style={{background:"var(--bg)",borderRadius:12,padding:"8px 12px",margin:"10px 0",border:"1px solid var(--line)",fontSize:"0.82rem"}}>
                    <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
                      <span>Farmer: <b>{d.farmer_name}</b> · <a href={`tel:${d.pickup_phone}`} style={{color:"var(--pri)"}}>{d.pickup_phone}</a></span>
                      <span>Buyer: <b>{d.buyer_name}</b> · <a href={`tel:${d.dropoff_phone}`} style={{color:"var(--pri)"}}>{d.dropoff_phone}</a></span>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:8,marginTop:10,flexWrap:"wrap"}}>
                    {next&&<button className="btn sm" onClick={()=>advance(d.id,next.status)}>{next.label}</button>}
                    <button className="btn sm alt" onClick={()=>setOpenTracking(d.id)}>View Timeline</button>
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
            <div className="card empty"><p>No open jobs right now.</p><small>Jobs appear when buyers purchase produce requiring delivery.</small></div>
          ):(
            jobs.map(j=>{
              const distKm=km(j.pickup,j.dropoff);
              return(
                <div className="card" key={j.id}>
                  <div className="row">
                    <div>
                      <h3>{j.item}</h3>
                      <div className="mute"><b>{j.pickup} to {j.dropoff}</b> · {num(j.quantity)} {j.unit}</div>
                      <div className="mute" style={{marginTop:4}}>~{distKm} km · ~{eta(distKm)}</div>
                      <div className="mute" style={{marginTop:4}}>
                        Farmer: {j.farmer_name} · <a href={`tel:${j.pickup_phone}`} style={{color:"var(--pri)"}}>{j.pickup_phone}</a>
                      </div>
                    </div>
                    <button className="btn sm" onClick={()=>acceptJob(j.id)} disabled={!user?.is_verified}>
                      {user?.is_verified?"Accept":"Awaiting Verification"}
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
                  <div className="mute">{d.pickup} to {d.dropoff} · {num(d.quantity)} {d.unit} · {fmt(d.created_at)}</div>
                </div>
                <span className="pill g">Delivered</span>
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
      {!user?.is_verified&&<div className="warn">Account awaiting admin verification. Listings go live once approved.</div>}
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
                      {!photo&&<span style={{fontSize:"2.2rem"}}>{CROPS[l.crop_name]?.emoji||"?"}</span>}
                      <span className={"pill "+(l.status==="active"?"g":"o")} style={{position:"absolute",top:8,right:8}}>{l.status}</span>
                    </div>
                    <div style={{padding:"10px 12px"}}>
                      <h3 style={{margin:"0 0 4px",fontSize:"0.95rem"}}>{l.title}</h3>
                      <div className="mute" style={{fontSize:"0.78rem"}}>{l.district_name} · Grade {l.quality_grade}</div>
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
                    <div className="mute">Buyer: <b>{r.buyer}</b> · {num(r.quantity)} {r.unit}{r.offered_price&&` · Offer: ${ugx(r.offered_price)}/${r.unit}`}</div>
                    <div className="mute" style={{marginTop:4}}>{r.delivery_needed?`Deliver to ${r.delivery_district||"Buyer's district"}`:"Farm gate collection"}</div>
                    <div style={{marginTop:6,fontSize:"0.82rem"}}>
                      Contact: <a href={`tel:${r.buyer_phone||""}`} style={{color:"var(--pri)",fontWeight:700}}>{r.buyer_phone||"N/A"}</a>
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
                    <div className="mute">#{o.order_number} · {num(o.quantity)} {o.unit} · {ugx(o.total_amount)}</div>
                    <div className="mute" style={{marginTop:4}}>Buyer: {o.other_name} · Escrow: <b>{o.payment_status?.toUpperCase()}</b></div>
                    <div style={{marginTop:6,fontSize:"0.82rem"}}><a href={`tel:${o.buyer_phone}`} style={{color:"var(--pri)",fontWeight:700}}>{o.buyer_phone}</a></div>
                  </div>
                  <span className="pill g">{o.status.replace("_"," ")}</span>
                </div>
                <div style={{display:"flex",gap:8,marginTop:12}}>
                  {o.status==="confirmed"&&<button className="btn sm" onClick={()=>updateOrderStatus(o.id,"ready_for_pickup")}>Ready for Pickup</button>}
                  {o.status==="ready_for_pickup"&&!o.delivery_required&&<button className="btn sm" onClick={()=>updateOrderStatus(o.id,"delivered")}>Handed Over</button>}
                  <span className="mute" style={{alignSelf:"center",fontSize:"0.8rem"}}>{o.delivery_required?"Transporter handover":"Farm gate pickup"}</span>
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
// CART ICON + BUYER BOTTOM NAV ICON
// ==========================================
const CartIcon=({size=22})=>(
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
  </svg>
);
const HomeIconSvg=()=>(
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    <polyline points="9 22 9 12 15 12 15 22"/>
  </svg>
);

// ==========================================
// BUYER VIEW — Vegigo-style marketplace
// ==========================================
function BuyerView({searchQ,filterDistrict,setFilterDistrict,filterCrop,setFilterCrop}){
  const {produceListings,setOpenListing,setOpenPayOrder,setOpenTracking,toast,user,
         cart,addToCart,cartCount,setOpenCart}=useContext(AppContext);
  const [orders,refreshOrders]=useData("/orders/",8000);
  const [requests]=useData("/orders/requests/",8000);
  const [subTab,setSubTab]=useState("shop");

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
          {/* Promo banner */}
          <div className="promo-banner">
            <div>
              <div className="promo-title">Fresh &amp; Direct</div>
              <div className="promo-sub">Straight from Uganda's farms to your door</div>
            </div>
            <img src={getCropImg("Tomatoes")||""} alt="" className="promo-img" onError={e=>e.target.style.display="none"}/>
          </div>

          {/* Category chips */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",margin:"16px 0 8px"}}>
            <h3 style={{margin:0,color:"var(--ink)"}}>Categories</h3>
          </div>
          <div className="cat-row">
            <button className={"cat-chip"+(!filterCrop?" active":"")} onClick={()=>setFilterCrop("")}>
              <span>All</span>
            </button>
            {Object.entries(CROPS).map(([name,c])=>(
              <button key={name} className={"cat-chip"+(filterCrop===name?" active":"")}
                onClick={()=>setFilterCrop(filterCrop===name?"":name)}>
                <span>{c.emoji}</span>
                <span>{name.split(" ")[0]}</span>
              </button>
            ))}
          </div>

          <div style={{margin:"10px 0 14px"}}>
            <select value={filterDistrict} onChange={e=>setFilterDistrict(e.target.value)}
              style={{width:"100%",padding:"10px 14px",borderRadius:12,border:"1.5px solid var(--line)",
                background:"var(--surf)",color:"var(--ink)",font:"inherit",outline:0}}>
              <option value="">All Districts</option>
              {DN.map(d=><option key={d} value={d}>{d}</option>)}
            </select>
          </div>

          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <h3 style={{margin:0,color:"var(--ink)"}}>{filterCrop||"All Produce"}{filterDistrict&&` · ${filterDistrict}`}</h3>
            <span style={{fontSize:"0.78rem",color:"var(--mute)"}}>{filtered.length} items</span>
          </div>

          {filtered.length===0?(
            <div className="card empty">No produce matches your filters right now.</div>
          ):(
            <div className="shop-grid">
              {filtered.map(l=>{
                const meta=CROPS[l.crop_name]||{emoji:"?",grad:"135deg,#79a73a,#5f8f3a"};
                const photo=l.image||l.image_url||getCropImg(l.crop_name);
                const inCart=cart.has(l.id);
                const cartQty=cart.get(l.id)?.qty||0;
                return(
                  <div className="shop-card" key={l.id} onClick={()=>setOpenListing(l)}>
                    <div className="shop-card-img">
                      {photo
                        ?<img src={photo} alt={l.title}/>
                        :<div className="shop-card-emoji" style={{background:`linear-gradient(${meta.grad})`}}>{meta.emoji}</div>}
                      {l.farmer_verified&&<span className="shop-verified"><BlueTick/></span>}
                    </div>
                    <div className="shop-card-body">
                      <div className="shop-card-name">{l.crop_name}</div>
                      <div className="shop-card-sub">{l.district_name}</div>
                      <div className="shop-card-price">
                        UGX {Number(l.price_per_unit).toLocaleString()}
                        <span className="shop-card-unit">/{l.unit}</span>
                      </div>
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
            <div className="card empty"><p>No orders yet.</p>
              <button className="btn sm" onClick={()=>setSubTab("shop")}>Browse Market</button>
            </div>
          ):(
            orders.map(o=>(
              <div className="order-card" key={o.id}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:700,fontSize:"1rem"}}>{o.item_title}</div>
                    <div className="mute" style={{marginTop:2}}>#{o.order_number} · {num(o.quantity)} {o.unit}</div>
                    <div style={{fontWeight:800,color:"var(--pri)",marginTop:4,fontSize:"1rem"}}>{ugx(o.total_amount)}</div>
                    <div className="mute" style={{marginTop:4,fontSize:"0.8rem"}}>
                      Farmer: {o.other_name} · <a href={`tel:${o.seller_phone}`} style={{color:"var(--pri)",fontWeight:700}}>{o.seller_phone}</a>
                    </div>
                    {o.transporter_name&&(
                      <div className="mute" style={{fontSize:"0.8rem"}}>
                        Transporter: {o.transporter_name} {o.transporter_phone&&<a href={`tel:${o.transporter_phone}`} style={{color:"var(--pri)",fontWeight:700}}>· {o.transporter_phone}</a>}
                      </div>
                    )}
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
            ))
          )}
        </div>
      )}

      {subTab==="requests"&&(
        <div>
          <h2>Sent Requests</h2>
          {(!requests||requests.length===0)?<div className="card empty">No sent requests yet.</div>:(
            requests.map(r=>(
              <div className="order-card" key={r.id}>
                <div style={{fontWeight:700}}>{r.title}</div>
                <div className="mute">Farmer: {r.farmer} · {num(r.quantity)} {r.unit}{r.offered_price&&` · Offer: ${ugx(r.offered_price)}`}</div>
                <div className="mute">{r.delivery_needed?`Deliver to ${r.delivery_district}`:"Self pickup"}</div>
                <span className={"status-pill "+(r.status==="accepted"?"done":r.status==="rejected"?"bad":"active")} style={{marginTop:8,display:"inline-block"}}>{r.status}</span>
              </div>
            ))
          )}
        </div>
      )}

      {/* Buyer bottom nav */}
      <nav className="buyer-bottom-nav">
        <button className={subTab==="shop"?"active":""} onClick={()=>setSubTab("shop")}>
          <HomeIconSvg/><span>Home</span>
        </button>
        <button className={subTab==="orders"?"active":""} onClick={()=>setSubTab("orders")}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/></svg>
          <span>Orders</span>
        </button>
        <button className={subTab==="requests"?"active":""} onClick={()=>setSubTab("requests")}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <span>Requests</span>
        </button>
        <button className={cartCount>0?"active":""} onClick={()=>setOpenCart(true)} style={{position:"relative"}}>
          <CartIcon size={22}/>
          {cartCount>0&&<em>{cartCount}</em>}
          <span>Cart</span>
        </button>
      </nav>
    </div>
  );
}

// ==========================================
// PRODUCT DETAIL SHEET
// ==========================================
function ProductDetailSheet({listing,onClose}){
  const {user,toast,cart,addToCart,setOpenCart,produceListings,setOpenListing}=useContext(AppContext);
  const maxQty=Number(listing.quantity_available);
  const inCartItem=cart.get(listing.id);
  const [qty,setQty]=useState(inCartItem?.qty||1);
  const [transporters]=useData("/transport/transporters/");
  const [backendDistricts]=useData("/locations/districts/");
  const [deliveryNeeded,setDeliveryNeeded]=useState(true);
  const [destDistrict,setDestDistrict]=useState(user?.district_name||"Kampala");
  const [chosenTransporter,setChosenTransporter]=useState("");
  const [message,setMessage]=useState("");
  const [submitting,setSubmitting]=useState(false);

  const meta=CROPS[listing.crop_name]||{emoji:"?",grad:"135deg,#79a73a,#5f8f3a"};
  const photo=listing.image||listing.image_url||getCropImg(listing.crop_name);
  const pricePerUnit=Number(listing.price_per_unit);
  const lineTotal=qty*pricePerUnit;
  const distKm=deliveryNeeded?km(listing.district_name,destDistrict):0;
  const similar=(produceListings||[]).filter(l=>l.id!==listing.id&&l.crop_name===listing.crop_name&&l.status==="active").slice(0,4);

  const handleAddToCart=()=>{
    addToCart(listing,qty);
    toast(`${listing.crop_name} (${qty} ${listing.unit}) added to cart!`);
    onClose();
  };

  const handleSendRequest=async()=>{
    if(!user){ toast("Please log in to purchase."); onClose(); return; }
    if(user.role!=="buyer") return toast("Only buyers can purchase produce.");
    if(qty<=0||qty>maxQty) return toast(`Quantity must be 1 to ${maxQty} ${listing.unit}`);
    const districtId=(backendDistricts||[]).find(d=>d.name.toLowerCase()===destDistrict.toLowerCase())?.id;
    setSubmitting(true);
    try{
      await api("/orders/requests/",{method:"POST",body:{
        listing:listing.id,quantity:qty,offered_price:null,delivery_needed:deliveryNeeded,
        delivery_district:deliveryNeeded?(districtId||null):null,
        preferred_transporter:deliveryNeeded&&chosenTransporter?chosenTransporter:null,
        message
      }});
      toast(`Request sent to ${listing.farmer_name}!`); onClose();
    }catch(e){ toast(e.message); }
    finally{ setSubmitting(false); }
  };

  return(
    <div className="sheet pds-sheet" onClick={onClose}>
      <div onClick={e=>e.stopPropagation()}>
        <div className="pds-hero">
          {photo
            ?<img src={photo} alt={listing.title} className="pds-img"/>
            :<div className="pds-emoji-bg" style={{background:`linear-gradient(${meta.grad})`}}><span>{meta.emoji}</span></div>}
        </div>
        <div className="pds-body">
          <h2 className="pds-title">{listing.title}</h2>
          <div className="pds-farmer">
            {listing.crop_name} · {listing.district_name} · Grade {listing.quality_grade}
            {listing.farmer_verified&&<span style={{marginLeft:4,display:"inline-flex",verticalAlign:"middle"}}><BlueTick/></span>}
          </div>
          <div className="pds-farmer">
            Farmer: {listing.farmer_name} · <a href={`tel:${listing.farmer_phone}`} style={{color:"var(--pri)",fontWeight:700}}>{listing.farmer_phone}</a>
          </div>
          <div className="pds-price-row">
            <span className="pds-price">UGX {Number(listing.price_per_unit).toLocaleString()}</span>
            <span className="pds-unit"> / {listing.unit}</span>
          </div>
          <div className="mute" style={{fontSize:"0.82rem",marginBottom:16}}>{num(listing.quantity_available)} {listing.unit} available</div>

          {user?.role==="transporter"?(
            <div className="warn">Transporters cannot place orders.</div>
          ):user?.role==="farmer"&&user?.id===listing.farmer?(
            <div className="warn">This is your own listing.</div>
          ):(
            <>
              <div className="pds-stepper-row">
                <div className="pds-stepper">
                  <button className="pds-step-btn" onClick={()=>setQty(q=>Math.max(1,q-1))}>-</button>
                  <input type="number" className="pds-step-input" value={qty} min={1} max={maxQty}
                    onChange={e=>{
                      const v=parseInt(e.target.value.replace(/[^0-9]/g,""))||1;
                      setQty(Math.min(maxQty,Math.max(1,v)));
                    }}/>
                  <span className="pds-unit-lbl">{listing.unit}</span>
                  <button className="pds-step-btn" onClick={()=>setQty(q=>Math.min(maxQty,q+1))}>+</button>
                </div>
                <div className="pds-line-total">UGX {lineTotal.toLocaleString()}</div>
              </div>

              <button className="pds-cart-btn" onClick={handleAddToCart}>
                Add to Cart
              </button>

              <details className="pds-delivery">
                <summary>Delivery options</summary>
                <div style={{padding:"10px 0 4px"}}>
                  <div style={{display:"grid",gap:6,margin:"6px 0"}}>
                    <label style={{display:"flex",alignItems:"center",gap:8,fontWeight:500,margin:0}}>
                      <input type="radio" name="deliv" checked={!deliveryNeeded} onChange={()=>setDeliveryNeeded(false)}/>
                      Collect from farm gate ({listing.district_name})
                    </label>
                    <label style={{display:"flex",alignItems:"center",gap:8,fontWeight:500,margin:0}}>
                      <input type="radio" name="deliv" checked={deliveryNeeded} onChange={()=>setDeliveryNeeded(true)}/>
                      Deliver to my district
                    </label>
                  </div>
                  {deliveryNeeded&&(
                    <div>
                      <select value={destDistrict} onChange={e=>setDestDistrict(e.target.value)}
                        style={{width:"100%",marginTop:6,padding:"9px 12px",borderRadius:10,border:"1.5px solid var(--line)",background:"var(--surf)",color:"var(--ink)",font:"inherit",outline:0}}>
                        {DN.map(d=><option key={d} value={d}>{d}</option>)}
                      </select>
                      <select value={chosenTransporter} onChange={e=>setChosenTransporter(e.target.value)}
                        style={{width:"100%",marginTop:8,padding:"9px 12px",borderRadius:10,border:"1.5px solid var(--line)",background:"var(--surf)",color:"var(--ink)",font:"inherit",outline:0}}>
                        <option value="">Any Verified Transporter</option>
                        {(transporters||[]).map(t=><option key={t.id} value={t.id}>{t.name} · {t.phone}</option>)}
                      </select>
                      <div className="mute" style={{fontSize:"0.78rem",marginTop:6}}>{listing.district_name} to {destDistrict} · {distKm} km · ~{eta(distKm)}</div>
                    </div>
                  )}
                  <textarea style={{width:"100%",marginTop:8,padding:"9px 12px",borderRadius:10,border:"1.5px solid var(--line)",background:"var(--surf)",color:"var(--ink)",font:"inherit",outline:0,resize:"vertical"}}
                    rows={2} placeholder="Note to farmer (optional)..." value={message} onChange={e=>setMessage(e.target.value)}/>
                  <button className="btn w" style={{marginTop:8}} onClick={handleSendRequest} disabled={submitting}>
                    {submitting?"Sending...":"Send Purchase Request Directly"}
                  </button>
                </div>
              </details>

              {similar.length>0&&(
                <div style={{marginTop:20}}>
                  <h3 style={{margin:"0 0 10px"}}>Similar Products</h3>
                  <div className="similar-row">
                    {similar.map(s=>{
                      const sPhoto=s.image||s.image_url||getCropImg(s.crop_name);
                      const sMeta=CROPS[s.crop_name]||{emoji:"?",grad:"135deg,#79a73a,#5f8f3a"};
                      return(
                        <div key={s.id} className="similar-card"
                          onClick={e=>{e.stopPropagation();onClose();setTimeout(()=>setOpenListing(s),100);}}>
                          <div className="similar-img">
                            {sPhoto?<img src={sPhoto} alt={s.title}/>
                              :<div style={{height:"100%",background:`linear-gradient(${sMeta.grad})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1.6rem"}}>{sMeta.emoji}</div>}
                          </div>
                          <div style={{fontSize:"0.76rem",fontWeight:700,marginTop:6}}>{s.crop_name}</div>
                          <div style={{fontSize:"0.76rem",color:"var(--mute)"}}>{s.district_name}</div>
                          <div style={{fontSize:"0.78rem",fontWeight:800,color:"var(--pri)",marginTop:2}}>UGX {Number(s.price_per_unit).toLocaleString()}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
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

  const placeAllOrders=async()=>{
    if(items.length===0) return toast("Your cart is empty.");
    if(user?.role!=="buyer") return toast("Only buyers can place orders.");
    const districtId=(backendDistricts||[]).find(d=>d.name.toLowerCase()===destDistrict.toLowerCase())?.id;
    setSubmitting(true);
    let successCount=0;
    for(const {listing,qty} of items){
      try{
        await api("/orders/requests/",{method:"POST",body:{
          listing:listing.id,quantity:qty,offered_price:null,
          delivery_needed:deliveryNeeded,
          delivery_district:deliveryNeeded?(districtId||null):null,
          preferred_transporter:deliveryNeeded&&chosenTransporter?chosenTransporter:null,
          message:""
        }});
        successCount++;
      }catch(e){ toast(`${listing.crop_name}: ${e.message}`); }
    }
    setSubmitting(false);
    if(successCount>0){
      toast(`${successCount} purchase request${successCount>1?"s":""} sent to farmers!`);
      clearCart(); onClose();
    }
  };

  return(
    <div className="sheet" onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <h2 style={{margin:0}}>My Cart ({items.length})</h2>
          {items.length>0&&<button className="btn sm bad" onClick={clearCart}>Clear</button>}
        </div>

        {items.length===0?(
          <div className="card empty">
            <p>Your cart is empty.</p>
            <p className="mute">Go to the marketplace and tap "+ Add" on any produce.</p>
          </div>
        ):(
          <>
            {items.map(({listing,qty})=>{
              const photo=listing.image||listing.image_url||getCropImg(listing.crop_name);
              const meta=CROPS[listing.crop_name]||{emoji:"?",grad:"135deg,#79a73a,#5f8f3a"};
              const pricePerUnit=Number(listing.price_per_unit);
              const maxQty=Number(listing.quantity_available);
              const lineTotal=qty*pricePerUnit;
              return(
                <div className="cart-item" key={listing.id}>
                  <div className="cart-item-img">
                    {photo?<img src={photo} alt={listing.crop_name}/>
                      :<div style={{width:"100%",height:"100%",background:`linear-gradient(${meta.grad})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1.5rem"}}>{meta.emoji}</div>}
                  </div>
                  <div className="cart-item-info">
                    <div className="cart-item-name">{listing.crop_name}</div>
                    <div className="cart-item-sub">{listing.district_name} · {listing.farmer_name}</div>
                    <div className="cart-item-price">UGX {pricePerUnit.toLocaleString()}/{listing.unit}</div>
                  </div>
                  <div className="cart-item-controls">
                    <div className="cart-stepper">
                      <button onClick={()=>updateCartQty(listing.id,qty-1)}>-</button>
                      <input type="number" value={qty} min={1} max={maxQty}
                        onChange={e=>{
                          const v=parseInt(e.target.value.replace(/[^0-9]/g,""))||1;
                          updateCartQty(listing.id,Math.min(maxQty,Math.max(1,v)));
                        }}/>
                      <button onClick={()=>updateCartQty(listing.id,Math.min(maxQty,qty+1))}>+</button>
                    </div>
                    <div className="cart-line-total">UGX {lineTotal.toLocaleString()}</div>
                    <button className="cart-remove" onClick={()=>removeFromCart(listing.id)}>x</button>
                  </div>
                </div>
              );
            })}

            <div className="cart-total-row">
              <span>Total</span>
              <span className="cart-total-amount">UGX {cartTotal.toLocaleString()}</span>
            </div>

            <div className="cart-delivery">
              <h3 style={{margin:"0 0 10px"}}>Delivery</h3>
              <div style={{display:"grid",gap:6,marginBottom:10}}>
                <label style={{display:"flex",alignItems:"center",gap:8,fontWeight:500,cursor:"pointer"}}>
                  <input type="radio" name="cartdeliv" checked={!deliveryNeeded} onChange={()=>setDeliveryNeeded(false)}/>
                  Collect from each farm gate
                </label>
                <label style={{display:"flex",alignItems:"center",gap:8,fontWeight:500,cursor:"pointer"}}>
                  <input type="radio" name="cartdeliv" checked={deliveryNeeded} onChange={()=>setDeliveryNeeded(true)}/>
                  Deliver to my district
                </label>
              </div>
              {deliveryNeeded&&(
                <div style={{display:"grid",gap:8}}>
                  <select value={destDistrict} onChange={e=>setDestDistrict(e.target.value)}
                    style={{width:"100%",padding:"10px 12px",borderRadius:10,border:"1.5px solid var(--line)",background:"var(--surf)",color:"var(--ink)",font:"inherit",outline:0}}>
                    {DN.map(d=><option key={d} value={d}>{d}</option>)}
                  </select>
                  <select value={chosenTransporter} onChange={e=>setChosenTransporter(e.target.value)}
                    style={{width:"100%",padding:"10px 12px",borderRadius:10,border:"1.5px solid var(--line)",background:"var(--surf)",color:"var(--ink)",font:"inherit",outline:0}}>
                    <option value="">Any Verified Transporter</option>
                    {(transporters||[]).map(t=><option key={t.id} value={t.id}>{t.name} · {t.phone}</option>)}
                  </select>
                </div>
              )}
            </div>

            <button className="glass-btn" style={{marginTop:16,background:"linear-gradient(135deg,#2d7a54,#1f5a3d)"}}
              onClick={placeAllOrders} disabled={submitting}>
              {submitting?"Sending requests...":`Place Order · UGX ${cartTotal.toLocaleString()}`}
            </button>
          </>
        )}

        <button className="btn alt w" style={{marginTop:10}} onClick={onClose}>Close</button>
      </div>
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
        <button className={"chip"+(subTab==="approvals"?" on":"")} onClick={()=>setSubTab("approvals")}>Verification Queue ({pendingUsers.length})</button>
        <button className={"chip"+(subTab==="orders"?" on":"")} onClick={()=>setSubTab("orders")}>All Orders ({(allOrders||[]).length})</button>
        <button className={"chip"+(subTab==="deliveries"?" on":"")} onClick={()=>setSubTab("deliveries")}>Deliveries ({(allDeliveries||[]).length})</button>
      </div>
      {subTab==="approvals"&&(
        <div>
          <h2>Verification Requests</h2>
          {pendingUsers.length===0?<div className="card empty">No pending requests.</div>:(
            pendingUsers.map(u=>(
              <div className="card row" key={u.id}>
                <div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}><h3>{u.full_name}</h3><span className="pill o">{u.role}</span></div>
                  <div className="mute">{u.phone} · {u.district_name||"Uganda"}</div>
                  <div className="mute">Doc: <b>{u.verification_doc||"None"}</b></div>
                </div>
                <div style={{display:"flex",gap:6}}>
                  <button className="btn sm" onClick={()=>verifyUser(u.id,true)}>Approve</button>
                  <button className="btn sm bad" onClick={()=>verifyUser(u.id,false)}>Reject</button>
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
                    <div className="mute">#{o.order_number} · {num(o.quantity)} {o.unit} · <b>{ugx(o.total_amount)}</b></div>
                    <div className="mute">{o.seller_name} ({o.seller_phone}) to {o.buyer_name} ({o.buyer_phone})</div>
                    <div className="mute">{o.pickup_district} to {o.dropoff_district||"Farm gate"}</div>
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
                    <div className="mute">{d.pickup} to {d.dropoff} · {d.transporter_name||"Unassigned"}</div>
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
// PAYMENT MODAL
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
          <small className="mute">#{order.order_number} · {order.item_title}</small>
        </div>
        <p style={{fontWeight:700,marginBottom:12}}>Choose your network:</p>
        <button className="pay-network-btn mtn" onClick={()=>{window.open("tel:*165*3*1#","_self");handlePay("MTN MoMo");}} disabled={processing}>
          <MtnLogo/>
          <div><div style={{fontWeight:800}}>MTN Mobile Money</div><div style={{fontSize:"0.76rem",opacity:0.8}}>Dial *165# · Pay {ugx(order.total_amount)}</div></div>
        </button>
        <button className="pay-network-btn airtel" onClick={()=>{window.open("tel:*185*1*1#","_self");handlePay("Airtel Money");}} disabled={processing} style={{marginTop:10}}>
          <AirtelLogo/>
          <div><div style={{fontWeight:800}}>Airtel Money</div><div style={{fontSize:"0.76rem",opacity:0.8}}>Dial *185# · Pay {ugx(order.total_amount)}</div></div>
        </button>
        <button className="btn alt w" style={{marginTop:14}} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
function MtnLogo(){return(<svg width="44" height="44" viewBox="0 0 44 44"><circle cx="22" cy="22" r="22" fill="#FFCC00"/><text x="22" y="28" textAnchor="middle" fontWeight="900" fontSize="13" fill="#000">MTN</text></svg>);}
function AirtelLogo(){return(<svg width="44" height="44" viewBox="0 0 44 44"><circle cx="22" cy="22" r="22" fill="#E40612"/><text x="22" y="29" textAnchor="middle" fontWeight="900" fontSize="11" fill="#fff">airtel</text></svg>);}

// ==========================================
// NEW LISTING MODAL
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
    if(file){setPhotoFile(file);const r=new FileReader();r.onload=ev=>setPhotoPreview(ev.target.result);r.readAsDataURL(file);}
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
      onSaved&&onSaved();onClose();
    }catch(e){toast(e.message);}
    finally{setSubmitting(false);}
  };

  return(
    <div className="sheet" onClick={onClose}>
      <div onClick={e=>e.stopPropagation()}>
        <h2>Add Farm Produce</h2>
        <label>Crop</label>
        <select value={crop} onChange={e=>{const c=e.target.value;setCrop(c);setTitle(`Fresh ${c}`);if(!photoFile)setPhotoPreview(getCropImg(c)||"");}}>
          {Object.keys(CROPS).map(c=><option key={c} value={c}>{CROPS[c].emoji} {c}</option>)}
        </select>
        <label>Title</label>
        <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. Dry Maize, 2 Tonnes"/>
        <label>Picture</label>
        <div className="img-upload-box" onClick={()=>document.getElementById("produce-img").click()}>
          <input id="produce-img" type="file" accept="image/*" style={{display:"none"}} onChange={handleFileChange}/>
          <div style={{fontSize:"1.8rem"}}>📷</div>
          <b>Tap to upload photo</b>
          <div className="mute" style={{fontSize:"0.76rem"}}>Default crop image used if none selected</div>
        </div>
        {photoPreview&&<img src={photoPreview} alt="Preview" className="img-preview"/>}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div>
            <label>Quantity ({CROPS[crop]?.unit||"kg"})</label>
            <div className="qty-stepper">
              <button type="button" className="qty-btn" onClick={()=>setQty(q=>Math.max(1,q-1))}>-</button>
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
          {submitting?"Publishing...":"Publish Listing"}
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
        <h2>Delivery Tracking</h2>
        {delivery&&<div className="mute">#{delivery.order_number} · {delivery.item}</div>}
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
              Transporter: <b>{delivery.transporter_name}</b>
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
        <span style={{fontSize:"1.3rem"}}>⚙</span>
        <span style={{fontSize:"0.72rem",fontWeight:600}}>Django DB</span>
      </a>
      <button onClick={()=>setOpenProfile(true)}><span>👤</span> Profile</button>
    </nav>
  );
  return null;
}
