// ==UserScript==
// @name         Get Skills Data UI
// @namespace    http://tampermonkey.net/
// @version      2.4
// @description  Scrapes combat skills and displays them in a gorgeous floating UI
// @author       Slayfer
// @match        *demonicscans.org/pvp.php*
// @match        *demonicscans.org/pvp_battle.php*
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const DB_KEY = "veyra_skills_db";
  let skillsDb = {};

  // UI State
  let isMinimized = false;
  let isDragging = false;
  let uiOffsetX = 0,
    uiOffsetY = 0;
  let uiPos = { top: "20px", left: "auto", right: "20px" };

  // Load data & UI state
  try {
    const saved = localStorage.getItem(DB_KEY);
    if (saved) skillsDb = JSON.parse(saved);

    const savedUi = localStorage.getItem(DB_KEY + "_ui");
    if (savedUi) {
      const parsed = JSON.parse(savedUi);
      uiPos = parsed.pos || uiPos;
      isMinimized = parsed.minimized || false;
    }
  } catch (e) {
    console.error("Failed to load skills DB", e);
  }

  function saveDB() {
    localStorage.setItem(DB_KEY, JSON.stringify(skillsDb));
    renderSkills();
  }

  function saveUIState() {
    const ui = document.getElementById("gsd-ui");
    if (ui) {
      uiPos = { top: ui.style.top, left: ui.style.left, right: ui.style.right };
    }
    localStorage.setItem(
      DB_KEY + "_ui",
      JSON.stringify({ pos: uiPos, minimized: isMinimized }),
    );
  }

  // ==========================================
  // SCRAPER ENGINE
  // ==========================================
  function scrapeSkills() {
    const elements = document.querySelectorAll("*[data-skill-id]");
    if (elements.length === 0) return;

    let updated = false;
    elements.forEach((el) => {
      const id = el.getAttribute("data-skill-id");
      const name =
        el.getAttribute("data-skill-name") ||
        el.querySelector(".skillName")?.innerText ||
        "Unknown";

      const imgEl = el.querySelector("img");
      const imgUrl = imgEl ? imgEl.getAttribute("src") : "";

      const attributes = {};
      Array.from(el.attributes).forEach((attr) => {
        attributes[attr.name] = attr.value;
      });

      const newEntry = { id, name, imgUrl, attributes };
      if (JSON.stringify(skillsDb[id]) !== JSON.stringify(newEntry)) {
        skillsDb[id] = newEntry;
        updated = true;
      }
    });

    if (updated) {
      console.log("GetSkillsData: New skills found and saved!");
      saveDB();
    }
  }

  // Check for new skills every second
  setInterval(scrapeSkills, 1000);

  // ==========================================
  // PREMIUM UI BUILDER
  // ==========================================
  function initUI() {
    if (document.getElementById("gsd-ui")) return;

    // Inject font if needed
    if (!document.getElementById("gsd-font")) {
      const font = document.createElement("link");
      font.id = "gsd-font";
      font.href =
        "https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap";
      font.rel = "stylesheet";
      document.head.appendChild(font);
    }

    const ui = document.createElement("div");
    ui.id = "gsd-ui";
    ui.style.cssText = `
            position: fixed; top: ${uiPos.top}; ${uiPos.left !== "auto" ? `left: ${uiPos.left};` : `right: ${uiPos.right};`} z-index: 999999;
            width: ${isMinimized ? "200px" : "clamp(320px, 90vw, 1200px)"};
            max-height: 90vh;
            background: rgba(15, 10, 20, 0.75);
            backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 16px;
            box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6), inset 0 0 0 1px rgba(255, 255, 255, 0.05);
            color: #fff; font-family: 'Inter', system-ui, sans-serif;
            display: flex; flex-direction: column; overflow: hidden;
            transition: width 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
        `;

    // Global CSS for cards to keep JS clean
    const style = document.createElement("style");
    style.innerText = `
            #gsd-body::-webkit-scrollbar { width: 6px; }
            #gsd-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 3px; }
            .gsd-card {
                background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05);
                border-radius: 12px; padding: 10px;
                display: flex; gap: 10px; align-items: flex-start;
                transition: transform 0.2s, background 0.2s, box-shadow 0.2s;
            }
            .gsd-card:hover {
                transform: translateY(-2px);
                background: rgba(255,255,255,0.06);
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                border-color: rgba(180, 130, 255, 0.3);
            }
            .gsd-icon {
                width: 44px; height: 44px; border-radius: 8px; background: rgba(0,0,0,0.4);
                object-fit: cover; border: 1px solid rgba(255,255,255,0.1);
            }
            .gsd-info { flex: 1; display: flex; flex-direction: column; gap: 4px; overflow: hidden; }
            .gsd-name { font-size: 13px; font-weight: 600; color: #fff; letter-spacing: 0.2px; margin-bottom: 2px; }
            .gsd-tags { display: flex; flex-direction: column; gap: 4px; }
            .gsd-tag { 
                font-size: 10px; font-family: monospace; font-weight: 500; padding: 3px 5px; border-radius: 4px; 
                background: rgba(255,255,255,0.05); color: #ccc; border: 1px solid rgba(255,255,255,0.1);
                word-break: break-all; line-height: 1.2;
            }
        `;
    document.head.appendChild(style);

    // Header
    const header = document.createElement("div");
    header.id = "gsd-header";
    header.style.cssText = `
            padding: 14px 16px; cursor: grab; user-select: none;
            display: flex; justify-content: space-between; align-items: center;
            background: linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.0) 100%);
            border-bottom: 1px solid rgba(255,255,255,0.05);
        `;
    header.innerHTML = `
            <h2 style="margin: 0; font-size: 15px; font-weight: 600; color: #e2d1f9; text-shadow: 0 0 10px rgba(180, 130, 255, 0.5); display: flex; align-items: center; gap: 8px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                Skill DB
            </h2>
            <div style="display: flex; gap: 4px;">
                <button id="gsd-refresh" style="background: none; border: none; color: rgba(255,255,255,0.5); cursor: pointer; padding: 4px; font-size: 16px; display: flex; align-items: center; justify-content: center; transition: color 0.2s;" title="Force Reload/Clear DB">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
                </button>
                <button id="gsd-minimize" style="background: none; border: none; color: rgba(255,255,255,0.5); cursor: pointer; padding: 4px; font-size: 16px; display: flex; align-items: center; justify-content: center; transition: color 0.2s;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                </button>
            </div>
        `;

    // Body
    const body = document.createElement("div");
    body.id = "gsd-body";
    body.style.cssText = `
            padding: 16px; overflow-y: auto; flex: 1; min-height: 0;
            display: ${isMinimized ? "none" : "grid"}; gap: 12px;
            grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
        `;

    ui.appendChild(header);
    ui.appendChild(body);
    document.body.appendChild(ui);

    // Bounds Checking
    const checkBounds = () => {
      const rect = ui.getBoundingClientRect();
      let newTop = rect.top;
      let newLeft = rect.left;
      let changed = false;

      // Prevent left side from going off-screen
      if (newLeft < 0) {
        newLeft = 20;
        changed = true;
      }
      // Prevent right side from going off-screen
      else if (newLeft + rect.width > window.innerWidth) {
        newLeft = Math.max(20, window.innerWidth - rect.width - 20);
        changed = true;
      }

      // Prevent top from going off-screen
      if (newTop < 0) {
        newTop = 20;
        changed = true;
      }
      // Prevent bottom from going off-screen
      else if (newTop + rect.height > window.innerHeight) {
        newTop = Math.max(20, window.innerHeight - rect.height - 20);
        changed = true;
      }

      if (changed) {
        ui.style.top = newTop + "px";
        ui.style.left = newLeft + "px";
        ui.style.right = "auto";
      }
      return changed;
    };

    // Dragging Logic
    header.addEventListener("pointerdown", (e) => {
      if (e.target.closest("#gsd-minimize") || e.target.closest("#gsd-refresh"))
        return; // Ignore drag on buttons
      isDragging = true;
      const rect = ui.getBoundingClientRect();
      uiOffsetX = e.clientX - rect.left;
      uiOffsetY = e.clientY - rect.top;
      header.style.cursor = "grabbing";
      e.preventDefault();
    });

    document.addEventListener("pointermove", (e) => {
      if (!isDragging) return;
      ui.style.left = e.clientX - uiOffsetX + "px";
      ui.style.top = e.clientY - uiOffsetY + "px";
      ui.style.right = "auto"; // Override right anchor when dragged
    });

    const stopDrag = (e) => {
      if (!isDragging) return;
      isDragging = false;
      header.style.cursor = "grab";
      checkBounds(); // Ensure it stays in bounds when let go
      saveUIState();
    };

    document.addEventListener("pointerup", stopDrag);
    document.addEventListener("pointercancel", stopDrag);

    // Check bounds on load and resize
    const enforceBounds = () => {
      if (checkBounds()) saveUIState();
    };
    enforceBounds();
    setTimeout(enforceBounds, 500);
    window.addEventListener("resize", enforceBounds);

    // Events
    const minBtn = document.getElementById("gsd-minimize");
    minBtn.onclick = () => {
      isMinimized = !isMinimized;
      ui.style.width = isMinimized ? "200px" : "clamp(320px, 90vw, 1200px)";
      body.style.display = isMinimized ? "none" : "grid";
      saveUIState();
    };
    minBtn.onmouseover = () => (minBtn.style.color = "#fff");
    minBtn.onmouseout = () => (minBtn.style.color = "rgba(255,255,255,0.5)");

    const refBtn = document.getElementById("gsd-refresh");
    refBtn.onclick = () => {
      skillsDb = {};
      scrapeSkills();
      saveDB();
    };
    refBtn.onmouseover = () => (refBtn.style.color = "#fff");
    refBtn.onmouseout = () => (refBtn.style.color = "rgba(255,255,255,0.5)");

    renderSkills();
  }

  function renderSkills() {
    const body = document.getElementById("gsd-body");
    if (!body) return;

    const skillKeys = Object.keys(skillsDb);
    if (skillKeys.length === 0) {
      body.innerHTML = `
                <div style="text-align: center; color: rgba(255,255,255,0.5); font-size: 13px; padding: 20px 10px;">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 12px; opacity: 0.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                    <br>No data retrieved yet.<br>Enter combat to sync skills.
                </div>
            `;
      return;
    }

    let html = "";
    skillKeys.forEach((id) => {
      const s = skillsDb[id];

      // Generate tags dynamically from all stored attributes
      let tagsHtml = "";
      if (s.imgUrl) {
        tagsHtml += `<div class="gsd-tag"><span style="color:#d6b3ff">src:</span> ${s.imgUrl}</div>`;
      }
      if (s.attributes) {
        Object.keys(s.attributes).forEach((attrName) => {
          // Skip 'class' or irrelevant massive attributes if desired, but we will show all as requested
          tagsHtml += `<div class="gsd-tag"><span style="color:#8ce0ff">${attrName}:</span> ${s.attributes[attrName]}</div>`;
        });
      }

      // Fallback for empty tags
      if (!tagsHtml)
        tagsHtml = `<div class="gsd-tag" style="color: #aaa;">No attributes found</div>`;

      // Fallback image if missing: transparent 1x1 GIF
      const imgSrc =
        s.imgUrl ||
        "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";

      html += `
                <div class="gsd-card" title="Skill ID: ${s.id}">
                    <img class="gsd-icon" src="${imgSrc}" alt="${s.name}" onerror="this.src='data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='">
                    <div class="gsd-info">
                        <div class="gsd-name">${s.name}</div>
                        <div class="gsd-tags">${tagsHtml}</div>
                    </div>
                </div>
            `;
    });

    body.innerHTML = html;
  }

  // Run
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initUI);
  } else {
    initUI();
  }
})();
