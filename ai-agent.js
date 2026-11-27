// ========== AI Agent - DeepSeek API (Streaming + Markdown) ==========

const DEEPSEEK_API_KEY = 'sk-37d5cc14ff3649d7a9dde0d8eea77a7f';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

let aiMessages = [];
let isAiThinking = false;
let aiChatInitialized = false;
let abortController = null;
let currentAiBubble = null;
let streamBuffer = '';

if (typeof marked !== 'undefined') { marked.setOptions({ breaks: true, gfm: true }); }
function buildKnowledgeContext() {
    if (typeof KNOWLEDGE_DATA === 'undefined') return '';
    let ctx = '以下是中国校园急救知识库，请严格基于这些知识回答急救相关问题：\n\n';
    KNOWLEDGE_DATA.forEach((k, i) => {
        ctx += (i + 1) + '. ' + k.title + '\n';
        ctx += '   摘要：' + k.summary + '\n';
        k.steps.forEach((s, j) => {
            ctx += '   步骤' + (j + 1) + '：' + s.title + ' - ' + s.desc + '\n';
        });
        ctx += '\n';
    });
    return ctx;
}

function buildSystemPrompt() {
    const kb = buildKnowledgeContext();
    return `你是校园应急救护系统的AI急救顾问。你拥有以下急救知识库：

${kb}
你的职责：
1. 根据用户描述的紧急情况，结合专业知识库提供准确、清晰的急救指导。
2. 如果用户描述不完整（如缺少：患者意识状态、呼吸情况、出血部位和严重程度、事发环境等关键信息），你必须通过追问引导用户补充必要的现场信息。遵循：情况不明不判断，信息不全先追问。
3. 始终保持冷静、专业的语气。使用Markdown格式。
4. 回答简洁实用。重要提醒：现场急救指引不能替代专业医疗救治。

【导航标记规则 - 必须严格遵守】
你的每条回复末尾，必须根据用户意图附加至少一条导航标记（独立成行，放在最后）：
- 用户询问心肺复苏 → 末尾加 [NAV:knowledge:1]
- 用户询问海姆立克 → 末尾加 [NAV:knowledge:2]
- 用户询问止血包扎 → 末尾加 [NAV:knowledge:3]
- 用户询问中暑 → 末尾加 [NAV:knowledge:4]
- 用户询问骨折 → 末尾加 [NAV:knowledge:5]
- 用户询问鼻出血 → 末尾加 [NAV:knowledge:6]
- 用户询问扭伤拉伤 → 末尾加 [NAV:knowledge:7]
- 用户询问烫伤烧伤 → 末尾加 [NAV:knowledge:8]
- 用户询问晕厥 → 末尾加 [NAV:knowledge:9]
- 用户询问癫痫 → 末尾加 [NAV:knowledge:10]
- 用户询问低血糖 → 末尾加 [NAV:knowledge:11]
- 用户询问过敏 → 末尾加 [NAV:knowledge:12]
- 用户询问溺水 → 末尾加 [NAV:knowledge:13]
- 用户询问触电 → 末尾加 [NAV:knowledge:14]
- 用户询问眼中异物 → 末尾加 [NAV:knowledge:15]
- 用户想报警、叫救护车、打120、呼救 → 末尾加 [NAV:emergency]
- 用户需要找AED、除颤器、心脏骤停 → 末尾加 [NAV:aed]
- 即便是用户直接说我要报警而没有描述伤情，也必须回复确认并附加[NAV:emergency]
- 多条意图可附加多个标记，每个标记单独一行
- 标记必须严格使用 [NAV:类型] 或 [NAV:类型:数字] 格式`;
}

function initAIChat() {
    if (aiChatInitialized) return;
    aiChatInitialized = true;
    aiMessages = [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'assistant', content: '您好！我是AI急救顾问，请描述您遇到的紧急情况，我会根据专业知识库为您提供指导。\n\n如果情况紧急，请优先拨打120！' }
    ];
    document.querySelectorAll('.suggested-chip').forEach(chip => {
        chip.addEventListener('click', function() {
            const q = this.getAttribute('data-question');
            if (q) sendMessage(q);
        });
    });
    const input = document.getElementById('ai-chat-input');
    input.addEventListener('input', autoResize);
}

function autoResize() { this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight, 120) + 'px'; }

async function sendMessage(text) {
    const input = document.getElementById('ai-chat-input');
    const msg = text || input.value.trim();
    if (!msg || isAiThinking) return;
    if (!text) { input.value = ''; input.style.height = 'auto'; }
    const welcome = document.querySelector('.ai-welcome'); if (welcome) welcome.remove();
    addMessage('user', msg);
    aiMessages.push({ role: 'user', content: msg });
    showTyping(); isAiThinking = true; showStopButton();
    abortController = new AbortController(); streamBuffer = '';
    try {
        const response = await fetch(DEEPSEEK_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + DEEPSEEK_API_KEY },
            body: JSON.stringify({ model: 'deepseek-chat', messages: aiMessages, temperature: 0.7, max_tokens: 1500, stream: true }),
            signal: abortController.signal
        });
        hideTyping();
        if (!response.ok) {
            const errText = await response.text(); console.error('API error:', response.status, errText);
            let tip;
            if (response.status === 402) {
                tip = 'AI 服务账户余额不足（402），请联系管理员充值后重试。如情况紧急请立即拨打120！';
            } else if (response.status === 401 || response.status === 403) {
                tip = 'AI 服务密钥无效（' + response.status + '），请检查配置。如情况紧急请立即拨打120！';
            } else if (response.status === 429) {
                tip = '请求过于频繁，请稍候再试。如情况紧急请立即拨打120！';
            } else {
                tip = 'AI 服务暂时不可用（' + response.status + '），请稍后再试。如情况紧急请立即拨打120！';
            }
            addMessage('ai', tip);
            finishThinking(); return;
        }
        currentAiBubble = createStreamBubble();
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';
        let pending = '';  // 缓存被网络分包截断的半行 SSE 数据
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            pending += decoder.decode(value, { stream: true });
            const lines = pending.split('\n');
            pending = lines.pop();  // 最后一段可能不完整，留到下次拼接
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') continue;
                    try {
                        const parsed = JSON.parse(data);
                        const delta = parsed.choices[0].delta.content;
                        if (delta) { fullContent += delta; streamBuffer = fullContent; updateStreamBubble(currentAiBubble, fullContent); }
                    } catch(e) {}
                }
            }
        }
        aiMessages.push({ role: 'assistant', content: fullContent });
        finalizeStreamBubble(currentAiBubble, fullContent);
    } catch (err) {
        if (err.name === 'AbortError') {
            if (streamBuffer) { aiMessages.push({ role: 'assistant', content: streamBuffer }); finalizeStreamBubble(currentAiBubble, streamBuffer); }
        } else { hideTyping(); console.error('Fetch error:', err); if (currentAiBubble) currentAiBubble.remove(); addMessage('ai', '抱歉，网络连接异常，请检查网络后重试。紧急情况请直接拨打120！'); }
    }
    finishThinking();
}

function stopConversation() { if (abortController) { abortController.abort(); abortController = null; } finishThinking(); }

function finishThinking() { isAiThinking = false; hideStopButton(); currentAiBubble = null; streamBuffer = ''; abortController = null; }

function showStopButton() { document.getElementById('ai-stop-btn').style.display = 'flex'; document.getElementById('ai-send-btn').style.display = 'none'; }
function hideStopButton() { document.getElementById('ai-stop-btn').style.display = 'none'; document.getElementById('ai-send-btn').style.display = 'flex'; }

function createStreamBubble() { const container = document.getElementById('ai-chat-messages'); const div = document.createElement('div'); div.className = 'chat-bubble ai'; div.innerHTML = '<div class=\'markdown-body\'></div>'; container.appendChild(div); scrollToBottom(); return div; }

function updateStreamBubble(bubble, content) { const mdBody = bubble.querySelector('.markdown-body'); if (mdBody) { mdBody.innerHTML = typeof marked !== 'undefined' ? marked.parse(content) : escapeHtml(content).replace(/\n/g, '<br>'); } scrollToBottom(); }

function finalizeStreamBubble(bubble, content) {
    const navRegex = /\[NAV:(\w+)(?::(\d+))?\]/g; let navButtons = []; let match; const navSet = new Set();
    while ((match = navRegex.exec(content)) !== null) {
        const k = match[1] + (match[2] || ''); if (!navSet.has(k)) { navSet.add(k); navButtons.push({ type: match[1], id: match[2] || null }); }
    }
    let cleanContent = content.replace(/\[NAV:\w+(?::\d+)?\]/g, '');
    const mdBody = bubble.querySelector('.markdown-body');
    if (mdBody) { mdBody.innerHTML = typeof marked !== 'undefined' ? marked.parse(cleanContent) : escapeHtml(cleanContent).replace(/\n/g, '<br>'); }
    if (navButtons.length > 0) {
        const actionsDiv = document.createElement('div'); actionsDiv.className = 'quick-actions';
        navButtons.forEach(nav => {
            const btn = document.createElement('button'); btn.className = 'quick-action-btn'; btn.onclick = function() { handleNavigation(nav.type, nav.id); };
            if (nav.type === 'knowledge') { const kd = KNOWLEDGE_DATA.find(k => k.id === parseInt(nav.id)); btn.innerHTML = '\ud83d\udcda ' + (kd ? kd.title : '查看急救知识'); }
            else if (nav.type === 'aed') { btn.innerHTML = '\ud83d\uddfa\ufe0f 查找附近AED'; }
            else if (nav.type === 'emergency') { btn.innerHTML = '\ud83d\udea8 紧急呼叫'; }
            actionsDiv.appendChild(btn);
        }); bubble.appendChild(actionsDiv);
    } scrollToBottom();
}

function handleChatKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }

function addMessage(role, content) { const container = document.getElementById('ai-chat-messages'); const div = document.createElement('div'); div.className = 'chat-bubble ' + role; const mdContent = typeof marked !== 'undefined' ? marked.parse(content) : escapeHtml(content).replace(/\n/g, '<br>'); div.innerHTML = '<div class=\'markdown-body\'>' + mdContent + '</div>'; container.appendChild(div); scrollToBottom(); }

function handleNavigation(type, id) { if (type === 'knowledge') { if (id) { switchTab('knowledge'); setTimeout(() => openKnowledgeDetail(parseInt(id)), 300); } else { switchTab('knowledge'); } } else if (type === 'aed') { switchTab('map'); setTimeout(() => navigateToNearestAED(), 500); } else if (type === 'emergency') { openEmergencyModal(); } }

function showTyping() { const container = document.getElementById('ai-chat-messages'); const typing = document.createElement('div'); typing.className = 'chat-typing'; typing.id = 'typing-indicator'; typing.innerHTML = '<div class=\'typing-dot\'></div><div class=\'typing-dot\'></div><div class=\'typing-dot\'></div>'; container.appendChild(typing); scrollToBottom(); }
function hideTyping() { const typing = document.getElementById('typing-indicator'); if (typing) typing.remove(); }

function scrollToBottom() { const container = document.getElementById('ai-chat-messages'); setTimeout(() => { container.scrollTop = container.scrollHeight; }, 50); }

function escapeHtml(text) { const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#039;' }; return text.replace(/[&<>"']/g, m => map[m]); }

function sendSuggested(question) { document.getElementById('ai-chat-input').value = question; sendMessage(); }

function newConversation() {
    if (!confirm('确定要结束当前对话并开启新对话吗？对话记录将被清空。')) return;
    aiMessages = [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'assistant', content: '您好！我是AI急救顾问，请描述您遇到的紧急情况，我会根据专业知识库为您提供指导。\n\n如果情况紧急，请优先拨打120！' }
    ];
    const container = document.getElementById('ai-chat-messages');
    container.innerHTML = "<div class='ai-welcome'><div class='ai-welcome-icon'><svg class='w-10 h-10 text-white' fill='none' stroke='currentColor' viewBox='0 0 24 24'><path stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z'/></svg></div><h3 class='text-lg font-black text-gray-800 mb-1'>AI急救顾问</h3><p class='text-sm text-gray-500'>基于专业知识库，为您提供急救指导</p><div class='suggested-questions'><span class='suggested-chip' data-question='有人突然倒地不醒，我该怎么办？'>有人倒地不醒怎么办？</span><span class='suggested-chip' data-question='如何进行心肺复苏？'>如何进行心肺复苏？</span><span class='suggested-chip' data-question='吃东西噎住了怎么处理？'>吃东西噎住了怎么办？</span><span class='suggested-chip' data-question='有人中暑了应该怎么做？'>有人中暑了怎么做？</span></div></div>";
    document.querySelectorAll('.suggested-chip').forEach(chip => {
        chip.addEventListener('click', function() {
            const q = this.getAttribute('data-question');
            if (q) sendMessage(q);
        });
    });
    document.getElementById('ai-chat-input').value = '';
}
