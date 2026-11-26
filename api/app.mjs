import express from 'express';
import {createHash,createHmac,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {Fault,one,passwordHash,pool,post,transaction,treasury,verifies} from './db.mjs';

export const app = express();
app.disable('x-powered-by');
const sha = value => createHash('sha256').update(value).digest('hex');
const secret = () => process.env.WEBHOOK_SECRET || (process.env.NODE_ENV !== 'production' ? 'fincore-local-simulator' : '');
const fail = (status, code, message) => { throw new Fault(status,code,message); };
const uuid = z.string().uuid();
const amount = z.number().int().min(1).max(100000000);
const note = max => z.string().trim().min(1).max(max);
const credentials = z.object({email:z.string().email().max(254).transform(value => value.toLowerCase()),password:z.string().min(12).max(128)});
const staff = ['support','operations','finance','admin'];
const finance = ['finance','admin'];
const ops = ['operations','finance','admin'];
const send = (res, data, status = 200) => res.status(status).json({data});
const audit = (db, user, action, id) => db.query('INSERT INTO audit(actor_id,action,entity_id) VALUES($1,$2,$3)',[user,action,id]);
app.use((req,res,next) => {
  req.requestId = randomUUID();
  res.set({'X-Request-ID':req.requestId,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  const started = Date.now();
  res.on('finish', () => {
    if (process.env.NODE_ENV !== 'test') console.log(JSON.stringify({requestId:req.requestId,method:req.method,route:req.route?.path,status:res.statusCode,ms:Date.now()-started}));
  });
  next();
});
app.use(express.json({limit:'32kb',verify:(req,_res,buffer) => { req.rawBody = buffer; }}));
app.get('/health',(_req,res) => send(res,{status:'ok'}));
app.get('/ready',async (_req,res) => {
  await pool.query('SELECT 1');
  send(res,{status:'ready'});
});
const api = express.Router();
app.use('/api/v1',api);
async function issue(db,user) {
  const token = randomBytes(32).toString('hex');
  await db.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '8 hours')",[sha(token),user.id]);
  return {token,user:{id:user.id,name:user.name,email:user.email,role:user.role}};
}
api.post('/auth/register',async (req,res) => {
  const body = credentials.extend({name:note(80)}).parse(req.body);
  const data = await transaction(async db => {
    const user = await one(db,'INSERT INTO users(email,name,password_hash) VALUES($1,$2,$3) RETURNING *',[body.email,body.name,passwordHash(body.password)]);
    const wallet = await one(db,"INSERT INTO wallets(owner_id,label) VALUES($1,'Primary wallet') RETURNING id",[user.id]);
    await audit(db,user.id,'account.created',wallet.id);
    return issue(db,user);
  });
  send(res,data,201);
});
const dummyHash = passwordHash(randomBytes(32).toString('hex'));
api.post('/auth/login',async (req,res) => {
  const body = credentials.parse(req.body);
  const user = await one(pool,'SELECT * FROM users WHERE email=$1',[body.email]);
  if (!verifies(body.password,user?.password_hash || dummyHash) || !user) fail(401,'LOGIN','Email or password is incorrect.');
  send(res,await issue(pool,user));
});
async function settle(db, event) {
  const intent = await one(db,'SELECT * FROM payment_intents WHERE id=$1 FOR UPDATE',[event.intentId]);
  if (!intent) fail(404,'INTENT','Payment intent unavailable.');
  const outcome = Number(intent.cents) !== event.cents ? 'mismatch' : intent.status !== 'pending' ? 'ignored' : event.status;
  const inserted = await one(db,'INSERT INTO provider_events(id,intent_id,status,cents,outcome) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING *',[event.id,intent.id,event.status,event.cents,outcome]);
  if (!inserted) {
    const prior = await one(db,'SELECT * FROM provider_events WHERE id=$1',[event.id]);
    if (prior.intent_id !== event.intentId || prior.status !== event.status || Number(prior.cents) !== event.cents) fail(409,'EVENT_CONFLICT','Event ID is already in use.');
    return {outcome:prior.outcome,duplicate:true};
  }
  if (outcome === 'settled' || outcome === 'failed') {
    const posting = outcome === 'settled' ? await post(db,treasury,intent.wallet_id,intent.cents,'topup','Sandbox payment') : null;
    await db.query('UPDATE payment_intents SET status=$2,transaction_id=$3 WHERE id=$1',[intent.id,outcome,posting?.id || null]);
  }
  await audit(db,null,'payment.'+outcome,intent.id);
  return {outcome,duplicate:false};
}
api.post('/webhooks/sandbox',async (req,res) => {
  const timestamp = req.get('x-event-timestamp') || '';
  const signature = req.get('x-event-signature') || '';
  if (!secret() || !req.rawBody || !/^\d{10}$/.test(timestamp) || Math.abs(Date.now()/1000-Number(timestamp)) > 300 || !/^[a-f0-9]{64}$/.test(signature)) fail(401,'SIGNATURE','Invalid webhook signature.');
  const expected = createHmac('sha256',secret()).update(timestamp+'.').update(req.rawBody).digest();
  if (!timingSafeEqual(expected,Buffer.from(signature,'hex'))) fail(401,'SIGNATURE','Invalid webhook signature.');
  const event = z.object({id:note(128),intentId:uuid,cents:amount,status:z.enum(['settled','failed'])}).parse(req.body);
  send(res,await transaction(db => settle(db,event)));
});
api.use(async (req,_res,next) => {
  const token = req.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token) fail(401,'SESSION','Sign in to continue.');
  req.sessionKey = sha(token);
  req.user = await one(pool,'SELECT u.*,s.confirmed_until FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now()',[req.sessionKey]);
  if (!req.user) fail(401,'SESSION','Your session expired. Sign in again.');
  next();
});
function requireRole(req, roles) {
  if (!roles.includes(req.user.role)) fail(403,'ROLE','You do not have access to this action.');
}
function confirmed(req) {
  if (new Date(req.user.confirmed_until).getTime() <= Date.now()) fail(403,'CONFIRMATION','Confirm this action with your password and simulation code.');
}
api.post('/auth/confirm',async (req,res) => {
  const {password,code} = z.object({password:credentials.shape.password,code:z.string().regex(/^\d{6}$/)}).parse(req.body);
  if (!verifies(password,req.user.password_hash) || code !== (process.env.SIMULATION_MFA_CODE || '246810')) fail(403,'CONFIRMATION','Password or simulation code is incorrect.');
  await transaction(async db => {
    await db.query("UPDATE sessions SET confirmed_until=now()+interval '5 minutes' WHERE token_hash=$1",[req.sessionKey]);
    await audit(db,req.user.id,'session.confirmed',req.user.id);
  });
  send(res,{confirmed:true});
});
api.post('/auth/refresh',async (req,res) => {
  send(res,await transaction(async db => {
    const old = await one(db,'DELETE FROM sessions WHERE token_hash=$1 AND expires_at>now() RETURNING token_hash',[req.sessionKey]);
    if (!old) fail(401,'SESSION','Sign in again.');
    return issue(db,req.user);
  }));
});
api.post('/auth/logout',async (req,res) => {
  await pool.query('DELETE FROM sessions WHERE token_hash=$1',[req.sessionKey]);
  res.sendStatus(204);
});
api.get('/profile',(req,res) => {
  const {id,name,email,role} = req.user;
  send(res,{id,name,email,role});
});
async function owned(db,id,owner) {
  const wallet = await one(db,'SELECT * FROM wallets WHERE id=$1 AND owner_id=$2',[uuid.parse(id),owner]);
  if (!wallet) fail(404,'WALLET','Wallet unavailable.');
  return wallet;
}
api.get('/wallets',async (req,res) => send(res,(await pool.query('SELECT id,label,balance FROM wallets WHERE owner_id=$1 ORDER BY label,id',[req.user.id])).rows));
api.post('/wallets',async (req,res) => {
  requireRole(req,['customer']);
  send(res,await transaction(async db => {
    const wallet = await one(db,'INSERT INTO wallets(owner_id,label) VALUES($1,$2) RETURNING id,label,balance',[req.user.id,note(60).parse(req.body.label)]);
    await audit(db,req.user.id,'wallet.created',wallet.id);
    return wallet;
  }),201);
});
api.get('/beneficiaries',async (req,res) => send(res,(await pool.query('SELECT id,name,wallet_id FROM beneficiaries WHERE owner_id=$1 ORDER BY name LIMIT 100',[req.user.id])).rows));
api.post('/beneficiaries',async (req,res) => {
  requireRole(req,['customer']);
  const data = z.object({name:note(80),walletId:uuid}).parse(req.body);
  send(res,await transaction(async db => {
    const wallet = await one(db,'SELECT id FROM wallets WHERE id=$1 AND owner_id IS NOT NULL AND owner_id<>$2',[data.walletId,req.user.id]);
    if (!wallet) fail(404,'WALLET','Recipient wallet unavailable.');
    const beneficiary = await one(db,'INSERT INTO beneficiaries(owner_id,wallet_id,name) VALUES($1,$2,$3) RETURNING id,name,wallet_id',[req.user.id,data.walletId,data.name]);
    await audit(db,req.user.id,'beneficiary.created',beneficiary.id);
    return beneficiary;
  }),201);
});
async function idempotent(req, body, action) {
  const key = note(128).parse(req.get('idempotency-key'));
  const fingerprint = sha(JSON.stringify([req.method,req.route.path,req.params,body]));
  return transaction(async db => {
    const inserted = await one(db,'INSERT INTO request_keys(owner_id,request_key,fingerprint) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING request_key',[req.user.id,key,fingerprint]);
    if (!inserted) {
      const prior = await one(db,'SELECT * FROM request_keys WHERE owner_id=$1 AND request_key=$2',[req.user.id,key]);
      if (prior.fingerprint !== fingerprint) fail(409,'KEY_CONFLICT','This key was used for another request.');
      return prior.response;
    }
    const data = await action(db);
    await db.query('UPDATE request_keys SET response=$3 WHERE owner_id=$1 AND request_key=$2',[req.user.id,key,JSON.stringify(data)]);
    return data;
  });
}
api.post('/transfers',async (req,res) => {
  requireRole(req,['customer']);
  const data = z.object({walletId:uuid,beneficiaryId:uuid,cents:amount,memo:z.string().trim().max(140).default('')}).parse(req.body);
  send(res,await idempotent(req,data,async db => {
    confirmed(req);
    await owned(db,data.walletId,req.user.id);
    const recipient = await one(db,'SELECT wallet_id FROM beneficiaries WHERE id=$1 AND owner_id=$2',[data.beneficiaryId,req.user.id]);
    if (!recipient) fail(404,'BENEFICIARY','Beneficiary unavailable.');
    const posting = await post(db,data.walletId,recipient.wallet_id,data.cents,'transfer',data.memo);
    await audit(db,req.user.id,'transfer.posted',posting.id);
    return posting;
  }),201);
});
api.post('/payment-intents',async (req,res) => {
  requireRole(req,['customer']);
  const data = z.object({walletId:uuid,cents:amount}).parse(req.body);
  send(res,await idempotent(req,data,async db => {
    await owned(db,data.walletId,req.user.id);
    const intent = await one(db,'INSERT INTO payment_intents(wallet_id,cents) VALUES($1,$2) RETURNING *',[data.walletId,data.cents]);
    await audit(db,req.user.id,'payment.created',intent.id);
    return intent;
  }),201);
});
api.get('/payment-intents',async (req,res) => send(res,(await pool.query('SELECT p.* FROM payment_intents p JOIN wallets w ON w.id=p.wallet_id WHERE w.owner_id=$1 ORDER BY p.created_at DESC LIMIT 50',[req.user.id])).rows));
api.post('/payment-intents/:id/simulate',async (req,res) => {
  if (process.env.DEMO_MODE === 'false' || process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true') fail(404,'ROUTE','Route unavailable.');
  const id = uuid.parse(req.params.id);
  const {status} = z.object({status:z.enum(['settled','failed'])}).parse(req.body);
  const intent = await one(pool,'SELECT p.* FROM payment_intents p JOIN wallets w ON w.id=p.wallet_id WHERE p.id=$1 AND w.owner_id=$2',[id,req.user.id]);
  if (!intent) fail(404,'INTENT','Payment intent unavailable.');
  send(res,await transaction(db => settle(db,{id:'demo-'+id,intentId:id,status,cents:Number(intent.cents)})));
});
for (const [route,kind] of [['refunds','refund'],['reversals','reversal']]) {
  api.post('/transactions/:id/'+route,async (req,res) => {
    requireRole(req,finance);
    const id = uuid.parse(req.params.id);
    send(res,await idempotent(req,{},async db => {
      confirmed(req);
      const original = await one(db,'SELECT * FROM transactions WHERE id=$1 FOR UPDATE',[id]);
      if (!original || original.kind !== (kind === 'refund' ? 'topup' : 'transfer')) fail(404,'TRANSACTION','Eligible original transaction unavailable.');
      if (await one(db,'SELECT id FROM transactions WHERE original_id=$1',[id])) fail(409,'ALREADY_REVERSED','The posting was already compensated.');
      const posting = await post(db,original.to_wallet,original.from_wallet,original.cents,kind,'Compensating entry',id);
      await audit(db,req.user.id,kind+'.posted',posting.id);
      return posting;
    }),201);
  });
}
api.get('/statements',async (req,res) => {
  const query = z.object({limit:z.coerce.number().int().min(1).max(100).default(25),offset:z.coerce.number().int().min(0).max(100000).default(0),kind:z.enum(['transfer','topup','refund','reversal']).optional()}).parse(req.query);
  const {rows} = await pool.query(`SELECT t.id,t.kind,t.memo,t.cents,t.created_at,
    CASE WHEN a.owner_id=$1 THEN 'out' ELSE 'in' END AS direction,
    CASE WHEN a.owner_id=$1 THEN coalesce(ub.name,b.label) ELSE coalesce(ua.name,a.label) END AS counterparty
    FROM transactions t JOIN wallets a ON a.id=t.from_wallet JOIN wallets b ON b.id=t.to_wallet
    LEFT JOIN users ua ON ua.id=a.owner_id LEFT JOIN users ub ON ub.id=b.owner_id
    WHERE (a.owner_id=$1 OR b.owner_id=$1) AND ($4::text IS NULL OR t.kind=$4)
    ORDER BY t.created_at DESC,t.id DESC LIMIT $2 OFFSET $3`,[req.user.id,query.limit,query.offset,query.kind || null]);
  if (req.query.format === 'csv') {
    const escape = value => '"' + String(value).replace(/^[\s]*[=+@-]/,match => "'"+match).replaceAll('"','""') + '"';
    const csv = ['id,kind,direction,cents,counterparty,memo,date',...rows.map(row => [row.id,row.kind,row.direction,row.cents,row.counterparty,row.memo,row.created_at.toISOString()].map(escape).join(','))];
    return res.attachment('fincore-statement.csv').type('text/csv').send(csv.join('\r\n'));
  }
  send(res,rows);
});
api.get('/disputes',async (req,res) => {
  const owner = staff.includes(req.user.role) ? null : req.user.id;
  send(res,(await pool.query('SELECT * FROM disputes WHERE ($1::uuid IS NULL OR owner_id=$1) ORDER BY created_at DESC LIMIT 100',[owner])).rows);
});
api.post('/disputes',async (req,res) => {
  requireRole(req,['customer']);
  const data = z.object({transactionId:uuid,reason:note(500)}).parse(req.body);
  send(res,await transaction(async db => {
    const visible = await one(db,'SELECT t.id FROM transactions t JOIN wallets w ON w.id IN (t.from_wallet,t.to_wallet) WHERE t.id=$1 AND w.owner_id=$2',[data.transactionId,req.user.id]);
    if (!visible) fail(404,'TRANSACTION','Transaction unavailable.');
    const dispute = await one(db,'INSERT INTO disputes(owner_id,transaction_id,reason) VALUES($1,$2,$3) RETURNING *',[req.user.id,data.transactionId,data.reason]);
    await audit(db,req.user.id,'dispute.opened',dispute.id);
    return dispute;
  }),201);
});
api.patch('/disputes/:id',async (req,res) => {
  requireRole(req,staff);
  const status = z.enum(['reviewing','resolved']).parse(req.body.status);
  send(res,await transaction(async db => {
    const dispute = await one(db,"UPDATE disputes SET status=$2 WHERE id=$1 AND status<> 'resolved' RETURNING *",[uuid.parse(req.params.id),status]);
    if (!dispute) fail(404,'DISPUTE','Active dispute unavailable.');
    await audit(db,req.user.id,'dispute.'+status,dispute.id);
    return dispute;
  }));
});
api.get('/operations',async (req,res) => {
  requireRole(req,ops);
  const [ledger,events,auditLog,activity] = await Promise.all([
    one(pool,'SELECT count(DISTINCT transaction_id)::int AS postings,coalesce(sum(delta),0)::text AS net FROM journal'),
    pool.query('SELECT * FROM provider_events ORDER BY created_at DESC LIMIT 50'),
    pool.query('SELECT id,action,entity_id,created_at FROM audit ORDER BY id DESC LIMIT 50'),
    pool.query("SELECT id,cents,kind,created_at FROM transactions WHERE created_at>now()-interval '1 day' ORDER BY created_at DESC LIMIT 100")
  ]);
  send(res,{ledger,events:events.rows,audit:auditLog.rows,activity:activity.rows});
});
api.get('/operations/risk',async (req,res) => {
  requireRole(req,ops);
  const groups = (await pool.query("SELECT from_wallet AS wallet_id,count(*)::int AS count, max(cents)::text AS peak FROM transactions WHERE kind='transfer' AND created_at>now()-interval '1 hour' GROUP BY from_wallet LIMIT 100")).rows;
  const upstream = await fetch((process.env.ANALYTICS_URL || 'http://127.0.0.1:8000')+'/risk',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({groups}),signal:AbortSignal.timeout(2500)}).catch(() => null);
  if (!upstream?.ok) fail(503,'ANALYTICS','Risk analytics is temporarily unavailable.');
  send(res,await upstream.json());
});
app.use((_req,_res) => fail(404,'ROUTE','Route unavailable.'));
app.use((error,req,res,_next) => {
  let fault = error;
  if (error instanceof z.ZodError) fault = new Fault(400,'VALIDATION',error.issues.map(issue => issue.path.join('.') || 'Request').join(', ')+' contains an invalid value.');
  else if (error.type === 'entity.parse.failed') fault = new Fault(400,'JSON','Invalid JSON.');
  else if (error.type === 'entity.too.large') fault = new Fault(413,'PAYLOAD','Request is too large.');
  else if (error.code === '23505') fault = new Fault(409,'DUPLICATE','This record already exists.');
  else if (!(error instanceof Fault)) {
    console.error(JSON.stringify({requestId:req.requestId,error:error.code || error.name}));
    fault = new Fault(503,'SERVICE','The service could not complete this request.');
  }
  res.status(fault.status).json({error:{code:fault.code,message:fault.message,requestId:req.requestId}});
});
