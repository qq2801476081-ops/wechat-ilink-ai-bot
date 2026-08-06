export const renderSetupPage = (): string => `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>微信 AI 机器人 - 配置向导</title>
  <style>
    :root{color-scheme:light;--ink:#17211b;--muted:#667069;--line:#dce3de;--paper:#f4f6f3;--card:#fff;--green:#176b45;--green2:#0e5a39;--soft:#e8f2ec;--danger:#a13737}
    *{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 system-ui,"Microsoft YaHei",sans-serif}
    .shell{width:min(760px,calc(100% - 28px));margin:38px auto 64px}.hero{display:flex;justify-content:space-between;align-items:end;margin-bottom:18px}
    h1{font-size:26px;letter-spacing:-.02em;margin:0 0 4px}h2{font-size:18px;margin:0}.sub,.hint{color:var(--muted)}.status-pill{padding:6px 11px;border:1px solid var(--line);border-radius:999px;background:#fff;font-size:13px}
    .panel{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;box-shadow:0 14px 45px rgba(30,55,40,.07)}
    .step{display:grid;grid-template-columns:48px 1fr;gap:10px;padding:24px;border-bottom:1px solid var(--line)}.step:last-child{border-bottom:0}.num{width:32px;height:32px;border-radius:50%;display:grid;place-items:center;background:var(--soft);color:var(--green);font-weight:700}
    .content{min-width:0}.providers{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0}.choice{border:1px solid var(--line);padding:9px 12px;border-radius:9px;cursor:pointer}.choice:has(input:checked){border-color:var(--green);background:var(--soft)}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}.field{display:grid;gap:6px}.field.full{grid-column:1/-1}label{font-weight:600;font-size:13px}select,input{width:100%;border:1px solid #cbd5ce;border-radius:8px;padding:10px 11px;background:#fff;color:var(--ink);font:inherit}input:focus,select:focus{outline:2px solid #9fc8ae;outline-offset:1px}
    button{border:0;border-radius:8px;background:var(--green);color:#fff;padding:10px 16px;font:600 14px inherit;cursor:pointer}button:hover{background:var(--green2)}button:disabled{opacity:.55;cursor:wait}.secondary{background:#fff;color:var(--green);border:1px solid var(--green)}
    .actions{display:flex;align-items:center;gap:12px;margin-top:15px}.message{font-size:13px;color:var(--muted)}.message.error{color:var(--danger)}
    .qrbox{display:none;margin-top:18px;padding:18px;border:1px dashed #b9c7bd;border-radius:10px;text-align:center;background:#fbfcfb}.qrbox.show{display:block}.qrbox img{display:block;width:min(280px,100%);height:auto;margin:0 auto 12px;background:#fff}.complete{display:none}.complete.show{display:block}.complete strong{color:var(--green)}
    .candidates{display:grid;gap:10px;margin-top:16px}.candidate{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px;border:1px solid var(--line);border-radius:9px;background:#fbfcfb}.candidate.selected{border-color:var(--green);background:var(--soft)}.candidate-main{min-width:0}.candidate-preview{font-weight:600;word-break:break-word}.candidate-time{font-size:12px;color:var(--muted);margin-top:3px}.candidate button{flex:0 0 auto}
    @media(max-width:620px){.shell{margin-top:20px}.hero{display:block}.status-pill{display:inline-block;margin-top:10px}.step{grid-template-columns:38px 1fr;padding:20px 16px}.grid{grid-template-columns:1fr}.field.full{grid-column:auto}.providers{display:grid}.actions{align-items:flex-start;flex-direction:column}}
  </style>
</head>
<body>
  <main class="shell">
    <header class="hero"><div><h1>微信 AI 机器人</h1><div class="sub">配置向导 · 运行在你的 Cloudflare 账号中</div></div><span id="online" class="status-pill">正在读取状态</span></header>
    <section class="panel">
      <div class="step"><div class="num">1</div><div class="content">
        <h2>AI 模型配置</h2><p class="hint">默认使用免费的 Cloudflare Workers AI。外部服务的 Key 会加密存储且不会回显。</p>
        <div class="providers">
          <label class="choice"><input type="radio" name="provider" value="workers-ai" checked> Workers AI（推荐）</label>
          <label class="choice"><input type="radio" name="provider" value="deepseek"> DeepSeek API</label>
          <label class="choice"><input type="radio" name="provider" value="openai"> OpenAI API</label>
        </div>
        <div class="grid">
          <div class="field"><label for="model">模型名称</label><input id="model" value="@cf/meta/llama-3.1-8b-instruct" autocomplete="off"></div>
          <div id="keyField" class="field" hidden><label id="keyLabel" for="apiKey">API Key</label><input id="apiKey" type="password" autocomplete="new-password" placeholder="留空则保持现有 Key"></div>
        </div>
        <div class="actions"><button id="saveConfig">保存配置</button><span id="configMessage" class="message"></span></div>
      </div></div>
      <div class="step"><div class="num">2</div><div class="content">
        <h2>微信登录</h2><p class="hint">请使用专用微信小号扫码，并在手机端确认登录。</p>
        <div class="actions"><button id="getQr" class="secondary">获取登录二维码</button><span id="loginMessage" class="message">尚未获取二维码</span></div>
        <div id="qrBox" class="qrbox"><img id="qrImage" alt="微信登录二维码"><div id="qrStatus">等待扫码…</div></div>
      </div></div>
      <div class="step"><div class="num">3</div><div class="content">
        <h2>选择对话好友</h2><p class="hint">让目标好友先给 Bot 发送一条容易辨认的消息，然后刷新列表并选择。绑定后，其他好友的消息不会触发 AI，也不会保存为对话记录。</p>
        <div class="actions"><button id="refreshCandidates" class="secondary">刷新候选好友</button><button id="clearBinding" class="secondary">取消当前绑定</button><span id="bindingMessage" class="message"></span></div>
        <div id="candidateList" class="candidates"><p class="hint">正在读取候选好友…</p></div>
      </div></div>
      <div class="step"><div class="num">4</div><div class="content">
        <h2>完成</h2><div id="complete" class="complete"><p><strong>登录成功，机器人已经上线。</strong></p><img id="botQr" alt="机器人二维码" style="width:min(220px,100%);background:#fff"><p class="hint">用自己的微信添加该 Bot 后即可聊天。超过 24 小时未聊天时，如会话失效，请返回本页重新扫码。</p></div><p id="waiting" class="hint">完成 AI 配置并扫码登录后，机器人将随每分钟定时任务开始接收消息。</p>
      </div></div>
    </section>
  </main>
  <script>
    const $ = (id) => document.getElementById(id);
    let qrKey = "";
    let qrTimer = null;
    const selectedProvider = () => document.querySelector('input[name="provider"]:checked').value;
    const setMessage = (element, text, error = false) => { element.textContent = text; element.classList.toggle("error", error); };
    function syncProviderFields() {
      const provider = selectedProvider();
      $("keyField").hidden = provider === "workers-ai";
      $("keyLabel").textContent = provider === "deepseek" ? "DeepSeek API Key" : "OpenAI API Key";
      if (provider === "workers-ai" && !$("model").value.startsWith("@cf/")) $("model").value = "@cf/meta/llama-3.1-8b-instruct";
      if (provider === "deepseek" && $("model").value.startsWith("@cf/")) $("model").value = "deepseek-chat";
      if (provider === "openai" && ($("model").value.startsWith("@cf/") || $("model").value === "deepseek-chat")) $("model").value = "gpt-4o-mini";
    }
    async function api(url, options) {
      const response = await fetch(url, options);
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || body.error || ("请求失败：" + response.status));
      return body;
    }
    async function loadConfig() {
      try {
        const data = await api("/api/config");
        const radio = document.querySelector('input[name="provider"][value="' + data.ai_provider + '"]');
        if (radio) radio.checked = true;
        $("model").value = data.ai_model;
        syncProviderFields();
        const configured = data.ai_provider === "deepseek" ? data.deepseek_api_key_configured : data.openai_api_key_configured;
        if (data.ai_provider !== "workers-ai" && configured) $("apiKey").placeholder = "已配置，留空保持不变";
      } catch (error) { setMessage($("configMessage"), error.message, true); }
    }
    async function saveConfig() {
      const button = $("saveConfig"); button.disabled = true;
      try {
        const provider = selectedProvider();
        const entries = [["ai_provider", provider], ["ai_model", $("model").value.trim()]];
        const key = $("apiKey").value.trim();
        if (key && provider !== "workers-ai") entries.push([provider === "deepseek" ? "deepseek_api_key" : "openai_api_key", key]);
        for (const [configKey, value] of entries) await api("/api/config", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({key:configKey,value}) });
        $("apiKey").value = ""; setMessage($("configMessage"), "配置已保存");
      } catch (error) { setMessage($("configMessage"), error.message, true); } finally { button.disabled = false; }
    }
    async function pollQr() {
      if (!qrKey) return;
      try {
        const data = await api("/api/login/status?key=" + encodeURIComponent(qrKey));
        const labels = { pending:"等待扫码…", scanned:"已扫码，请在手机上确认…", confirmed:"登录成功", expired:"二维码已过期，请重新获取" };
        $("qrStatus").textContent = labels[data.status] || data.status;
        setMessage($("loginMessage"), labels[data.status] || data.status);
        if (data.status === "confirmed") {
          clearInterval(qrTimer); $("complete").classList.add("show"); $("waiting").hidden = true; $("botQr").src = $("qrImage").src; $("online").textContent = "Bot 已在线";
        } else if (data.status === "expired") clearInterval(qrTimer);
      } catch (error) { setMessage($("loginMessage"), error.message, true); }
    }
    async function getQr() {
      const button = $("getQr"); button.disabled = true;
      try {
        const data = await api("/api/login/qr"); qrKey = data.key; $("qrImage").src = data.imgBase64; $("qrBox").classList.add("show"); setMessage($("loginMessage"), "等待扫码…");
        clearInterval(qrTimer); qrTimer = setInterval(pollQr, 3000);
      } catch (error) { setMessage($("loginMessage"), error.message, true); } finally { button.disabled = false; }
    }
    async function bindCandidate(candidateId) {
      try {
        await api("/api/chat-binding", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({candidateId}) });
        setMessage($("bindingMessage"), candidateId === null ? "已取消绑定，Bot 暂时不会回复任何好友" : "已绑定目标好友");
        await loadChatBinding();
      } catch (error) { setMessage($("bindingMessage"), error.message, true); }
    }
    async function loadChatBinding() {
      const list = $("candidateList");
      try {
        const data = await api("/api/chat-binding");
        list.replaceChildren();
        if (!data.candidates.length) {
          const empty = document.createElement("p"); empty.className = "hint"; empty.textContent = "还没有候选好友。请让目标好友发一条消息，等待约 1 分钟后刷新。"; list.appendChild(empty); return;
        }
        for (const candidate of data.candidates) {
          const row = document.createElement("div"); row.className = "candidate" + (candidate.id === data.selectedCandidateId ? " selected" : "");
          const main = document.createElement("div"); main.className = "candidate-main";
          const preview = document.createElement("div"); preview.className = "candidate-preview"; preview.textContent = "最近消息：" + (candidate.lastMessagePreview || "（空消息）");
          const time = document.createElement("div"); time.className = "candidate-time"; time.textContent = "最后收到：" + candidate.lastSeenAt;
          const button = document.createElement("button"); button.textContent = candidate.id === data.selectedCandidateId ? "已选择" : "选择此好友"; button.disabled = candidate.id === data.selectedCandidateId; button.addEventListener("click", () => bindCandidate(candidate.id));
          main.append(preview, time); row.append(main, button); list.appendChild(row);
        }
      } catch (error) { list.replaceChildren(); setMessage($("bindingMessage"), error.message, true); }
    }
    document.querySelectorAll('input[name="provider"]').forEach((input) => input.addEventListener("change", syncProviderFields));
    $("saveConfig").addEventListener("click", saveConfig); $("getQr").addEventListener("click", getQr);
    $("refreshCandidates").addEventListener("click", loadChatBinding); $("clearBinding").addEventListener("click", () => bindCandidate(null));
    loadConfig(); loadChatBinding(); fetch("/health").then((r)=>r.json()).then((data)=>{$("online").textContent=data.loggedIn?"Bot 已在线":"Bot 未登录";}).catch(()=>{$("online").textContent="状态读取失败";});
  </script>
</body>
</html>`;
