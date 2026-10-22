// FlowForge API smoke test: auth, tenant isolation, branching, retries/timeouts, cancel,
// cycles, schedules, versions, credentials (never leaked) and SSRF.
// Run with the API up:  npm run test:api      (override target: API=http://host:4000)
const ROOT=process.env.API||'http://localhost:4000'; const B=ROOT+'/api'; let pass=0, fail=0;
const ok=(n,c,x='')=>{c?pass++:fail++;console.log(c?'PASS':'FAIL',n,c?'':x)};
const call=async(path,tok,method='GET',body)=>{const r=await fetch(B+path,{method,headers:{'content-type':'application/json',...(tok?{authorization:'Bearer '+tok}:{})},body:body?JSON.stringify(body):undefined});let j={};try{j=await r.json()}catch{};return {s:r.status,...j}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const reg=async()=>{const r=await call('/auth/register',null,'POST',{email:`t${Date.now()}${Math.random().toString(36).slice(2,6)}@x.com`,password:'secret1'});return r.token};
const N=(id,type,label,config,extra={})=>({id,type,label,position:{x:0,y:0},config,...extra});
const E=(id,s,t,h)=>({id,source:s,target:t,sourceHandle:h??null});
const mk=(tok,name,nodes,edges)=>call('/workflows',tok,'POST',{name,graph:{nodes,edges}});
const waitRun=async(tok,id,ms=20000)=>{const t=Date.now();while(Date.now()-t<ms){const r=await call('/runs/'+id,tok);if(['success','failed','cancelled'].includes(r.run.status))return r.run;await sleep(250)}return (await call('/runs/'+id,tok)).run};
const T=N('t','trigger','Start',{});
const U=ROOT;

const A=await reg(), Bt=await reg();
ok('register returns token',!!A&&!!Bt);
ok('no-auth rejected',(await call('/workflows')).s===401);
ok('bad login rejected',(await call('/auth/login',null,'POST',{email:'nobody@x.com',password:'wrongpass'})).s===401);

// cancel mid-run
let w2; let w=await mk(A,'cancel',[T,N('s1','http','Slow1',{method:'GET',url:U+'/mock/slow?ms=2500'}),N('s2','http','Slow2',{method:'GET',url:U+'/mock/slow?ms=100'})],[E('e1','t','s1'),E('e2','s1','s2')]);
let r=await call('/runs/workflow/'+w.workflow.id,A,'POST',{});
await sleep(800); await call(`/runs/${r.run.id}/cancel`,A,'POST');
let fin=await waitRun(A,r.run.id,6000); await sleep(3500);
fin=(await call('/runs/'+r.run.id,A)).run;
ok('cancel: run stays cancelled',fin.status==='cancelled',fin.status);
ok('cancel: step after cancel not executed',!fin.node_state?.s2,JSON.stringify(fin.node_state?.s2));

// timeout
w=await mk(A,'timeout',[T,N('s','http','Too slow',{method:'GET',url:U+'/mock/slow?ms=5000'},{timeoutMs:500,retry:{maxAttempts:2,backoffMs:50}})],[E('e1','t','s')]);
r=await call('/runs/workflow/'+w.workflow.id,A,'POST',{}); fin=await waitRun(A,r.run.id);
ok('timeout: run failed',fin.status==='failed',fin.status);
ok('timeout: error mentions timeout',/time/i.test(fin.node_state?.s?.error||''),fin.node_state?.s?.error);
ok('timeout: retried (2 attempts)',fin.node_state?.s?.attempts===2,fin.node_state?.s?.attempts);

// cycle + validation
w=await mk(A,'cycle',[T,N('a','transform','A',{mapping:{x:'1'}}),N('b','transform','B',{mapping:{x:'1'}})],[E('e1','t','a'),E('e2','a','b'),E('e3','b','a')]);
const v=await call(`/workflows/${w.workflow.id}/validate`,A,'POST',{});
ok('cycle detected',JSON.stringify(v).toLowerCase().includes('cycle'),JSON.stringify(v).slice(0,200));
r=await call('/runs/workflow/'+w.workflow.id,A,'POST',{});
ok('cycle: run refused (400)',r.s===400,r.s);

// condition with template both sides + branch + skip
w=await mk(A,'cond',[T,N('u','http','User',{method:'GET',url:U+'/mock/users/3'}),
  N('c','condition','Pro?',{left:'{{steps.u.output.body.tier}}',operator:'==',right:'pro'}),
  N('y','transform','Yes',{mapping:{r:'yes'}}),N('n','transform','No',{mapping:{r:'no'}})],
  [E('e1','t','u'),E('e2','u','c'),E('e3','c','y','true'),E('e4','c','n','false')]);
r=await call('/runs/workflow/'+w.workflow.id,A,'POST',{}); fin=await waitRun(A,r.run.id);
ok('condition: run success',fin.status==='success',fin.error);
ok('condition: true branch ran, false skipped',fin.node_state?.y?.status==='success'&&fin.node_state?.n?.status==='skipped',JSON.stringify(fin.node_state));

// tenant isolation
ok('isolation: B cannot read A workflow',(await call('/workflows/'+w.workflow.id,Bt)).s===404);
ok('isolation: B cannot read A run',(await call('/runs/'+r.run.id,Bt)).s===404);
ok('isolation: B cannot run A workflow',(await call('/runs/workflow/'+w.workflow.id,Bt,'POST',{})).s===404);
ok('isolation: B cannot cancel A run',(await call(`/runs/${r.run.id}/cancel`,Bt,'POST')).s===404);
ok('isolation: B cannot list A schedules',((await call('/schedules/workflow/'+w.workflow.id,Bt)).schedules||[]).length===0);

// schedules: invalid + valid + delete workflow cleans up
let sc=await call('/schedules/workflow/'+w.workflow.id,A,'POST',{cron:'not a cron'});
ok('schedule: invalid cron -> 400',sc.s===400,sc.s);
sc=await call('/schedules/workflow/'+w.workflow.id,A,'POST',{cron:'*/5 * * * *'});
ok('schedule: valid cron created',sc.s===200,JSON.stringify(sc));
const del=await call('/workflows/'+w.workflow.id,A,'DELETE');
ok('delete workflow ok',del.s===200||del.s===204,del.s);
ok('deleted workflow gone',(await call('/workflows/'+w.workflow.id,A)).s===404);

// versions: save -> edit -> restore
w=await mk(A,'ver',[T,N('x','transform','X',{mapping:{v:'one'}})],[E('e1','t','x')]);
const id=w.workflow.id;
await call('/workflows/'+id,A,'PUT',{name:'ver',graph:{nodes:[T,N('x','transform','X',{mapping:{v:'one'}})],edges:[E('e1','t','x')]},newVersion:true,note:'v-one'});
await call('/workflows/'+id,A,'PUT',{name:'ver',graph:{nodes:[T,N('x','transform','X',{mapping:{v:'two'}}),N('y','transform','Y',{mapping:{v:'2'}})],edges:[E('e1','t','x'),E('e2','x','y')]},newVersion:true,note:'v-two'});
const vs=await call(`/workflows/${id}/versions`,A);
ok('versions listed (>=2)',(vs.versions||[]).length>=2,JSON.stringify(vs).slice(0,200));
const first=Math.min(...vs.versions.map(x=>x.version));
const rs=await call(`/workflows/${id}/versions/${first}/restore`,A,'POST');
ok('restore ok',rs.s===200,JSON.stringify(rs).slice(0,200));
const cur=await call('/workflows/'+id,A);
ok('restore: graph reverted to earlier snapshot',cur.workflow.graph.nodes.length===2,cur.workflow.graph.nodes.length);

// credentials: encrypted, injected, never returned
const cr=await call('/credentials',A,'POST',{name:'k',type:'bearer',data:{token:'TOPSECRET-XYZ'}});
ok('credential created',cr.s===200||cr.s===201,JSON.stringify(cr));
ok('credential list hides secret',!JSON.stringify(await call('/credentials',A)).includes('TOPSECRET-XYZ'));
w=await mk(A,'echo-auth',[T,N('h','http','H',{method:'GET',url:U+'/mock/users/1',credentialId:cr.credential?.id})],[E('e1','t','h')]);
r=await call('/runs/workflow/'+w.workflow.id,A,'POST',{}); fin=await waitRun(A,r.run.id);
ok('credentialed run succeeds',fin.status==='success',fin.error);
const logs=JSON.stringify((await call(`/runs/${r.run.id}/logs`,A)).logs||[]);
ok('secret never appears in logs or run',!logs.includes('TOPSECRET-XYZ')&&!JSON.stringify(fin).includes('TOPSECRET-XYZ'));


// ---------- Webhook trigger ----------
const hook=async(token,body,ct='application/json',method='POST')=>{const r=await fetch(ROOT+'/hooks/'+token,{method,headers:ct?{'content-type':ct}:{},body:body===undefined?undefined:(ct==='application/json'?JSON.stringify(body):body)});let j={};try{j=await r.json()}catch{};return {s:r.status,...j}};
w=await mk(A,'webhook',[T,N('echo','transform','Echo',{mapping:{amt:'{{input.amount}}',who:'{{input.customer}}'}})],[E('e1','t','echo')]);
let wh=await call(`/workflows/${w.workflow.id}/webhook`,A);
ok('webhook: token issued',typeof wh.token==='string'&&wh.token.length>=24,JSON.stringify(wh));
ok('webhook: token is stable',(await call(`/workflows/${w.workflow.id}/webhook`,A)).token===wh.token);
ok('webhook: other user cannot read token',(await call(`/workflows/${w.workflow.id}/webhook`,Bt)).s===404);
let hr=await hook(wh.token,{amount:150,customer:'Acme'});
ok('webhook: accepted (202)',hr.s===202&&!!hr.runId,JSON.stringify(hr));
fin=await waitRun(A,hr.runId);
ok('webhook: run succeeded with body as input',fin.status==='success'&&fin.node_state?.echo?.output?.amt===150&&fin.node_state.echo.output.who==='Acme',JSON.stringify(fin.node_state?.echo));
ok('webhook: unknown token 404',(await hook('not-a-real-token-123456789012',{})).s===404);
ok('webhook: form-encoded body works',(await hook(wh.token,'amount=7&customer=Zed','application/x-www-form-urlencoded')).s===202);
ok('webhook: empty body works',(await hook(wh.token,undefined,null)).s===202);
ok('webhook: GET works',(await hook(wh.token,undefined,null,'GET')).s===202);
const rot=await call(`/workflows/${w.workflow.id}/webhook/rotate`,A,'POST');
ok('webhook: rotate gives new token',rot.token&&rot.token!==wh.token);
ok('webhook: old token dead after rotate',(await hook(wh.token,{})).s===404);
ok('webhook: new token works',(await hook(rot.token,{amount:1})).s===202);
const bad=await mk(A,'webhook-invalid',[T,N('c','condition','C',{})],[E('e1','t','c')]);
const badTok=(await call(`/workflows/${bad.workflow.id}/webhook`,A)).token;
ok('webhook: invalid workflow refused (422)',(await hook(badTok,{})).s===422);

// ---------- Watch for change ----------
const ch='w'+Date.now();
const publish=()=>fetch(`${ROOT}/mock/latest-video/publish?channel=${ch}`,{method:'POST'});
w=await mk(A,'watch',[T,N('f','http','Fetch',{method:'GET',url:`${U}/mock/latest-video`,query:{channel:ch}}),
  N('wt','watch','New?',{value:'{{steps.f.output.body.id}}'}),
  N('yes','transform','Yes',{mapping:{t:'{{steps.f.output.body.title}}'}}),N('no','transform','No',{mapping:{n:'same'}})],
  [E('e1','t','f'),E('e2','f','wt'),E('e3','wt','yes','true'),E('e4','wt','no','false')]);
const runW=async()=>{const rr=await call('/runs/workflow/'+w.workflow.id,A,'POST',{});return waitRun(A,rr.run.id)};
let f1=await runW();
ok('watch: first run saves baseline, does not fire',f1.status==='success'&&f1.node_state.wt.output.first===true&&f1.node_state.wt.output.changed===false&&f1.node_state.yes?.status==='skipped'&&f1.node_state.no?.status==='success',JSON.stringify(f1.node_state.wt));
let f2=await runW();
ok('watch: unchanged value takes false branch',f2.node_state.wt.output.changed===false&&f2.node_state.wt.output.first===false&&f2.node_state.no?.status==='success');
await publish();
let f3=await runW();
ok('watch: new value fires true branch',f3.node_state.wt.output.changed===true&&f3.node_state.yes?.status==='success'&&f3.node_state.no?.status==='skipped'&&f3.node_state.wt.output.previous==='vid1'&&f3.node_state.wt.output.current==='vid2',JSON.stringify(f3.node_state.wt));
let f4=await runW();
ok('watch: fires only once per change',f4.node_state.wt.output.changed===false);
const wnodeBad=await call(`/workflows/${w.workflow.id}/validate`,A,'POST',{graph:{nodes:[T,N('wt','watch','W',{value:''})],edges:[E('e1','t','wt')]}});
ok('watch: empty value flagged by validation',JSON.stringify(wnodeBad).includes('wt'),JSON.stringify(wnodeBad).slice(0,200));
w=await mk(A,'watch-first',[T,N('wt','watch','W',{value:'x{{input.n}}',fireOnFirstRun:true}),N('y','transform','Y',{mapping:{a:'1'}})],[E('e1','t','wt'),E('e2','wt','y','true')]);
r=await call('/runs/workflow/'+w.workflow.id,A,'POST',{input:{n:1}}); fin=await waitRun(A,r.run.id);
ok('watch: fireOnFirstRun fires on first check',fin.node_state.wt.output.changed===true&&fin.node_state.y.status==='success');
// watch state isolated between workflows
w2=await mk(A,'watch-iso',[T,N('wt','watch','W',{value:'x{{input.n}}'})],[E('e1','t','wt')]);
r=await call('/runs/workflow/'+w2.workflow.id,A,'POST',{input:{n:1}}); fin=await waitRun(A,r.run.id);
ok('watch: state is per-workflow (fresh baseline)',fin.node_state.wt.output.first===true);

// ---------- OAuth2 refresh-token credential ----------
const oc=await call('/credentials',A,'POST',{name:'oauth-mock',type:'oauth2',data:{token_url:U+'/mock/oauth/token?rotate=1',client_id:'mock-client',client_secret:'SHHH-CLIENT-SECRET',refresh_token:'rt-'+Date.now()}});
ok('oauth: credential created, no secrets echoed',oc.s===200&&!JSON.stringify(oc).includes('SHHH')&&!JSON.stringify(oc).includes('rt-'),JSON.stringify(oc));
w=await mk(A,'oauth',[T,N('c1','http','Cal',{method:'POST',url:U+'/mock/calendar/events',body:{summary:'x',conferenceData:{createRequest:{}}},bodyType:'json',credentialId:oc.credential.id}),
  N('c2','http','Cal2',{method:'POST',url:U+'/mock/calendar/events',body:{summary:'y'},bodyType:'json',credentialId:oc.credential.id})],[E('e1','t','c1'),E('e2','c1','c2')]);
r=await call('/runs/workflow/'+w.workflow.id,A,'POST',{}); fin=await waitRun(A,r.run.id);
ok('oauth: refresh token exchanged, API call authorised',fin.status==='success'&&/meet\.google\.com/.test(JSON.stringify(fin.node_state.c1.output)),JSON.stringify(fin.node_state.c1||fin.node_state));
const oLogs=JSON.stringify((await call(`/runs/${r.run.id}/logs`,A)).logs);
ok('oauth: secrets/tokens not in logs or run record',!oLogs.includes('SHHH')&&!oLogs.includes('rt-')&&!JSON.stringify(fin).includes('SHHH')&&!JSON.stringify(fin).includes('at-17'));
// rotated refresh token persisted -> second run must still work (provider only rotates 'good-refresh' once, 'good-refresh-2' is also accepted)
r=await call('/runs/workflow/'+w.workflow.id,A,'POST',{}); fin=await waitRun(A,r.run.id);
ok('oauth: works again on the next run (rotated token stored)',fin.status==='success',JSON.stringify(fin.node_state?.c1?.error));
const badOc=await call('/credentials',A,'POST',{name:'oauth-bad',type:'oauth2',data:{token_url:U+'/mock/oauth/token',client_id:'mock-client',refresh_token:'revoked'}});
w=await mk(A,'oauth-bad',[T,N('c','http','Cal',{method:'POST',url:U+'/mock/calendar/events',body:{},bodyType:'json',credentialId:badOc.credential.id})],[E('e1','t','c')]);
r=await call('/runs/workflow/'+w.workflow.id,A,'POST',{}); fin=await waitRun(A,r.run.id);
ok('oauth: revoked token -> clear failure, no secret leak',fin.status==='failed'&&/refresh failed/i.test(fin.node_state.c.error)&&!JSON.stringify(fin).includes('revoked'),fin.node_state?.c?.error);
const oMissing=await call('/credentials',A,'POST',{name:'oauth-missing',type:'oauth2',data:{client_id:'x'}});
w=await mk(A,'oauth-missing',[T,N('c','http','Cal',{method:'GET',url:U+'/mock/protected',credentialId:oMissing.credential.id})],[E('e1','t','c')]);
r=await call('/runs/workflow/'+w.workflow.id,A,'POST',{}); fin=await waitRun(A,r.run.id);
ok('oauth: missing fields -> clear error',fin.status==='failed'&&/missing/i.test(fin.node_state.c.error),fin.node_state?.c?.error);
// tenant isolation: B cannot use A's credential id
w=await mk(Bt,'steal',[T,N('c','http','C',{method:'GET',url:U+'/mock/protected',credentialId:oc.credential.id})],[E('e1','t','c')]);
r=await call('/runs/workflow/'+w.workflow.id,Bt,'POST',{}); fin=await waitRun(Bt,r.run.id);
ok("credentials: another user's credential id is rejected",fin.status==='failed'&&/credential/i.test(fin.node_state.c.error||''),JSON.stringify(fin.node_state?.c));

// ---------- {{now.*}} clock ----------
w=await mk(A,'now',[T,N('x','transform','X',{mapping:{a:'{{now.iso}}',b:'{{now.in30min}}',d:'{{now.date}}'}})],[E('e1','t','x')]);
r=await call('/runs/workflow/'+w.workflow.id,A,'POST',{}); fin=await waitRun(A,r.run.id);
const nv=fin.node_state.x.output; const dt=Date.parse(nv.b)-Date.parse(nv.a);
ok('now: iso + in30min work',dt===30*60000&&nv.d===nv.a.slice(0,10),JSON.stringify(nv));

// ---------- Schedules: time zones + one-time ----------
w=await mk(A,'sched',[T,N('x','transform','X',{mapping:{a:'1'}})],[E('e1','t','x')]);
const sp=`/schedules/workflow/${w.workflow.id}`;
ok('schedule: cron with time zone accepted',(await call(sp,A,'POST',{cron:'0 9 * * *',tz:'Asia/Kolkata'})).s===200);
ok('schedule: bad time zone rejected',(await call(sp,A,'POST',{cron:'0 9 * * *',tz:'Mars/Base'})).s===400);
ok('schedule: bad cron rejected',(await call(sp,A,'POST',{cron:'nope',tz:'UTC'})).s===400);
ok('schedule: cron + runAt together rejected',(await call(sp,A,'POST',{cron:'* * * * *',runAt:new Date(Date.now()+60000).toISOString()})).s===400);
ok('schedule: neither rejected',(await call(sp,A,'POST',{})).s===400);
ok('schedule: past time rejected',(await call(sp,A,'POST',{runAt:new Date(Date.now()-60000).toISOString()})).s===400);
ok('schedule: garbage date rejected',(await call(sp,A,'POST',{runAt:'tomorrow-ish'})).s===400);
ok("schedule: other user can't schedule my workflow",(await call(sp,Bt,'POST',{cron:'* * * * *'})).s===404);
const once=await call(sp,A,'POST',{runAt:new Date(Date.now()+7000).toISOString(),tz:'Asia/Kolkata'});
ok('schedule: one-time accepted',once.s===200,JSON.stringify(once));
let runsBefore=(await call('/runs?workflowId='+w.workflow.id,A)).runs.length;
await sleep(11000);
let runsAfter=(await call('/runs?workflowId='+w.workflow.id,A)).runs;
ok('schedule: one-time fires at the chosen moment (exactly once)',runsAfter.length===runsBefore+1,`before=${runsBefore} after=${runsAfter.length}`);
const listed=(await call(sp,A)).schedules.find(x=>x.id===once.schedule?.id||x.id===once.id);
ok('schedule: one-time marked as ran',listed&&!!listed.fired_at&&listed.enabled===false,JSON.stringify(listed));
await sleep(3000);
ok('schedule: one-time never fires twice',(await call('/runs?workflowId='+w.workflow.id,A)).runs.length===runsBefore+1);


// ---------- Watch: concurrency + re-baselining + webhook flood cap ----------
{
  const ch2='c'+Date.now();
  const wc=await mk(A,'watch-race',[T,N('f','http','F',{method:'GET',url:`${U}/mock/latest-video`,query:{channel:ch2}}),N('wt','watch','W',{value:'{{steps.f.output.body.id}}'}),N('y','transform','Y',{mapping:{a:'1'}})],[E('e1','t','f'),E('e2','f','wt'),E('e3','wt','y','true')]);
  const one1=async()=>{const rr=await call('/runs/workflow/'+wc.workflow.id,A,'POST',{});return waitRun(A,rr.run.id)};
  await one1(); // baseline
  await fetch(`${ROOT}/mock/latest-video/publish?channel=${ch2}`,{method:'POST'});
  const rs=await Promise.all([1,2,3,4,5,6].map(()=>one1()));
  const fired=rs.filter(x=>x.node_state?.wt?.output?.changed===true).length;
  ok('watch: 6 simultaneous runs, one change -> fires exactly once',fired===1,`fired=${fired}`);
  // edit what is watched -> fresh baseline, no false "changed"
  const g=(await call('/workflows/'+wc.workflow.id,A)).workflow.graph;
  g.nodes=g.nodes.map(n=>n.id==='f'?{...n,config:{...n.config,query:{channel:ch2+'-other'}}}:n);
  await call('/workflows/'+wc.workflow.id,A,'PUT',{graph:g}); // value template unchanged, so same baseline key
  const g2=JSON.parse(JSON.stringify(g)); g2.nodes=g2.nodes.map(n=>n.id==='wt'?{...n,config:{...n.config,value:'{{steps.f.output.body.title}}'}}:n);
  await call('/workflows/'+wc.workflow.id,A,'PUT',{graph:g2});
  const after=await one1();
  ok('watch: changing the watched expression re-baselines (no false fire)',after.node_state.wt.output.first===true&&after.node_state.wt.output.changed===false,JSON.stringify(after.node_state.wt.output));
  // per-URL flood cap
  const fw=await mk(A,'flood',[T,N('x','transform','X',{mapping:{a:'1'}})],[E('e1','t','x')]);
  const ft=(await call(`/workflows/${fw.workflow.id}/webhook`,A)).token;
  const codes=[]; for(let i=0;i<64;i++) codes.push((await hook(ft,{i})).s);
  ok('webhook: flood is rate limited per URL (429 after 60)',codes.filter(c=>c===202).length===60&&codes.includes(429),`202s=${codes.filter(c=>c===202).length} 429s=${codes.filter(c=>c===429).length}`);
}


// ---------- Real-service templates: placeholders, settings node, key redaction ----------
{
  const ytGraph=(pl,key)=>({nodes:[T,N('settings','transform','Settings',{mapping:{playlistId:pl,youtubeApiKey:key,discordUrl:U+'/mock/notify'}}),
    N('fetch','http','Latest video',{method:'GET',url:U+'/mock/youtube/playlistItems',query:{part:'snippet',maxResults:'1',playlistId:'{{steps.settings.output.playlistId}}',key:'{{steps.settings.output.youtubeApiKey}}'}}),
    N('watch','watch','New video?',{value:'{{steps.fetch.output.body.items.0.snippet.resourceId.videoId}}',fireOnFirstRun:true}),
    N('post','http','Post',{method:'POST',url:'{{steps.settings.output.discordUrl}}',bodyType:'json',body:{content:'New video: {{steps.fetch.output.body.items.0.snippet.title}} https://youtu.be/{{steps.fetch.output.body.items.0.snippet.resourceId.videoId}}'}}),
    N('idle','transform','Idle',{mapping:{n:'none'}})],
    edges:[E('e1','t','settings'),E('e2','settings','fetch'),E('e3','fetch','watch'),E('e4','watch','post','true'),E('e5','watch','idle','false')]});
  const pl='UU'+Date.now();
  const unfilled=await call('/workflows',A,'POST',{name:'tpl-unfilled',graph:ytGraph('PASTE_UPLOADS_PLAYLIST_ID','PASTE_YOUTUBE_API_KEY')});
  const rUn=await call('/runs/workflow/'+unfilled.workflow.id,A,'POST',{});
  ok('template: unfilled PASTE_ placeholders block the run (400)',rUn.s===400,JSON.stringify(rUn).slice(0,200));
  const vUn=await call(`/workflows/${unfilled.workflow.id}/validate`,A,'POST',{});
  ok('template: validation names the placeholder',/PASTE_UPLOADS_PLAYLIST_ID/.test(JSON.stringify(vUn)),JSON.stringify(vUn).slice(0,200));
  const hookTok=(await call(`/workflows/${unfilled.workflow.id}/webhook`,A)).token;
  ok('template: webhook also refuses an unfilled workflow (422)',(await hook(hookTok,{})).s===422);
  const filled=await call('/workflows',A,'POST',{name:'tpl-filled',graph:ytGraph(pl,'AIzaSECRETKEY123')});
  const runF=async()=>{const rr=await call('/runs/workflow/'+filled.workflow.id,A,'POST',{});return waitRun(A,rr.run.id)};
  let y1=await runF();
  ok('template: filled settings -> first check posts latest video',y1.status==='success'&&y1.node_state.post?.status==='success'&&y1.node_state.watch.output.current==='vid1',JSON.stringify(y1.node_state?.post||y1.node_state?.fetch));
  const yl=JSON.stringify((await call(`/runs/${y1.id}/logs`,A)).logs);
  ok('template: API key hidden in run logs',yl.includes('key=***')&&!yl.includes('AIzaSECRETKEY123'),yl.slice(0,300));
  let y2=await runF();
  ok('template: second check does not repost',y2.node_state.watch.output.changed===false&&y2.node_state.idle?.status==='success');
  await fetch(`${ROOT}/mock/latest-video/publish?channel=${pl}`,{method:'POST'});
  // the mock's YouTube endpoint reads the same per-playlist counter
  let y3=await runF();
  ok('template: new upload is detected and posted once',y3.node_state.watch.output.changed===true&&y3.node_state.post?.status==='success'&&y3.node_state.watch.output.current==='vid2',JSON.stringify(y3.node_state.watch?.output));
}


// ---------- Simple body modes, mentions, "test this step", schedule behaviour ----------
{
  const echoOf=async(cfg)=>{const ww=await mk(A,'body-'+Date.now()+Math.random(),[T,N('p','http','P',{method:'POST',url:U+'/mock/notify',...cfg})],[E('e1','t','p')]);
    const rr=await call('/runs/workflow/'+ww.workflow.id,A,'POST',{input:{name:'Asha'}}); const f=await waitRun(A,rr.run.id); return f.node_state?.p?.output?.body?.echo};
  const d=await echoOf({bodyMode:'message',messageFormat:'discord',message:'@everyone hello {{input.name}} <@123456>'});
  ok('message mode (Discord): writes {content}, keeps @everyone and <@id>, fills {{input.name}}',d?.content==='@everyone hello Asha <@123456>'&&Array.isArray(d?.allowed_mentions?.parse),JSON.stringify(d));
  const sl=await echoOf({bodyMode:'message',messageFormat:'slack',message:'@channel deploy done, cc <@U123ABC> and @here'});
  ok('message mode (Slack): @channel/@here become <!channel>/<!here>, <@U..> kept',sl?.text==='<!channel> deploy done, cc <@U123ABC> and <!here>',JSON.stringify(sl));
  const xx=await echoOf({bodyMode:'message',messageFormat:'x',message:'Hi @someone from FlowForge'});
  ok('message mode (X): writes {text} and keeps @handle',xx?.text==='Hi @someone from FlowForge'&&Object.keys(xx).length===1,JSON.stringify(xx));
  const ff=await echoOf({bodyMode:'fields',fields:{user:'{{input.name}}',plan:'pro'}});
  ok('fields mode: key/value rows become a JSON object',ff?.user==='Asha'&&ff?.plan==='pro',JSON.stringify(ff));
  const long=await echoOf({bodyMode:'message',messageFormat:'discord',message:'x'.repeat(2500)});
  ok('message mode (Discord): over-long text trimmed to 2000',long?.content?.length===2000);
  const emptyMsg=await mk(A,'empty-msg',[T,N('p','http','P',{method:'POST',url:U+'/mock/notify',bodyMode:'message',messageFormat:'discord',message:''})],[E('e1','t','p')]);
  ok('message mode: empty message blocks the run',(await call('/runs/workflow/'+emptyMsg.workflow.id,A,'POST',{})).s===400);

  // test this step
  const tw=await mk(A,'testnode',[T,N('u','http','U',{method:'GET',url:U+'/mock/users/1'}),N('n','http','N',{method:'POST',url:U+'/mock/notify',bodyMode:'message',messageFormat:'other',message:'hi {{steps.u.output.body.name}}'})],[E('e1','t','u'),E('e2','u','n')]);
  const tn=(node,id=tw.workflow.id,tok=A)=>call(`/workflows/${id}/test-node`,tok,'POST',{node});
  let t1=await tn({id:'u',type:'http',label:'U',config:{method:'GET',url:U+'/mock/users/2'}});
  ok('test step: runs one http step and returns the response',t1.ok===true&&t1.output?.body?.id===2&&t1.output?.status===200,JSON.stringify(t1).slice(0,200));
  let t2=await tn({id:'n',type:'http',label:'N',config:{method:'POST',url:U+'/mock/notify',bodyMode:'message',messageFormat:'other',message:'hi {{steps.u.output.body.name}}'}});
  ok('test step: warns that earlier-step data is missing before any run',t2.ok===true&&(t2.unresolved||[]).includes('steps.u.output.body.name'),JSON.stringify(t2.unresolved));
  const rr0=await call('/runs/workflow/'+tw.workflow.id,A,'POST',{}); await waitRun(A,rr0.run.id);
  let t3=await tn({id:'n',type:'http',label:'N',config:{method:'POST',url:U+'/mock/notify',bodyMode:'message',messageFormat:'other',message:'hi {{steps.u.output.body.name}}'}});
  ok('test step: after one run it uses real earlier data',t3.ok===true&&t3.output?.body?.echo?.message==='hi User 1'&&(t3.unresolved||[]).length===0,JSON.stringify(t3).slice(0,250));
  let t4=await tn({id:'x',type:'http',label:'X',config:{method:'GET',url:'http://169.254.169.254/latest/'}});
  ok('test step: SSRF guard applies to tests too',t4.ok===false&&/block|private|not allowed|forbid/i.test(t4.error||''),JSON.stringify(t4).slice(0,200));
  let t5=await tn({id:'f',type:'http',label:'F',config:{method:'GET',url:U+'/mock/always-fail'}});
  ok('test step: failure reports the error and the response',t5.ok===false&&/500|fail/i.test(t5.error||''),JSON.stringify(t5).slice(0,200));
  let t6=await tn({id:'w',type:'watch',label:'W',config:{value:'x'}});
  ok('test step: watch/delay refused with an explanation',t6.ok===false&&/Press Run/.test(t6.error||''));
  ok("test step: other user can't test my workflow",(await tn({id:'u',type:'http',config:{method:'GET',url:U+'/mock/users/1'}},tw.workflow.id,Bt)).s===404);

  // schedules: creating one must NOT run anything right away; list shows next run
  const sw=await mk(A,'sched-quiet',[T,N('x','transform','X',{mapping:{a:'1'}})],[E('e1','t','x')]);
  const before=(await call('/runs?workflowId='+sw.workflow.id,A)).runs.length;
  const cs=await call(`/schedules/workflow/${sw.workflow.id}`,A,'POST',{cron:'0 3 1 1 *',tz:'Asia/Kolkata'});
  const cs2=await call(`/schedules/workflow/${sw.workflow.id}`,A,'POST',{runAt:new Date(Date.now()+3600e3).toISOString(),tz:'Asia/Kolkata'});
  await sleep(4000);
  ok('schedule: creating schedules does not trigger a run',(await call('/runs?workflowId='+sw.workflow.id,A)).runs.length===before);
  const lst=(await call(`/schedules/workflow/${sw.workflow.id}`,A)).schedules;
  const cron1=lst.find(x=>x.cron), once1=lst.find(x=>x.run_at);
  ok('schedule: list includes next run time (cron + one-time)',typeof cron1?.next_at==='number'&&cron1.next_at>Date.now()&&typeof once1?.next_at==='number',JSON.stringify(lst).slice(0,300));
  ok('schedule: cron next run is 03:00 IST on 1 Jan (21:30 UTC the day before)',new Date(cron1.next_at).getUTCHours()===21&&new Date(cron1.next_at).getUTCMinutes()===30,new Date(cron1.next_at).toISOString());
}

// --- UX hardening: cron fields, schedule caps, empty-variable warning, malformed ids
{
  const t=await reg(); const w=(await mk(t,'ux',[T,N('m','http','msg',{method:'POST',url:U+'/mock/notify',bodyMode:'message',messageFormat:'other',message:'Hi {{steps.nothing.output.name}} done'})],[E('e','t','m')])).workflow;
  const six=await call('/schedules/workflow/'+w.id,t,'POST',{cron:'* * * * * *',tz:'UTC'});
  ok('schedule: 6-field (every second) cron refused',six.s===400&&/5 fields/.test(six.error||''),JSON.stringify(six));
  const sp=await call('/schedules/workflow/'+w.id,t,'POST',{cron:'  */5   *  * * * ',tz:'UTC'});
  ok('schedule: extra spaces in a 5-field cron are fine',sp.s===200,JSON.stringify(sp));
  let last=200, made=1; for(let i=0;i<12&&last===200;i++){const r=await call('/schedules/workflow/'+w.id,t,'POST',{cron:'0 * * * *',tz:'UTC'});last=r.s;if(r.s===200)made++;}
  ok('schedule: capped at 10 per workflow',last===400&&made===10,`made=${made} last=${last}`);
  const run=(await call('/runs/workflow/'+w.id,t,'POST',{input:{}})).run; const done=await waitRun(t,run.id);
  const lg=(await call('/runs/'+run.id+'/logs',t)).logs||[];
  ok('run with an empty {{variable}} succeeds but warns',done.status==='success'&&lg.some(l=>l.level==='warn'&&/steps\.nothing\.output\.name/.test(l.message)),JSON.stringify(lg.map(l=>l.message)).slice(0,300));
  const bad=await call('/workflows/not-a-uuid',t);
  ok('malformed workflow id -> 404 (not 500)',bad.s===404,bad.s);
  const bad2=await call('/runs/not-a-uuid',t);
  ok('malformed run id -> 404 (not 500)',bad2.s===404,bad2.s);
  const noUrl=await mk(t,'nourl',[T,N('h','http','no url',{method:'GET',url:''})],[E('e','t','h')]);
  const rr=await call('/runs/workflow/'+noUrl.workflow.id,t,'POST',{input:{}});
  ok('run refusal names the problem in plain words',rr.s===400&&/Can.t run yet:.*URL/.test(rr.error||''),JSON.stringify(rr));
}

// Rate limits (429): FlowForge waits (honouring Retry-After) and retries on its own, even with no retry settings
{
  const t=await reg(); const k='rl'+Date.now();
  const w1=(await mk(t,'rl-ok',[T,N('h','http','Limited API',{method:'GET',url:U+'/mock/rate-limited',query:{key:k,limitTimes:'2'}})],[E('e','t','h')])).workflow;
  const r1=(await call('/runs/workflow/'+w1.id,t,'POST',{input:{}})).run; const d1=await waitRun(t,r1.id);
  const n1=(await call('/runs/'+r1.id,t)).run?.node_states?.h||{};
  ok('429 twice -> run still succeeds by itself (auto wait + retry)',d1.status==='success',d1.status+' '+d1.error+' '+JSON.stringify(((await call('/runs/'+r1.id+'/logs',t)).logs||[]).map(l=>l.message)).slice(0,600));
  const w2=(await mk(t,'rl-fail',[T,N('h','http','Limited API',{method:'GET',url:U+'/mock/rate-limited',query:{key:k+'b',limitTimes:'9'}})],[E('e','t','h')])).workflow;
  const r2=(await call('/runs/workflow/'+w2.id,t,'POST',{input:{}})).run; const d2=await waitRun(t,r2.id,60000);
  const lg2=(await call('/runs/'+r2.id+'/logs',t)).logs||[];
  ok('endless 429 -> fails after the automatic tries, with a plain explanation',d2.status==='failed'&&lg2.some(l=>/limits how often/.test(l.message)),JSON.stringify(lg2.map(l=>l.message)).slice(-300));
}

// SSRF variants
for (const [name,url] of [['metadata','http://169.254.169.254/latest/'],['decimal ip','http://2130706433:4000/api/health'.replace('2130706433','2852039166')],['ipv6 loopback','http://[::1]:4000/api/health'],['file scheme','file:///etc/passwd']]) {
  w=await mk(A,'ssrf-'+name,[T,N('h','http','H',{method:'GET',url})],[E('e1','t','h')]);
  if(w.s>=400){ok('ssrf '+name+': rejected at save',true);continue}
  r=await call('/runs/workflow/'+w.workflow.id,A,'POST',{}); 
  if(r.s>=400){ok('ssrf '+name+': rejected before run',true);continue}
  fin=await waitRun(A,r.run.id); ok('ssrf '+name+': blocked at run',fin.status==='failed',fin.status);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
