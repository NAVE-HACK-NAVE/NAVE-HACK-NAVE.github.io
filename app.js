// app.js - Gemini Chat Application

class GeminiChatApp {
  constructor() {
    this.apiKey = 'AIzaSyDrIXxX1KxARUksyJ4Q0oXRApDnlRiFZnA'; // ← Replace with your actual Gemini API key
    this.apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';
    
    this.conversations = JSON.parse(localStorage.getItem('geminiConversations')) || [];
    this.currentChatId = localStorage.getItem('currentChatId') || null;
    this.isTyping = false;

    this.elements = {
      chatArea: document.getElementById('chatArea'),
      messageForm: document.getElementById('messageForm'),
      messageInput: document.getElementById('messageInput'),
      conversationList: document.getElementById('conversationList'),
      newChatBtn: document.getElementById('newChat'),
      sidebar: document.getElementById('sidebar'),
      menuToggle: document.getElementById('menuToggle'),
      themeToggle: document.getElementById('themeToggle'),
      rateLimitAlert: document.getElementById('rateLimitAlert')
    };

    this.init();
  }

  init() {
    this.loadTheme();
    this.restoreChat();
    this.bindEvents();
    this.renderConversationList();
  }

  bindEvents() {
    this.elements.messageForm.addEventListener('submit', (e) => this.handleSendMessage(e));
    this.elements.newChatBtn.addEventListener('click', () => this.startNewChat());
    this.elements.menuToggle.addEventListener('click', () => this.toggleSidebar());
    this.elements.themeToggle.addEventListener('click', () => this.toggleTheme());

    // Close sidebar when clicking outside on mobile
    document.addEventListener('click', (e) => {
      const isSidebar = this.elements.sidebar.contains(e.target);
      const isToggle = this.elements.menuToggle.contains(e.target);
      if (!isSidebar && !isToggle && window.innerWidth < 1024) {
        this.closeSidebar();
      }
    });

    // Keyboard navigation
    this.elements.messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.elements.messageForm.requestSubmit();
      }
    });
  }

  async handleSendMessage(e) {
    e.preventDefault();
    const input = this.elements.messageInput;
    const text = input.value.trim();

    if (!text || this.isTyping) return;

    this.addUserMessage(text);
    input.value = '';

    this.isTyping = true;
    this.addAIMessagePlaceholder();

    try {
      const response = await this.callGeminiAPI(text);
      this.updateLastMessage(response);
    } catch (error) {
      this.updateLastMessage("❌ Sorry, I couldn't process your request. " + error.message);
      if (error.message.includes('429')) {
        this.showRateLimitAlert();
      }
    } finally {
      this.isTyping = false;
      Prism.highlightAll();
      this.scrollToBottom();
    }
  }

  async callGeminiAPI(prompt) {
    const chat = this.getCurrentChat();
    const history = chat.messages
      .filter(m => m.role !== 'assistant' || m.content !== '...')
      .map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }]
      }));

    const response = await fetch(`${this.apiUrl}?key=${this.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: history })
    });

    if (!response.ok) {
      const errText = await response.text();
      if (response.status === 429) throw new Error('429: Rate limit exceeded');
      throw new Error(`HTTP ${response.status}: ${errText}`);
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "No response";
  }

  addUserMessage(text) {
    const chat = this.getCurrentChat();
    const message = { role: 'user', content: text, timestamp: Date.now() };
    chat.messages.push(message);
    this.saveConversations();

    const messageEl = this.createMessageElement(message);
    this.elements.chatArea.appendChild(messageEl);
    this.scrollToBottom();
  }

  addAIMessagePlaceholder() {
    const chat = this.getCurrentChat();
    const placeholder = { role: 'assistant', content: '...', timestamp: Date.now() };
    chat.messages.push(placeholder);
    this.saveConversations();

    const el = document.createElement('div');
    el.className = 'flex justify-start';
    el.innerHTML = `
      <div class="message ai-message relative">
        <div class="typing">Thinking</div>
      </div>
    `;
    el.id = 'typing-placeholder';
    this.elements.chatArea.appendChild(el);
    this.scrollToBottom();
  }

  updateLastMessage(content) {
    const chat = this.getCurrentChat();
    const lastMsg = chat.messages[chat.messages.length - 1];
    lastMsg.content = content;
    this.saveConversations();

    const placeholder = document.getElementById('typing-placeholder');
    if (!placeholder) return;

    const mdContent = marked.parse(content);
    placeholder.outerHTML = `
      <div class="flex justify-start">
        <div class="message ai-message relative group">
          <div class="markdown-content">${mdContent}</div>
          <button class="copy-btn" onclick="app.copyResponse(this)">
            <i class="fas fa-copy"></i>
          </button>
        </div>
      </div>
    `;

    Prism.highlightAll();
    this.scrollToBottom();
  }

  createMessageElement(message) {
    const isUser = message.role === 'user';
    const div = document.createElement('div');
    div.className = `flex ${isUser ? 'justify-end' : 'justify-start'}`;

    const mdContent = marked.parse(message.content);
    const copyButton = isUser ? '' : `
      <button class="copy-btn" onclick="app.copyResponse(this)">
        <i class="fas fa-copy"></i>
      </button>
    `;

    div.innerHTML = `
      <div class="message ${isUser ? 'user-message' : 'ai-message'} relative group">
        <div class="markdown-content">${mdContent}</div>
        ${copyButton}
      </div>
    `;

    return div;
  }

  getCurrentChat() {
    if (!this.currentChatId || !this.conversations.find(c => c.id === this.currentChatId)) {
      this.startNewChat();
    }
    return this.conversations.find(c => c.id === this.currentChatId);
  }

  startNewChat() {
    const id = Date.now().toString();
    const newChat = {
      id,
      title: 'New Conversation',
      messages: [],
      createdAt: Date.now()
    };
    this.conversations.unshift(newChat);
    this.currentChatId = id;
    this.saveConversations();
    localStorage.setItem('currentChatId', id);
    this.clearChatArea();
    this.renderConversationList();
    this.updateTitle();
  }

  restoreChat() {
    if (!this.currentChatId) {
      this.startNewChat();
      return;
    }

    const chat = this.conversations.find(c => c.id === this.currentChatId);
    if (!chat) {
      this.startNewChat();
      return;
    }

    this.renderChatMessages(chat);
    this.updateTitle();
  }

  renderChatMessages(chat) {
    this.clearChatArea();
    if (chat.messages.length === 0) {
      this.showEmptyState();
      return;
    }

    chat.messages.forEach(message => {
      const el = this.createMessageElement(message);
      this.elements.chatArea.appendChild(el);
    });

    setTimeout(() => Prism.highlightAll(), 100);
    this.scrollToBottom();
  }

  clearChatArea() {
    this.elements.chatArea.innerHTML = '';
  }

  showEmptyState() {
    this.clearChatArea();
    const el = document.createElement('div');
    el.className = 'flex justify-center';
    el.innerHTML = `
      <div class="max-w-2xl text-center">
        <i class="fas fa-robot text-6xl text-indigo-500 mb-4"></i>
        <h2 class="text-2xl font-bold text-gray-800 dark:text-white mb-2">Gemini Assistant</h2>
        <p class="text-gray-600 dark:text-gray-300">Ask me anything!</p>
      </div>
    `;
    this.elements.chatArea.appendChild(el);
  }

  renderConversationList() {
    this.elements.conversationList.innerHTML = '';
    this.conversations.forEach(chat => {
      const active = chat.id === this.currentChatId;
      const item = document.createElement('div');
      const title = this.getChatTitle(chat);
      item.className = `p-2 px-3 mb-1 rounded-md text-sm cursor-pointer flex justify-between items-center hover:bg-gray-200 dark:hover:bg-gray-700 ${active ? 'bg-gray-200 dark:bg-gray-700 font-medium' : 'text-gray-700 dark:text-gray-300'}`;
      item.innerHTML = `
        <span class="truncate">${title}</span>
        <i class="fas fa-trash text-xs opacity-0 group-hover:opacity-100 hover:text-red-500 transition-opacity"></i>
      `;
      item.onclick = (e) => {
        e.stopPropagation();
        if (e.target.closest('.fa-trash')) {
          this.deleteChat(chat.id);
        } else {
          this.openChat(chat.id);
        }
      };
      this.elements.conversationList.prepend(item);
    });
  }

  getChatTitle(chat) {
    if (chat.title !== 'New Conversation') return chat.title;
    const firstMsg = chat.messages.find(m => m.role === 'user');
    return firstMsg ? (firstMsg.content.length > 30 ? firstMsg.content.substring(0, 30) + '...' : firstMsg.content) : 'New Conversation';
  }

  openChat(id) {
    this.currentChatId = id;
    localStorage.setItem('currentChatId', id);
    const chat = this.conversations.find(c => c.id === id);
    this.clearChatArea();
    this.renderChatMessages(chat);
    this.updateTitle();
    this.closeSidebar();
  }

  deleteChat(id) {
    if (this.conversations.length <= 1) {
      alert("You can't delete the last conversation.");
      return;
    }

    this.conversations = this.conversations.filter(c => c.id !== id);
    if (this.currentChatId === id) {
      const next = this.conversations[0].id;
      this.openChat(next);
    }
    this.saveConversations();
    this.renderConversationList();
  }

  updateTitle() {
    const chat = this.getCurrentChat();
    const title = this.getChatTitle(chat);
    document.title = `${title} | Gemini Chat`;
  }

  saveConversations() {
    localStorage.setItem('geminiConversations', JSON.stringify(this.conversations));
  }

  copyResponse(button) {
    const content = button.parentElement.querySelector('.markdown-content').innerText;
    navigator.clipboard.writeText(content).then(() => {
      const icon = button.querySelector('i');
      icon.className = 'fas fa-check';
      setTimeout(() => {
        icon.className = 'fas fa-copy';
      }, 2000);
    }).catch(err => {
      console.error('Copy failed', err);
    });
  }

  scrollToBottom() {
    this.elements.chatArea.scrollTop = this.elements.chatArea.scrollHeight;
  }

  toggleSidebar() {
    this.elements.sidebar.classList.toggle('-translate-x-full');
  }

  closeSidebar() {
    this.elements.sidebar.classList.add('-translate-x-full');
  }

  toggleTheme() {
    document.documentElement.classList.toggle('dark');
    this.saveTheme();
  }

  loadTheme() {
    if (localStorage.getItem('theme') === 'dark' || 
        (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }

  saveTheme() {
    const isDark = document.documentElement.classList.contains('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    const iconSun = document.querySelector('.fa-sun');
    const iconMoon = document.querySelector('.fa-moon');
    if (isDark) {
      iconSun.classList.remove('hidden');
      iconMoon.classList.add('hidden');
    } else {
      iconSun.classList.add('hidden');
      iconMoon.classList.remove('hidden');
    }
  }

  showRateLimitAlert() {
    const alert = this.elements.rateLimitAlert;
    alert.classList.remove('hidden');
    setTimeout(() => {
      alert.classList.add('hidden');
    }, 5000);
  }
}

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
  window.app = new GeminiChatApp();
});