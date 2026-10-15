/* Cloud sync for accounts signed in with Google. The data is the same localStorage keys the app already uses;
   this layer mirrors an allow-list of them to the worker (worker/sync.js), one document per Google account.
   Per key, the newest write wins (CLOUD.touch stamps each save). API keys and caches never leave the device. */
var CLOUD = (function(){
  var KEY = 'fh3_cloud', TS = 'fh3_cts';
  var SYNC = /^fh3_(lists|pf|hist|q|chat|tasks|research|skills|desk|calls|visit|pfseen|memory|rruns|alerts|inbox|custom|chs|inds|quant|scrmode|favs|tour|xpf|csum)$/;
  var PROFILE = '_profile';   // name/age/roles/since of the signed-in account, kept under a pseudo key
  var hooks = { getProfile:function(){ return null; }, setProfile:function(){} };
  var st = rd(KEY) || {}, ts = rd(TS) || {};
  var last = {};              // the cloud document as of the last pull/push
  var state = 'off', when = 0, timer = 0, busy = null, dirty = false;

  function rd(k){ try{ return JSON.parse(localStorage.getItem(k)); }catch(e){ return null; } }
  function wr(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
  function on(){ return !!(st.token && st.exp > Date.now()); }
  function api(path, method, body, keep){
    return fetch(OC_PROXY + path, { method:method, keepalive:!!keep, headers:Object.assign({ 'content-type':'application/json' }, st.token ? { authorization:'Bearer ' + st.token } : {}), body:body ? JSON.stringify(body) : undefined })
      .then(function(r){ return r.json().catch(function(){ return {}; }).then(function(j){ return { status:r.status, body:j }; }); });
  }
  function set(s){ state = s; if(s === 'synced') when = Date.now(); try{ var el = document.getElementById('cloudLine'); if(el) el.textContent = line(); }catch(e){} }
  function line(){
    return !on() ? 'Not syncing' : state === 'syncing' ? 'Syncing…' : state === 'error' ? 'Sync problem — will retry' : state === 'offline' ? 'Offline — will sync when back' :
      when ? 'Synced ' + (Date.now() - when < 60000 ? 'just now' : Math.round((Date.now() - when) / 60000) + ' min ago') : 'Signed in';
  }

  /* what this device holds right now, in the cloud document's shape: key -> { v:<json string|null>, t:<ms> } */
  function local(){
    var o = {};
    try{ for(var i = 0; i < localStorage.length; i++){ var k = localStorage.key(i); if(SYNC.test(k)) o[k] = { v:localStorage.getItem(k), t:ts[k] || 1 }; } }catch(e){}
    var p = hooks.getProfile(); if(p) o[PROFILE] = { v:JSON.stringify(p), t:ts[PROFILE] || 1 };
    Object.keys(ts).forEach(function(k){ if(ts[k] && !o[k] && (SYNC.test(k) || k === PROFILE) && ts['-' + k]) o[k] = { v:null, t:ts[k] }; });   // deleted here
    return o;
  }
  /* newest write per key; returns { out: what the cloud should hold, changed: whether this device took something newer } */
  function merge(cloud){
    var mine = local(), out = {}, changed = false;
    Object.keys(Object.assign({}, cloud, mine)).forEach(function(k){
      var c = cloud[k], m = mine[k];
      if(c && (!m || c.t > m.t)){
        out[k] = c; changed = true; ts[k] = c.t; delete ts['-' + k];
        if(k === PROFILE){ if(c.v) try{ hooks.setProfile(JSON.parse(c.v)); }catch(e){} }
        else try{ if(c.v === null) localStorage.removeItem(k); else localStorage.setItem(k, c.v); }catch(e){}
      } else out[k] = m;
    });
    wr(TS, ts);
    return { out:out, changed:changed };
  }
  function same(a, b){ var ka = Object.keys(a); return ka.length === Object.keys(b).length && ka.every(function(k){ return b[k] && b[k].t === a[k].t; }); }

  /* pull, merge, push if this device had anything newer. Resolves { changed } (true = local data was replaced by newer cloud data). */
  function sync(){
    if(!on()) return Promise.resolve({ changed:false });
    if(busy) return busy.then(function(){ return sync(); });
    clearTimeout(timer); dirty = false; set('syncing');
    var changed = false;
    function round(n){
      return api('/api/sync', 'GET').then(function(r){
        if(r.status === 401){ st = {}; wr(KEY, st); set('off'); if(typeof toast === 'function') toast('Cloud sync paused — sign in with Google again.'); return; }
        if(r.status !== 200) throw new Error('pull ' + r.status);
        last = r.body.data || {}; st.rev = r.body.rev || 0;
        var m = merge(last); changed = changed || m.changed;
        if(same(m.out, last)) return;
        return api('/api/sync', 'PUT', { baseRev:st.rev, data:m.out }).then(function(p){
          if(p.status === 200){ st.rev = p.body.rev; last = m.out; wr(KEY, st); return; }
          if(p.status === 409 && n < 3) return round(n + 1);   // another device wrote in between: merge again
          if(p.status === 413){ if(typeof toast === 'function') toast('Too much saved data to sync — delete old chats or Research Log runs.', 6000); return; }
          throw new Error('push ' + p.status);
        });
      });
    }
    busy = round(0).then(function(){ if(on()) set('synced'); }, function(){ set(navigator.onLine === false ? 'offline' : 'error'); setTimeout(function(){ if(on()) schedule(20000); }, 0); })
      .then(function(){ busy = null; return { changed:changed }; });
    return busy;
  }
  function schedule(ms){ clearTimeout(timer); dirty = true; timer = setTimeout(sync, ms || 3000); }

  /* flush a pending change as the tab goes away */
  function flush(){
    if(!on() || !dirty || busy) return;
    var out = local(); clearTimeout(timer); dirty = false;
    api('/api/sync', 'PUT', { baseRev:st.rev, data:Object.assign({}, last, out) }, true).catch(function(){});
  }
  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState === 'hidden') flush();
    else if(on()) sync().then(function(r){ if(r.changed && typeof toast === 'function') toast('Newer data from another device was saved. Refresh to see it.', 6000); });
  });
  window.addEventListener('online', function(){ if(on()) sync(); });

  return {
    on:on, line:line,
    init:function(h){ hooks = h; },
    user:function(){ return on() ? st.user : null; },
    touch:function(k){ if(!SYNC.test(k) && k !== PROFILE) return; ts[k] = Date.now(); delete ts['-' + k]; wr(TS, ts); if(on()) schedule(); },
    del:function(k){ if(!SYNC.test(k)) return; ts[k] = Date.now(); ts['-' + k] = 1; wr(TS, ts); if(on()) schedule(); },
    sync:sync,
    signIn:function(credential){
      return api('/api/auth/google', 'POST', { credential:credential }).then(function(r){
        if(r.status !== 200) throw new Error(r.body && r.body.error || 'sign-in failed (' + r.status + ')');
        st = { token:r.body.token, exp:r.body.exp, user:r.body.user, rev:0 }; wr(KEY, st); last = {};
        return sync().then(function(res){ return { changed:res.changed, user:st.user }; });
      });
    },
    /* clear = also remove this device's copy of the synced data (shared computers) */
    signOut:function(clear){
      var done = on() && dirty ? sync() : Promise.resolve();
      return done.then(function(){
        st = {}; wr(KEY, st); last = {}; set('off');
        if(clear){ try{ var ks = []; for(var i = 0; i < localStorage.length; i++) ks.push(localStorage.key(i)); ks.filter(function(k){ return SYNC.test(k); }).forEach(function(k){ localStorage.removeItem(k); }); }catch(e){} ts = {}; wr(TS, ts); }
      });
    },
    wipeCloud:function(){ return api('/api/sync', 'DELETE').then(function(r){ if(r.status !== 200) throw new Error('delete failed'); last = {}; st.rev = 0; wr(KEY, st); }); }
  };
})();
