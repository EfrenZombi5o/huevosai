// Elements
const chatListEl = document.getElementById('chatList');
const newChatForm = document.getElementById('newChatForm');
const newChatNameInput = document.getElementById('newChatName');
const chatDiv = document.getElementById('chat');
const promptInput = document.getElementById('prompt');
const sendBtn = document.getElementById('sendBtn');
const voiceInputBtn = document.getElementById('voiceInputBtn');
const imageUrlInput = document.getElementById('imageUrl');
const modelSelect = document.getElementById('modelSelect');
const generateImageBtn = document.getElementById('generateImageBtn');
const darkModeToggle = document.getElementById('darkModeToggle');
const voiceToggle = document.getElementById('voiceToggle');
const statusDiv = document.getElementById('status');
const sidebar = document.getElementById('sidebar');

// Mic permission prompt elements
const micPermissionPrompt = document.getElementById('micPermissionPrompt');
const allowMicBtn = document.getElementById('allowMicBtn');
const denyMicBtn = document.getElementById('denyMicBtn');

// State variables
let chats = {};
let currentChatId = null;
let recognition = null;
let isListening = false;
let synth = window.speechSynthesis;
let assistantVoiceEnabled = true;

// Utility delay function
const delay = ms => new Promise(res => setTimeout(res, ms));

// Debounce helper
function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// Load chats from localStorage
function loadChats() {
  const saved = localStorage.getItem('personal_ai_chats');
  if (saved) {
    try {
      chats = JSON.parse(saved);
    } catch {
      chats = {};
    }
  }
}

// Save chats to localStorage
function saveChats() {
  localStorage.setItem('personal_ai_chats', JSON.stringify(chats));
}

// Generate unique chat ID
function generateId() {
  return 'chat_' + Math.random().toString(36).slice(2, 10);
}

// Render chat list with delete buttons
function renderChatList() {
  chatListEl.innerHTML = '';
  for (const [id, chat] of Object.entries(chats)) {
    const li = document.createElement('li');
    li.textContent = chat.name;
    li.dataset.chatId = id;
    li.classList.toggle('active', id === currentChatId);
    if (document.body.classList.contains('dark')) li.classList.add('dark');

    // Click to switch chat (ignore clicks on delete button)
    li.addEventListener('click', e => {
      if (e.target.classList.contains('delete-btn')) return;
      switchChat(id);
    });

    // Delete button
    const delBtn = document.createElement('span');
    delBtn.textContent = '×';
    delBtn.className = 'delete-btn';
    delBtn.title = 'Delete chat';
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (confirm(`Are you sure you want to delete chat "${chat.name}"? This action cannot be undone.`)) {
        delete chats[id];
        saveChats();
        if (currentChatId === id) {
          const remainingIds = Object.keys(chats);
          if (remainingIds.length > 0) {
            switchChat(remainingIds[0]);
          } else {
            createNewChat('Default Chat');
          }
        } else {
          renderChatList();
        }
      }
    });

    li.appendChild(delBtn);
    chatListEl.appendChild(li);
  }
}

// Switch to a chat by ID
function switchChat(id) {
  if (!chats[id]) return;
  currentChatId = id;
  renderChatList();
  loadChatToUI();
}

// Load chat messages and model into UI
async function loadChatToUI() {
  if (!currentChatId) return;
  const chat = chats[currentChatId];
  // Note: Do not clear promptInput or imageUrlInput here to preserve user input on chat switch
  modelSelect.value = chat.model || 'deepseek-chat';
  statusDiv.textContent = '';
  await renderMessages();
}

// Parse message text into parts: text and code blocks
function parseMessageParts(text) {
  const regex = /```(\w+)?\n([\s\S]*?)```/g;
  let result = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    result.push({ type: 'code', lang: match[1] || '', content: match[2] });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    result.push({ type: 'text', content: text.slice(lastIndex) });
  }

  return result;
}

// Create message element supporting mixed text and code parts
async function createMessageElement(msg) {
  if (msg.role === 'user') {
    const bubble = document.createElement('div');
    bubble.className = 'bubble user';
    bubble.textContent = msg.text;
    return bubble;
  }

  // Assistant message: parse parts
  const parts = parseMessageParts(msg.text);

  const container = document.createElement('div');
  container.className = 'assistant-message-container';

  for (const part of parts) {
    if (part.type === 'text') {
      const p = document.createElement('p');
      p.className = 'bubble assistant';
      p.textContent = part.content.trim();
      container.appendChild(p);
    } else if (part.type === 'code') {
      const pre = document.createElement('pre');
      pre.className = 'code-box hljs';
      const code = document.createElement('code');
      if (part.lang) code.className = part.lang;
      code.textContent = part.content;
      pre.appendChild(code);

      if (window.hljs) {
        hljs.highlightElement(code);
      } else {
        setTimeout(() => {
          if (window.hljs) hljs.highlightElement(code);
        }, 100);
      }

      container.appendChild(pre);
    }
  }

  return container;
}

// Render all messages (async due to async createMessageElement)
async function renderMessages() {
  if (!currentChatId) return;
  chatDiv.innerHTML = '';
  const chat = chats[currentChatId];

  for (const msg of chat.messages) {
    const el = await createMessageElement(msg);
    chatDiv.appendChild(el);
  }
  chatDiv.scrollTop = chatDiv.scrollHeight;
}

// Add message to current chat
function addMessage(role, text) {
  if (!currentChatId) return;
  const chat = chats[currentChatId];
  chat.messages.push({ role, text });
  if (chat.messages.length > 50) chat.messages.shift();
  saveChats();
}

// Create a new chat
function createNewChat(name) {
  if (!name.trim()) {
    alert('Enter a chat name');
    return;
  }
  const id = generateId();
  chats[id] = {
    name: name.trim(),
    messages: [],
    model: 'deepseek-chat'
  };
  saveChats();
  switchChat(id);
  newChatNameInput.value = '';
}

// Build context prompt from chat history + new user message
function buildContextPrompt(newUserMessage) {
  if (!currentChatId) return newUserMessage;
  const chat = chats[currentChatId];
  let context = '';
  chat.messages.forEach(msg => {
    context += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.text}\n`;
  });
  context += `User: ${newUserMessage}\nAssistant:`;
  return context;
}

// Debounced highlight function for streaming code updates
const debouncedHighlight = debounce(codeEl => {
  if (window.hljs) {
    hljs.highlightElement(codeEl);
  }
}, 150);

// Send user query and stream assistant response with incremental update
async function sendQuery() {
  const prompt = promptInput.value.trim();
  const imageUrl = imageUrlInput.value.trim();
  const model = modelSelect.value;

  if (!prompt && !imageUrl) {
    alert('Please enter a message or image URL.');
    return;
  }

  addMessage('user', prompt || '[Image URL provided]');
  promptInput.value = '';
  imageUrlInput.value = '';
  statusDiv.textContent = 'Thinking...';
  await renderMessages();

  if (currentChatId) {
    chats[currentChatId].model = model;
    saveChats();
  }

  try {
    let responseStream;
    if (imageUrl) {
      const fullPrompt = prompt || 'Describe this image';
      const contextPrompt = buildContextPrompt(fullPrompt);
      responseStream = await puter.ai.chat(contextPrompt, imageUrl, { model, stream: true });
    } else {
      const contextPrompt = buildContextPrompt(prompt);
      responseStream = await puter.ai.chat(contextPrompt, { model, stream: true });
    }

    let assistantReply = '';

    // Add empty assistant message placeholder
    addMessage('assistant', '');
    await renderMessages();

    const chat = chats[currentChatId];
    let lastMsg = chat.messages[chat.messages.length - 1];

    for await (const part of responseStream) {
      if (part?.text) {
        assistantReply += part.text;
        lastMsg.text = assistantReply;
        saveChats();

        // Re-render all messages (or optimize to only update last message)
        await renderMessages();

        chatDiv.scrollTop = chatDiv.scrollHeight;
      }
    }

    statusDiv.textContent = '';
    if (assistantVoiceEnabled) speakText(assistantReply);

  } catch (e) {
    statusDiv.textContent = 'Error: ' + e.message;
  }
}

// Generate image from prompt
async function generateImage() {
  const prompt = promptInput.value.trim();
  if (!prompt) {
    alert('Enter prompt to generate image.');
    return;
  }
  statusDiv.textContent = 'Generating image...';
  try {
    const img = await puter.ai.txt2img(prompt);
    addMessage('user', prompt);
    addMessage('assistant', '[Image generated below]');
    await renderMessages();

    // Wrap image in assistant bubble for consistent UI
    const imgBubble = document.createElement('div');
    imgBubble.className = 'bubble assistant';
    const imgElem = document.createElement('img');
    imgElem.src = img.src;
    imgElem.style.maxWidth = '100%';
    imgElem.alt = 'Generated image';
    imgBubble.appendChild(imgElem);
    chatDiv.appendChild(imgBubble);
    chatDiv.scrollTop = chatDiv.scrollHeight;

    statusDiv.textContent = 'Image generated.';
    promptInput.value = '';
  } catch (e) {
    statusDiv.textContent = 'Error generating image.';
  }
}

// Setup voice recognition with toggle and permission prompt
function setupVoiceRecognition() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    voiceInputBtn.disabled = true;
    voiceInputBtn.title = 'Voice input not supported in this browser';
    statusDiv.textContent = 'Voice input not supported in this browser.';
    return;
  }
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    isListening = true;
    voiceInputBtn.textContent = '🎙️ Listening... (click to stop)';
    statusDiv.textContent = 'Listening...';
  };
  recognition.onend = () => {
    isListening = false;
    voiceInputBtn.textContent = '🎤';
    statusDiv.textContent = '';
  };
  recognition.onerror = (e) => {
    console.error('Voice input error:', e.error);
    statusDiv.textContent = 'Voice input error: ' + e.error;
    isListening = false;
    voiceInputBtn.textContent = '🎤';
    if (e.error === 'not-allowed' || e.error === 'permission-denied') {
      alert('Microphone access denied. Please allow microphone permissions and reload the page.');
    }
  };
  recognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    promptInput.value = transcript;
    statusDiv.textContent = 'You said: ' + transcript;
  };
}

// Show/hide mic permission prompt
function showMicPermissionPrompt() {
  micPermissionPrompt.style.display = 'flex';
}

function hideMicPermissionPrompt() {
  micPermissionPrompt.style.display = 'none';
}

// Toggle voice input listening with permission prompt
function toggleVoiceInput() {
  if (!recognition) return;
  if (isListening) {
    recognition.stop();
  } else {
    showMicPermissionPrompt();
  }
}

// Toggle assistant voice on/off
function toggleAssistantVoice() {
  assistantVoiceEnabled = !assistantVoiceEnabled;
  voiceToggle.textContent = assistantVoiceEnabled ? '🔊' : '🔈';
  localStorage.setItem('assistantVoiceEnabled', assistantVoiceEnabled ? 'true' : 'false');
}

// Load assistant voice preference
function loadAssistantVoicePref() {
  const val = localStorage.getItem('assistantVoiceEnabled');
  assistantVoiceEnabled = val !== 'false';
  voiceToggle.textContent = assistantVoiceEnabled ? '🔊' : '🔈';
}

// Text-to-speech for assistant voice
function speakText(text) {
  if (!synth) return;
  if (synth.speaking) synth.cancel();
  if (!text) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  synth.speak(utterance);
}

// Dark mode toggle
function toggleDarkMode() {
  document.body.classList.toggle('dark');
  sidebar.classList.toggle('dark');
  newChatForm.classList.toggle('dark');
  chatListEl.querySelectorAll('li').forEach(li => li.classList.toggle('dark'));
  if (document.body.classList.contains('dark')) {
    darkModeToggle.textContent = '☀️';
    localStorage.setItem('darkMode', 'true');
  } else {
    darkModeToggle.textContent = '🌙';
    localStorage.setItem('darkMode', 'false');
  }
}

// Load dark mode preference
function loadDarkMode() {
  if (localStorage.getItem('darkMode') === 'true') {
    document.body.classList.add('dark');
    sidebar.classList.add('dark');
    newChatForm.classList.add('dark');
    chatListEl.querySelectorAll('li').forEach(li => li.classList.add('dark'));
    darkModeToggle.textContent = '☀️';
  } else {
    darkModeToggle.textContent = '🌙';
  }
}

// Initialize app and add event listeners inside DOMContentLoaded
window.addEventListener('DOMContentLoaded', () => {
  // Initialization
  loadChats();
  if (Object.keys(chats).length === 0) {
    createNewChat('Default Chat');
  } else {
    switchChat(Object.keys(chats)[0]);
  }
  setupVoiceRecognition();
  loadDarkMode();
  loadAssistantVoicePref();

  // Event listeners
  newChatForm.addEventListener('submit', e => {
    e.preventDefault();
    createNewChat(newChatNameInput.value);
  });
  sendBtn.addEventListener('click', sendQuery);
  generateImageBtn.addEventListener('click', generateImage);
  voiceInputBtn.addEventListener('click', toggleVoiceInput);
  darkModeToggle.addEventListener('click', toggleDarkMode);
  voiceToggle.addEventListener('click', toggleAssistantVoice);

  promptInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendQuery();
    }
  });

  allowMicBtn.addEventListener('click', () => {
    hideMicPermissionPrompt();
    try {
      recognition.start();
    } catch (err) {
      console.error('Error starting recognition:', err);
      statusDiv.textContent = 'Error starting voice recognition: ' + err.message;
    }
  });

  denyMicBtn.addEventListener('click', () => {
    hideMicPermissionPrompt();
    statusDiv.textContent = 'Microphone permission denied.';
  });
});
