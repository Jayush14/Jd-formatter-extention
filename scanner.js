// scanner.js - Reusable job scanning and processing logic for Multi-Job JD Collector

// Helper functions
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

/**
 * Extract LinkedIn job details from HTML
 * @param {string} htmlText - HTML from LinkedIn guest API
 * @param {Object} fallback - Fallback data from initial discovery
 * @param {number} tabId - Tab ID for live DOM extraction (workplace type)
 * @returns {Promise<Object>} Parsed job data
 */
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
      ".job-details-jobs-unified-top-card__primary-description-container .topcard__flavor"
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

/**
 * Extract Naukri job description from HTML
 * @param {string} htmlText - HTML from Naukri job page
 * @returns {string} Cleaned job description
 */
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

/**
 * Generate a unique key for a job for deduplication
 * @param {Object} job - Job object
 * @returns {string} Unique key
 */
function getJobKey(job) {
  if (job.linkedinJobID) {
    return `linkedin:${job.linkedinJobID}`;
  }
  if (job.naukriJobID) {
    return `naukri:${job.naukriJobID}`;
  }
  // Fallback to URL if no ID (should not happen)
  return job.url || "";
}

/**
 * Save a job to chrome.storage.local.savedJds
 * @param {Object} jobToSave - Job object to save
 * @returns {Promise<Object>} The saved job
 */
async function saveJob(jobToSave) {
  const storageResult = await chrome.storage.local.get({ savedJds: [] });
  const updated = storageResult.savedJds || [];
  updated.push(jobToSave);
  await chrome.storage.local.set({ savedJds: updated });
  return jobToSave;
}

/**
 * Discover jobs from the current tab
 * @param {number} tabId - Tab ID to scan
 * @returns {Promise<Array>} Array of discovered job objects
 */
async function discoverJobsFromPage(tabId) {
  const result = await chrome.scripting.executeScript({
    target: { tabId: tabId },
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
                    href.match(/currentJobId=(\d+)?/)?.[1] ||
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
        );
        const location = locationEl ? locationEl.innerText.split("\n")[0].trim() : "";

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

  return result?.[0]?.result || [];
}

/**
 * Process a single job (extract description and save)
 * @param {Object} job - Job object from discovery
 * @param {number} index - Index in the batch
 * @param {number} total - Total jobs in batch
 * @param {number} tabId - Tab ID for live DOM extraction
 * @returns {Promise<Object>} Result with success and job or error
 */
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

/**
 * Main scanner function to discover, process, and save jobs
 * @param {number} tabId - Tab ID to scan
 * @param {Object} options - Optional configuration
 * @param {Function} options.onProgress - Progress callback
 * @returns {Promise<Object>>} Result object
 */
async function scanAndSaveJobs(tabId, options = {}) {
  const { onProgress } = options;

  let savedCount = 0;
  let failedCount = 0;

  // Step 1: Discover jobs
  const discoveredJobs = await discoverJobsFromPage(tabId);
  if (onProgress) {
    onProgress({ current: 0, total: discoveredJobs.length, job: null, status: "discovered", error: null, savedCount: 0, failedCount: 0 });
  }

  // Step 2: Load saved jobs for deduplication
  const storageResult = await chrome.storage.local.get({ savedJds: [] });
  const existingIds = new Set(
    storageResult.savedJds
      .map(item => item.linkedinJobID || item.naukriJobID)
      .filter(Boolean)
  );

  // Step 3: Filter out already processed jobs
  const uniqueNewJobs = discoveredJobs.filter(job => {
    const id = job.linkedinJobID || job.naukriJobID;
    return id && !existingIds.has(id);
  });

  // REMOVED the early "complete" callback here

  if (uniqueNewJobs.length === 0) {
    return {
      success: true,
      discoveredCount: discoveredJobs.length,
      newJobsCount: 0,
      savedCount: 0,
      failedCount: 0,
      jobs: [],
      errors: []
    };
  }

  // Step 4: Process jobs sequentially
  const jobs = [];
  const errors = [];

  for (let i = 0; i < uniqueNewJobs.length; i++) {
    const job = uniqueNewJobs[i];
    if (onProgress) {
      onProgress({ current: i, total: uniqueNewJobs.length, job, status: "processing", error: null, savedCount, failedCount });
    }

    const result = await processJob(job, i, uniqueNewJobs.length, tabId);
    if (result.success) {
      savedCount++;
      jobs.push(result.job);
      if (onProgress) {
        onProgress({ current: i + 1, total: uniqueNewJobs.length, job, status: "saved", error: null, savedCount, failedCount });
      }
    } else {
      failedCount++;
      errors.push({
        jobId: job.linkedinJobID || job.naukriJobID || job.url,
        title: job.title || "Unknown",
        error: result.error
      });
      if (onProgress) {
        onProgress({ current: i + 1, total: uniqueNewJobs.length, job, status: "error", error: result.error, savedCount, failedCount });
      }
    }

    // Small delay between jobs to be respectful to servers
    if (i < uniqueNewJobs.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // Step 5: Final progress callback
  if (onProgress) {
    onProgress({ current: uniqueNewJobs.length, total: uniqueNewJobs.length, job: null, status: "complete", error: null, savedCount, failedCount });
  }

  return {
    success: true,
    discoveredCount: discoveredJobs.length,
    newJobsCount: uniqueNewJobs.length,
    savedCount,
    failedCount,
    jobs,
    errors
  };
}