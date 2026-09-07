// Import the scanner module
importScripts("scanner.js");

const MENU_ID = "scan-and-save-jobs";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Scan & Save Jobs",
    contexts: ["page"],
    documentUrlPatterns: [
      "https://www.linkedin.com/*",
      "https://*.linkedin.com/*",
      "https://www.naukri.com/*"
    ]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) {
    return;
  }

  if (!tab?.id) {
    console.error("No active tab");
    return;
  }

  try {
    console.log("Context menu clicked:", tab.url);

    // Directly call the scanner function
    const result = await scanAndSaveJobs(tab.id);
    console.log("Scan & Save Jobs result:", result);
  } catch (error) {
    console.error(
      "Context menu scan error:",
      error
    );
  }
});