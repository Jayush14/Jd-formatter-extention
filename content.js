chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "extract_full_page") {
    let title = "";
    let company = "";
    let location = "";
    let postedDate = "";
    let workplaceTags = [];
    let body = "";

    const host = window.location.hostname;

    // Function to extract company name for LinkedIn job detail page
    function getCompanyName() {
      // Option 1: Direct link in top card header
      const topCardLink = document.querySelector(
        '.job-details-jobs-unified-top-card__company-name a, .jobs-unified-top-card__company-name a'
      );
      if (topCardLink) return topCardLink.innerText.trim();

      // Option 2: Plain text container in top card
      const topCardContainer = document.querySelector(
        '.job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name'
      );
      if (topCardContainer) return topCardContainer.innerText.trim();

      // Option 3: Extract from "Unlock hiring insights on <Company>" text
      const insightElement = Array.from(document.querySelectorAll('h2, h3')).find(el =>
        el.innerText.includes('Unlock hiring insights on')
      );
      if (insightElement) {
        return insightElement.innerText.replace('Unlock hiring insights on', '').trim();
      }

      return 'Unknown Company';
    }

    if (host.includes("linkedin.com")) {
      title = document.querySelector("h1")?.innerText?.trim() || "";
      company = getCompanyName(); // Use our new function

      const primaryDesc = document.querySelector(".job-details-jobs-unified-top-card__primary-description, .jobs-unified-top-card__primary-description")?.innerText?.trim() || "";
      if (primaryDesc) {
        const parts = primaryDesc.split("·").map(p => p.trim());
        if (parts.length > 0) location = parts[0];
        if (parts.length > 1) postedDate = parts[1];
      }

      const badgeElements = document.querySelectorAll(".ui-label--custom, .job-details-jobs-unified-top-card__workplace-type, .ui-label");
      badgeElements.forEach(badge => {
        const text = badge.innerText.trim();
        if (text && !workplaceTags.includes(text) && !text.includes("clicked apply")) {
          workplaceTags.push(text);
        }
      });

      let bodyEl = document.querySelector("#job-details, .jobs-description-content__text, .jobs-description__content");
      if (bodyEl) {
        const clonedBody = bodyEl.cloneNode(true);
        const garbageSelectors = [".jobs-premium-company-growth", "button", "section[data-test-id='hiring-insights']"];
        garbageSelectors.forEach(sel => clonedBody.querySelectorAll(sel).forEach(n => n.remove()));
        body = clonedBody.innerText || "";
      }
    } else if (host.includes("naukri.com")) {
      title = document.querySelector(".styles_jd-header-title__4S2L1, header h1")?.innerText?.trim() || "";
      company = document.querySelector(".styles_jd-header-comp-name__32O2k, .comp-name")?.innerText?.trim() || "";
      location = document.querySelector(".styles_jdc__location__3b2J-, .location")?.innerText?.trim() || "";
      postedDate = document.querySelector(".styles_jdc__stat__2K_3-, .posted")?.innerText?.trim() || "";
      body = document.querySelector("section.styles_job-desc-container__2v1T2, .danger-markup")?.innerText || "";
    }

    if (!body.trim() && !title.trim()) {
      sendResponse({ success: false });
      return true;
    }

    let headerLine = title;
    if (company) headerLine += ` · ${company}`;

    let subHeaderParts = [];
    if (location) subHeaderParts.push(location);
    if (workplaceTags.length > 0) subHeaderParts.push(workplaceTags.join(" · "));
    if (postedDate) subHeaderParts.push(postedDate);

    let fullText = headerLine;
    if (subHeaderParts.length > 0) fullText += `\n${subHeaderParts.join(" · ")}`;
    fullText += `\n\n${body.trim()}`;

    let cleanText = fullText
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/(Project Role :)/g, "\n\nProject Role :")
      .replace(/(Project Role Description :)/g, "\n\nProject Role Description :")
      .replace(/(Must have skills :)/g, "\n\nMust have skills :")
      .replace(/(Good to have skills :)/g, "\n\nGood to have skills :")
      .replace(/(Summary:)/g, "\n\nSummary:\n")
      .replace(/(Roles & Responsibilities:)/g, "\n\nRoles & Responsibilities:\n")
      .replace(/(Professional & Technical Skills:)/g, "\n\nProfessional & Technical Skills:\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    sendResponse({ success: true, formattedJd: cleanText, title, company });
  }
  return true;
});