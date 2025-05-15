import {
  auth,
  db,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  doc,
  getDoc,
  setDoc,
  GoogleAuthProvider,
  signInWithPopup,
} from "./firebase-app.js";

// Elements
const chatListEl = document.getElementById("chatList");
const newChatForm = document.getElementById("newChatForm");
const newChatNameInput = document.getElementById("newChatName");
const chatDiv = document.getElementById("chat");
const promptInput = document.getElementById("prompt");
const sendBtn = document.getElementById("sendBtn");
const voiceInputBtn = document.getElementById("voiceInputBtn");
const modelSelect = document.getElementById("modelSelect");
const generateImageBtn = document.getElementById("generateImageBtn");
const darkModeToggle = document.getElementById("darkModeToggle");
const voiceToggle = document.getElementById("voiceToggle");
const statusDiv = document.getElementById("status");
const sidebar = document.getElementById("sidebar");

// Mic permission prompt elements
const micPermissionPrompt = document.getElementById("micPermissionPrompt");
const allowMicBtn = document.getElementById("allowMicBtn");
const denyMicBtn = document.getElementById("denyMicBtn");

// Login modal elements
const loginModal = document.getElementById("loginModal");
const emailInput = document.getElementById("emailInput");
const passwordInput = document.getElementById("passwordInput");
const loginBtn = document.getElementById("loginBtn");
const signupBtn = document.getElementById("signupBtn");
const loginError = document.getElementById("loginError");
const googleSignInBtn = document.getElementById("googleSignInBtn");

// Auth button in sidebar
const authBtn = document.createElement("button");
authBtn.id = "authBtn";
authBtn.style.margin = "10px";
authBtn.style.padding = "6px 12px";
authBtn.style.cursor = "pointer";
sidebar.insertBefore(authBtn, sidebar.firstChild);

// State variables
let chats = {};
let currentChatId = null;
let recognition = null;
let isListening = false;
let synth = window.speechSynthesis;
let assistantVoiceEnabled = true;

// Utility delay function
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// Debounce helper
function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// ------------------- FIRESTORE SYNC -------------------

async function saveChatsToFirestore() {
  if (!auth.currentUser) return;
  try {
    const docRef = doc(db, "users", auth.currentUser.uid);
    await setDoc(docRef, { chats });
  } catch (error) {
    console.error("Error saving chats:", error);
  }
}

async function loadChatsFromFirestore(userId) {
  try {
    const docRef = doc(db, "users", userId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return docSnap.data().chats || {};
    } else {
      return {};
    }
  } catch (error) {
    console.error("Error loading chats:", error);
    return {};
  }
}

// ------------------- LOCAL STORAGE -------------------

function saveChatsToLocalStorage() {
  localStorage.setItem("personal_ai_chats", JSON.stringify(chats));
}

function loadChatsFromLocalStorage() {
  const saved = localStorage.getItem("personal_ai_chats");
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {
      return {};
    }
  }
  return {};
}

// ------------------- CHAT STORAGE -------------------

function saveChats() {
  if (auth.currentUser) {
    saveChatsToFirestore();
  } else {
    saveChatsToLocalStorage();
  }
}

function generateId() {
  return "chat_" + Math.random().toString(36).slice(2, 10);
}

function renderChatList() {
  chatListEl.innerHTML = "";
  for (const [id, chat] of Object.entries(chats)) {
    const li = document.createElement("li");
    li.textContent = chat.name;
    li.dataset.chatId = id;
    li.classList.toggle("active", id === currentChatId);
    if (document.body.classList.contains("dark")) li.classList.add("dark");

    li.addEventListener("click", (e) => {
      if (e.target.classList.contains("delete-btn")) return;
      switchChat(id);
    });

    const delBtn = document.createElement("span");
    delBtn.textContent = "×";
    delBtn.className = "delete-btn";
    delBtn.title = "Delete chat";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (
        confirm(
          `Are you sure you want to delete chat "${chat.name}"? This action cannot be undone.`
        )
      ) {
        delete chats[id];
        saveChats();
        if (currentChatId === id) {
          const remainingIds = Object.keys(chats);
          if (remainingIds.length > 0) {
            switchChat(remainingIds[0]);
          } else {
            createNewChat("Default Chat");
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

function switchChat(id) {
  if (!chats[id]) return;
  currentChatId = id;
  renderChatList();
  loadChatToUI();
}

async function loadChatToUI() {
  if (!currentChatId) return;
  const chat = chats[currentChatId];
  modelSelect.value = chat.model || "deepseek-chat";
  statusDiv.textContent = "";
  await renderMessages();
}

function parseMessageParts(text) {
  const regex = /```(\w+)?\n([\s\S]*?)```/g;
  let result = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }
    result.push({ type: "code", lang: match[1] || "", content: match[2] });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    result.push({ type: "text", content: text.slice(lastIndex) });
  }

  return result;
}

async function createMessageElement(msg) {
  if (msg.role === "user") {
    const bubble = document.createElement("div");
    bubble.className = "bubble user";
    bubble.textContent = msg.text;
    return bubble;
  }

  const parts = parseMessageParts(msg.text);

  const container = document.createElement("div");
  container.className = "assistant-message-container";

  for (const part of parts) {
    if (part.type === "text") {
      const p = document.createElement("p");
      p.className = "bubble assistant";
      p.textContent = part.content.trim();
      container.appendChild(p);
    } else if (part.type === "code") {
      const wrapper = document.createElement("div");
      wrapper.style.position = "relative";

      const copyBtn = document.createElement("button");
      copyBtn.textContent = "Copy Code";
      copyBtn.style.position = "absolute";
      copyBtn.style.top = "8px";
      copyBtn.style.right = "8px";
      copyBtn.style.padding = "4px 8px";
      copyBtn.style.fontSize = "0.8em";
      copyBtn.style.cursor = "pointer";
      copyBtn.style.borderRadius = "4px";
      copyBtn.style.border = "none";
      copyBtn.style.backgroundColor = "var(--primary)";
      copyBtn.style.color = "white";
      copyBtn.style.zIndex = "10";

      const pre = document.createElement("pre");
      pre.className = "code-box hljs";
      const code = document.createElement("code");
      if (part.lang) code.className = part.lang;
      code.textContent = part.content;
      pre.appendChild(code);

      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(code.textContent);
          copyBtn.textContent = "Copied!";
          setTimeout(() => {
            copyBtn.textContent = "Copy Code";
          }, 1500);
        } catch {
          copyBtn.textContent = "Failed to copy";
          setTimeout(() => {
            copyBtn.textContent = "Copy Code";
          }, 1500);
        }
      });

      wrapper.appendChild(copyBtn);
      wrapper.appendChild(pre);

      if (window.hljs && hljs.highlightElement) {
        hljs.highlightElement(code);
      }

      container.appendChild(wrapper);
    }
  }

  return container;
}

async function renderMessages() {
  if (!currentChatId) return;
  chatDiv.innerHTML = "";
  const chat = chats[currentChatId];

  for (const msg of chat.messages) {
    const el = await createMessageElement(msg);
    chatDiv.appendChild(el);
  }
  chatDiv.scrollTop = chatDiv.scrollHeight;
}

function addMessage(role, text) {
  if (!currentChatId) return;
  const chat = chats[currentChatId];
  chat.messages.push({ role, text });
  if (chat.messages.length > 50) chat.messages.shift();
  saveChats();
}

function createNewChat(name) {
  if (!name.trim()) {
    alert("Enter a chat name");
    return;
  }
  const id = generateId();
  chats[id] = {
    name: name.trim(),
    messages: [],
    model: "deepseek-chat",
  };
  saveChats();
  switchChat(id);
  newChatNameInput.value = "";
}

function buildContextPrompt(newUserMessage) {
  if (!currentChatId) return newUserMessage;
  const chat = chats[currentChatId];
  let context = "";
  chat.messages.forEach((msg) => {
    context += `${msg.role === "user" ? "User" : "Assistant"}: ${msg.text}\n`;
  });
  context += `User: ${newUserMessage}\nAssistant:`;
  return context;
}

const debouncedHighlight = debounce((codeEl) => {
  if (window.hljs && hljs.highlightElement) {
    hljs.highlightElement(codeEl);
  }
}, 150);

// ------------------- SEND QUERY & IMAGE GENERATION -------------------

async function sendQuery() {
  const prompt = promptInput.value.trim();
  const model = modelSelect.value;

  if (!prompt) {
    alert("Please enter a message.");
    return;
  }

  addMessage("user", prompt);
  promptInput.value = "";
  statusDiv.textContent = "Thinking...";
  await renderMessages();

  if (currentChatId) {
    chats[currentChatId].model = model;
    saveChats();
  }

  try {
    const contextPrompt = buildContextPrompt(prompt);
    // Replace puter.ai.chat with your actual streaming API call
    const responseStream = await puter.ai.chat(contextPrompt, { model, stream: true });

    let assistantReply = "";

    addMessage("assistant", "");
    await renderMessages();

    const chat = chats[currentChatId];
    let lastMsg = chat.messages[chat.messages.length - 1];

    for await (const part of responseStream) {
      if (part?.text) {
        assistantReply += part.text;
        lastMsg.text = assistantReply;
        saveChats();

        await renderMessages();

        chatDiv.scrollTop = chatDiv.scrollHeight;
      }
    }

    statusDiv.textContent = "";
    if (assistantVoiceEnabled) speakText(assistantReply);
  } catch (e) {
    console.error("Error in sendQuery:", e);
    statusDiv.textContent = "Error: " + (e.message || JSON.stringify(e));
  }
}

async function generateImage() {
  const prompt = promptInput.value.trim();
  if (!prompt) {
    alert("Enter prompt to generate image.");
    return;
  }
  statusDiv.textContent = "Generating image...";
  try {
    // Replace puter.ai.txt2img with your actual image generation API call
    const img = await puter.ai.txt2img(prompt);
    addMessage("user", prompt);
    addMessage("assistant", "[Image generated below]");
    await renderMessages();

    const imgBubble = document.createElement("div");
    imgBubble.className = "bubble assistant";
    const imgElem = document.createElement("img");
    imgElem.src = img.src;
    imgElem.style.maxWidth = "100%";
    imgElem.alt = "Generated image";
    imgBubble.appendChild(imgElem);
    chatDiv.appendChild(imgBubble);
    chatDiv.scrollTop = chatDiv.scrollHeight;

    statusDiv.textContent = "Image generated.";
    promptInput.value = "";
  } catch {
    statusDiv.textContent = "Error generating image.";
  }
}

// ------------------- VOICE RECOGNITION -------------------

function setupVoiceRecognition() {
  if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
    voiceInputBtn.disabled = true;
    voiceInputBtn.title = "Voice input not supported in this browser";
    statusDiv.textContent = "Voice input not supported in this browser.";
    return;
  }
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    isListening = true;
    voiceInputBtn.textContent = "🎙️ Listening... (click to stop)";
    statusDiv.textContent = "Listening...";
  };
  recognition.onend = () => {
    isListening = false;
    voiceInputBtn.textContent = "🎤";
    statusDiv.textContent = "";
  };
  recognition.onerror = (e) => {
    console.error("Voice input error:", e.error);
    statusDiv.textContent = "Voice input error: " + e.error;
    isListening = false;
    voiceInputBtn.textContent = "🎤";
    if (e.error === "not-allowed" || e.error === "permission-denied") {
      alert("Microphone access denied. Please allow microphone permissions and reload the page.");
    }
  };
  recognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    promptInput.value = transcript;
    statusDiv.textContent = "You said: " + transcript;
  };
}

function showMicPermissionPrompt() {
  micPermissionPrompt.style.display = "flex";
}

function hideMicPermissionPrompt() {
  micPermissionPrompt.style.display = "none";
}

function toggleVoiceInput() {
  if (!recognition) return;
  if (isListening) {
    recognition.stop();
  } else {
    showMicPermissionPrompt();
  }
}

function toggleAssistantVoice() {
  assistantVoiceEnabled = !assistantVoiceEnabled;
  voiceToggle.textContent = assistantVoiceEnabled ? "🔊" : "🔈";
  localStorage.setItem("assistantVoiceEnabled", assistantVoiceEnabled ? "true" : "false");
}

function loadAssistantVoicePref() {
  const val = localStorage.getItem("assistantVoiceEnabled");
  assistantVoiceEnabled = val !== "false";
  voiceToggle.textContent = assistantVoiceEnabled ? "🔊" : "🔈";
}

function speakText(text) {
  if (!synth) return;
  if (synth.speaking) synth.cancel();
  if (!text) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  synth.speak(utterance);
}

// ------------------- DARK MODE TOGGLE -------------------

function toggleDarkMode() {
  document.body.classList.toggle("dark");
  sidebar.classList.toggle("dark");
  newChatForm.classList.toggle("dark");
  chatListEl.querySelectorAll("li").forEach((li) => li.classList.toggle("dark"));
  if (document.body.classList.contains("dark")) {
    darkModeToggle.textContent = "☀️";
    localStorage.setItem("darkMode", "true");
  } else {
    darkModeToggle.textContent = "🌙";
    localStorage.setItem("darkMode", "false");
  }
}

function loadDarkMode() {
  if (localStorage.getItem("darkMode") === "true") {
    document.body.classList.add("dark");
    sidebar.classList.add("dark");
    newChatForm.classList.add("dark");
    chatListEl.querySelectorAll("li").forEach((li) => li.classList.add("dark"));
    darkModeToggle.textContent = "☀️";
  } else {
    darkModeToggle.textContent = "🌙";
  }
}

// ------------------- LOGIN MODAL SHOW/HIDE -------------------

function showLogin() {
  loginModal.style.display = "flex";
}

function hideLogin() {
  loginModal.style.display = "none";
}

// Close login modal when clicking outside the form
loginModal.addEventListener("click", (e) => {
  if (e.target === loginModal) {
    hideLogin();
  }
});

// ------------------- AUTHENTICATION -------------------

// Update auth button text and behavior based on user state
function updateAuthButton(user) {
  if (user) {
    authBtn.textContent = "Logout";
    authBtn.onclick = async () => {
      await signOut(auth);
    };
  } else {
    authBtn.textContent = "Login / Sign Up";
    authBtn.onclick = () => {
      showLogin();
    };
  }
}

// Login handler
loginBtn.addEventListener("click", async () => {
  loginError.textContent = "";
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  if (!email || !password) {
    loginError.textContent = "Please enter email and password.";
    return;
  }
  try {
    await signInWithEmailAndPassword(auth, email, password);
    hideLogin();
    emailInput.value = "";
    passwordInput.value = "";
  } catch (e) {
    loginError.textContent = e.message;
  }
});

// Signup handler
signupBtn.addEventListener("click", async () => {
  loginError.textContent = "";
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  if (!email || !password) {
    loginError.textContent = "Please enter email and password.";
    return;
  }
  try {
    await createUserWithEmailAndPassword(auth, email, password);
    hideLogin();
    emailInput.value = "";
    passwordInput.value = "";
  } catch (e) {
    loginError.textContent = e.message;
  }
});

// Google Sign-In handler
const provider = new GoogleAuthProvider();

googleSignInBtn.addEventListener("click", async () => {
  loginError.textContent = "";
  try {
    await signInWithPopup(auth, provider);
    hideLogin();
    emailInput.value = "";
    passwordInput.value = "";
  } catch (e) {
    loginError.textContent = e.message || "Google sign-in failed.";
  }
});

// Listen for auth state changes and update UI accordingly
onAuthStateChanged(auth, async (user) => {
  updateAuthButton(user);

  if (user) {
    hideLogin();
    chats = await loadChatsFromFirestore(user.uid);
  } else {
    // Load from localStorage if no user
    chats = loadChatsFromLocalStorage();
  }

  if (Object.keys(chats).length === 0) {
    createNewChat("Default Chat");
  } else {
    switchChat(Object.keys(chats)[0]);
  }
  renderChatList();
  renderMessages();
});

// ------------------- INITIALIZATION -------------------

window.addEventListener("DOMContentLoaded", () => {
  setupVoiceRecognition();
  loadDarkMode();
  loadAssistantVoicePref();

  newChatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    createNewChat(newChatNameInput.value);
  });
  sendBtn.addEventListener("click", sendQuery);
  generateImageBtn.addEventListener("click", generateImage);
  voiceInputBtn.addEventListener("click", toggleVoiceInput);
  darkModeToggle.addEventListener("click", toggleDarkMode);
  voiceToggle.addEventListener("click", toggleAssistantVoice);

  promptInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendQuery();
    }
  });

  allowMicBtn.addEventListener("click", () => {
    hideMicPermissionPrompt();
    try {
      recognition.start();
    } catch (err) {
      console.error("Error starting recognition:", err);
      statusDiv.textContent = "Error starting voice recognition: " + err.message;
    }
  });

  denyMicBtn.addEventListener("click", () => {
    hideMicPermissionPrompt();
    statusDiv.textContent = "Microphone permission denied.";
  });

  // Show login modal on page load
  window.addEventListener("load", () => {
    showLogin();
  });
});
