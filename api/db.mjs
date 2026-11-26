import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {randomBytes, scryptSync, timingSafeEqual} from 'node:crypto';

export const pool = new pg.Pool({connectionString: process.env.DATABASE_URL || 'postgresql://fincore@127.0.0.1:55432/postgres', connectionTimeoutMillis: 3000});
export function passwordHash(value, salt = randomBytes(16).toString('hex')) {
  return salt + ':' + scryptSync(value, salt, 64).toString('hex');
}
export function verifies(value, hash) {
  return timingSafeEqual(Buffer.from(passwordHash(value, hash.split(':')[0])), Buffer.from(hash));
}
export async function transaction(fn) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const result = await fn(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
export async function one(db, sql, args = []) {
  return (await db.query(sql, args)).rows[0];
}
export const treasury = '00000000-0000-4000-8000-000000000001';
export class Fault extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export async function post(db, from, to, cents, kind, memo = '', original = null) {
  const {rows} = await db.query('SELECT * FROM wallets WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [[from, to]]);
  const source = rows.find(row => row.id === from);
  if (!source || rows.length !== 2) throw new Fault(404, 'WALLET', 'Wallet unavailable.');
  if (source.owner_id && BigInt(source.balance) < BigInt(cents)) {
    throw new Fault(409, 'FUNDS', 'The wallet has insufficient simulated funds.');
  }
  const posting = await one(db, 'INSERT INTO transactions(from_wallet,to_wallet,cents,kind,memo,original_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [from,to,cents,kind,memo,original]);
  await db.query('INSERT INTO journal VALUES($1,$2,-$4::bigint),($1,$3,$4::bigint)', [posting.id,from,to,cents]);
  await db.query('UPDATE wallets SET balance=balance+CASE WHEN id=$1 THEN -$3::bigint ELSE $3::bigint END WHERE id IN ($1,$2)', [from,to,cents]);
  return posting;
}
export async function setup() {
  await transaction(async db => {
    await db.query('SELECT pg_advisory_xact_lock(714462)');
    await db.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    await db.query('INSERT INTO wallets(id,label) VALUES($1,$2) ON CONFLICT DO NOTHING', [treasury,'Simulation reserve']);
    if (process.env.DEMO_MODE === 'false' || process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true') return;
    const accounts = [
      ['ava@fincore.test','Ava Morgan','customer',1250000],
      ['jordan@fincore.test','Jordan Lee','customer',100000],
      ['maya@fincore.test','Maya Patel','customer',280000],
      ['ops@fincore.test','Ellis Reed','operations',0],
      ['finance@fincore.test','Sam West','finance',0],
      ['support@fincore.test','Robin Cole','support',0],
      ['admin@fincore.test','Taylor Quinn','admin',0]
    ];
    const wallets = [];
    for (const [email,name,role,balance] of accounts) {
      const created = await one(db,'INSERT INTO users(email,name,role,password_hash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id',[email,name,role,passwordHash('FinCoreDemo!2026')]);
      if (!created || role !== 'customer') continue;
      const wallet = await one(db,'INSERT INTO wallets(owner_id,label) VALUES($1,$2) RETURNING id',[created.id,'Primary wallet']);
      wallets.push({...wallet, owner: created.id, name});
      await post(db,treasury,wallet.id,balance,'topup','Opening balance');
    }
    const [ava,jordan,maya] = wallets;
    if (!ava || !jordan || !maya) return;
    for (const recipient of [jordan,maya]) {
      await db.query('INSERT INTO beneficiaries(owner_id,wallet_id,name) VALUES($1,$2,$3)',[ava.owner,recipient.id,recipient.name]);
    }
    await post(db,ava.id,jordan.id,42000,'transfer','Studio expenses');
    await post(db,maya.id,ava.id,165000,'transfer','Project reimbursement');
    await post(db,ava.id,maya.id,9500,'transfer','Team lunch');
  });
}
