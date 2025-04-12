document.addEventListener('DOMContentLoaded', function() {
    // DOM Elements
    const chatContainer = document.getElementById('chatContainer');
    const userInput = document.getElementById('userInput');
    const sendButton = document.getElementById('sendButton');
    const clearChatButton = document.getElementById('clearChatButton');
    const charCounter = document.getElementById('charCounter');
    const themeToggleButton = document.getElementById('themeToggleButton');
    const shareButton = document.getElementById('shareButton');

    // State variables
    let isWaitingForResponse = false;
    let userSettings = {
        darkMode: false
    };
    let lastRequestTime = 0;
    const REQUEST_DELAY = 5000; // 5 seconds minimum between requests
    const MAX_RETRIES = 3;

    // Initialize the app
    initializeApp();

    function initializeApp() {
        // Load settings and apply theme
        loadSettings();

        // Load previous chat history
        loadChatHistory();

        // Set up event listeners
        setupEventListeners();

        // Adjust textarea height based on content
        adjustTextareaHeight();

        // Focus on input field
        userInput.focus();

        // Check for temp user input (from context menu)
        chrome.runtime.sendMessage({action: "getTempUserInput"}, function(response) {
            if (response && response.text) {
                userInput.value = response.text;
                updateCharCounter();
                adjustTextareaHeight();
                enableSendButton();
            }
        });
    }

    function loadSettings() {
        chrome.storage.local.get(['userSettings'], function(result) {
            if (result.userSettings) {
                userSettings = result.userSettings;

                // Apply dark mode if enabled
                if (userSettings.darkMode) {
                    document.body.classList.add('dark-mode');
                }
            }
        });
    }

    function loadChatHistory() {
        chrome.storage.local.get(['chatHistory'], function(result) {
            if (result.chatHistory && result.chatHistory.trim() !== '') {
                chatContainer.innerHTML = result.chatHistory;
                chatContainer.scrollTop = chatContainer.scrollHeight;

                // Add event listeners to copied elements
                addCopyButtonListeners();
            }
        });
    }

    function setupEventListeners() {
        // Event listeners for suggestion chips
        document.querySelectorAll('.suggestion-chip').forEach(chip => {
            chip.addEventListener('click', function() {
                userInput.value = this.textContent;
                updateCharCounter();
                adjustTextareaHeight();
                enableSendButton();
                sendMessage();
            });
        });

        // Input field events
        userInput.addEventListener('input', function() {
            updateCharCounter();
            adjustTextareaHeight();
            enableSendButton();
        });

        userInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (sendButton.disabled === false) {
                    sendMessage();
                }
            }
        });

        // Send button click
        sendButton.addEventListener('click', sendMessage);

        // Clear chat button
        clearChatButton.addEventListener('click', confirmClearChat);

        // Theme toggle
        themeToggleButton.addEventListener('click', toggleDarkMode);

        // Share button
        shareButton.addEventListener('click', shareExtension);

        // Handle clicks on copy buttons that might have been loaded from history
        addCopyButtonListeners();
    }

    function updateCharCounter() {
        const currentLength = userInput.value.length;
        charCounter.textContent = `${currentLength}/2000`;

        // Change color if approaching limit
        if (currentLength > 1800) {
            charCounter.style.color = '#f44336';
        } else {
            charCounter.style.color = '';
        }
    }

    function adjustTextareaHeight() {
        userInput.style.height = 'auto';
        const newHeight = Math.min(userInput.scrollHeight, 120);
        userInput.style.height = newHeight + 'px';
    }

    function enableSendButton() {
        sendButton.disabled = userInput.value.trim() === '' || isWaitingForResponse;
    }

    function toggleDarkMode() {
        document.body.classList.toggle('dark-mode');
        userSettings.darkMode = document.body.classList.contains('dark-mode');
        chrome.storage.local.set({userSettings: userSettings});
    }

    function shareExtension() {
        const extensionUrl = "https://chrome.google.com/webstore/detail/ai-assistant/your-extension-id";
        navigator.clipboard.writeText(extensionUrl)
            .then(() => showToast('Extension link copied to clipboard!'))
            .catch(err => {
                console.error('Could not copy link: ', err);
                showToast('Failed to copy link', true);
            });
    }

    function confirmClearChat() {
        if (confirm('Are you sure you want to clear the chat history?')) {
            chatContainer.innerHTML = `
                <div class="welcome-message">
                    <h2>Welcome to AI Assistant</h2>
                    <p>I'm here to help answer your questions, provide information, assist with tasks, or just chat. What would you like to talk about today?</p>
                    <div class="suggestions">
                        <div class="suggestion-chip">Who are you?</div>
                        <div class="suggestion-chip">Help me with code</div>
                        <div class="suggestion-chip">Write a poem</div>
                        <div class="suggestion-chip">How does AI work?</div>
                    </div>
                </div>
            `;
            chrome.storage.local.remove(['chatHistory']);

            // Re-add event listeners for suggestion chips
            document.querySelectorAll('.suggestion-chip').forEach(chip => {
                chip.addEventListener('click', function() {
                    userInput.value = this.textContent;
                    updateCharCounter();
                    adjustTextareaHeight();
                    enableSendButton();
                    sendMessage();
                });
            });

            showToast('Chat history cleared');
        }
    }

    async function sendMessage() {
        const message = userInput.value.trim();
        if (!message || isWaitingForResponse) return;

        // Check rate limiting
        const now = Date.now();
        const timeElapsed = now - lastRequestTime;

        // Add user message to chat
        addMessage(message, 'user-message');
        userInput.value = '';
        updateCharCounter();
        adjustTextareaHeight();

        // Disable input during response and show typing indicator
        isWaitingForResponse = true;
        enableSendButton();
        showTypingIndicator();

        // Scroll to bottom to show the typing indicator
        chatContainer.scrollTop = chatContainer.scrollHeight;

        try {
            // Wait if needed to respect rate limit
            if (timeElapsed < REQUEST_DELAY && lastRequestTime !== 0) {
                const waitTime = REQUEST_DELAY - timeElapsed;
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }

            // Call the AI API with retry logic
            lastRequestTime = Date.now();
            let retries = 0;
            let aiResponse = null;

            while (retries < MAX_RETRIES) {
                try {
                    aiResponse = await sendToAI(message);
                    break;
                } catch (error) {
                    retries++;
                    if (retries >= MAX_RETRIES) {
                        throw error;
                    }
                    await new Promise(resolve => setTimeout(resolve, 1000 * retries));
                }
            }

            removeTypingIndicator();
            addFormattedMessage(aiResponse, 'ai-message');
        } catch (error) {
            removeTypingIndicator();
            addMessage("Sorry, I encountered an error processing your request. Please try again later.", 'ai-message error');
            console.error('Error in AI response:', error);
        } finally {
            isWaitingForResponse = false;
            enableSendButton();
            userInput.focus();
        }
    }

    async function sendToAI(message) {
        try {
            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `API_KEY`
                },
                body: JSON.stringify({
                    model: "google/gemma-3-12b-it",
                    messages: [
                        {
                            role: "system",
                            content: "You are a helpful assistant embedded in a Chrome extension. Format your responses with markdown when appropriate for better readability. Keep your responses concise and focused."
                        },
                        {
                            role: "user",
                            content: message
                        }
                    ],
                    max_tokens: 1000,
                    temperature: 0.7
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error?.message || 'API request failed');
            }

            const data = await response.json();
            return data.choices[0].message.content;
        } catch (error) {
            console.error('Error calling AI API:', error);
            throw error;
        }
    }

    function addMessage(text, className) {
        // Create message container
        const messageGroup = document.createElement('div');
        messageGroup.className = 'message-group';

        // Create message element
        const messageElement = document.createElement('div');
        messageElement.className = className;

        // Convert URLs to clickable links
        const linkedText = text.replace(
            /(https?:\/\/[^\s]+)/g,
            '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
        );

        messageElement.innerHTML = linkedText;

        // Add timestamp
        const timeElement = document.createElement('div');
        timeElement.className = 'message-time';
        timeElement.textContent = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        messageElement.appendChild(timeElement);

        // Add message actions for copying text
        if (className === 'user-message' || className === 'ai-message') {
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'message-actions';

            const copyButton = document.createElement('button');
            copyButton.className = 'message-action-button copy-button tooltip';
            copyButton.innerHTML = `
                <span class="tooltip-text">Copy to clipboard</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
            `;
            copyButton.addEventListener('click', function() {
                copyTextToClipboard(text);
            });

            actionsDiv.appendChild(copyButton);
            messageElement.appendChild(actionsDiv);
        }

        // Add to message group and chat container
        messageGroup.appendChild(messageElement);
        chatContainer.appendChild(messageGroup);
        chatContainer.scrollTop = chatContainer.scrollHeight;

        // Save chat history
        saveChatHistory();
    }

    function addFormattedMessage(text, className) {
        // Create message container
        const messageGroup = document.createElement('div');
        messageGroup.className = 'message-group';

        // Create message element
        const messageElement = document.createElement('div');
        messageElement.className = className;

        // Format markdown
        let formattedText = formatMarkdown(text);

        messageElement.innerHTML = formattedText;

        // Add copy buttons to code blocks
        const codeBlocks = messageElement.querySelectorAll('pre');
        codeBlocks.forEach(block => {
            const copyButton = document.createElement('button');
            copyButton.className = 'copy-code-button';
            copyButton.textContent = 'Copy';
            copyButton.addEventListener('click', function() {
                const code = block.querySelector('code').textContent;
                copyTextToClipboard(code);
                copyButton.textContent = 'Copied!';
                setTimeout(() => {
                    copyButton.textContent = 'Copy';
                }, 2000);
            });
            block.appendChild(copyButton);
        });

        // Add timestamp
        const timeElement = document.createElement('div');
        timeElement.className = 'message-time';
        timeElement.textContent = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        messageElement.appendChild(timeElement);

        // Add message actions for copying text
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'message-actions';

        const copyButton = document.createElement('button');
        copyButton.className = 'message-action-button copy-button tooltip';
        copyButton.innerHTML = `
            <span class="tooltip-text">Copy to clipboard</span>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
        `;
        copyButton.addEventListener('click', function() {
            copyTextToClipboard(text);
        });

        actionsDiv.appendChild(copyButton);
        messageElement.appendChild(actionsDiv);

        // Add to message group and chat container
        messageGroup.appendChild(messageElement);
        chatContainer.appendChild(messageGroup);
        chatContainer.scrollTop = chatContainer.scrollHeight;

        // Save chat history
        saveChatHistory();
    }

    function formatMarkdown(text) {
        // Process code blocks first
        let formattedText = text.replace(/```(\w*)\n([\s\S]*?)```/g, function(match, lang, code) {
            return `<pre${lang ? ` data-language="${lang}"` : ''}><code>${escapeHtml(code.trim())}</code></pre>`;
        });

        // Process other markdown elements
        formattedText = formattedText
            // Inline code
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            // Headers (h3 and smaller only for chat UI)
            .replace(/^### (.*$)/gm, '<h3>$1</h3>')
            .replace(/^#### (.*$)/gm, '<h4>$1</h4>')
            .replace(/^##### (.*$)/gm, '<h5>$1</h5>')
            // Bold
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            // Italic
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            // Links
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
            // Unordered lists
            .replace(/^\s*[\-\*] (.*)$/gm, '<li>$1</li>')
            // Ordered lists
            .replace(/^\s*(\d+\.) (.*)$/gm, '<li>$2</li>')
            // Blockquotes
            .replace(/^\> (.*)$/gm, '<blockquote>$1</blockquote>');

        // Wrap list items in ul or ol
        formattedText = formattedText.replace(/<li>[\s\S]*?<\/li>/g, function(match) {
            return '<ul>' + match + '</ul>';
        });

        // Handle paragraphs - blocks of text separated by newlines
        formattedText = '<p>' + formattedText.replace(/\n\s*\n/g, '</p><p>') + '</p>';

        // Clean up any empty paragraphs
        formattedText = formattedText.replace(/<p>\s*<\/p>/g, '');

        // Fix nested paragraphs in other elements
        formattedText = formattedText
            .replace(/<(h[3-5]|li|blockquote)><p>([\s\S]*?)<\/p><\/\1>/g, '<$1>$2</$1>')
            .replace(/<pre><p>([\s\S]*?)<\/p><\/pre>/g, '<pre>$1</pre>');

        return formattedText;
    }

    function escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function showTypingIndicator() {
        const typingIndicator = document.createElement('div');
        typingIndicator.className = 'typing-indicator';
        typingIndicator.id = 'typingIndicator';

        typingIndicator.innerHTML = `
            <div class="dot-container">
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
            </div>
        `;

        chatContainer.appendChild(typingIndicator);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    function removeTypingIndicator() {
        const typingIndicator = document.getElementById('typingIndicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
    }

    function copyTextToClipboard(text) {
        navigator.clipboard.writeText(text).then(
            function() {
                showToast('Copied to clipboard!');
            },
            function(err) {
                console.error('Could not copy text: ', err);
                showToast('Failed to copy text', true);
            }
        );
    }

    function showToast(message, isError = false) {
        // Create toast container if it doesn't exist
        let toastContainer = document.getElementById('toastContainer');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'toastContainer';
            document.body.appendChild(toastContainer);
        }

        // Create toast
        const toast = document.createElement('div');
        toast.style.backgroundColor = isError ? '#f44336' : '#4caf50';
        toast.style.color = 'white';
        toast.style.padding = '10px 20px';
        toast.style.borderRadius = '4px';
        toast.style.marginTop = '5px';
        toast.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
        toast.style.fontSize = '14px';
        toast.style.opacity = '1';
        toast.style.transition = 'opacity 0.5s';
        toast.textContent = message;

        toastContainer.appendChild(toast);

        // Remove toast after 3 seconds
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => {
                if (toastContainer.contains(toast)) {
                    toastContainer.removeChild(toast);
                }
                if (toastContainer.childNodes.length === 0 && document.body.contains(toastContainer)) {
                    document.body.removeChild(toastContainer);
                }
            }, 500);
        }, 3000);
    }

    function addCopyButtonListeners() {
        // Add event listeners to copy buttons that might have been loaded from history
        document.querySelectorAll('.copy-button').forEach(button => {
            button.addEventListener('click', function() {
                const messageText = this.closest('.user-message, .ai-message').textContent;
                // Remove the timestamp and "Copy to clipboard" text from the copied text
                const cleanedText = messageText.replace(/Copy to clipboard\d+:\d+$/g, '').trim();
                copyTextToClipboard(cleanedText);
            });
        });

        document.querySelectorAll('.copy-code-button').forEach(button => {
            button.addEventListener('click', function() {
                const code = this.parentElement.querySelector('code').textContent;
                copyTextToClipboard(code);
                button.textContent = 'Copied!';
                setTimeout(() => {
                    button.textContent = 'Copy';
                }, 2000);
            });
        });
    }

    function saveChatHistory() {
        chrome.storage.local.set({chatHistory: chatContainer.innerHTML});
    }
});