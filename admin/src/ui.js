// Static admin UI (served only after the Access gate). All data is inserted with textContent (no HTML from the DB).
const css = `*{box-sizing:border-box}body{margin:0;background:#121410;color:#E8EAE4;font:14px system-ui,sans-serif}
a{color:#F5A623}.top{display:flex;align-items:center;gap:16px;padding:14px 28px;border-bottom:1px solid #2f342c;flex-wrap:wrap}
.logo{font-weight:700;font-size:17px;color:#E8EAE4;text-decoration:none}.logo b{color:#F5A623}.sp{flex:1}.who,.muted{color:#9aa294}
.wrap{padding:24px 28px}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:24px 0 10px}.sub{color:#9aa294;margin-bottom:20px}
.card{background:#262A24;border:1px solid #343a31;border-radius:12px;padding:16px}.grid{display:grid;gap:14px}
.tiles{grid-template-columns:repeat(auto-fill,minmax(170px,1fr))}.tile .v{font-size:24px;font-weight:700;margin-top:6px}.tile .s{color:#9aa294;font-size:12px}
.tile.na .v{font-size:14px;color:#9aa294;font-weight:500}.amber{color:#F5A623}
.pill{display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px;background:#343a31;color:#cfd4c9}.pill.a{background:#F5A62333;color:#F5A623}.pill.g{background:#4caf5033;color:#7fd483}
.btn{background:#F5A623;color:#121410;border:0;border-radius:8px;padding:8px 12px;font-weight:600;cursor:pointer}.btn.o{background:transparent;color:#F5A623;border:1px solid #F5A623}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px;border-bottom:1px solid #343a31;vertical-align:top}th{color:#9aa294;font-weight:500;font-size:12px}
tr.row{cursor:pointer}tr.row:hover,tr.sel{background:#2f342c}input,select{background:#1b1e19;color:#E8EAE4;border:1px solid #343a31;border-radius:8px;padding:8px}
.bars{display:flex;gap:3px;align-items:flex-end;height:140px;margin-top:12px}.bars div{flex:1;background:#F5A623;border-radius:3px 3px 0 0;min-height:1px}
.split{grid-template-columns:3fr 2fr}@media(max-width:900px){.split{grid-template-columns:1fr}}.appcard{border-color:#F5A623;cursor:pointer;max-width:380px}
.ico{width:48px;height:48px;border-radius:12px;background:#F5A623;color:#121410;font-weight:800;display:grid;place-items:center;font-size:20px}
.tg{display:flex;justify-content:space-between;align-items:center;margin:10px 0}.err{color:#ff8a80}`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Cajun App Factory Admin</title><link rel="stylesheet" href="/admin.css"></head><body>
<div class="top"><a class="logo" href="/">Cajun App Factory <b>Admin</b></a><span class="muted" id="crumb">Apps</span><div class="sp"></div><div class="who" id="who"></div></div>
<main class="wrap" id="main"><p class="muted">Loading…</p></main><script src="/admin.js"></script></body></html>`;
const js = `'use strict';
const kids=(k)=>k.flat(Infinity).filter(c=>c!=null&&c!==false).map(c=>c.nodeType?c:String(c));
const $=(t,a={},...k)=>{const e=document.createElement(t);for(const[x,y]of Object.entries(a)){if(x==='on')for(const[ev,f]of Object.entries(y))e.addEventListener(ev,f);else if(x==='cls')e.className=y;else e.setAttribute(x,y)}e.append(...kids(k));return e};
const put=(el,...k)=>el.replaceChildren(...kids(k));
const api=async(p,o)=>{const r=await fetch(p,o);const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||r.status);return j};
const M=document.getElementById('main'),nf=new Intl.NumberFormat();
const n=(v)=>v==null?'—':typeof v==='number'?nf.format(v):v, pct=(v)=>v==null?'—':v+'%';
const dt=(t)=>t?new Date(t).toLocaleString('en-US',{timeZone:'America/Chicago',dateStyle:'medium',timeStyle:'short'})+' CT':'never';
const ago=(t)=>{if(!t)return 'never';const d=(Date.now()-t)/864e5;return d<1?Math.round(d*24)+'h ago':Math.round(d)+'d ago'};
const tile=(label,v,s,na)=>$('div',{cls:'card tile'+(na?' na':'')},$('div',{cls:'muted'},label),$('div',{cls:'v'},v),s?$('div',{cls:'s'},s):null);
const soon=(label,s)=>tile(label,'Coming soon',s,true);
const table=(cols,rows)=>$('table',{},$('tr',{},cols.map(c=>$('th',{},c))),rows.map(r=>$('tr',{},r.map(c=>$('td',{},c)))));
const crumb=(t)=>{document.getElementById('crumb').textContent=t};
api('/api/me').then(j=>{const w=document.getElementById('who');w.textContent=j.email+' · via Cloudflare Access';if(j.role==='owner')w.prepend($('a',{href:'/admins',on:{click:(e)=>{e.preventDefault();go('/admins')}}},'Admins'),' · ')}).catch(()=>{});
function go(p){history.pushState({},'',p);route()} window.onpopstate=route;
async function route(){const p=location.pathname;put(M,$('p',{cls:'muted'},'Loading…'));
 try{if(p==='/apps/stopscope')await overview();else if(p==='/apps/stopscope/users')await users();else if(p==='/admins')await admins();else await home()}catch(e){put(M,$('p',{cls:'err'},'Could not load: '+e.message))}}
async function home(){crumb('Apps');const o=await api('/api/apps/stopscope/overview');
 put(M,$('h1',{},'Your apps'),$('div',{cls:'sub'},'Tap an app for stats and users'),
  $('div',{cls:'card appcard',on:{click:()=>go('/apps/stopscope')}},$('div',{style:'display:flex;gap:12px;align-items:center'},$('div',{cls:'ico'},'S'),$('div',{},$('div',{style:'font-size:17px;font-weight:700'},'StopScope'),$('div',{cls:'muted'},'Android · stopscope.com'))),
   $('div',{cls:'grid',style:'grid-template-columns:1fr 1fr 1fr;margin-top:14px'},[['Users',n(o.app_users+o.website_users)],['Active 7d',n(o.active_7d)],['Rating','Not connected yet']].map(([a,b])=>$('div',{},$('div',{cls:'muted'},a),$('b',{style:'font-size:'+(b.length>8?'12':'20')+'px'},b))))))}
async function overview(){crumb('Apps › StopScope');const[o,s,pl]=await Promise.all([api('/api/apps/stopscope/overview'),api('/api/apps/stopscope/stats'),api('/api/apps/stopscope/play').catch(()=>({}))]);
 const e=s.engagement,a=s.activation,r=s.routes,d=s.dispatch,c=s.api_cost,cs=s.coming_soon;const mx=Math.max(1,...o.signups.map(x=>x.n));
 put(M,$('div',{style:'display:flex;align-items:center;gap:12px'},$('h1',{},'StopScope'),$('div',{cls:'sp'}),$('button',{cls:'btn',on:{click:()=>go('/apps/stopscope/users')}},'Users')),
  $('div',{cls:'sub'},'Live from D1 stopscope-dispatch · aggregates only'),
  $('h2',{},'Users'),$('div',{cls:'grid tiles'},tile('App users',n(o.app_users),'app_users'),tile('Website users',n(o.website_users),'users'),tile('Personal (solo)',n(o.personal)),tile('Free Pro',n(o.pro_comp),'pro_comp'),tile('Versions in use',(o.versions_in_use||[]).slice(0,3).map(v=>v.version+': '+v.n).join(' · ')||'—','app users by version (from the app, 0.3.31+)'),
   tile('DAU',n(e.dau)),tile('WAU',n(e.wau)),tile('MAU',n(e.mau)),tile('Stickiness',pct(e.stickiness),'DAU / MAU'),tile('Activation',pct(a.rate_pct),a.activated+' of '+a.eligible+' (first 7 days)')),
  $('div',{cls:'grid split',style:'margin-top:14px'},$('div',{cls:'card'},$('b',{},'Sign-ups per day'),$('span',{cls:'muted'},' last 30 days (UTC)'),$('div',{cls:'bars'},o.signups.map(x=>$('div',{title:x.day+': '+x.n,style:'height:'+Math.round(x.n/mx*100)+'%'}))),$('div',{cls:'muted',style:'display:flex;justify-content:space-between;font-size:11px;margin-top:6px'},$('span',{},o.signups[0].day),$('span',{},o.signups[29].day))),
   $('div',{cls:'card'},$('b',{},'Sign-in method'),$('p',{},'Google: '+o.methods.google+' · Password: '+o.methods.password),$('b',{},'Recent admin actions'),o.recent_actions.length?o.recent_actions.map(x=>$('div',{cls:'muted',style:'font-size:12px;margin-top:6px'},x.action+' · '+(x.target_email||x.target_kind)+' · '+dt(x.created_at))):$('div',{cls:'muted'},'None yet'))),
  $('h2',{},'Sign-ups per week'),$('div',{cls:'card'},table(['Week of','Google','Email','Verified','Unverified'],s.signups_weekly.map(w=>[w.wk,w.google,w.email,w.verified,w.unverified]))),
  $('h2',{},'Weekly retention cohorts'),$('div',{cls:'card'},table(['Cohort','Users','Wk 0','Wk 1','Wk 2','Wk 3','Wk 4','Wk 5','Wk 6','Wk 7'],s.cohorts.map(k=>[k.week,k.size,...Array.from({length:8},(_,i)=>k.retained_pct[i]==null?'':k.retained_pct[i]+'%')]))),
  $('h2',{},'API cost watch'),$('div',{cls:'grid tiles'},Object.entries(c.free).map(([k,v])=>tile(k+' this month',n(v.month_to_date),'of '+n(v.free_monthly)+' free ('+v.pct+'%)')),tile('Days at daily cap',n(c.capped_days.length),'last 14 days (calls past the cap got 429)')),
  $('div',{cls:'grid split',style:'margin-top:14px'},$('div',{cls:'card'},$('b',{},'Daily calls (last 14 days)'),table(['Day','API','Calls','Cap'],c.daily.map(x=>[x.day,x.api,n(x.count),n(c.caps[x.api])]))),$('div',{cls:'card'},$('b',{},'Top users, 7 days'),table(['User','Calls'],c.top_users_7d.map(x=>[x.email||x.id,n(x.calls)])),$('p',{cls:'muted',style:'font-size:12px'},c.note_429))),
  $('h2',{},'Dispatch'),$('div',{cls:'grid tiles'},tile('MRR (est.)','$'+n(d.mrr_usd),d.mrr_note),tile('Paying companies',n(d.paying_companies)),tile('Billed seats',n(d.billed_seats)),tile('Drivers',n(d.drivers)),tile('Companies',n(o.companies),o.free_license_companies+' on free license'),tile('Churned',n(d.churned_companies),d.deleted_companies+' deleted'),
   tile('Status mix',Object.entries(d.status_mix).map(([k,v])=>k+' '+v).join(' · ')||'—'),tile('Route completion',pct(r.completion_pct),r.completed+' of '+r.routes+' routes'),tile('Stops done / skipped',n(r.stops_done)+' / '+n(r.stops_skipped),n(r.stops_pending)+' pending'),
   tile('Median route time',r.median_route_minutes==null?'—':r.median_route_minutes+' min'),tile('Invite acceptance',pct(r.invite_accept_pct),r.invites_accepted+' of '+r.invites),tile('Proof photo rate',pct(r.proof_photo_pct),'of done stops'),tile('Signature rate',pct(r.proof_signature_pct),'of done stops'),tile('Proof storage',r.proof_storage_mb+' MB','R2 stopscope-pod')),
  playSec(pl),
  featureSec(s.features),proSec(s.pro),
  $('h2',{},'Gone quiet (14+ days)'),$('div',{cls:'card'},s.gone_quiet.length?table(['User','Account','Last seen'],s.gone_quiet.map(x=>[(x.name?x.name+' · ':'')+x.email,x.kind==='app'?'App':'Website',dt(x.last)])):$('p',{cls:'muted'},'Nobody yet.')))}
function playSec(p){const st=(x,lbl,val,sub)=>!x?tile(lbl,'Waiting for first sync','daily at 06:00 CT',true):x.error&&!x.data?tile(lbl,/403/.test(x.error)?'Waiting for Play access':'Error',x.error,true):x.data.no_data?tile(lbl,'No data yet',(x.data.note||'Play needs more users')+(x.data.as_of?' · as of '+x.data.as_of:''),true):tile(lbl,val(x.data),sub(x.data)+(x.error?' · last sync failed':''));
 return $('div',{},$('h2',{},'Play & app data'),$('div',{cls:'grid tiles'},
  st(p.installs,'Installs',d=>n(d.total_user_installs),d=>n(d.installs_30d)+' new / '+n(d.uninstalls_30d)+' uninstalls, 30 days · '+d.as_of),
  st(p.rating,'Rating',d=>d.avg+' ★',d=>d.count+' reviews · '+d.note),
  st(p.crash,'Crash-free users',d=>(Math.round((100-d.rate_pct)*100)/100)+'%',d=>'28 days to '+d.as_of+' · '+n(d.users)+' users'),
  st(p.anr,'ANR rate',d=>d.rate_pct+'%',d=>'28 days to '+d.as_of+' (bad: 0.47%+)'),
  st(p.versions,'Version spread',d=>d.versions.slice(0,3).map(v=>v.version_code+': '+v.pct+'%').join(' · '),d=>'users by version code, 7 days to '+d.as_of)),
  $('p',{cls:'muted',style:'font-size:12px'},'Synced daily from Google Play'+(p.crash&&p.crash.fetched_at?' · last run '+dt(p.crash.fetched_at):'')))}
function featureSec(f){const h=$('h2',{},'Feature adoption');if(!f||!f.has_data)return $('div',{},h,$('div',{cls:'grid tiles'},tile('Feature adoption','No data yet','App feature counters (0.3.30+)',true)));
 const days=[...new Set(f.daily.map(x=>x.day))].sort(),keys=f.adoption.map(a=>a.counter),m={};for(const x of f.daily)m[x.day+'|'+x.counter]=x.total;
 return $('div',{},h,$('div',{cls:'grid tiles'},tile('Stops per route',f.stops_per_route_30d==null?'—':String(f.stops_per_route_30d),'route stops / routes started, 30 days'),tile('Maps vs Waze',pct(f.handoff_30d.maps_pct)+' / '+pct(f.handoff_30d.waze_pct),n(f.handoff_30d.maps)+' Maps · '+n(f.handoff_30d.waze)+' Waze, 30 days'),tile('Active app users',n(f.active_app_users_7d)+' / '+n(f.active_app_users_30d),'7 days / 30 days')),
  $('div',{cls:'card',style:'margin-top:14px'},table(['Feature','% active 7d','% active 30d','Users 30d','Total 30d'],f.adoption.map(a=>[a.label,pct(a.pct_7d),pct(a.pct_30d),n(a.users_30d),n(a.total_30d)]))),
  $('div',{cls:'card',style:'margin-top:14px'},$('b',{},'Totals per day'),$('span',{cls:'muted'},' last 30 days (UTC)'),table(['Day',...f.adoption.map(a=>a.label)],days.reverse().map(d=>[d,...keys.map(k=>n(m[d+'|'+k]||0))]))))}
function proSec(p){const h=$('h2',{},'Pro subscriptions (Google Play)');if(!p||!p.has_data)return $('div',{},h,$('div',{cls:'grid tiles'},tile('Pro trial funnel','Waiting for Play',p&&p.test_notifications?'Test notification received '+dt(p.last_test_at):'Play notifications',true),tile('Pro MRR','Waiting for Play','$7.99 / month',true)));
 return $('div',{},h,$('div',{cls:'grid tiles'},tile('Trial starts',n(p.trial_starts),'30 days · '+n(p.new_subscriptions)+' new subs'),tile('Conversions',n(p.conversions),'first renewals, 30 days'),tile('Cancels',n(p.cancels),'30 days'),tile('Active paid subs',n(p.active_paid)),tile('Pro MRR','$'+n(p.mrr_usd),'at $'+p.price+' / month'),tile('Unverified events',n(p.unverified_events),'of '+n(p.total_events)+' (no Play API lookup)')),$('p',{cls:'muted',style:'font-size:12px'},p.note))}
let st={q:'',type:'',page:1,sel:null};
async function users(){crumb('Apps › StopScope › Users');const j=await api('/api/apps/stopscope/users?'+new URLSearchParams({q:st.q,type:st.type,page:st.page}));
 const q=$('input',{type:'search',placeholder:'Search email, name or company',value:st.q,maxlength:'100'}),t=$('select',{},[['','All'],['personal','Personal'],['dispatch','Dispatch'],['pro','Free Pro']].map(([v,l])=>{const o=$('option',{value:v},l);if(v===st.type)o.selected=true;return o}));
 const f=$('form',{style:'display:flex;gap:8px;margin-bottom:12px',on:{submit:(e)=>{e.preventDefault();st.q=q.value;st.type=t.value;st.page=1;users()}}},q,t,$('button',{cls:'btn'},'Search'));t.onchange=()=>f.requestSubmit();
 const det=$('div',{cls:'card'},$('p',{cls:'muted'},'Tap a user.'));
 const rows=j.users.map(u=>{const tr=$('tr',{cls:'row',on:{click:()=>{st.sel=u;[...tr.parentNode.children].forEach(x=>x.classList.remove('sel'));tr.classList.add('sel');detail(det,u)}}},$('td',{},$('b',{},u.name||'—'),$('div',{cls:'muted',style:'font-size:12px'},u.email)),
  $('td',{},u.pro_comp?$('span',{cls:'pill a'},'Pro (free)'):null,' ',u.type==='dispatch'?$('span',{cls:'pill g'},u.driver?'Driver':'Dispatch'):$('span',{cls:'pill'},'Personal'),u.free_license?$('span',{cls:'pill g'},'License'):null),$('td',{},(u.accounts||[u.kind]).map(a=>$('span',{cls:'pill'},a==='app'?'App':'Web'))),$('td',{cls:u.app_version&&u.app_version.startsWith('older')?'muted':''},u.app_version||'—'),$('td',{},ago(u.last_seen||u.last_app_open||u.last_sign_in_at)));return tr});
 put(M,$('h1',{},'Users'),$('div',{cls:'sub'},j.total+' rows · Play Pro is checked on the phone, so only free Pro shows here'),f,
  $('div',{cls:'grid split'},$('div',{cls:'card'},$('table',{},$('tr',{},['Person','Plan','Accounts','App version','Last seen'].map(c=>$('th',{},c))),rows),
   $('p',{},$('button',{cls:'btn o',on:{click:()=>{if(st.page>1){st.page--;users()}}}},'Previous'),' Page '+j.page+' of '+j.pages+' ',$('button',{cls:'btn o',on:{click:()=>{if(st.page<j.pages){st.page++;users()}}}},'Next'))),det))}
async function detail(box,u){put(box,$('p',{cls:'muted'},'Loading…'));let d;try{d=await api('/api/apps/stopscope/user?'+new URLSearchParams({kind:u.kind,id:u.id}))}catch(e){put(box,$('p',{cls:'err'},e.message));return}
 const tog=(label,what,on,enabled,why)=>{const b=$('button',{cls:on?'btn':'btn o'},on?'On':'Off');if(!enabled){b.disabled=true;b.title=why}
  b.onclick=async()=>{if(!confirm((on?'Turn OFF ':'Turn ON ')+label+' for '+d.email+'?'))return;b.disabled=true;
   try{await api('/api/apps/stopscope/toggle',{method:'POST',headers:{'Content-Type':'application/json','X-Admin':'1'},body:JSON.stringify({kind:u.kind,id:u.id,what,on:!on})});detail(box,u)}catch(e){alert('Failed: '+e.message);b.disabled=false}};
  return $('div',{cls:'tg'},$('span',{},label,enabled?null:$('div',{cls:'muted',style:'font-size:11px'},why)),b)};
 const act=(label,what)=>$('button',{cls:'btn o',on:{click:async(e)=>{if(!confirm(label+' for '+d.email+'?'))return;e.target.disabled=true;
  try{await api('/api/apps/stopscope/action',{method:'POST',headers:{'Content-Type':'application/json','X-Admin':'1'},body:JSON.stringify({kind:u.kind,id:u.id,what})});detail(box,u)}catch(x){alert('Failed: '+x.message);e.target.disabled=false}}}},label);
 const us=Object.entries(d.usage_7d).filter(([,v])=>v).map(([k,v])=>k+' '+v).join(' · ')||'none';
 put(box,$('div',{style:'font-size:18px;font-weight:700'},d.name||d.email),$('div',{cls:'muted'},d.email+(d.sign_in?' · '+d.sign_in:'')),
  table(['',''],[['Accounts',[d.app_account&&'App',d.website_account&&'Website'].filter(Boolean).join(' + ')],['Joined',dt(d.joined)],['Sign-ins',n(d.sign_ins)],['Last app open',dt(d.last_app_open)],['App version',d.app_version||'—'],['Company',d.company?d.company+(d.role?' ('+d.role+')':''):'—'],['Routes / stops done',n(d.routes)+' / '+n(d.stops_done)],['API use 7d',us]]),
  tog('Free Pro','pro_comp',d.pro_comp,true,''),tog('Dispatch license','dispatch_license',!!d.dispatch_license,d.license_toggle,'Only for someone who owns a Dispatch company'),
  $('div',{cls:'tg'},d.app_account?act('Show tutorial again','tutorial'):null,' ',act('Sign out all devices','signout'),' ',d.sign_in&&d.sign_in.includes('Password')&&d.website_account?act('Send password reset email','reset-email'):null),
  $('b',{},'Audit log'),d.audit.length?d.audit.map(x=>$('div',{cls:'muted',style:'font-size:12px'},x.action+' · '+dt(x.created_at))):$('div',{cls:'muted',style:'font-size:12px'},'No admin actions yet'),
  $('div',{cls:'muted',style:'font-size:11px;margin-top:10px'},'Every toggle is written to admin_audit.'))}
const post=(p,b)=>api(p,{method:'POST',headers:{'Content-Type':'application/json','X-Admin':'1'},body:JSON.stringify(b)});
async function admins(){crumb('Admins');const j=await api('/api/admins');
 const q=$('input',{type:'email',placeholder:'name@example.com',maxlength:'254',required:'required'}),msg=$('p',{cls:'muted'},j.invites_on?'They get a link that works once and expires in 7 days.':'Invites are off until the Access API token and email sending are set up.');
 const f=$('form',{style:'display:flex;gap:8px',on:{submit:async(e)=>{e.preventDefault();try{await post('/api/admins/invite',{email:q.value});admins()}catch(x){msg.textContent='Failed: '+x.message}}}},q,$('button',{cls:'btn'},'Send invite'));
 if(!j.invites_on)[...f.elements].forEach(x=>x.disabled=true);
 const btn=(l,fn)=>$('button',{cls:'btn o',on:{click:async(e)=>{if(!confirm(l+'?'))return;e.target.disabled=true;try{await fn();admins()}catch(x){alert('Failed: '+x.message);e.target.disabled=false}}}},l);
 put(M,$('h1',{},'Admins'),$('div',{cls:'sub'},'Who can open Cajun App Factory Admin. Admins can do everything except manage admins.'),
  $('div',{cls:'card'},$('b',{},'Invite by email'),msg,f),
  $('div',{cls:'card'},$('b',{},'Pending invites'),j.invites.length?table(['Email','Sent','',''],j.invites.map(i=>[i.email,dt(i.created_at),i.expired?'Expired':'Expires '+dt(i.expires_at),j.invites_on?btn('Revoke',()=>post('/api/admins/revoke',{id:i.id})):''])):$('p',{cls:'muted'},'None')),
  $('div',{cls:'card'},$('b',{},'Devices (fingerprint unlock)'),j.devices.length?table(['Admin','Device','Added','Last unlock',''],j.devices.map(d=>[d.email,d.label||'Phone',dt(d.created_at),d.last_used_at?dt(d.last_used_at):'Never',btn('Revoke device',()=>post('/api/admins/device-revoke',{id:d.id}))])):$('p',{cls:'muted'},'No phones enrolled yet.')),
  $('div',{cls:'card'},$('b',{},'Admins'),table(['Email','Role',''],[[j.owner,'Owner','']].concat(j.admins.map(a=>[a.email,'Admin',j.invites_on?btn('Remove',()=>post('/api/admins/remove',{email:a.email})):''])))))}
route();`;
export const PAGE = { html, css, js };
