export function demoHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agent Fleet · Shared CloudFS Workspace</title>
<style>
:root{--ink:#0b0b0d;--paper:#f7f5ed;--card:#fff;--line:#d9d5c8;--green:#00e3aa;--blue:#3434ef;--muted:#68675f;--soft:#e7fbf5;--shadow:0 18px 50px rgba(11,11,13,.08)}
*{box-sizing:border-box} body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;min-height:100vh}
button{font:inherit}.topbar{height:70px;background:var(--ink);color:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 4vw}
.brand{display:flex;align-items:center;gap:12px;font-weight:800;letter-spacing:-.04em;font-size:22px}.brandmark{width:26px;height:26px;background:var(--green);clip-path:polygon(50% 0,100% 38%,82% 100%,18% 100%,0 38%)}
.live{display:flex;align-items:center;gap:8px;color:#cbc9c2;font-size:13px}.live i{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 12px var(--green)}
main{max-width:1440px;margin:auto;padding:34px 4vw 48px}.hero{display:flex;justify-content:space-between;gap:32px;align-items:flex-end;margin-bottom:28px}
.eyebrow{text-transform:uppercase;letter-spacing:.13em;color:var(--blue);font-size:12px;font-weight:800;margin-bottom:8px}.hero h1{font-size:clamp(32px,4vw,58px);line-height:.98;letter-spacing:-.055em;margin:0;max-width:760px}.hero h1 em{font-style:normal;color:var(--blue)}
.subtitle{color:var(--muted);max-width:660px;line-height:1.55;margin:15px 0 0;font-size:16px}.runbox{min-width:265px}.run{width:100%;border:0;border-radius:12px;background:var(--green);padding:15px 22px;font-weight:800;cursor:pointer;box-shadow:0 8px 22px rgba(0,227,170,.22);transition:.2s transform,.2s opacity}.run:hover{transform:translateY(-2px)}.run:disabled{opacity:.55;cursor:wait;transform:none}
.runmeta{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted);margin-top:10px;text-align:center;white-space:nowrap}
.shell{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(330px,.7fr);gap:20px}.panel{background:var(--card);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow);overflow:hidden}.panelhead{display:flex;align-items:center;justify-content:space-between;padding:17px 20px;border-bottom:1px solid var(--line)}.panelhead h2{font-size:15px;margin:0}.badge{font:700 11px ui-monospace,SFMono-Regular,Menlo,monospace;padding:5px 8px;border-radius:20px;background:#eee;color:var(--muted)}
.pipeline{padding:26px 22px 22px}.agents{display:grid;grid-template-columns:repeat(5,1fr);gap:13px;position:relative}.agents:before{content:"";position:absolute;left:7%;right:7%;top:29px;height:2px;background:var(--line)}
.agent{position:relative;border:1px solid var(--line);border-radius:14px;background:#fff;padding:15px 12px 13px;min-height:145px;transition:.35s;border-top:4px solid var(--line)}.agent.active{border-color:var(--blue);border-top-color:var(--blue);box-shadow:0 8px 25px rgba(52,52,239,.12);transform:translateY(-4px)}.agent.done{border-top-color:var(--green);background:linear-gradient(180deg,var(--soft),#fff 48%)}
.node{width:32px;height:32px;border-radius:50%;display:grid;place-items:center;background:var(--ink);color:#fff;font-weight:800;font-size:13px;margin-bottom:25px;position:relative;z-index:1}.active .node{background:var(--blue);animation:pulse 1.2s infinite}.done .node{background:var(--green);color:var(--ink)}
@keyframes pulse{50%{box-shadow:0 0 0 9px rgba(52,52,239,.12)}}.role{font-weight:800;font-size:14px;text-transform:capitalize}.action{color:var(--muted);font-size:12px;margin-top:5px;line-height:1.35}.state{display:inline-flex;margin-top:12px;font-size:10px;text-transform:uppercase;letter-spacing:.08em;font-weight:800;color:#999}.active .state{color:var(--blue)}.done .state{color:#008c69}
.progress{height:7px;background:#ece9df;border-radius:10px;margin:24px 0 8px;overflow:hidden}.progress span{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--green),var(--blue));transition:width .45s}.progresslabel{display:flex;justify-content:space-between;color:var(--muted);font-size:11px}
.lower{display:grid;grid-template-columns:.9fr 1.1fr;border-top:1px solid var(--line);min-height:290px}.files{padding:18px;border-right:1px solid var(--line)}.sectiontitle{text-transform:uppercase;letter-spacing:.1em;font-size:10px;font-weight:800;color:var(--muted);margin-bottom:12px}.file{width:100%;border:1px solid transparent;background:transparent;padding:10px;border-radius:9px;display:flex;align-items:center;gap:10px;text-align:left;cursor:pointer;color:var(--ink)}.file:hover,.file.selected{background:var(--paper);border-color:var(--line)}.fileicon{width:30px;height:30px;border-radius:7px;display:grid;place-items:center;background:var(--ink);color:var(--green);font:700 10px ui-monospace,monospace}.filename{font-weight:700;font-size:12px}.filesize{font-size:10px;color:var(--muted);margin-top:2px}.empty{color:#999;font-size:12px;padding:28px 8px;text-align:center}
.preview{padding:18px;min-width:0}.preview pre{white-space:pre-wrap;word-break:break-word;margin:0;background:var(--ink);color:#ddd;border-radius:11px;padding:15px;height:218px;overflow:auto;font:11px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace}.preview pre .cursor{color:var(--green)}
.activity{height:100%;display:flex;flex-direction:column}.feed{padding:8px 18px 18px;overflow:auto;height:555px}.event{display:grid;grid-template-columns:30px 1fr;gap:10px;padding:11px 0;border-bottom:1px solid #ebe8df}.eventdot{width:25px;height:25px;border-radius:50%;display:grid;place-items:center;background:var(--soft);color:#007d5e;font-size:11px;font-weight:900}.event strong{display:block;font-size:12px;text-transform:capitalize}.event p{margin:3px 0 0;color:var(--muted);font-size:11px;line-height:1.4}.time{font:10px ui-monospace,monospace;color:#aaa;margin-top:4px}.notice{margin:0 18px 18px;padding:12px;border-radius:10px;background:var(--soft);color:#006c52;font-size:12px;line-height:1.4}.notice.error{background:#fff0ed;color:#a42c15}
@media(max-width:1000px){.hero{align-items:flex-start;flex-direction:column}.runbox{width:100%}.shell{grid-template-columns:1fr}.feed{height:320px}}@media(max-width:720px){.agents{grid-template-columns:1fr}.agents:before{display:none}.agent{min-height:auto}.node{margin-bottom:10px}.lower{grid-template-columns:1fr}.files{border-right:0;border-bottom:1px solid var(--line)}}
</style>
</head>
<body>
<header class="topbar"><div class="brand"><span class="brandmark"></span>telnyx</div><div class="live"><i></i> Agent SDK · CloudFS</div></header>
<main>
  <section class="hero">
    <div><div class="eyebrow">Shared workspace orchestration</div><h1>Five agents. One <em>shared workspace.</em></h1><p class="subtitle">Watch durable agents hand work to each other through CloudFS while embedded SQL records every read, write, and state transition.</p></div>
    <div class="runbox"><button class="run" id="runButton">Run agent fleet →</button><div class="runmeta" id="runMeta">Ready for a fresh isolated run</div></div>
  </section>
  <div class="shell">
    <section class="panel">
      <div class="panelhead"><h2>Agent pipeline</h2><span class="badge" id="statusBadge">READY</span></div>
      <div class="pipeline">
        <div class="agents" id="agents"></div>
        <div class="progress"><span id="progress"></span></div><div class="progresslabel"><span>Writer starts</span><span id="progressText">0 / 5 artifacts</span><span>Publisher completes</span></div>
      </div>
      <div class="lower">
        <div class="files"><div class="sectiontitle">CloudFS · shared/runs/current</div><div id="files"><div class="empty">Artifacts will appear here as agents write them.</div></div></div>
        <div class="preview"><div class="sectiontitle" id="previewTitle">Artifact preview</div><pre id="preview">Select an artifact to inspect its shared contents.<span class="cursor">_</span></pre></div>
      </div>
    </section>
    <aside class="panel activity"><div class="panelhead"><h2>Live operation log</h2><span class="badge">SQL REGISTRY</span></div><div class="feed" id="feed"><div class="empty">The registry is waiting for a fleet run.</div></div><div class="notice" id="notice">Every stage uses the same POSIX workspace—the agents share files, not process memory.</div></aside>
  </div>
</main>
<script>
const stages=[
 {id:'agent-1',role:'writer',action:'Creates the source report',file:'report.md'},
 {id:'agent-2',role:'analyst',action:'Reads report · writes analysis',file:'analysis.json'},
 {id:'agent-3',role:'reviewer',action:'Validates the analysis',file:'review.md'},
 {id:'agent-4',role:'summarizer',action:'Condenses the review',file:'summary.md'},
 {id:'agent-5',role:'publisher',action:'Publishes the manifest',file:'manifest.json'}
];
const el=id=>document.getElementById(id); let runId='';let timer;let selected='';let running=false;
function escapeHtml(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function renderAgents(completed){el('agents').innerHTML=stages.map((s,i)=>{const done=i<completed,active=running&&i===completed;return '<div class="agent '+(done?'done':active?'active':'')+'"><div class="node">'+(done?'✓':i+1)+'</div><div class="role">'+s.role+'</div><div class="action">'+s.action+'</div><span class="state">'+(done?'complete':active?'working':'waiting')+'</span></div>';}).join('');}
function render(snapshot){const writes=(snapshot.files||[]).filter(f=>f.operation==='write');const names=new Set(writes.map(f=>f.path));const completed=stages.filter(s=>names.has(s.file)).length;renderAgents(completed);el('progress').style.width=(completed*20)+'%';el('progressText').textContent=completed+' / 5 artifacts';
 el('files').innerHTML=writes.length?writes.slice().reverse().map(f=>'<button class="file '+(selected===f.path?'selected':'')+'" data-path="'+escapeHtml(f.path)+'"><span class="fileicon">'+escapeHtml(f.path.split('.').pop().toUpperCase())+'</span><span><div class="filename">'+escapeHtml(f.path)+'</div><div class="filesize">'+f.size+' bytes · shared by '+escapeHtml(f.agentId)+'</div></span></button>').join(''):'<div class="empty">Artifacts will appear here as agents write them.</div>';
 document.querySelectorAll('.file').forEach(b=>b.addEventListener('click',()=>openArtifact(b.dataset.path)));
 const events=(snapshot.files||[]).slice(0,30);el('feed').innerHTML=events.length?events.map(f=>'<div class="event"><div class="eventdot">'+(f.operation==='write'?'W':'R')+'</div><div><strong>'+escapeHtml(f.agentId)+' · '+f.operation+'</strong><p>'+escapeHtml(f.path)+'</p><div class="time">'+new Date(f.recordedAt).toLocaleTimeString()+'</div></div></div>').join(''):'<div class="empty">The registry is waiting for a fleet run.</div>';
 if(!selected&&writes.length)openArtifact(writes[writes.length-1].path);
}
async function refresh(){if(!runId)return;try{const r=await fetch('/fleet?runId='+encodeURIComponent(runId));if(!r.ok)throw new Error('Fleet status unavailable');render(await r.json());}catch(e){showError(e.message);}}
async function openArtifact(path){selected=path;el('previewTitle').textContent='Artifact preview · '+path;el('preview').textContent='Loading…';try{const scoped='runs/'+runId+'/'+path;const r=await fetch('/artifacts/'+encodeURIComponent(scoped)+'?agent='+encodeURIComponent(runId+':agent-1'));const data=await r.json();if(!r.ok)throw new Error(data.error||'Unable to read artifact');el('preview').textContent=data.content;}catch(e){el('preview').textContent=e.message;}await refresh();}
function showError(message){el('notice').className='notice error';el('notice').textContent=message;}
async function start(){if(running)return;running=true;selected='';runId=crypto.randomUUID();el('runButton').disabled=true;el('runButton').textContent='Fleet running…';el('runMeta').textContent='Run '+runId.slice(0,8)+' · isolated workspace';el('statusBadge').textContent='RUNNING';el('statusBadge').style.background='#dcdcff';el('notice').className='notice';el('notice').textContent='Live: agents are reading and writing through the shared POSIX mount.';render({files:[]});timer=setInterval(refresh,300);
 try{const r=await fetch('/demo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({runId:runId,paceMs:1100})});const data=await r.json();if(!r.ok)throw new Error(data.error||'Demo run failed');await refresh();el('statusBadge').textContent='COMPLETE';el('statusBadge').style.background='#ccf9ee';el('notice').textContent='Complete: five agents produced five artifacts through one shared workspace.';}
 catch(e){showError(e.message);el('statusBadge').textContent='ERROR';}finally{clearInterval(timer);running=false;el('runButton').disabled=false;el('runButton').textContent='Run another fresh take →';renderAgents(document.querySelectorAll('.agent.done').length);}}
el('runButton').addEventListener('click',start);renderAgents(0);
</script>
</body></html>`;
}
