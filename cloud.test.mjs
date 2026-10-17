// node --test cloud.test.mjs — two simulated devices syncing through the real worker handler (sync.js) with an in-memory KV.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import vm from 'node:vm';
import { signSession, syncResponse } from './worker/sync.js';

const src = fs.readFileSync(new URL('./cloud.js', import.meta.url), 'utf8');
const wait = () => new Promise((r) => setTimeout(r, 5));

function world() {
  const kv = new Map(), env = { SESSION_SECRET: 's', GOOGLE_CLIENT_ID: 'cid', USERS: { get: async (k) => (kv.has(k) ? JSON.parse(kv.get(k)) : null), put: async (k, v) => kv.set(k, v), delete: async (k) => kv.delete(k) } };
  const fetchFn = async (url, init) => { const u = new URL(url); return syncResponse(new Request(url, init), u, env); };
  return { kv, async device(sub = '1') {
    const store = new Map(), ls = { get length() { return store.size; }, key: (i) => [...store.keys()][i], getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
    Object.defineProperty(ls, 'keys', { value: () => [...store.keys()] });
    const token = await signSession({ sub, email: 'a@x.com' }, 's');
    store.set('fh3_cloud', JSON.stringify({ token, exp: Date.now() + 864e5, user: { sub, email: 'a@x.com' } }));
    const sb = { localStorage: ls, fetch: fetchFn, OC_PROXY: 'https://w', document: { addEventListener() {}, getElementById: () => null }, window: { addEventListener() {} }, navigator: { onLine: true }, setTimeout, clearTimeout, console, Object, JSON, Date, Promise, Array };
    vm.createContext(sb); vm.runInContext(src + '\nthis.CLOUD = CLOUD;', sb);
    Object.defineProperty(sb.localStorage, 'length', { get: () => store.size });
    return { CLOUD: sb.CLOUD, put: (k, v) => { ls.setItem(k, JSON.stringify(v)); sb.CLOUD.touch(k); }, get: (k) => (ls.getItem(k) === null ? null : JSON.parse(ls.getItem(k))), raw: ls };
  } };
}

test('a second device receives what the first saved, and newer edits flow both ways', async () => {
  const w = world(), A = await w.device(), B = await w.device();
  A.put('fh3_pf', [{ name: 'Main' }]); A.put('fh3_keys', { key: 'SECRET' });
  await A.CLOUD.sync();
  assert.ok(!JSON.stringify([...w.kv.values()]).includes('SECRET'), 'API keys are sealed, never stored in clear');
  assert.equal((await B.CLOUD.sync()).changed, true);
  assert.deepEqual(B.get('fh3_pf'), [{ name: 'Main' }]);
  assert.deepEqual(B.get('fh3_keys'), { key: 'SECRET' });          // the phone gets the laptop's AI keys
  await wait(); B.put('fh3_pf', [{ name: 'Main' }, { name: 'Alt' }]);
  await B.CLOUD.sync();
  assert.equal((await A.CLOUD.sync()).changed, true);
  assert.equal(A.get('fh3_pf').length, 2);
});

test('older cloud data does not overwrite a newer local edit; edits made on both sides merge per key', async () => {
  const w = world(), A = await w.device(), B = await w.device();
  A.put('fh3_lists', ['x']); await A.CLOUD.sync(); await B.CLOUD.sync();
  await wait(); A.put('fh3_lists', ['x', 'a']);        // A edits lists
  await wait(); B.put('fh3_favs', ['NVDA']);            // B edits a different key, before A has synced
  await B.CLOUD.sync(); await A.CLOUD.sync();           // A's push hits a stale revision first time and retries
  await B.CLOUD.sync();
  for (const d of [A, B]) { assert.deepEqual(d.get('fh3_lists'), ['x', 'a']); assert.deepEqual(d.get('fh3_favs'), ['NVDA']); }
});

test('a delete on one device removes the key on the other, and accounts stay separate', async () => {
  const w = world(), A = await w.device(), B = await w.device(), C = await w.device('2');
  A.put('fh3_desk', { m: 1 }); await A.CLOUD.sync(); await B.CLOUD.sync();
  await wait(); B.raw.removeItem('fh3_desk'); B.CLOUD.del('fh3_desk'); await B.CLOUD.sync();
  await A.CLOUD.sync();
  assert.equal(A.get('fh3_desk'), null);
  assert.equal((await C.CLOUD.sync()).changed, false); assert.equal(C.get('fh3_desk'), null);
});

test('signing out with clear removes this device\'s synced data but leaves other keys', async () => {
  const w = world(), A = await w.device();
  A.put('fh3_pf', [1]); A.raw.setItem('fh3_cfg', '{}');
  await A.CLOUD.sync(); await A.CLOUD.signOut(true);
  assert.equal(A.get('fh3_pf'), null); assert.equal(A.raw.getItem('fh3_cfg'), '{}');
  assert.equal(A.CLOUD.on(), false);
});
