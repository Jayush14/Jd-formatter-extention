document.addEventListener("DOMContentLoaded", () => {
  const scanBtn = document.getElementById("scanBtn");
  const exportBtn = document.getElementById("exportBtn");
  const copyBtn = document.getElementById("copyBtn");
  const clearBtn = document.getElementById("clearBtn");
  const jobList = document.getElementById("jobList");
  const countSpan = document.getElementById("count");
  const progressContainer = document.getElementById("progressContainer");
  const progressText = document.getElementById("progressText");
  const progressFill = document.getElementById("progressFill");
  console.log("🔥 POPUP.JS LOADED");

  function renderSavedJobs() {
    chrome.storage.local.get({ savedJds: [] }).then((result) => {
      countSpan.innerText = `${result.savedJds.length} Saved`;
    });
  }

  // Scan button handler - now uses the shared scanner
  scanBtn.addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    // Disable UI during scan
    scanBtn.disabled = true;
    scanBtn.innerText = "Scanning...";
    exportBtn.disabled = true;
    copyBtn.disabled = true;
    clearBtn.disabled = true;

    try {
      // Use the shared scanner with progress callback
      const result = await scanAndSaveJobs(tab.id, {
        onProgress: ({ current, total, job, status, error, savedCount, failedCount }) => {
          // Update progress text and bar
          if (status === "discovered") {
            progressText.textContent = `Discovered ${total} jobs...`;
            progressContainer.style.display = "block";
            progressFill.style.width = "0%";
          } else if (status === "processing") {
            progressText.textContent = `Processing job ${current + 1} of ${total}: ${job ? job.title : ""}`;
            const percent = Math.round((current / total) * 100);
            progressFill.style.width = `${percent}%`;
          } else if (status === "saved") {
            progressText.textContent = `Saved job ${current} of ${total}`;
            const percent = Math.round((current / total) * 100);
            progressFill.style.width = `${percent}%`;
          } else if (status === "error") {
            progressText.textContent = `Error processing job ${current + 1} of ${total}: ${error}`;
            const percent = Math.round((current / total) * 100);
            progressFill.style.width = `${percent}%`;
          } else if (status === "complete") {
            progressText.textContent = `Completed! Saved ${savedCount} jobs`;
            // Hide progress after a short delay
            setTimeout(() => {
              progressContainer.style.display = "none";
            }, 1000);
          }
        }
      });

      // Re-enable UI
      scanBtn.disabled = false;
      scanBtn.innerText = "Scan Page for Jobs";
      exportBtn.disabled = false;
      copyBtn.disabled = false;
      clearBtn.disabled = false;

      // Show summary message
      const message = result.savedCount > 0
        ? `Successfully saved ${result.savedCount} jobs${result.failedCount > 0 ? ` (${result.failedCount} failed)` : ""}`
        : `Failed to save any jobs${result.failedCount > 0 ? ` (${result.failedCount} errors)` : ""}`;

      jobList.innerHTML = `<li class="job-item"><span class="job-info">${message}</span></li>`;

      // Update saved count
      renderSavedJobs();

    } catch (error) {
      console.error("Scan error:", error);
      progressContainer.style.display = "none";
      jobList.innerHTML = `<li class="job-item"><span class="job-info">Error during scanning: ${error.message}</span></li>`;

      // Re-enable UI
      scanBtn.disabled = false;
      scanBtn.innerText = "Scan Page for Jobs";
      exportBtn.disabled = false;
      copyBtn.disabled = false;
      clearBtn.disabled = false;
    }
  });

  exportBtn.addEventListener("click", () => {
    chrome.storage.local.get({ savedJds: [] }).then((result) => {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(result.savedJds, null, 2));
      const downloadAnchor = document.createElement("a");
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", `jobs_batch_${Date.now()}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    });
  });

  copyBtn.addEventListener("click", () => {
    chrome.storage.local.get({ savedJds: [] }).then((result) => {
      navigator.clipboard.writeText(JSON.stringify(result.savedJds, null, 2));
      alert("Copied to clipboard!");
    });
  });

  clearBtn.addEventListener(async () => {
    await chrome.storage.local.set({ savedJds: [] });
    renderSavedJobs();
    jobList.innerHTML = '<li class="job-item"><span class="job-info">List cleared.</span></li>';
  });

  renderSavedJobs();
});