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
const modelSelect = document.getElementById("modelSelect");
const generateImageBtn = document.getElementById("generateImageBtn");
const darkModeToggle = document.getElementById("darkModeToggle");
const statusDiv = document.getElementById("status");
const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");

// Removed mic permission prompt elements and voice input button

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
  if (!auth.currentUser) {
    console.warn("saveChatsToFirestore called but no user");
    return;
  }
  try {
    const docRef = doc(db, "users", auth.currentUser.uid);
    await setDoc(docRef, { chats }, { merge: true });
    console.log("Chats saved to Firestore");
  } catch (error) {
    console.error("Error saving chats to Firestore:", error);
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
    console.error("Error loading chats from Firestore:", error);
    return {};
  }
}

// ------------------- LOCAL STORAGE -------------------

function saveChatsToLocalStorage() {
  try {
    localStorage.setItem("personal_ai_chats", JSON.stringify(chats));
    console.log("Chats saved to localStorage");
  } catch (e) {
    console.error("Error saving chats to localStorage:", e);
  }
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

async function saveChats() {
  if (auth.currentUser) {
    await saveChatsToFirestore();
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
    delBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (
        confirm(
          `Are you sure you want to delete chat "${chat.name}"? This action cannot be undone.`
        )
      ) {
        delete chats[id];
        await saveChats();
        if (currentChatId === id) {
          const remainingIds = Object.keys(chats);
          if (remainingIds.length > 0) {
            switchChat(remainingIds[0]);
          } else {
            await createNewChat("Default Chat");
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
      p.textContent = String(part.content).trim();
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

async function addMessage(role, text) {
  if (!currentChatId) return;
  const chat = chats[currentChatId];
  chat.messages.push({ role, text });
  if (chat.messages.length > 50) chat.messages.shift();
  await saveChats();
}

async function createNewChat(name) {
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
  await saveChats();
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

  await addMessage("user", prompt);
  promptInput.value = "";
  statusDiv.textContent = "Thinking...";
  await renderMessages();

  if (currentChatId) {
    chats[currentChatId].model = model;
    await saveChats();
  }

  try {
    const contextPrompt = buildContextPrompt(prompt);

    // Replace puter.ai.chat with your actual chat API call
    const response = await puter.ai.chat(contextPrompt, { model, stream: true });

    if (response[Symbol.asyncIterator]) {
      // Streaming response
      let assistantReply = "";
      await addMessage("assistant", "");
      await renderMessages();

      const chat = chats[currentChatId];
      let lastMsg = chat.messages[chat.messages.length - 1];

      for await (const part of response) {
        if (part?.text) {
          assistantReply += part.text;
          lastMsg.text = assistantReply;
          await saveChats();
          await renderMessages();
          chatDiv.scrollTop = chatDiv.scrollHeight;
        }
      }

      statusDiv.textContent = "";
      // Removed speech synthesis
    } else {
      // Non-streaming response fallback
      const assistantReply = response.message?.content || response;
      await addMessage("assistant", assistantReply);
      await renderMessages();
      statusDiv.textContent = "";
      // Removed speech synthesis
    }
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
    await addMessage("user", prompt);
    await addMessage("assistant", "[Image generated below]");
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
  } catch (e) {
    console.error("Error generating image:", e);
    statusDiv.textContent = "Error generating image.";
  }
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

// ------------------- SIDEBAR TOGGLE FOR MOBILE -------------------

sidebarToggle.addEventListener("click", () => {
  sidebar.classList.toggle("collapsed");
});

document.addEventListener("click", (e) => {
  if (window.innerWidth <= 768) {
    if (!sidebar.contains(e.target) && !sidebarToggle.contains(e.target)) {
      sidebar.classList.add("collapsed");
    }
  }
});

function checkWidth() {
  if (window.innerWidth <= 768) {
    sidebar.classList.add("collapsed");
  } else {
    sidebar.classList.remove("collapsed");
  }
}
window.addEventListener("resize", checkWidth);
window.addEventListener("load", checkWidth);

// ------------------- LOGIN MODAL SHOW/HIDE -------------------

function showLogin() {
  loginModal.classList.remove("hidden");
  loginModal.classList.add("active");
  emailInput.focus();
}

function hideLogin() {
  loginModal.classList.remove("active");
  loginModal.classList.add("hidden");
  loginError.textContent = "";
  emailInput.value = "";
  passwordInput.value = "";
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
    chats = loadChatsFromLocalStorage();
  }

  if (Object.keys(chats).length === 0) {
    await createNewChat("Default Chat");
  } else {
    switchChat(Object.keys(chats)[0]);
  }
  renderChatList();
  renderMessages();
});

// ------------------- INITIALIZATION -------------------

window.addEventListener("DOMContentLoaded", () => {
  loadDarkMode();

  if (!newChatForm.dataset.listenerAttached) {
    newChatForm.addEventListener("submit", (e) => {
      e.preventDefault();
      createNewChat(newChatNameInput.value);
    });
    newChatForm.dataset.listenerAttached = "true";
  }

  if (!sendBtn.dataset.listenerAttached) {
    sendBtn.addEventListener("click", () => {
      sendQuery();
    });
    sendBtn.dataset.listenerAttached = "true";
  }

  if (!generateImageBtn.dataset.listenerAttached) {
    generateImageBtn.addEventListener("click", generateImage);
    generateImageBtn.dataset.listenerAttached = "true";
  }

  if (!darkModeToggle.dataset.listenerAttached) {
    darkModeToggle.addEventListener("click", toggleDarkMode);
    darkModeToggle.dataset.listenerAttached = "true";
  }

  if (!promptInput.dataset.listenerAttached) {
    promptInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendQuery();
      }
    });
    promptInput.dataset.listenerAttached = "true";
  }

  // Optionally show login modal on page load if no user
  if (!auth.currentUser) {
    showLogin();
  }
});
