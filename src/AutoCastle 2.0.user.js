// ==UserScript==
// @name         Auto Climb Castle 2.0
// @namespace    http://tampermonkey.net/
// @version      2.0
// @updateURL    https://raw.githubusercontent.com/slayfer-dev/VeyraScripts/refs/heads/main/src/AutoCastle%202.0.user.js
// @downloadURL  https://raw.githubusercontent.com/slayfer-dev/VeyraScripts/refs/heads/main/src/AutoCastle%202.0.user.js
// @description  A fully rewritten, highly optimized auto-battler for DemonicScans Vampire Castle.
// @author       Slayfer
// @match        *demonicscans.org/occurrence_castle.php?slug=vampire_castle*
// @require      https://raw.githubusercontent.com/slayfer-dev/VeyraScripts/refs/heads/main/libs/AntiThrottle.js
// @grant        GM.getValue
// @grant        GM.setValue
// ==/UserScript==

(async function() {
    'use strict';

    // =========================================================================
    // STATE & CONFIG
    // =========================================================================
    const ALL_POWERS = [
        "Vampiric Edge", "Raven Eye", "Iron Veil", "Execution Rhythm", "Blood Frenzy", 
        "Frozen Blood", "Witchfire Core", "Mana Leech", "Ashen Wand", "Arcane Surge", 
        "Serrated Vein", "Thorns of the Crypt", "Blood Alchemy", "Crimson Vitality", "Venom Script"
    ];

    const DEFAULT_STATE = {
        active: false,
        attackType: 'slash',
        stopsAt: 'epic_legendary', // never, legendary, epic_legendary, all
        eventChoice: 'random',
        potionEnabled: false,
        potionThreshold: 35,
        continuousRuns: true,
        currentLoadoutId: 'loadout_a',
        uiPos: { left: '20px', top: '20px' }
    };

    const DEFAULT_LOADOUTS = {
        loadout_a: { name: "Loadout A", priorities: Array(10).fill("") },
        loadout_b: { name: "Loadout B", priorities: Array(10).fill("") },
        loadout_c: { name: "Loadout C", priorities: Array(10).fill("") }
    };

    let state = { ...DEFAULT_STATE };
    let loadouts = { ...DEFAULT_LOADOUTS };
    let uiOffsetX = 0, uiOffsetY = 0, isDragging = false;

    // Load from storage
    try {
        const storedState = await GM.getValue('vc_auto_state');
        if (storedState) state = { ...DEFAULT_STATE, ...JSON.parse(storedState) };
        const storedLoadouts = await GM.getValue('vc_auto_loadouts');
        if (storedLoadouts) loadouts = { ...DEFAULT_LOADOUTS, ...JSON.parse(storedLoadouts) };
    } catch (e) {
        console.error("Failed to load state from GM storage", e);
    }

    async function saveState() {
        await GM.setValue('vc_auto_state', JSON.stringify(state));
    }

    async function saveLoadouts() {
        await GM.setValue('vc_auto_loadouts', JSON.stringify(loadouts));
    }

    // =========================================================================
    // DOM PARSERS
    // =========================================================================
    function getPlayerHP() {
        const hpText = document.getElementById("playerHpText");
        if (!hpText) return null;
        const parts = hpText.innerText.split('/');
        if (parts.length === 2) {
            return { current: parseInt(parts[0].replace(/,/g, '')), max: parseInt(parts[1].replace(/,/g, '')) };
        }
        return null;
    }

    function getUniquePowersCount() {
        // Scrapes the right sidebar "Powers X/10"
        const powerCards = document.querySelectorAll('.side-column .power-list .power');
        return powerCards.length;
    }

    function parseMaxDmg() {
        // Find logs for damage dealt to update max dmg stat
        const logs = document.querySelectorAll('.log');
        let maxFound = 0;
        logs.forEach(log => {
            const match = log.innerText.match(/dealt ([\d,]+) damage/i);
            if (match) {
                const dmg = parseInt(match[1].replace(/,/g, ''));
                if (dmg > maxFound) maxFound = dmg;
            }
        });
        return maxFound;
    }

    function getPotionCount() {
        // Find the potion item card and extract the count if possible, or fallback to checking if it exists
        const potionForm = document.querySelector('.js-hp-potion-form');
        if (!potionForm) return 0;
        // In this game, usually having the form means we have at least 1, 
        // full exact quantities might not be exposed on the battle page unless on the button text
        const btn = potionForm.querySelector('button');
        if (btn) {
            const match = btn.innerText.match(/\((\d+)\s+left\)/i);
            if (match) return parseInt(match[1]);
        }
        return 1; // Default to 1 if we have the form but can't parse number
    }

    // =========================================================================
    // UI BUILDER
    // =========================================================================
    function initUI() {
        if (document.getElementById("veyra-castle-ui")) return;

        // 1. Floating Main Panel
        const ui = document.createElement('div');
        ui.id = "veyra-castle-ui";
        ui.style.cssText = `
            position: fixed; top: ${state.uiPos.top || '20px'}; left: ${state.uiPos.left || '20px'}; z-index: 99999;
            background: linear-gradient(180deg, rgba(18, 12, 20, 0.95), rgba(9, 7, 13, 0.95));
            border: 1px solid rgba(126, 167, 255, 0.38); border-radius: 12px;
            color: #f8ead2; font-family: Georgia, serif; width: 320px;
            box-shadow: 0 15px 40px rgba(0,0,0,0.6); display: flex; flex-direction: column;
        `;
        
        // Header
        const header = document.createElement('div');
        header.style.cssText = "padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.1); cursor: grab; display: flex; justify-content: space-between; align-items: center; user-select: none;";
        header.innerHTML = `<h2 style="margin:0; font-size:16px; color:#a8ffca;">AutoCastle 2.0</h2><span style="opacity:0.5">⠿</span>`;
        
        // Dragging Logic
        header.addEventListener("pointerdown", (e) => {
            isDragging = true;
            const rect = ui.getBoundingClientRect();
            uiOffsetX = e.clientX - rect.left;
            uiOffsetY = e.clientY - rect.top;
            header.style.cursor = "grabbing";
            e.preventDefault(); // Prevent text selection
        });
        document.addEventListener("pointermove", (e) => {
            if (!isDragging) return;
            ui.style.left = (e.clientX - uiOffsetX) + "px";
            ui.style.top = (e.clientY - uiOffsetY) + "px";
            ui.style.right = "auto";
        });
        const stopDrag = (e) => {
            if (!isDragging) return;
            isDragging = false;
            header.style.cursor = "grab";
            state.uiPos = { left: ui.style.left, top: ui.style.top };
            saveState();
        };
        document.addEventListener("pointerup", stopDrag);
        document.addEventListener("pointercancel", stopDrag);
        ui.appendChild(header);

        // Body container
        const body = document.createElement('div');
        body.style.cssText = "padding: 16px; display: grid; gap: 12px;";

        const createField = (labelHTML, inputHTML) => `
            <div style="display: grid; gap: 6px;">
                <label style="font-size: 13px; color: #ffe3ad; font-weight: 900;">${labelHTML}</label>
                ${inputHTML}
            </div>
        `;

        const selectStyle = `width: 100%; border: 1px solid rgba(241, 201, 107, 0.34); border-radius: 8px; background: #120d16; color: #f8ead2; padding: 6px 8px; font: 700 13px Georgia, serif;`;

        body.innerHTML = `
            ${createField('Attack', `<select id="vc-attack-type" style="${selectStyle}"><option value="slash">Slash</option><option value="magic">Magic Attack</option></select>`)}
            ${createField('Stops at/on', `<select id="vc-stops-at" style="${selectStyle}">
                <option value="never">Never (Skip unlisted)</option>
                <option value="legendary">Legendary choices</option>
                <option value="epic_legendary">Epic or Legendary</option>
                <option value="all">Any Rarity</option>
            </select>`)}
            ${createField('Path Events', `<select id="vc-event-choice" style="${selectStyle}"><option value="random">Random</option><option value="left">Left</option><option value="right">Right</option></select>`)}
            
            <div style="display: flex; flex-direction: column; gap: 8px; border: 1px solid rgba(241, 201, 107, 0.22); border-radius: 8px; padding: 10px; background: rgba(241, 201, 107, 0.07);">
                <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px;">
                    <input type="checkbox" id="vc-potion-enabled" style="accent-color: #c92644; width:16px; height:16px;">
                    Use HP Potion
                </label>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <input type="range" id="vc-potion-slider" min="1" max="99" style="flex:1; accent-color: #f1c96b;">
                    <input type="number" id="vc-potion-input" min="1" max="99" style="width: 45px; background: #120d16; color: #f8ead2; border: 1px solid #555; border-radius: 4px; text-align: center;">
                </div>
                <div id="vc-hp-preview" style="font-size: 11px; color: #ff9999; text-align: center; margin-top: 4px;">❤️ Heals at: ... / ... HP</div>
            </div>

            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; color: #ffe3ad; font-weight: bold;">
                <input type="checkbox" id="vc-continuous-runs" style="accent-color: #c92644; width:16px; height:16px;">
                Continuous Runs
            </label>

            <div style="display: flex; gap: 8px; margin-top: 4px;">
                <button id="vc-start-btn" style="flex: 1; border: 0; border-radius: 8px; padding: 8px; font-weight: 900; background: #d9b66f; color: #1b1210; cursor: pointer;">Start Auto</button>
                <button id="vc-stop-btn" style="flex: 1; border: 1px solid rgba(255,255,255,0.16); border-radius: 8px; padding: 8px; font-weight: 900; background: #221b28; color: #fff; cursor: pointer;">Stop</button>
                <button id="vc-settings-btn" style="border: 1px solid rgba(255,255,255,0.16); border-radius: 8px; padding: 8px 12px; background: #221b28; cursor: pointer;" title="Customize Auto-Pilot">⚙️</button>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: flex-start; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 8px; min-height: 20px;">
                <div id="vc-status-msg" style="color: #cdbfba; font-size: 13px; line-height: 1.4;">Ready.</div>
                <div id="vc-max-dmg" style="color: #ff9999; font-size: 13px; font-weight: bold; white-space: nowrap;">Max DMG: 0</div>
            </div>
        `;
        ui.appendChild(body);
        document.body.appendChild(ui);

        // 2. Settings Modal
        const modal = document.createElement('div');
        modal.id = "veyra-settings-modal";
        modal.style.cssText = `
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 100000;
            background: rgba(15,12,20,0.98); border: 1px solid rgba(241,201,107,0.6); border-radius: 12px;
            padding: 20px; color: #f8ead2; width: 90%; max-width: 400px; max-height: 90vh; overflow-y: auto;
            box-shadow: 0 15px 40px rgba(0,0,0,0.8); display: none; font-family: Georgia, serif;
        `;
        modal.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.1); margin-bottom:15px; padding-bottom:10px;">
                <h2 style="margin:0; font-size:18px; color:#d9b66f;">⚙️ Customize Auto-Pilot</h2>
                <span id="vc-close-modal" style="cursor:pointer; font-size:22px; color:#ff9999; line-height:1;">&times;</span>
            </div>
            <div style="display: grid; gap: 6px; margin-bottom: 15px;">
                <label style="font-size: 13px; color: #ffe3ad; font-weight: 900;">Power Loadout</label>
                <div style="display:flex; gap: 8px;">
                    <select id="vc-loadout-select" style="${selectStyle}"></select>
                    <button id="vc-rename-loadout" style="border: 1px solid rgba(255,255,255,0.16); border-radius: 8px; padding: 6px 12px; background: #221b28; color: #fff; cursor: pointer; font-weight:bold;">Rename</button>
                </div>
            </div>
            <div id="vc-power-warning" style="font-size:12px; color:#ffcf9e; margin-bottom:15px; display:none;">⚠️ Warning: You can only hold 10 powers.</div>
            <div id="vc-priority-container" style="display:grid; gap:8px;"></div>
        `;
        document.body.appendChild(modal);

        bindUIEvents();
        updateUIFromState();
        populateModal();
        setInterval(updateDynamicHP, 1000);
        updateDynamicHP();
    }

    function updateDynamicHP() {
        const hpPreview = document.getElementById("vc-hp-preview");
        if (!hpPreview) return;
        const hp = getPlayerHP();
        if (hp) {
            const healVal = Math.floor(hp.max * (state.potionThreshold / 100));
            hpPreview.innerText = `❤️ Heals at: ~ ${healVal.toLocaleString()} / ${hp.max.toLocaleString()} HP`;
        }
    }

    function bindUIEvents() {
        const getEl = id => document.getElementById(id);
        
        // Sync State
        getEl("vc-attack-type").onchange = e => { state.attackType = e.target.value; saveState(); };
        getEl("vc-stops-at").onchange = e => { state.stopsAt = e.target.value; saveState(); };
        getEl("vc-event-choice").onchange = e => { state.eventChoice = e.target.value; saveState(); };
        getEl("vc-potion-enabled").onchange = e => { state.potionEnabled = e.target.checked; saveState(); };
        getEl("vc-continuous-runs").onchange = e => { state.continuousRuns = e.target.checked; saveState(); };

        // Potion Sync
        const updateThreshold = (val) => {
            let v = Math.max(1, Math.min(99, parseInt(val) || 1));
            state.potionThreshold = v;
            getEl("vc-potion-slider").value = v;
            getEl("vc-potion-input").value = v;
            saveState();
            updateDynamicHP();
        };
        getEl("vc-potion-slider").oninput = e => updateThreshold(e.target.value);
        getEl("vc-potion-input").onchange = e => updateThreshold(e.target.value);

        // Buttons
        getEl("vc-start-btn").onclick = () => { state.active = true; saveState(); scheduleAutoStep(); };
        getEl("vc-stop-btn").onclick = () => { stopAuto("User stopped."); };
        
        // Modal
        getEl("vc-settings-btn").onclick = () => { getEl("veyra-settings-modal").style.display = "block"; };
        getEl("vc-close-modal").onclick = () => { getEl("veyra-settings-modal").style.display = "none"; };
        
        // Loadouts
        getEl("vc-loadout-select").onchange = e => {
            state.currentLoadoutId = e.target.value;
            saveState();
            populateModal();
        };
        getEl("vc-rename-loadout").onclick = async () => {
            const newName = prompt("Enter new name for this loadout:", loadouts[state.currentLoadoutId].name);
            if (newName && newName.trim()) {
                loadouts[state.currentLoadoutId].name = newName.trim();
                await saveLoadouts();
                updateLoadoutDropdown();
            }
        };
    }

    function updateUIFromState() {
        const getEl = id => document.getElementById(id);
        getEl("vc-attack-type").value = state.attackType;
        getEl("vc-stops-at").value = state.stopsAt;
        getEl("vc-event-choice").value = state.eventChoice;
        getEl("vc-potion-enabled").checked = state.potionEnabled;
        getEl("vc-continuous-runs").checked = state.continuousRuns;
        getEl("vc-potion-slider").value = state.potionThreshold;
        getEl("vc-potion-input").value = state.potionThreshold;
    }

    function updateLoadoutDropdown() {
        const select = document.getElementById("vc-loadout-select");
        select.innerHTML = Object.entries(loadouts).map(([id, data]) => 
            `<option value="${id}" ${state.currentLoadoutId === id ? 'selected' : ''}>${data.name}</option>`
        ).join("");
    }

    function populateModal() {
        updateLoadoutDropdown();
        
        const container = document.getElementById("vc-priority-container");
        container.innerHTML = "";
        
        const currentLoadout = loadouts[state.currentLoadoutId];
        const selectStyle = `width: 100%; box-sizing: border-box; border: 1px solid rgba(241, 201, 107, 0.34); border-radius: 8px; background: #120d16; color: #f8ead2; padding: 6px 8px; font: 700 13px Georgia, serif;`;

        for (let i = 0; i < 10; i++) {
            const row = document.createElement("div");
            row.style.cssText = "display: flex; align-items: center; gap: 10px;";
            
            const num = document.createElement("span");
            num.innerText = `${i + 1}.`;
            num.style.cssText = "width: 20px; color: #d9b66f; font-weight: bold; text-align: right;";
            
            const select = document.createElement("select");
            select.style.cssText = selectStyle;
            
            let options = `<option value="">-- None --</option>`;
            ALL_POWERS.forEach(p => {
                options += `<option value="${p}">${p}</option>`;
            });
            select.innerHTML = options;
            select.value = currentLoadout.priorities[i] || "";
            
            select.onchange = (e) => {
                currentLoadout.priorities[i] = e.target.value;
                saveLoadouts();
            };

            row.appendChild(num);
            row.appendChild(select);
            container.appendChild(row);
        }
    }

    // =========================================================================
    // COMBAT LOOP ENGINE & AUTOMATION LOGIC
    // =========================================================================
    let isActionInFlight = false;
    let autoTimer = null;
    let maxDmgDealt = 0;
    
    function setStatus(msg) {
        const el = document.getElementById("vc-status-msg");
        if (el) el.innerText = msg;
    }

    function stopAuto(reason) {
        state.active = false;
        saveState();
        setStatus(reason);
        playNotifyBeep();
    }

    function playNotifyBeep() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(440, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);
            gain.gain.setValueAtTime(0.1, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.5);
        } catch(e) {}
    }

    async function submitFormThenReload(form) {
        if (!form || isActionInFlight) return;
        isActionInFlight = true;
        try {
            const response = await fetch(window.location.href, {
                method: 'POST',
                body: new FormData(form),
                headers: { 'Accept': 'text/html', 'X-Requested-With': 'XMLHttpRequest' }
            });
            if (response.ok) {
                window.location.href = window.location.href; // Force full reload
            } else {
                isActionInFlight = false;
            }
        } catch(e) {
            isActionInFlight = false;
        }
    }

    async function submitAttack(form) {
        if (!form || isActionInFlight) return null;
        isActionInFlight = true;
        try {
            const response = await fetch(window.location.href, {
                method: 'POST',
                body: new FormData(form),
                headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
            });
            const text = await response.text();
            let data = JSON.parse(text);
            isActionInFlight = false;
            
            if (data.message) {
                const match = data.message.match(/dealt ([\d,]+) damage/i);
                if (match) {
                    const dmg = parseInt(match[1].replace(/,/g, ''));
                    if (dmg > maxDmgDealt) {
                        maxDmgDealt = dmg;
                        const dmgEl = document.getElementById("vc-max-dmg");
                        if (dmgEl) dmgEl.innerText = `Max DMG: ${maxDmgDealt.toLocaleString()}`;
                    }
                }
            }
            
            if (data.reload) {
                window.location.href = window.location.href;
                return null;
            }
            return data;
        } catch(e) {
            isActionInFlight = false;
            return null;
        }
    }

    function scheduleAutoStep() {
        if (autoTimer) clearTimeout(autoTimer);
        if (!state.active) return;
        if (isActionInFlight) {
            autoTimer = setTimeout(scheduleAutoStep, 50);
            return;
        }

        // 1. Check End of Run
        const startRunForm = document.querySelector('form input[value="start_run"]');
        if (startRunForm) {
            if (state.continuousRuns) {
                setStatus("Starting new run...");
                startRunForm.closest('form').submit();
                return;
            } else {
                stopAuto("Run finished.");
                return;
            }
        }

        // 2. Potions
        if (state.potionEnabled) {
            const hp = getPlayerHP();
            if (hp && (hp.current / hp.max * 100) <= state.potionThreshold) {
                const potForm = document.querySelector('.js-hp-potion-form');
                if (potForm) {
                    setStatus("Using HP Potion...");
                    submitFormThenReload(potForm);
                    return;
                }
            }
        }

        // 3. Path Events
        const leftForm = document.getElementById('eventPathLeftForm');
        const rightForm = document.getElementById('eventPathRightForm');
        if (leftForm && rightForm) {
            setStatus("Choosing Path...");
            let target = leftForm;
            if (state.eventChoice === 'right') target = rightForm;
            if (state.eventChoice === 'random') target = Math.random() < 0.5 ? leftForm : rightForm;
            submitFormThenReload(target);
            return;
        }

        // 4. Power Selection
        const powerCards = document.querySelectorAll('form.power-choice-card');
        if (powerCards.length > 0) {
            handlePowerSelection(Array.from(powerCards));
            return;
        }

        // 5. Attack
        const attackForms = document.querySelectorAll('form input[name="action"][value="attack"]');
        if (attackForms.length > 0) {
            let targetForm = null;
            attackForms.forEach(inp => {
                const form = inp.closest('form');
                const typeInp = form.querySelector('input[name="attack_type"]');
                if (typeInp && typeInp.value === state.attackType) {
                    targetForm = form;
                }
            });
            if (!targetForm) targetForm = attackForms[0].closest('form');
            
            setStatus(`Attacking (${state.attackType})...`);
            submitAttack(targetForm).then((data) => {
                if (data && !data.reload) {
                    if (data.monster) {
                        if (data.monster.hp) {
                            const hpText = document.getElementById("monsterHpText");
                            if (hpText) hpText.innerText = data.monster.hp + " / " + (getPlayerHP()?.max || data.monster.hp);
                        }
                        if (data.monster.hp_percent) {
                            const hpFill = document.getElementById("monsterHpFill");
                            if (hpFill) hpFill.style.width =  data.monster.hp_percent + "%";
                        }
                    }
                    if (data.player) {
                        if (data.player.hp) {
                            const hpText = document.getElementById("playerHpText");
                            if (hpText) hpText.innerText = data.player.hp + " / " + (getPlayerHP()?.max || data.player.hp);
                        }
                        if (data.player.hp_percent) {
                            const hpFill = document.getElementById("playerHpFill");
                            if (hpFill) hpFill.style.width =  data.player.hp_percent + "%";
                        }
                    }
                    // Loop instantly! Fast execution speed!
                    scheduleAutoStep();
                }
            });
            return;
        }

        setStatus("Waiting for next action...");
        autoTimer = setTimeout(scheduleAutoStep, 1000);
    }

    function getRarityScore(classStr) {
        if (!classStr) return 0;
        classStr = classStr.toLowerCase();
        if (classStr.includes('boss')) return 6;
        if (classStr.includes('legendary')) return 5;
        if (classStr.includes('epic')) return 4;
        if (classStr.includes('rare')) return 3;
        if (classStr.includes('uncommon')) return 2;
        if (classStr.includes('common')) return 1;
        return 0;
    }

    function setReplaceSelect(form, discardName, discardRarity) {
        const select = form.querySelector("select[name='replace_id']");
        if (!select) return true; // No replace dropdown present
        
        const keywords = ["common", "uncommon", "rare", "epic", "legendary", "boss"];
        const targetRk = keywords.find(k => discardRarity.toLowerCase().includes(k)) || "";
        const dName = discardName.toLowerCase().trim();
        
        let bestOpt = null;
        for (let opt of select.options) {
            const txt = opt.text.toLowerCase().trim();
            if (txt.includes(dName) && (!targetRk || txt.includes(targetRk))) {
                bestOpt = opt; break;
            }
        }
        if (!bestOpt) {
            for (let opt of select.options) {
                if (opt.text.toLowerCase().trim().includes(dName)) { bestOpt = opt; break; }
            }
        }
        
        if (bestOpt) {
            select.value = bestOpt.value;
            return true;
        }
        return false;
    }

    function handlePowerSelection(forms) {
        setStatus("Analyzing Powers...");
        
        const inventoryPowers = [];
        document.querySelectorAll('.side-column .power-list .power').forEach(card => {
            const strong = card.querySelector(".power-slot-head strong");
            if (strong) {
                inventoryPowers.push({
                    name: strong.innerText.trim(),
                    rarity: strong.className
                });
            }
        });
        const isFull = inventoryPowers.length >= 10;
        const loadout = loadouts[state.currentLoadoutId].priorities.filter(p => p !== "");

        let bestScore = 0; // MUST BE 0 SO SCORE-0 ACTIONS ARE IGNORED
        let bestForm = null;
        let bestReplace = null;
        
        forms.forEach(form => {
            const h3 = form.querySelector('h3');
            if (!h3) return;
            const nameMatch = h3.innerText.match(/^(.*?)\s*\(/);
            const powerName = nameMatch ? nameMatch[1].trim() : h3.innerText;
            const offeredRarity = h3.className;
            const offeredRarityVal = getRarityScore(offeredRarity);
            
            const pIdx = loadout.indexOf(powerName);
            if (pIdx === -1) return; // Not in priority list
            
            const stackMeta = form.querySelector(".power-stack-meta");
            let maxGameStack = 1;
            if (stackMeta) {
                const match = stackMeta.innerText.match(/\/(\d+)/);
                if (match) maxGameStack = parseInt(match[1]);
            }
            
            const samePowersInInv = inventoryPowers.filter(p => p.name === powerName);
            const currentCount = samePowersInInv.length;
            
            let score = 0;
            let replaceTarget = null;
            
            if (currentCount < maxGameStack) {
                if (isFull) {
                    // Try to find a junk power to replace (one not in our priority list)
                    const junk = inventoryPowers.find(p => !loadout.includes(p.name));
                    if (junk) {
                        score = 1000 + offeredRarityVal;
                        replaceTarget = junk;
                    } else {
                        // All inventory powers are on the priority list. 
                        // We can only add this if it is a higher rarity than the lowest rarity in inventory.
                        const lowestInv = inventoryPowers.reduce((prev, curr) => 
                            getRarityScore(curr.rarity) < getRarityScore(prev.rarity) ? curr : prev
                        );
                        if (offeredRarityVal > getRarityScore(lowestInv.rarity)) {
                            score = 800 + offeredRarityVal;
                            replaceTarget = lowestInv;
                        }
                    }
                } else {
                    score = 1000 + offeredRarityVal;
                }
            } else {
                // Max stacks reached, try to upgrade lowest rarity of THIS specific power
                const lowest = samePowersInInv.reduce((prev, curr) => 
                    getRarityScore(curr.rarity) < getRarityScore(prev.rarity) ? curr : prev
                );
                if (offeredRarityVal > getRarityScore(lowest.rarity)) {
                    score = 500 + offeredRarityVal;
                    replaceTarget = lowest;
                }
            }
            
            if (score > bestScore) {
                bestScore = score;
                bestForm = form;
                bestReplace = replaceTarget;
            }
        });

        if (bestForm) {
            if (bestReplace) {
                const success = setReplaceSelect(bestForm, bestReplace.name, bestReplace.rarity);
                if (!success) {
                    stopAuto("Failed to select replacement target for " + bestReplace.name);
                    return;
                }
            }
            submitFormThenReload(bestForm);
        } else {
            // Stops at logic
            const hasLegendary = forms.some(f => getRarityScore(f.querySelector('h3').className) >= 5);
            const hasEpic = forms.some(f => getRarityScore(f.querySelector('h3').className) >= 4);
            
            if (state.stopsAt === 'all' || 
               (state.stopsAt === 'legendary' && hasLegendary) ||
               (state.stopsAt === 'epic_legendary' && (hasEpic || hasLegendary))) {
                stopAuto("Rare power found. Waiting for player choice.");
                return;
            }
            
            const skipForm = document.getElementById('skipPowerForm');
            if (skipForm) submitFormThenReload(skipForm);
            else stopAuto("Could not find skip button. Script paused.");
        }
    }

    // Initialize UI on load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { initUI(); if (state.active) setTimeout(scheduleAutoStep, 300); });
    } else {
        initUI();
        if (state.active) setTimeout(scheduleAutoStep, 300);
    }

})();
