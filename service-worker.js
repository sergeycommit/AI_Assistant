// service-worker.js
// Background script for the AI Assistant extension

// Set the side panel to open when clicking the extension icon and ensure it takes full space
chrome.sidePanel.setPanelBehavior({
    openPanelOnActionClick: true
}).catch((error) => console.error("Failed to set panel behavior:", error));

// Listen for installation or update of the extension
chrome.runtime.onInstalled.addListener((details) => {
    console.log(`AI Assistant extension ${details.reason}`);

    // Handle different installation scenarios
    if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
        // Code to be executed on first install
        // Open a welcome page
        chrome.tabs.create({
            url: "https://sergeycommit.github.io/AI_Assistant/",
        });
    } else if (details.reason === chrome.runtime.OnInstalledReason.UPDATE) {
        // When extension is updated
        console.log("Extension updated to version", chrome.runtime.getManifest().version);
    } else if (details.reason === chrome.runtime.OnInstalledReason.CHROME_UPDATE) {
        // When browser is updated
        console.log("Chrome browser was updated");
    } else if (details.reason === chrome.runtime.OnInstalledReason.SHARED_MODULE_UPDATE) {
        // When a shared module is updated
        console.log("Shared module was updated");
    }

    // Initialize storage with empty chat history and default settings if needed
    chrome.storage.local.get(['chatHistory', 'userSettings'], function(result) {
        // Initialize chat history if not exists
        if (!result.chatHistory) {
            chrome.storage.local.set({chatHistory: ''});
        }

        // Initialize settings if not exists
        if (!result.userSettings) {
            const defaultSettings = {
                darkMode: false
            };
            chrome.storage.local.set({userSettings: defaultSettings});
        }
    });

    // Create context menu for quick access
    chrome.contextMenus.create({
        id: "aiAssistant",
        title: "Ask AI Assistant",
        contexts: ["selection"]
    });
});

// Listen for context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "aiAssistant" && info.selectionText) {
        // Store the selected text temporarily
        chrome.storage.local.set({
            tempUserInput: info.selectionText
        }, function() {
            // Open the side panel with the selected text
            chrome.sidePanel.open({windowId: tab.windowId});
        });
    }
});

// Listen for messages from the popup/side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "getTempUserInput") {
        // Get temporary user input (from context menu)
        chrome.storage.local.get(['tempUserInput'], function(result) {
            sendResponse({text: result.tempUserInput || ''});
            // Clear the temp input after retrieving
            chrome.storage.local.remove(['tempUserInput']);
        });
        return true; // Indicates async response
    }
});

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
    chrome.sidePanel.open({windowId: tab.windowId});
});