import test,{after,before} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import request from 'supertest';
import {app} from '../api/app.mjs';
import {one,pool,setup,transaction} from '../api/db.mjs';

const api=request(app);
const base='/api/v1';
const password='FinCoreDemo!2026';
const bearer=(req,token)=>req.set('Authorization','Bearer '+token);
const write=(path,token,body,key=randomUUID())=>bearer(api.post(base+path),token).set('Idempotency-Key',key).send(body);
const get=(path,token)=>bearer(api.get(base+path),token);
let customer, recipient, finance, wallet, beneficiary, posting;

async function register(name){
  const {body}=await api.post(base+'/auth/register').send({name,email:randomUUID()+'@fincore.test',password}).expect(201);
  const token=body.data.token;
  const result=await get('/wallets',token).expect(200);
  return {token,wallet:result.body.data[0].id};
}
async function confirm(token){
  await write('/auth/confirm',token,{password,code:'246810'}).expect(200);
}
function webhook(body, signature){
  const raw=JSON.stringify(body);
  const stamp=String(Math.floor(Date.now()/1000));
  const signed=createHmac('sha256',process.env.WEBHOOK_SECRET||'fincore-local-simulator').update(stamp+'.'+raw).digest('hex');
  return api.post(base+'/webhooks/sandbox').set('Content-Type','application/json').set('X-Event-Timestamp',stamp).set('X-Event-Signature',signature||signed).send(raw);
}
const balance=async actor=>BigInt((await get('/wallets',actor.token).expect(200)).body.data[0].balance);

before(async()=>{
  await setup();
  customer=await register('Case Customer');
  recipient=await register('Case Recipient');
  wallet=customer.wallet;
  beneficiary=(await write('/beneficiaries',customer.token,{name:'Case Recipient',walletId:recipient.wallet}).expect(201)).body.data.id;
  finance=(await api.post(base+'/auth/login').send({email:'finance@fincore.test',password}).expect(200)).body.data.token;
});
after(()=>pool.end());

test('unauthenticated access, invalid input, role checks and wallet ownership',async()=>{
  await api.get(base+'/wallets').expect(401);
  await get('/operations',customer.token).expect(403);
  await write('/payment-intents',customer.token,{walletId:wallet,cents:0}).expect(400);
  await write('/payment-intents',customer.token,{walletId:recipient.wallet,cents:100}).expect(404);
  await write('/transfers',customer.token,{walletId:wallet,beneficiaryId:beneficiary,cents:100}).expect(403);
});

test('signed settlement is deduplicated atomically and failures preserve balances',async()=>{
  const intent=(await write('/payment-intents',customer.token,{walletId:wallet,cents:1000}).expect(201)).body.data;
  const event={id:randomUUID(),intentId:intent.id,cents:1000,status:'settled'};
  await webhook(event,'0'.repeat(64)).expect(401);
  const mismatch=await webhook({...event,id:randomUUID(),cents:999}).expect(200);
  assert.equal(mismatch.body.data.outcome,'mismatch');
  const duplicates=await Promise.all([webhook(event).expect(200),webhook(event).expect(200)]);
  assert.equal(duplicates.filter(result=>result.body.data.duplicate).length,1);
  const failed=(await write('/payment-intents',customer.token,{walletId:wallet,cents:500}).expect(201)).body.data;
  await webhook({id:randomUUID(),intentId:failed.id,cents:500,status:'failed'}).expect(200);
  const state=(await get('/payment-intents',customer.token).expect(200)).body.data.find(item=>item.id===failed.id);
  assert.equal(state.status,'failed');
  assert.equal(state.transaction_id,null);
  assert.equal(await balance(customer),1000n);
});

test('concurrent requests cannot overspend and successful retry returns the same posting',async()=>{
  await confirm(customer.token);
  const payload={walletId:wallet,beneficiaryId:beneficiary,cents:800};
  const keys=[randomUUID(),randomUUID()];
  const responses=await Promise.all(keys.map(key=>write('/transfers',customer.token,payload,key)));
  assert.deepEqual(responses.map(response=>response.status).sort(),[201,409]);
  const index=responses.findIndex(response=>response.status===201);
  posting=responses[index].body.data;
  const duplicate=await write('/transfers',customer.token,payload,keys[index]).expect(201);
  assert.equal(posting.id,duplicate.body.data.id);
  await write('/transfers',customer.token,{...payload,cents:799},keys[index]).expect(409);
  await write('/transfers',customer.token,{...payload,cents:201}).expect(409);
  assert.equal(await balance(customer),200n);
  assert.equal(await balance(recipient),800n);
});

test('reversal posts once and normal ledger entries are immutable',async()=>{
  await confirm(finance);
  await write('/transactions/'+posting.id+'/reversals',customer.token,{}).expect(403);
  const path='/transactions/'+posting.id+'/reversals';
  const key=randomUUID();
  const reversal=await write(path,finance,{},key).expect(201);
  assert.equal((await write(path,finance,{},key).expect(201)).body.data.id,reversal.body.data.id);
  await write(path,finance,{}).expect(409);
  assert.equal(await balance(customer),1000n);
  assert.equal(await balance(recipient),0n);
  const row=await one(pool,'SELECT coalesce(sum(delta),0)::text AS net FROM journal');
  assert.equal(row.net,'0');
  await assert.rejects(pool.query('UPDATE journal SET delta=delta*2 WHERE transaction_id=$1',[posting.id]),/immutable/);
  await assert.rejects(transaction(db=>db.query("INSERT INTO transactions(from_wallet,to_wallet,cents,kind) VALUES($1,$2,100,'transfer')",[customer.wallet,recipient.wallet])),/Unbalanced posting/);
});

test('dispute ownership, statement export and session revocation',async()=>{
  const outsider=await register('Case Outsider');
  await write('/disputes',outsider.token,{transactionId:posting.id,reason:'No access'}).expect(404);
  const dispute=await write('/disputes',customer.token,{transactionId:posting.id,reason:'Review test'}).expect(201);
  await bearer(api.patch(base+'/disputes/'+dispute.body.data.id),finance).send({status:'reviewing'}).expect(200);
  await get('/statements?format=csv',customer.token).expect('Content-Type',/text\/csv/).expect(200);
  const next=(await write('/auth/refresh',outsider.token,{}).expect(200)).body.data.token;
  await get('/wallets',outsider.token).expect(401);
  await write('/auth/logout',next,{}).expect(204);
  await get('/wallets',next).expect(401);
});

test('analytics timeout returns a safe error and subsequent reads recover',async()=>{
  let delayed=true;
  const upstream=createServer((_req,res)=>{
    if (delayed) return;
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({alerts:[]}));
  });
  upstream.listen(0,'127.0.0.1');
  await once(upstream,'listening');
  const previous=process.env.ANALYTICS_URL;
  process.env.ANALYTICS_URL='http://127.0.0.1:'+upstream.address().port;
  try{
    const response=await get('/operations/risk',finance).expect(503);
    assert.equal(response.body.error.code,'ANALYTICS');
    assert.equal(response.body.error.requestId,response.headers['x-request-id']);
    delayed=false;
    assert.deepEqual((await get('/operations/risk',finance).expect(200)).body.data,{alerts:[]});
  } finally {
    if (previous===undefined) delete process.env.ANALYTICS_URL;
    else process.env.ANALYTICS_URL=previous;
    await new Promise(resolve=>{upstream.close(resolve);upstream.closeAllConnections();});
  }
});
