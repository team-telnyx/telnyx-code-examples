export const ADMIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Multi-Model Inference Switcher — Telnyx</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --telnyx-cream: #FEFDF5;
    --telnyx-black: #000000;
    --telnyx-green: #00E3AA;
    --telnyx-tan: #E6E3D3;
    --inference-blue: #3434EF;
    --bright-20: #CCF9EE;
    --inference-bright-20: #AED3F9;
    --inference-bright-10: #D6EFFC;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Inter', sans-serif;
    background: var(--telnyx-cream);
    color: var(--telnyx-black);
    min-height: 100vh;
    padding: 0;
  }
  .header {
    background: var(--telnyx-black);
    color: var(--telnyx-cream);
    padding: 24px 40px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .header h1 {
    font-family: 'Space Grotesk', sans-serif;
    font-weight: 700;
    font-size: 24px;
    letter-spacing: -0.5px;
  }
  .header .logo {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .container {
    max-width: 900px;
    margin: 0 auto;
    padding: 40px 24px;
  }
  .model-bar {
    background: var(--inference-bright-10);
    border: 2px solid var(--inference-bright-20);
    border-radius: 16px;
    padding: 20px 28px;
    display: flex;
    align-items: center;
    gap: 20px;
    margin-bottom: 32px;
  }
  .model-bar .label {
    font-family: 'Space Grotesk', sans-serif;
    font-weight: 600;
    font-size: 15px;
    color: var(--telnyx-black);
    white-space: nowrap;
  }
  .model-bar .label .dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--telnyx-green);
    margin-right: 8px;
    vertical-align: middle;
    box-shadow: 0 0 8px var(--telnyx-green);
  }
  .model-select {
    flex: 1;
    padding: 10px 16px;
    border: 2px solid var(--telnyx-black);
    border-radius: 10px;
    font-family: 'Inter', sans-serif;
    font-size: 15px;
    font-weight: 500;
    background: white;
    color: var(--telnyx-black);
    cursor: pointer;
    outline: none;
  }
  .model-select:focus { border-color: var(--inference-blue); }
  .switch-btn {
    padding: 10px 24px;
    background: var(--telnyx-black);
    color: var(--telnyx-green);
    border: none;
    border-radius: 10px;
    font-family: 'Space Grotesk', sans-serif;
    font-weight: 600;
    font-size: 15px;
    cursor: pointer;
    transition: all 0.2s;
  }
  .switch-btn:hover { background: var(--inference-blue); color: white; }
  .switch-btn:disabled { opacity: 0.5; cursor: wait; }
  .chat-container {
    background: white;
    border: 2px solid var(--telnyx-tan);
    border-radius: 16px;
    overflow: hidden;
    margin-bottom: 16px;
  }
  .chat-header {
    background: var(--telnyx-black);
    color: var(--telnyx-cream);
    padding: 14px 24px;
    font-family: 'Space Grotesk', sans-serif;
    font-weight: 600;
    font-size: 15px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .chat-header .badge {
    background: var(--telnyx-green);
    color: var(--telnyx-black);
    padding: 3px 10px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 700;
  }
  .chat-messages {
    padding: 24px;
    max-height: 420px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .msg {
    max-width: 75%;
    padding: 12px 18px;
    border-radius: 14px;
    font-size: 15px;
    line-height: 1.5;
  }
  .msg.user {
    align-self: flex-end;
    background: var(--inference-blue);
    color: white;
    border-bottom-right-radius: 4px;
  }
  .msg.assistant {
    align-self: flex-start;
    background: var(--bright-20);
    color: var(--telnyx-black);
    border-bottom-left-radius: 4px;
  }
  .msg.assistant .model-tag {
    display: inline-block;
    font-size: 11px;
    font-weight: 600;
    color: var(--inference-blue);
    margin-bottom: 4px;
    font-family: 'Space Grotesk', sans-serif;
  }
  .chat-input {
    display: flex;
    gap: 12px;
    padding: 16px 24px;
    background: var(--telnyx-cream);
    border-top: 1px solid var(--telnyx-tan);
  }
  .chat-input input {
    flex: 1;
    padding: 12px 18px;
    border: 2px solid var(--telnyx-tan);
    border-radius: 10px;
    font-family: 'Inter', sans-serif;
    font-size: 15px;
    outline: none;
    background: white;
  }
  .chat-input input:focus { border-color: var(--inference-blue); }
  .chat-input button {
    padding: 12px 28px;
    background: var(--telnyx-green);
    color: var(--telnyx-black);
    border: none;
    border-radius: 10px;
    font-family: 'Space Grotesk', sans-serif;
    font-weight: 600;
    font-size: 15px;
    cursor: pointer;
    transition: all 0.2s;
  }
  .chat-input button:hover { transform: scale(1.02); }
  .chat-input button:disabled { opacity: 0.5; cursor: wait; }
  .stats {
    display: flex;
    gap: 16px;
    margin-bottom: 32px;
  }
  .stat-card {
    flex: 1;
    background: white;
    border: 2px solid var(--telnyx-tan);
    border-radius: 12px;
    padding: 16px 20px;
  }
  .stat-card .stat-label {
    font-size: 12px;
    font-weight: 600;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
  }
  .stat-card .stat-value {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 24px;
    font-weight: 700;
    color: var(--telnyx-black);
  }
  .stat-card .stat-value .unit { font-size: 14px; color: #888; }
  .clear-btn {
    background: transparent;
    border: 1px solid var(--telnyx-tan);
    color: #888;
    padding: 6px 14px;
    border-radius: 8px;
    font-size: 13px;
    cursor: pointer;
    font-family: 'Inter', sans-serif;
  }
  .clear-btn:hover { border-color: var(--telnyx-black); color: var(--telnyx-black); }
  .loading { opacity: 0.5; }
  .empty-state {
    text-align: center;
    padding: 40px;
    color: #888;
    font-size: 15px;
  }
</style>
</head>
<body>
<div class="header">
  <div class="logo">
    <svg width="100" height="31" viewBox="0 0 128 40" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block">
<g clip-path="url(#clip0_logo)">
<path d="M102.027 34.1821C102.027 35.7236 101.422 37.2022 100.344 38.2931C99.2667 39.3839 97.8048 39.998 96.2795 40.0004H80.8381C80.8237 40.0004 80.81 39.9947 80.7999 39.9844C80.7897 39.9742 80.784 39.9603 80.784 39.9458V34.7557C80.784 34.7412 80.7897 34.7273 80.7999 34.7171C80.81 34.7069 80.8237 34.7011 80.8381 34.7011H93.9642C94.2674 34.7011 94.5676 34.6405 94.8475 34.5226C95.1275 34.4048 95.3815 34.2322 95.5951 34.0146C95.8086 33.7971 95.9775 33.539 96.0919 33.2552C96.2062 32.9714 96.2639 32.6675 96.2615 32.361V28.9192C96.2615 28.9071 96.2568 28.8955 96.2483 28.887C96.2399 28.8785 96.2284 28.8737 96.2165 28.8737C96.2045 28.8737 96.1931 28.8785 96.1846 28.887C96.1762 28.8955 96.1714 28.9071 96.1714 28.9192C95.3972 30.185 94.3068 31.2225 93.0101 31.9273C91.7133 32.6322 90.2558 32.9796 88.784 32.9347C83.5858 32.9347 80.73 29.1195 80.73 23.2921V7.50341H80.775H86.4057H86.4507V22.6183C86.4507 26.0874 87.9012 27.9813 91.1444 27.9813C94.8651 27.9813 96.0183 25.5229 96.2435 23.4287V23.0918V7.50341C96.2517 7.49862 96.261 7.49609 96.2705 7.49609C96.28 7.49609 96.2893 7.49862 96.2976 7.50341H101.955C101.963 7.49862 101.973 7.49609 101.982 7.49609C101.992 7.49609 102.001 7.49862 102.009 7.50341L102.027 34.1821Z" fill="currentColor"/>
<path d="M29.2523 21.4347H45.856V18.6393C45.856 11.1547 41.883 7.06641 34.7839 7.06641C26.955 7.06641 23.2163 11.4643 23.2163 18.4845V21.4347C23.2163 28.5368 26.955 32.9347 34.7839 32.9347C41.6217 32.9347 45.2073 29.502 45.6668 24.3666V23.4105H39.8199L39.7298 24.6033C39.7102 24.8726 39.6588 25.1385 39.5767 25.3955C39.1082 26.825 37.6397 27.9541 34.8379 27.9541C30.7208 27.9541 29.1893 25.5685 29.1893 22.0174V21.5166C29.1888 21.4977 29.1948 21.4792 29.2063 21.4642C29.2178 21.4493 29.2341 21.4389 29.2523 21.4347ZM34.6578 12.047C38.4235 12.047 39.937 14.0229 39.928 17.146C39.9261 17.1647 39.9179 17.1821 39.9047 17.1953C39.8916 17.2086 39.8744 17.2169 39.856 17.2189H29.3064C29.2961 17.219 29.286 17.2168 29.2766 17.2126C29.2672 17.2084 29.2588 17.2022 29.252 17.1944C29.2451 17.1867 29.24 17.1775 29.237 17.1676C29.234 17.1577 29.233 17.1472 29.2343 17.1369C29.4866 14.0957 31.0542 12.047 34.6578 12.047Z" fill="currentColor"/>
<path d="M54.0626 0H48.2974V32.5334H54.0626V0Z" fill="currentColor"/>
<path d="M62.5047 7.45691H56.7839V32.533H62.5047V17.5638C62.5047 15.3239 63.3425 12.0096 67.6578 12.0096C70.9011 12.0096 72.3515 13.8944 72.3515 17.3726V32.533H78.0813V16.7079C78.0813 10.8896 75.2164 7.06538 70.0272 7.06538C68.544 7.02657 67.0765 7.38104 65.771 8.09352C64.4654 8.806 63.3672 9.85164 62.5857 11.1264C62.5857 11.1384 62.581 11.15 62.5725 11.1586C62.5641 11.1671 62.5526 11.1719 62.5407 11.1719C62.5288 11.1719 62.5173 11.1671 62.5088 11.1586C62.5004 11.15 62.4957 11.1384 62.4957 11.1264L62.5047 7.45691Z" fill="currentColor"/>
<path d="M112.567 19.5219C112.583 19.5465 112.591 19.5749 112.591 19.6039C112.591 19.6329 112.583 19.6613 112.567 19.6858L104.153 32.5335H110.459L115.865 24.1748C115.871 24.1634 115.88 24.1539 115.891 24.1473C115.902 24.1407 115.915 24.1372 115.928 24.1372C115.941 24.1372 115.953 24.1407 115.964 24.1473C115.976 24.1539 115.985 24.1634 115.991 24.1748L121.351 32.5335H128L119.622 19.704C119.608 19.6805 119.601 19.6538 119.601 19.6266C119.601 19.5995 119.608 19.5728 119.622 19.5493L127.685 7.45735H121.144L116.36 15.0603C116.354 15.0697 116.345 15.0774 116.335 15.0827C116.324 15.0879 116.313 15.0907 116.302 15.0907C116.29 15.0907 116.279 15.0879 116.269 15.0827C116.259 15.0774 116.25 15.0697 116.243 15.0603L111.486 7.44824H104.54L112.567 19.5219Z" fill="currentColor"/>
<path d="M21.2973 27.3525H13.7748C13.1732 27.3526 12.5956 27.1142 12.1661 26.6886C11.7365 26.263 11.4893 25.684 11.4775 25.0761V14.9601C11.4775 14.3443 11.7195 13.7537 12.1504 13.3183C12.5812 12.8829 13.1655 12.6382 13.7748 12.6382H21.2973V7.44818H13.7748C13.1655 7.44818 12.5812 7.20355 12.1504 6.76812C11.7195 6.33269 11.4775 5.74211 11.4775 5.12631V0H5.73875V5.12631C5.73875 5.43199 5.67903 5.73466 5.56302 6.01696C5.447 6.29926 5.27698 6.55562 5.0627 6.77135C4.84842 6.98707 4.5941 7.15791 4.31434 7.27406C4.03458 7.39021 3.73488 7.44938 3.43244 7.44818H0V12.6382H3.45046C4.05974 12.6382 4.64407 12.8829 5.07489 13.3183C5.50572 13.7537 5.74775 14.3443 5.74775 14.9601V26.7151C5.76673 28.2665 6.39044 29.7476 7.48346 30.837C8.57647 31.9263 10.0505 32.5359 11.5856 32.5334H21.2973V27.3525Z" fill="currentColor"/>
</g>
<defs>
<clipPath id="clip0_logo">
<rect width="128" height="40" fill="white"/>
</clipPath>
</defs>
</svg>
  </div>
  <h1>Multi-Model Inference Switcher</h1>
</div>

<div class="container">
  <div class="model-bar">
    <div class="label"><span class="dot"></span>Active Model</div>
    <select class="model-select" id="modelSelect"></select>
    <button class="switch-btn" id="switchBtn" onclick="switchModel()">Switch</button>
  </div>

  <div class="stats">
    <div class="stat-card">
      <div class="stat-label">Total Requests</div>
      <div class="stat-value" id="totalRequests">0</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Models Used</div>
      <div class="stat-value" id="modelsUsed">0</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Current Model</div>
      <div class="stat-value" id="currentModel" style="font-size:16px;">—</div>
    </div>
  </div>

  <div class="chat-container">
    <div class="chat-header">
      <span>Chat</span>
      <button class="clear-btn" onclick="clearChat()">Clear</button>
    </div>
    <div class="chat-messages" id="chatMessages">
      <div class="empty-state">Send a message to start chatting. Each reply is tagged with the model that generated it — switch the model above to see the difference live.</div>
    </div>
    <div class="chat-input">
      <input type="text" id="chatInput" placeholder="Type a message..." onkeydown="if(event.key==='Enter') sendMessage()">
      <button id="sendBtn" onclick="sendMessage()">Send</button>
    </div>
  </div>
</div>

<script>
const MODELS = __MODELS_JSON__;
const ACTIVE_MODEL = "__ACTIVE_MODEL__";

async function init() {
  const sel = document.getElementById('modelSelect');
  MODELS.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name + ' (' + m.vendor + ')';
    if (m.id === ACTIVE_MODEL) opt.selected = true;
    sel.appendChild(opt);
  });
  document.getElementById('currentModel').textContent = modelName(ACTIVE_MODEL);
  await loadStats();
  await loadHistory();
}

function modelName(id) {
  const m = MODELS.find(x => x.id === id);
  return m ? m.name : id;
}

async function switchModel() {
  const sel = document.getElementById('modelSelect');
  const btn = document.getElementById('switchBtn');
  btn.disabled = true;
  btn.textContent = 'Switching...';
  try {
    const resp = await fetch('/model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: sel.value }),
    });
    const data = await resp.json();
    if (resp.ok) {
      document.getElementById('currentModel').textContent = modelName(data.model);
    } else {
      alert(data.error || 'Failed to switch model');
    }
  } catch (e) {
    alert('Network error: ' + e.message);
  }
  btn.disabled = false;
  btn.textContent = 'Switch';
}

async function sendMessage() {
  const input = document.getElementById('chatInput');
  const btn = document.getElementById('sendBtn');
  const text = input.value.trim();
  if (!text) return;
  btn.disabled = true;
  input.value = '';
  appendMessage('user', text);
  appendLoading();
  try {
    const resp = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const data = await resp.json();
    removeLoading();
    if (resp.ok) {
      appendMessage('assistant', data.reply, data.model);
    } else {
      appendMessage('assistant', 'Error: ' + (data.error || 'unknown'), 'error');
    }
  } catch (e) {
    removeLoading();
    appendMessage('assistant', 'Network error: ' + e.message, 'error');
  }
  btn.disabled = false;
  input.focus();
  await loadStats();
}

function appendMessage(role, content, model) {
  const container = document.getElementById('chatMessages');
  const empty = container.querySelector('.empty-state');
  if (empty) empty.remove();
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  if (role === 'assistant' && model) {
    const tag = document.createElement('div');
    tag.className = 'model-tag';
    tag.textContent = '⚡ ' + modelName(model);
    div.appendChild(tag);
  }
  div.appendChild(document.createTextNode(content));
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function appendLoading() {
  const container = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'msg assistant loading';
  div.id = 'loadingMsg';
  div.textContent = 'Thinking...';
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function removeLoading() {
  const el = document.getElementById('loadingMsg');
  if (el) el.remove();
}

async function loadStats() {
  try {
    const resp = await fetch('/history');
    const data = await resp.json();
    document.getElementById('totalRequests').textContent = data.totalRequests || 0;
    const modelCount = Object.keys(data.modelUsage || {}).length;
    document.getElementById('modelsUsed').textContent = modelCount;
  } catch (e) {}
}

async function loadHistory() {
  try {
    const resp = await fetch('/history');
    const data = await resp.json();
    if (data.messages && data.messages.length > 0) {
      const container = document.getElementById('chatMessages');
      const empty = container.querySelector('.empty-state');
      if (empty) empty.remove();
      // We don't have per-message model tags from history, so just show role + content
      data.messages.forEach(m => {
        appendMessage(m.role, m.content, m.model !== 'varies' ? m.model : undefined);
      });
    }
  } catch (e) {}
}

async function clearChat() {
  try {
    await fetch('/clear', { method: 'POST' });
    const container = document.getElementById('chatMessages');
    container.innerHTML = '<div class="empty-state">Chat cleared. Send a new message to start.</div>';
    await loadStats();
  } catch (e) {}
}

init();
</script>
</body>
</html>`;
