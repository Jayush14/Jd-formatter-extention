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

  // Function to process a single job (extract description and save)
 async function processJob(job, index, total, tabId) {
  // Validate job object
  if (!job || !job.url) {
    console.error("Invalid job object:", job);
    return {
      success: false,
      error: "Invalid job object"
    };
  }

  try {
    let jdText = "";
    let host = "";

    // --------------------------------------------------
    // Validate URL
    // --------------------------------------------------
    try {
      host = new URL(job.url).hostname;
    } catch (urlError) {
      throw new Error(`Invalid job URL: ${job.url}`);
    }

    // ==================================================
    // LINKEDIN
    // ==================================================
    if (host.includes("linkedin.com")) {
      if (!job.linkedinJobID) {
        throw new Error("Missing LinkedIn job ID");
      }

      const apiUrl =
        `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${job.linkedinJobID}`;

      console.error("Fetching LinkedIn job:", apiUrl);

      const response = await fetch(apiUrl, {
        method: "GET",
        credentials: "omit"
      });

      if (!response.ok) {
        throw new Error(
          `LinkedIn API error! Status: ${response.status}`
        );
      }

      const htmlText = await response.text();

      // Parse full LinkedIn job
      const parsed = await extractLinkedInJob(htmlText, job, tabId);

      console.error("Parsed LinkedIn job:", parsed);

      // Validate title
      if (!parsed.title) {
        throw new Error(
          "Could not extract LinkedIn job title"
        );
      }

      // Validate description
      if (
        !parsed.description ||
        parsed.description.length < 50
      ) {
        throw new Error(
          "Could not extract LinkedIn job description"
        );
      }

      // Merge parsed data into the current job object
      job = {
        ...job,
        ...parsed
      };

      // Description used for storage
      jdText = parsed.description;
    }

    // ==================================================
    // NAUKRI
    // ==================================================
    else if (host.includes("naukri.com")) {
      if (!job.naukriJobID) {
        throw new Error("Missing Naukri job ID");
      }

      const response = await fetch(job.url);

      if (!response.ok) {
        throw new Error(
          `Naukri fetch error! Status: ${response.status}`
        );
      }

      const htmlText = await response.text();

      jdText = extractNaukriDescription(htmlText);

      if (!jdText || jdText.length < 50) {
        throw new Error(
          "Could not extract Naukri job description"
        );
      }
    }

    // ==================================================
    // UNSUPPORTED
    // ==================================================
    else {
      throw new Error(
        `Unsupported platform: ${host}`
      );
    }

    // --------------------------------------------------
    // Final description validation
    // --------------------------------------------------
    if (!jdText || jdText.length < 50) {
      throw new Error(
        "Extracted description too short or empty."
      );
    }

    // --------------------------------------------------
    // Load existing storage
    // --------------------------------------------------
    const storageResult =
      await chrome.storage.local.get({
        savedJds: []
      });

    const updated = storageResult.savedJds || [];

    // --------------------------------------------------
    // Build normalized object
    // --------------------------------------------------
    const jobToSave = {
      source: host.includes("linkedin.com")
        ? "linkedin"
        : "naukri",

      // IDs
      ...(job.linkedinJobID
        ? { linkedinJobID: job.linkedinJobID }
        : {}),

      ...(job.naukriJobID
        ? { naukriJobID: job.naukriJobID }
        : {}),

      // Main job data
      title: job.title || "Unknown Title",

      company:
        job.company || "Unknown Company",

      location:
        job.location || "",

      workplaceType:
        job.workplaceType ||
        job.workplace ||
        "",

      employmentType:
        job.employmentType || "",

      postedAt:
        job.postedAt || "",

      url:
        job.url || "",

      // Description
      description:
        jdText,

      // LinkedIn criteria
      jobCriteria:
        job.jobCriteria || {},

      // Extraction timestamp
      extracted_at:
        new Date().toISOString()
    };

    console.log(
      "Saving job:",
      jobToSave
    );

    // --------------------------------------------------
    // Save
    // --------------------------------------------------
    updated.push(jobToSave);

    await chrome.storage.local.set({
      savedJds: updated
    });

    // Refresh popup count
    renderSavedJobs();

    // --------------------------------------------------
    // Return processed job
    // --------------------------------------------------
    return {
      success: true,
      job: jobToSave
    };

  } catch (err) {
    console.error(
      "Processing error for job:",
      job?.title || "Unknown",
      err
    );

    return {
      success: false,
      error: err?.message || "Unknown error"
    };
  }
}

  // Function to extract LinkedIn description from HTML
function cleanText(value) {
  return (value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstText(doc, selectors) {
  for (const selector of selectors) {
    const el = doc.querySelector(selector);
    if (el) {
      const text = cleanText(el.innerText || el.textContent);
      if (text) return text;
    }
  }
  return "";
}

async function extractLinkedInJob(htmlText, fallback = {}, tabId) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlText, "text/html");

  // -----------------------------
  // TITLE
  // -----------------------------
  const title =
    firstText(doc, [
      ".top-card-layout__title",
      "h1.topcard__title",
      ".jobs-unified-top-card__job-title",
      ".job-details-jobs-unified-top-card__job-title",
      "h1"
    ]) ||
    fallback.title ||
    "";

  // -----------------------------
  // COMPANY
  // -----------------------------
  const company =
    firstText(doc, [
      ".topcard__org-name-link",
      ".top-card-layout__card .topcard__org-name-link",
      ".job-details-jobs-unified-top-card__company-name a",
      ".jobs-unified-top-card__company-name a",
      ".job-details-jobs-unified-top-card__company-name",
      ".jobs-unified-top-card__company-name"
    ]) ||
    fallback.company ||
    "";

  // -----------------------------
  // LOCATION
  // -----------------------------
  let location =
    firstText(doc, [
      ".topcard__flavor--bullet",
      ".topcard__flavor",
      ".top-card-layout__second-subline .topcard__flavor",
      ".job-details-jobs-unified-top-card__primary-description-container .topcard__flavor",
      ".jobs-unified-top-card__primary-description-container .topcard__flavor"
    ]) ||
    fallback.location ||
    "";

  // Sometimes LinkedIn gives multiple flavor elements.
  // Find one that looks like a location.
  if (!location) {
    const locationCandidates = Array.from(
      doc.querySelectorAll(
        ".topcard__flavor, .topcard__flavor--bullet, [class*='primary-description'] span"
      )
    )
      .map(el => cleanText(el.innerText || el.textContent))
      .filter(Boolean);

    const locationCandidate = locationCandidates.find(text =>
      /,/.test(text) ||
      /\b(remote|india|united states|usa|canada|uk|london|pune|bangalore|bengaluru|mumbai|hyderabad|delhi)\b/i.test(text)
    );

    if (locationCandidate) {
      location = locationCandidate;
    }
  }

// -----------------------------
// POSTED DATE
// -----------------------------
let postedAtRaw =
  firstText(doc, [
    ".posted-time-ago__text",
    ".topcard__flavor--metadata",
    "time",
    "[class*='posted']",
    "[class*='listdate']"
  ]) ||
  fallback.postedAt ||
  "";

let postedAt = null;

if (postedAtRaw) {
  const now = new Date();

  const match = postedAtRaw.match(
    /(\d+)\s+(minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years)\s+ago/i
  );

  if (match) {
    const amount = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    const postedDate = new Date(now);

    switch (unit) {
      case "minute":
      case "minutes":
        postedDate.setMinutes(
          postedDate.getMinutes() - amount
        );
        break;

      case "hour":
      case "hours":
        postedDate.setHours(
          postedDate.getHours() - amount
        );
        break;

      case "day":
      case "days":
        postedDate.setDate(
          postedDate.getDate() - amount
        );
        break;

      case "week":
      case "weeks":
        postedDate.setDate(
          postedDate.getDate() - (amount * 7)
        );
        break;

      case "month":
      case "months":
        postedDate.setMonth(
          postedDate.getMonth() - amount
        );
        break;

      case "year":
      case "years":
        postedDate.setFullYear(
          postedDate.getFullYear() - amount
        );
        break;
    }

    postedAt = postedDate.toISOString();
  } else {
    // If LinkedIn gives an actual date instead of "X days ago"
    const parsedDate = new Date(postedAtRaw);

    if (!isNaN(parsedDate.getTime())) {
      postedAt = parsedDate.toISOString();
    }
  }
}
  // -----------------------------
  // DESCRIPTION
  // -----------------------------
  const descriptionEl =
    doc.querySelector(".show-more-less-html__markup") ||
    doc.querySelector(".description__text") ||
    doc.querySelector("section.description") ||
    doc.querySelector("[class*='description__text']") ||
    doc.querySelector("[class*='job-description']");

  let description = descriptionEl
    ? descriptionEl.innerText.trim()
    : "";

  // -----------------------------
  // JOB CRITERIA
  // -----------------------------
  const jobCriteria = {};

  const criteriaItems = doc.querySelectorAll(
    ".description__job-criteria-list li, " +
    ".description__job-criteria-item, " +
    "[class*='job-criteria'] li"
  );

  criteriaItems.forEach(item => {
    const heading =
      firstText(item, [
        ".description__job-criteria-subheader",
        "h3",
        "h4"
      ]) || "";

    const value =
      firstText(item, [
        ".description__job-criteria-text",
        "span"
      ]) || "";

    if (!heading || !value) return;

    const normalizedHeading = heading.toLowerCase();

    if (normalizedHeading.includes("seniority")) {
      jobCriteria.seniorityLevel = value;
    } else if (
      normalizedHeading.includes("employment") ||
      normalizedHeading.includes("job type")
    ) {
      jobCriteria.employmentType = value;
    } else if (
      normalizedHeading.includes("job function") ||
      normalizedHeading.includes("function")
    ) {
      jobCriteria.jobFunction = value;
    } else if (normalizedHeading.includes("industry")) {
      jobCriteria.industries = value;
    } else {
      jobCriteria[heading] = value;
    }
  });

  // -----------------------------
// WORKPLACE TYPE
// -----------------------------
async function getWorkplaceTypeFromLinkedInPage(tabId) {
  const result = await chrome.scripting.executeScript({
    target: { tabId },

    func: () => {
      const checkIcon = document.getElementById("check-small");

      if (!checkIcon) {
        console.log("check-small not found in live DOM");
        return "";
      }

      const valueSpan = checkIcon.nextElementSibling;

      if (!valueSpan) {
        console.log("No next element after check-small");
        return "";
      }

      const value = valueSpan.innerText?.trim() || "";

      console.log("Workplace type from live DOM:", value);

      return value;
    }
  });

  return result?.[0]?.result || "";
}



const workplaceType = await getWorkplaceTypeFromLinkedInPage(tabId);
  // -----------------------------
  // EMPLOYMENT TYPE
  // -----------------------------
  let employmentType =
    jobCriteria.employmentType ||
    firstText(doc, [
      "[class*='employment-type']",
      "[class*='job-type']"
    ]) ||
    "";

  // Check visible labels if criteria did not expose it.
  if (!employmentType) {
    const candidates = Array.from(
      doc.querySelectorAll("span, li, div, button")
    )
      .map(el => cleanText(el.innerText || el.textContent))
      .filter(Boolean);

    employmentType =
      candidates.find(text =>
        /^(full-time|part-time|contract|temporary|internship|volunteer)$/i.test(text)
      ) || "";
  }

  // -----------------------------
  // NORMALIZE
  // -----------------------------
  description = description
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    title,
    company,
    location,
    workplaceType,
    employmentType,
    postedAt,
    description,
    jobCriteria
  };
}
  // Function to extract Naukri description from HTML
  function extractNaukriDescription(htmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, "text/html");

    const descContainer = doc.querySelector("section.styles_job-desc-container__2v1T2, .danger-markup");
    let jdText = descContainer ? descContainer.innerText.trim() : "";

    // Clean up the text
    jdText = jdText
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return jdText;
  }

  // Function to display jobs with processing status
  function displayJobsWithStatus(jobs) {
    jobList.innerHTML = "";
    jobs.forEach((job, index) => {
      if (!job) return;

      const li = document.createElement("li");
      li.className = "job-item";
      li.dataset.index = index; // Store index for updates

      // Initial status: pending
      li.innerHTML = `
        <div class="job-info">
          <span class="job-title">${job.title}</span>
          <span class="job-company">${job.company}</span>
        </div>
        <div class="job-actions">
          <span class="job-status status-pending">Pending</span>
        </div>
      `;

      jobList.appendChild(li);
    });
  }

  // Function to update job status in UI
  function updateJobStatus(index, status, message = "") {
    const li = jobList.querySelector(`li[data-index="${index}"]`);
    if (!li) return;

    const statusEl = li.querySelector(".job-status");
    if (!statusEl) return;

    // Remove existing status classes
    statusEl.className = "job-status";

    // Add new status class and text
    if (status === "processing") {
      statusEl.classList.add("status-processing");
      statusEl.textContent = "Processing...";
    } else if (status === "saved") {
      statusEl.classList.add("status-saved");
      statusEl.textContent = "Saved ✓";
    } else if (status === "error") {
      statusEl.classList.add("status-error");
      statusEl.textContent = `Failed: ${message}`;
    } else if (status === "pending") {
      statusEl.classList.add("status-pending");
      statusEl.textContent = "Pending";
    }
  }

  // Main scan button handler - NOW WITH BATCH PROCESSING
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
      // STEP 1: Discover jobs on the page - USING ORIGINAL SELECTORS FROM WORKING VERSION
      const rawJobs = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const scrapedJobs = [];
          const localSeenIds = new Set();
          const titleBlacklist = ["more", "apply", "save", "easy apply", "see more", "view job", "show all"];

          // ORIGINAL SELECTORS THAT WERE WORKING
          const rawElements = document.querySelectorAll(`
            [data-job-id],
            [data-occludable-job-id],
            .jobs-search-results-list__list-item,
            .job-card-job-posting-card,
            .scaffold-layout__list-item,
            li[data-view-name*="job-card"],
            .srp-jobtuple-wrapper,
            a[href*='/jobs/view/'],
            a[href*='currentJobId='],
            a[href*='job-listings']
          `);

          rawElements.forEach((el) => {
            // Skip if element is not visible (basic check)
            if (!el.offsetParent) return;

            const anchor = el.tagName === "A" ? el : el.querySelector("a[href*='/jobs/'], a[href*='currentJobId'], a[href*='job-listings']");
            const href = anchor ? anchor.href : "";

            // Skip if no href
            if (!href) return;

            // Calling the extractor inside the content script
            let jobId = el.getAttribute("data-job-id") ||
                        el.getAttribute("data-occludable-job-id") ||
                        el.querySelector("[data-job-id]")?.getAttribute("data-job-id") ||
                        href.match(/\/view\/(\d+)/)?.[1] ||
                        href.match(/currentJobId=(\d+)/)?.[1] ||
                        (href.includes("naukri.com") ? href.match(/(\d{10,14})/)?.[1] : null);

            if (!jobId || localSeenIds.has(jobId)) return;

            // Clean Title Extraction - ORIGINAL LOGIC
            let title = anchor ? anchor.innerText.split("\n")[0].trim() : "";
            if (!title || title.length <= 2 || titleBlacklist.includes(title.toLowerCase())) {
              title = el.querySelector("h3, h4, strong, .job-card-list__title, .title, [class*='title']")?.innerText?.split("\n")[0]?.trim();
            }

            if (!title || title.length <= 2 || titleBlacklist.includes(title.toLowerCase())) return;

            // Clean Company & Location Extraction - ORIGINAL LOGIC
            const companyEl = el.querySelector(".job-card-container__primary-description, .job-card-container__company-name, [class*='company-name'], .artdeco-entity-lockup__subtitle, .comp-name");
const company = companyEl
  ? companyEl.innerText.split("\n")[0].trim()
  : "";
const locationEl = el.querySelector(
  ".job-card-container__metadata-item, " +
  ".job-card-container__metadata-wrapper, " +
  ".artdeco-entity-lockup__caption, " +
  "[class*='location'], " +
  "[class*='metadata']"
);            const location = locationEl ? locationEl.innerText.split("\n")[0].trim() : "";

            localSeenIds.add(jobId);

            const isNaukri = href.includes("naukri.com");
    const jobData = {
  title: title,
  company: company,
  location: location,
  url: isNaukri
    ? href
    : `https://www.linkedin.com/jobs/view/${jobId}/`,
  extracted_at: new Date().toISOString()
};

            if (isNaukri) {
              jobData.naukriJobID = jobId;
            } else {
              jobData.linkedinJobID = jobId;
            }

            scrapedJobs.push(jobData);
          });

          return scrapedJobs;
        }
      });

      const discoveredJobs = rawJobs?.[0]?.result || [];

      if (discoveredJobs.length === 0) {
        jobList.innerHTML = '<li class="job-item"><span class="job-info">No jobs found on this page.</span></li>';
        // Re-enable UI
        scanBtn.disabled = false;
        scanBtn.innerText = "Scan Page for Jobs";
        exportBtn.disabled = false;
        copyBtn.disabled = false;
        clearBtn.disabled = false;
        return;
      }

      // Filter against persistent Chrome storage
      const storageResult = await chrome.storage.local.get({ savedJds: [] });
      const existingIds = new Set(
        storageResult.savedJds
          .map(item => item.linkedinJobID || item.naukriJobID)
          .filter(Boolean)
      );

      const uniqueNewJobs = discoveredJobs.filter(job => {
        const id = job.linkedinJobID || job.naukriJobID;
        return id && !existingIds.has(id);
      });

      if (uniqueNewJobs.length === 0) {
        jobList.innerHTML = '<li class="job-item"><span class="job-info">No new jobs found (all already processed).</span></li>';
        // Re-enable UI
        scanBtn.disabled = false;
        scanBtn.innerText = "Scan Page for Jobs";
        exportBtn.disabled = false;
        copyBtn.disabled = false;
        clearBtn.disabled = false;
        return;
      }

      // STEP 2: Show progress and process all jobs automatically
      jobList.innerHTML = ""; // Clear any message
      displayJobsWithStatus(uniqueNewJobs);

      // Show progress container
      progressContainer.style.display = "block";
      progressText.textContent = `Processing ${uniqueNewJobs.length} jobs...`;
      progressFill.style.width = "0%";

      let processedCount = 0;
      let savedCount = 0;
      let failedCount = 0;

      // Process jobs sequentially to avoid rate limiting
      for (let i = 0; i < uniqueNewJobs.length; i++) {
        const job = uniqueNewJobs[i];

        // Update UI: show processing
        updateJobStatus(i, "processing");

        // Update progress text
        progressText.textContent = `Processing job ${i + 1} flo ${uniqueNewJobs.length}: ${job.title}`;

        // Process the job
        const result = await processJob(job, i, uniqueNewJobs.length ,tab.id);

        if (result.success) {
          updateJobStatus(i, "saved");
          savedCount++;
        } else {
          updateJobStatus(i, "error", result.error);
          failedCount++;
        }

        processedCount++;

        // Update progress bar
        const progressPercent = Math.round((processedCount / uniqueNewJobs.length) * 100);
        progressFill.style.width = `${progressPercent}%`;

        // Small delay between jobs to be respectful to servers
        if (i < uniqueNewJobs.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      // Hide progress container and show final results
      progressContainer.style.display = "none";

      // Update scan button
      scanBtn.disabled = false;
      scanBtn.innerText = "Scan Page for Jobs";

      // Re-enable other buttons
      exportBtn.disabled = false;
      copyBtn.disabled = false;
      clearBtn.disabled = false;

      // Show summary message
      const message = savedCount > 0
        ? `Successfully saved ${savedCount} jobs${failedCount > 0 ? ` (${failedCount} failed)` : ""}`
        : `Failed to save any jobs${failedCount > 0 ? ` (${failedCount} errors)` : ""}`;

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