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
let w=await mk(A,'cancel',[T,N('s1','http','Slow1',{method:'GET',url:U+'/mock/slow?ms=2500'}),N('s2','http','Slow2',{method:'GET',url:U+'/mock/slow?ms=100'})],[E('e1','t','s1'),E('e2','s1','s2')]);
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
