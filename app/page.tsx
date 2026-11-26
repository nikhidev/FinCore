"use client";
import {useEffect,useState,type FormEvent,type ReactNode} from "react";
import {QueryClient,QueryClientProvider,useQuery,useQueryClient} from "@tanstack/react-query";
import {Activity,ArrowDownLeft,ArrowUpRight,ArrowLeftRight,BookOpen,CircleHelp,Download,LayoutGrid,LogOut,Menu,Plus,ShieldCheck,Users,WalletCards,X} from "lucide-react";
import {z} from "zod";

type Session={token:string;user:{name:string;role:string}};
type Wallet={id:string;label:string;balance:string};
type Entry={id:string;kind:string;memo:string;cents:string;created_at:string;direction:"in"|"out";counterparty:string};
type Beneficiary={id:string;name:string;wallet_id:string};
type Dispute={id:string;reason:string;status:string;created_at:string};
type Intent={id:string;cents:string;status:string};
type Ops={ledger:{net:string;postings:number};activity:{id:string;cents:string;created_at:string;kind:string}[];events:{id:string;cents:string;outcome:string}[];audit:{id:string;action:string;created_at:string}[]};
type Risk={alerts:{wallet_id:string;score:number;flags:string[]}[]};
type Action="Send money"|"Add funds"|"New wallet"|"Add beneficiary"|"Raise dispute"|"Refund or reverse";
const date=(value:string)=>new Date(value).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
function money(value:string|bigint) {
  const cents=BigInt(value);
  const absolute=cents<0n?-cents:cents;
  return (cents<0n?"-$":"$")+(absolute/100n).toLocaleString("en-US")+"."+String(absolute%100n).padStart(2,"0");
}
const amount=z.string().trim().regex(/^\d{1,7}(\.\d{1,2})?$/).transform(value=>{
  const [whole,fraction=""]=value.split(".");
  return Number(whole)*100+Number(fraction.padEnd(2,"0"));
}).pipe(z.number().min(1).max(100000000));
const nav=[["Overview",LayoutGrid],["Wallets",WalletCards],["Transfers",ArrowLeftRight],["Beneficiaries",Users],["Statements",BookOpen],["Disputes",CircleHelp],["Operations",Activity]] as const;
const descriptions:Record<string,string>={Wallets:"Manage wallets and simulated balances.",Transfers:"Send simulated funds and review your activity.",Beneficiaries:"Manage your saved recipients.",Statements:"Review and export your transaction history.",Disputes:"Follow up on transactions that need review.",Operations:"Monitor ledger integrity, payment events, and risk alerts."};
async function request<T>(path:string,token?:string,method="GET",body?:unknown,key?:string):Promise<T>{
  const response=await fetch("/api/v1"+path,{method,headers:{...(token?{Authorization:"Bearer "+token}:{}),...(body===undefined?{}:{"Content-Type":"application/json"}),...(key?{"Idempotency-Key":key}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  if(response.status===204)return undefined as T;
  const payload=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(payload?.error?.message||"FinCore could not complete the request.");
  return payload.data as T;
}
export default function Home(){
  const [client]=useState(()=>new QueryClient({defaultOptions:{queries:{retry:false}}}));
  return <QueryClientProvider client={client}><Workspace/></QueryClientProvider>;
}
function Workspace(){
  const [session,setSession]=useState<Session|null>(null);
  const [ready,setReady]=useState(false);
  const [page,setPage]=useState("Overview");
  const [mobile,setMobile]=useState(false);
  const [register,setRegister]=useState(false);
  const [action,setAction]=useState<Action|null>(null);
  const [key,setKey]=useState("");
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [busy,setBusy]=useState(false);
  const [offset,setOffset]=useState(0);
  const [kind,setKind]=useState("");
  const client=useQueryClient();
  function signIn(next:Session){
    setSession(next);sessionStorage.setItem("fincore",JSON.stringify(next));
    setPage(next.user.role==="customer"?"Overview":next.user.role==="support"?"Disputes":"Operations");
  }
  useEffect(()=>{
    try{const saved=sessionStorage.getItem("fincore");if(saved)signIn(JSON.parse(saved));}
    catch{sessionStorage.removeItem("fincore");}
    finally{setReady(true);}
  },[]);
  const token=session?.token;
  const role=session?.user.role;
  const customer=role==="customer";
  const finance=role==="finance"||role==="admin";
  const config=<T,>(path:string,enabled:boolean)=>({queryKey:[token,path],queryFn:()=>request<T>(path,token),enabled:Boolean(token)&&enabled});
  const walletQuery=useQuery(config<Wallet[]>("/wallets",customer));
  const beneficiaryQuery=useQuery(config<Beneficiary[]>("/beneficiaries",customer));
  const filters=page==="Statements"&&kind?"&kind="+kind:"";
  const entryQuery=useQuery(config<Entry[]>("/statements?limit=10&offset="+(page==="Statements"?offset:0)+filters,customer));
  const disputeQuery=useQuery(config<Dispute[]>("/disputes",page==="Disputes"));
  const intentQuery=useQuery(config<Intent[]>("/payment-intents",page==="Wallets"));
  const ops=useQuery(config<Ops>("/operations",page==="Operations"));
  const risk=useQuery(config<Risk>("/operations/risk",page==="Operations"));
  const wallets=walletQuery.data||[],beneficiaries=beneficiaryQuery.data||[],entries=entryQuery.data||[];
  const navigate=(next:string)=>{setPage(next);setMobile(false);setError("");setNotice("");};
  const open=(next:Action)=>{setAction(next);setKey(crypto.randomUUID());setNotice("");setError("");};
  const close=()=>{setAction(null);setError("");};
  async function run(task:()=>Promise<void>){
    setBusy(true);setError("");setNotice("");
    try{await task();}catch(failure){setError(failure instanceof Error?failure.message:"Request failed.");}
    finally{setBusy(false);}
  }
  async function login(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const body=Object.fromEntries(new FormData(event.currentTarget));
    await run(async()=>signIn(await request<Session>(register?"/auth/register":"/auth/login",undefined,"POST",body)));
  }
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    const form=new FormData(event.currentTarget);
    const value=(name:string)=>String(form.get(name)||"");
    await run(async()=>{
      const parsed=amount.safeParse(value("amount"));
      if((action==="Send money"||action==="Add funds")&&!parsed.success)throw new Error("Enter an amount between $0.01 and $1,000,000.00.");
      if(action==="Send money"||action==="Refund or reverse")await request("/auth/confirm",token,"POST",{password:value("password"),code:value("code")});
      if(action==="Send money"&&parsed.success)await request("/transfers",token,"POST",{walletId:value("wallet"),beneficiaryId:value("beneficiary"),cents:parsed.data,memo:value("memo")},key);
      if(action==="Add funds"&&parsed.success){
        const intent=await request<Intent>("/payment-intents",token,"POST",{walletId:value("wallet"),cents:parsed.data},key);
        await request("/payment-intents/"+intent.id+"/simulate",token,"POST",{status:value("status")});
      }
      if(action==="New wallet")await request("/wallets",token,"POST",{label:value("label")});
      if(action==="Add beneficiary")await request("/beneficiaries",token,"POST",{name:value("name"),walletId:value("walletId")});
      if(action==="Raise dispute")await request("/disputes",token,"POST",{transactionId:value("transaction"),reason:value("reason")});
      if(action==="Refund or reverse")await request("/transactions/"+value("transaction")+"/"+value("kind"),token,"POST",{},key);
      close();setNotice(action==="Add funds"&&value("status")==="failed"?"Simulated settlement failed. Your balance is unchanged.":"Request completed.");
      await client.invalidateQueries();
    });
  }
  const demo=process.env.NEXT_PUBLIC_DEMO_MODE!=="false";
  if(!ready)return <div className="login"><Brand/></div>;
  if(!session)return <div className="login"><section className="panel login-card"><Brand/><div className="eyebrow">SIMULATED FINANCE</div><h1>{register?"Open your wallet":"Welcome to FinCore"}</h1><p>Manage simulated funds in your digital wallet.</p>
    <form onSubmit={login}>{register&&<label>Full name<input name="name" required maxLength={80}/></label>}<label>Email<input name="email" type="email" required autoComplete="email"/></label><label>Password<input name="password" type="password" minLength={12} required autoComplete={register?"new-password":"current-password"}/></label>
    {error&&<Feedback error>{error}</Feedback>}<button className="primary" disabled={busy}>{register?"Create account":"Sign in"}</button></form>
    <button className="text-button" onClick={()=>{setRegister(!register);setError("");}}>{register?"Back to sign in":"Create an account"}</button>
    {!register&&demo&&<div className="demo-buttons">{[["Customer","ava"],["Operations","ops"],["Finance","finance"]].map(([label,user])=><button className="secondary" key={user} disabled={busy} onClick={()=>run(async()=>signIn(await request<Session>("/auth/login",undefined,"POST",{email:user+"@fincore.test",password:"FinCoreDemo!2026"})))}>{label} demo</button>)}</div>}
  </section></div>;
  const recent=<Table headings={["Transaction","Date","Status","Amount"]} empty={entryQuery.isLoading?"Loading transactions...":"No posted transactions."} rows={entries.map(entry=>[<div className="transaction"><span className={"tx-icon "+entry.direction}>{entry.direction==="in"?<ArrowDownLeft size={17}/>:<ArrowUpRight size={17}/>}</span><span><b>{entry.counterparty}</b><small>{entry.memo||entry.kind}</small></span></div>,date(entry.created_at),<Status value="Posted"/>,<b className={entry.direction==="in"?"positive":""}>{entry.direction==="in"?"+":"−"}{money(entry.cents)}</b>])}/>;
  const primaryAction:Record<string,Action>={Wallets:"New wallet",Transfers:"Send money",Beneficiaries:"Add beneficiary",Disputes:"Raise dispute",Operations:"Refund or reverse"};
  const available=customer?nav.slice(0,6):role==="support"?nav.slice(5,6):[nav[6],nav[5]];
  return <div className="shell">
    <aside className={mobile?"sidebar expanded":"sidebar"}><Brand/><div className="nav-label">WORKSPACE</div><nav aria-label="Workspace">{available.map(([label,Icon])=><button aria-current={page===label?"page":undefined} key={label} onClick={()=>navigate(label)}><Icon size={18}/>{label}</button>)}</nav><div className="sidebar-bottom"><div className="environment"><span/> Simulation environment</div><button className="logout" onClick={()=>run(async()=>{try{await request("/auth/logout",token,"POST");}finally{sessionStorage.removeItem("fincore");client.clear();setSession(null);}})}><LogOut size={17}/> Sign out</button></div></aside>
    <div className="content"><header><button className="secondary menu" aria-label="Toggle navigation" aria-expanded={mobile} onClick={()=>setMobile(!mobile)}><Menu size={19}/></button><b className="header-page">{page}</b><div className="profile"><span className="avatar">{session.user.name.split(" ").slice(0,2).map(part=>part[0]).join("")}</span><span><b>{session.user.name}</b><small>{role}</small></span></div></header>
    <main><div className="page-heading"><div><div className="eyebrow">{customer?"PERSONAL WORKSPACE":"STAFF WORKSPACE"}</div><h1>{page==="Overview"?"Welcome back, "+session.user.name.split(" ")[0]:page}</h1><p>{page==="Overview"?"Here’s what’s happening with your FinCore account.":descriptions[page]}</p></div>
      {primaryAction[page]&&(customer||page==="Operations"&&finance)&&<button className="primary" onClick={()=>open(primaryAction[page])}><Plus size={17}/>{primaryAction[page]}</button>}
      {page==="Statements"&&<button className="secondary" disabled={busy} onClick={()=>run(async()=>{
        const response=await fetch("/api/v1/statements?format=csv&limit=100"+filters,{headers:{Authorization:"Bearer "+token}});
        if(!response.ok)throw new Error("Statement download failed.");
        const link=document.createElement("a");link.href=URL.createObjectURL(await response.blob());link.download="fincore-statement.csv";link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
      })}><Download size={17}/> Export CSV</button>}
    </div>
    {!action&&error&&<Feedback error>{error}</Feedback>}{notice&&<Feedback>{notice}</Feedback>}
    {[walletQuery,beneficiaryQuery,entryQuery,disputeQuery,intentQuery,ops].find(query=>query.isError)?.error&&<Feedback error>{[walletQuery,beneficiaryQuery,entryQuery,disputeQuery,intentQuery,ops].find(query=>query.isError)?.error?.message}</Feedback>}
    {page==="Overview"&&<div className="summary"><section className="balance"><div className="balance-meta"><span><WalletCards size={18}/> Total available balance</span><span className="badge">Simulated USD</span></div><div className="amount">{walletQuery.isLoading?"—":money(wallets.reduce((sum,wallet)=>sum+BigInt(wallet.balance),0n))}</div><small>Across {wallets.length} active {wallets.length===1?"wallet":"wallets"}</small><div className="actions"><button className="on-dark" onClick={()=>open("Send money")}><ArrowUpRight size={17}/> Send money</button><button className="dark-outline" onClick={()=>open("Add funds")}><Plus size={17}/> Add funds</button></div></section>
      <section className="panel quick"><h2>Quick access</h2>{([[WalletCards,"Wallets","View balances and add funds"],[Users,"Beneficiaries","Manage saved recipients"],[BookOpen,"Statements","Download account activity"]] as const).map(([Icon,label,hint])=><button key={label} onClick={()=>navigate(label)}><Icon/><span><b>{label}</b><small>{hint}</small></span></button>)}</section></div>}
    {["Overview","Transfers","Statements"].includes(page)&&<section className="panel"><div className="section-heading"><div><h2>{page==="Overview"?"Recent activity":"Transaction history"}</h2><p>Posted entries in your wallets</p></div>
      {page==="Overview"&&<button className="secondary" onClick={()=>navigate("Statements")}>View all</button>}
      {page==="Statements"&&<label className="filter">Type<select value={kind} onChange={event=>{setKind(event.target.value);setOffset(0);}}><option value="">All types</option>{["transfer","topup","refund","reversal"].map(type=><option key={type}>{type}</option>)}</select></label>}</div>{recent}
      {page==="Statements"&&<div className="pagination"><button className="secondary" disabled={!offset} onClick={()=>setOffset(offset-10)}>Previous</button><span>Page {offset/10+1}</span><button className="secondary" disabled={entries.length<10} onClick={()=>setOffset(offset+10)}>Next</button></div>}</section>}
    {page==="Wallets"&&<><div className="cards">{wallets.map(wallet=><article className="panel wallet-card" key={wallet.id}><WalletCards/><h2>{wallet.label}</h2><strong>{money(wallet.balance)}</strong><small>Simulated USD</small><code>{wallet.id}</code><button className="secondary" onClick={()=>open("Add funds")}>Add funds</button></article>)}</div><Panel title="Payment intents"><Table headings={["Reference","Amount","Status"]} empty="No payment intents." rows={(intentQuery.data||[]).map(intent=>[intent.id,money(intent.cents),<Status value={intent.status}/>])}/></Panel></>}
    {page==="Beneficiaries"&&<Panel title="Saved recipients"><Table headings={["Name","Wallet reference"]} empty="No saved beneficiaries." rows={beneficiaries.map(item=>[item.name,item.wallet_id])}/></Panel>}
    {page==="Disputes"&&<Panel title="Dispute queue"><Table headings={["Reason","Opened","Status",...(!customer?["Action"]:[])]} empty="No disputes." rows={(disputeQuery.data||[]).map(item=>[item.reason,date(item.created_at),<Status value={item.status}/>,...(!customer?[item.status==="resolved"?"—":<button className="secondary" disabled={busy} onClick={()=>run(async()=>{await request("/disputes/"+item.id,token,"PATCH",{status:item.status==="open"?"reviewing":"resolved"});await client.invalidateQueries();})}>{item.status==="open"?"Start review":"Resolve"}</button>]:[])])}/></Panel>}
    {page==="Operations"&&<><div className="cards">{[["Ledger net",ops.data?money(ops.data.ledger.net):"—"],["Posted transactions",ops.data?.ledger.postings??"—"],["Recent provider events",ops.data?.events.length??"—"]].map(([label,value])=><article key={label} className="panel wallet-card"><small>{label}</small><strong>{value}</strong></article>)}</div>
      <Panel title="Risk alerts"><Table headings={["Wallet","Score","Signals"]} empty={risk.error?.message||(risk.isLoading?"Analyzing recent activity...":"No risk alerts.")} rows={(risk.data?.alerts||[]).map(item=>[item.wallet_id,item.score,item.flags.join(", ")])}/></Panel>
      <Panel title="Recent postings"><Table headings={["Reference","Type","Amount","Date"]} empty="No recent postings." rows={(ops.data?.activity||[]).map(item=>[item.id,item.kind,money(item.cents),date(item.created_at)])}/></Panel>
      <Panel title="Provider reconciliation"><Table headings={["Event","Amount","Outcome"]} empty="No provider events." rows={(ops.data?.events||[]).map(item=>[item.id,money(item.cents),item.outcome])}/></Panel>
      <Panel title="Audit history"><Table headings={["Action","Date"]} empty="No audit entries." rows={(ops.data?.audit||[]).map(item=>[item.action,date(item.created_at)])}/></Panel></>}
    </main></div>
    {action&&<dialog aria-labelledby="action-heading" ref={node=>{if(node&&!node.open)node.showModal();}} onCancel={event=>{event.preventDefault();if(!busy)close();}}><div className="section-heading modal-heading"><h2 id="action-heading">{action}</h2><button className="secondary icon-button" aria-label="Close dialog" onClick={close} disabled={busy}><X size={18}/></button></div><form onSubmit={submit}>
      {(action==="Send money"||action==="Add funds")&&<label>Wallet<select name="wallet" required>{wallets.map(item=><option value={item.id} key={item.id}>{item.label} · {money(item.balance)}</option>)}</select></label>}
      {action==="Send money"&&<label>Recipient<select name="beneficiary" required><option value="">Choose a recipient</option>{beneficiaries.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select></label>}
      {(action==="Send money"||action==="Add funds")&&<label>Amount (USD)<input name="amount" required inputMode="decimal" placeholder="0.00"/></label>}
      {action==="Send money"&&<label>Memo<input name="memo" maxLength={140}/></label>}
      {action==="Add funds"&&<label>Provider simulation<select name="status"><option value="settled">Successful settlement</option><option value="failed">Failed settlement</option></select></label>}
      {action==="New wallet"&&<label>Wallet name<input name="label" required maxLength={60}/></label>}
      {action==="Add beneficiary"&&<><label>Name<input name="name" required maxLength={80}/></label><label>Wallet reference<input name="walletId" required/></label></>}
      {action==="Raise dispute"&&<><label>Transaction<select name="transaction" required><option value="">Choose a transaction</option>{entries.map(item=><option value={item.id} key={item.id}>{item.counterparty} · {money(item.cents)} · {date(item.created_at)}</option>)}</select></label><label>Reason<textarea name="reason" required maxLength={500}/></label></>}
      {action==="Refund or reverse"&&<><label>Transaction reference<input name="transaction" required/></label><label>Action<select name="kind"><option value="reversals">Reverse transfer</option><option value="refunds">Refund top-up</option></select></label></>}
      {(action==="Send money"||action==="Refund or reverse")&&<><label>Confirm password<input name="password" type="password" required autoComplete="current-password"/></label><label>Simulation code<input name="code" inputMode="numeric" pattern="[0-9]{6}" required maxLength={6}/></label>{demo&&<small>Demo password FinCoreDemo!2026 · Code 246810</small>}</>}
      {error&&<Feedback error>{error}</Feedback>}<button className="primary" disabled={busy}>{busy?"Working...":action}</button>
    </form></dialog>}
  </div>;
}
function Brand(){return <div className="wordmark"><span><ShieldCheck size={22}/></span>FinCore</div>;}
function Feedback({children,error=false}:{children:ReactNode;error?:boolean}){return <div className={error?"feedback failure":"feedback"} role={error?"alert":"status"}>{children}</div>;}
function Status({value}:{value:string}){return <span className="status">{value}</span>;}
function Panel({title,children}:{title:string;children:ReactNode}){return <section className="panel"><div className="section-heading"><h2>{title}</h2></div>{children}</section>;}
function Table({headings,rows,empty}:{headings:string[];rows:ReactNode[][];empty:string}){
  return rows.length?<div className="table-wrap"><table><thead><tr>{headings.map(title=><th key={title} scope="col">{title}</th>)}</tr></thead><tbody>{rows.map((row,index)=><tr key={index}>{row.map((cell,i)=><td key={i}>{cell}</td>)}</tr>)}</tbody></table></div>:<div className="empty">{empty}</div>;
}
