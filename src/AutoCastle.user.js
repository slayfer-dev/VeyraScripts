// ==UserScript==
// @name         Auto Climb Castle
// @namespace    http://tampermonkey.net/
// @version      2.1
// @updateURL    https://raw.githubusercontent.com/slayfer-dev/VeyraScripts/refs/heads/main/src/AutoCastle.user.js
// @downloadURL  https://raw.githubusercontent.com/slayfer-dev/VeyraScripts/refs/heads/main/src/AutoCastle.user.js
// @description  Auto-combat, auto-heal, auto-left-path, auto-enter. Added native Chrome console logging to diagnose button click failures.
// @author       AI Assistant
// @match        https://demonicscans.org/occurrence_castle.php?slug=vampire_castle*
// @require      https://raw.githubusercontent.com/slayfer-dev/VeyraScripts/refs/heads/main/libs/AntiThrottle.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function() {
    const temp_30 = function() { return ''; };
    'use strict';
    let healThreshold = GM_getValue("veyra_threshold", 20);
    let isDebugEnabled = GM_getValue("debug_enabled", false);
    let isAutoCastleRunning = GM_getValue("veyra_enabled", false);
    let debugLogsArray = [];
    let loopTimeout = null;
    let isWaiting = false;
    let uiOffsetX = 0;
    let uiOffsetY = 0;
    let powerPriorities = GM_getValue("user_priority_map", "{}"); try { powerPriorities = typeof powerPriorities === "string" ? JSON.parse(powerPriorities) : powerPriorities; } catch(e) { powerPriorities = {}; }
    const temp_25 = ["Vampiric Edge", "Raven Eye", "Iron Veil", "Execution Rhythm", "Blood Frenzy", "Frozen Blood", "Witchfire Core", "Mana Leech", "Ashen Wand", "Arcane Surge", "Serrated Vein", "Thorns of the Crypt", "Blood Alchemy", "Crimson Vitality", "Venom Script"],
        temp_26 = {
            'Vampiric\x20Edge': "Vampiric Edge - Slash lifesteal +3%",
            'Raven\x20Eye': "Raven Eye - Slash crit chance +3%",
            'Iron\x20Veil': "Iron Veil - Defense +5%",
            'Execution\x20Rhythm': "Execution Rhythm - First hit +15%",
            'Blood\x20Frenzy': "Blood Frenzy - Attack/Magic +3% per 20% missing HP",
            'Frozen\x20Blood': "Frozen Blood - Magic attacks +1% freeze chance",
            'Witchfire\x20Core': "Witchfire Core - Burn damage +10%",
            'Mana\x20Leech': "Mana Leech - Magic attacks heal for +2%",
            'Ashen\x20Wand': "Ashen Wand - Magic attacks +3% burn chance",
            'Arcane\x20Surge': "Arcane Surge - Magic attacks +3% overcharge chance",
            'Serrated\x20Vein': "Serrated Vein - Slash +3% bleed chance",
            'Thorns\x20of\x20the\x20Crypt': "Thorns of the Crypt - Reflect +7% damage taken",
            'Blood\x20Alchemy': "Blood Alchemy - HP potions heal +25%",
            'Crimson\x20Vitality': "Crimson Vitality - Max HP +6%",
            'Venom\x20Script': "Venom Script - Slash +2% poison chance"
        },
        MAX_LOGS = 0x7d0;

        function debugLog(temp_32, temp_33 = null) {
            const temp_34 = temp_30;
            if (!isDebugEnabled) return;
            const temp_35 = new Date()["toLocaleTimeString"]("en-US", {
                'hour12': ![]
            });
            let temp_36 = '[' + temp_35 + ']\x20' + temp_32;
            if (temp_33 !== null && temp_33 !== undefined) try {
                const temp_37 = typeof temp_33 === "object" ? JSON["stringify"](temp_33) : String(temp_33);
                temp_36 += " | Data:12" + temp_37;
            } catch (temp_38) {
                temp_36 += " | Data:12[Circular or unstringifiable]";
            }
            debugLogsArray["push"](temp_36);
            if (debugLogsArray["length"] > MAX_LOGS) debugLogsArray["shift"]();
            console["warn"]("[Veyra AAutopilot] " + temp_36);
        }

        function downloadLogs() {
            const temp_39 = temp_30;
            if (debugLogsArray["length"] === 0x0) {
                alert("No debug logs generated yet. Turn on Debug and let the script run until it stops.");
                return;
            }
            const temp_40 = "Veyra Castle Auto-Pilot Debug Log\nGenerated: " + new Date()["toLocaleString"]() + "\nUser Agent: " + navigator["userAgent"] + "\\n--------------------------------------------------\n\n",
                temp_41 = temp_40 + debugLogsArray["join"]('\x0a'),
                temp_42 = new Blob([temp_41], {
                    'type': "text/plain"
                }),
                temp_43 = URL["createObjectURL"](temp_42),
                temp_44 = document["createElement"]('a');
            temp_44["href"] = temp_43, temp_44["download"] = "veyra_debug_log_" + Date["now"]() + ".txt", document["body"]["appendChild"](temp_44), temp_44["click"](), document["body"]["removeChild"](temp_44), URL["revokeObjectURL"](temp_43), debugLog("Logs downloaded by user.");
        }

        function applyUIPosition() {
            const temp_45 = temp_30,
                temp_46 = GM_getValue("ui_pos_left", "auto"),
                temp_47 = GM_getValue("ui_pos_top", "20px"),
                temp_48 = document["getElementById"]("veyra-autoplay-ui");
            if (temp_48) {
                if (temp_46 !== "auto") temp_48["style"]["left"] = temp_46 + 'px';
                temp_48["style"]["top"] = temp_47 + 'px';
            }
        }


        let uiUpdateInterval = null;

        function updateDynamicHP() {
            const hpPreview = document.getElementById("veyra-hp-preview");
            if (!hpPreview) return;
            const hp = getPlayerHP();
            if (hp) {
                const healVal = Math.floor(hp.max * (healThreshold / 100));
                hpPreview.innerText = `❤️ Heals at: ${healVal.toLocaleString()} / ${hp.max.toLocaleString()} HP`;
            } else {
                hpPreview.innerText = `❤️ Heals at: ... / ... HP`;
            }
        }

        function minimizeUI() {
            const ui = document.getElementById("veyra-autoplay-ui");
            if (!ui) return;
            const isMin = ui.getAttribute("data-minimized") === "true";

            const contentDivs = ui.querySelectorAll(".veyra-content");
            contentDivs.forEach(el => el.style.display = isMin ? (el.id === 'veyra-live-stats' ? 'grid' : 'flex') : "none");

            ui.setAttribute("data-minimized", isMin ? "false" : "true");
            document.getElementById("veyra-min-btn").innerText = isMin ? "[-]" : "[+]";
            ui.style.minWidth = isMin ? "160px" : "auto";
        }

        function initUI() {
            if (document.getElementById("veyra-autoplay-ui")) return;

            const ui = document.createElement("div");
            ui.id = "veyra-autoplay-ui";
            ui.style.cssText = `
                position: fixed; top: 20px; right: auto; left: auto; z-index: 99999;
                background: rgba(15, 12, 20, 0.85); border: 1px solid rgba(241, 201, 107, 0.6);
                border-radius: 12px; padding: 12px 16px; color: #f8ead2;
                font-family: Georgia, "Times New Roman", serif; font-size: 13px; min-width: 160px;
                box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.6);
                backdrop-filter: blur(8px); touch-action: none; cursor: grab; user-select: none;
                -webkit-tap-highlight-color: transparent; display: flex; flex-direction: column; gap: 8px;
            `;
            ui.addEventListener("pointerdown", onUIPointerDown);

            // Header (Drag handle + Minimize)
            const header = document.createElement("div");
            header.style.cssText = "display: flex; justify-content: space-between; align-items: center; cursor: grab; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 4px; margin-bottom: 4px;";
            header.innerHTML = `<span style="opacity:0.5; letter-spacing: 2px;">⠿⠿⠿</span>
                                <span id="veyra-min-btn" style="cursor:pointer; font-weight:bold; color:#d9b66f; pointer-events:auto;" onclick="minimizeUI()">[-]</span>`;
            ui.appendChild(header);

            // Status Glow
            const status = document.createElement("div");
            status.className = "veyra-content";
            status.id = "veyra-status";
            status.style.cssText = "display: flex; align-items: center; gap: 6px; font-weight: bold;";
            status.innerHTML = `Status: <span id="veyra-status-glow" style="display:inline-block; width:10px; height:10px; border-radius:50%; background:red; box-shadow: 0 0 8px red;"></span>`;
            ui.appendChild(status);

            // Healing UI
            const healBox = document.createElement("div");
            healBox.className = "veyra-content";
            healBox.style.cssText = "display: flex; flex-direction: column; gap: 4px;";

            const healInputRow = document.createElement("div");
            healInputRow.style.cssText = "display: flex; gap: 6px; align-items: center;";

            const slider = document.createElement("input");
            slider.type = "range";
            slider.min = "1";
            slider.max = "100";
            slider.value = healThreshold;
            slider.style.cssText = "flex: 1; pointer-events: auto; cursor: pointer; accent-color: #d9b66f;";

            const numInput = document.createElement("input");
            numInput.type = "number";
            numInput.min = "1";
            numInput.max = "100";
            numInput.value = healThreshold;
            numInput.style.cssText = "width: 40px; background: #221b28; color: #f8ead2; border: 1px solid #555; border-radius: 4px; padding: 2px; text-align: center; pointer-events: auto;";

            const updateHeal = (val) => {
                let v = parseInt(val);
                if (isNaN(v) || v < 1) v = 1;
                if (v > 100) v = 100;
                healThreshold = v;
                slider.value = v;
                numInput.value = v;
                GM_setValue("veyra_threshold", v);
                updateDynamicHP();
            };

            slider.oninput = (e) => updateHeal(e.target.value);
            numInput.onchange = (e) => updateHeal(e.target.value);

            healInputRow.appendChild(slider);
            healInputRow.appendChild(numInput);
            healInputRow.insertAdjacentHTML('beforeend', '<span>%</span>');

            const hpPreview = document.createElement("div");
            hpPreview.id = "veyra-hp-preview";
            hpPreview.style.cssText = "font-size: 11px; opacity: 0.8; color: #ff9999;";
            hpPreview.innerText = "❤️ Heals at: ... / ... HP";

            healBox.appendChild(healInputRow);
            healBox.appendChild(hpPreview);
            ui.appendChild(healBox);

            // Stats Box
            const statsBox = document.createElement("div");
            statsBox.className = "veyra-content";
            statsBox.id = "veyra-live-stats";
            statsBox.style.cssText = "font-size: 11px; color: #a8ffca; margin-top: 4px; display: grid; grid-template-columns: 1fr 1fr; gap: 4px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 6px; width: 100%;";
            statsBox.innerHTML = `
                <span>🧪 Potions: <strong id='veyra-stat-potions'>${GM_getValue("potion_gained_count", 1)}</strong></span>
                <span>💥 Max DMG: <strong id='veyra-stat-dmg'>${GM_getValue("highest_damage_dealt", 0)}</strong></span>
            `;
            ui.appendChild(statsBox);

            // Buttons
            const btnRow = document.createElement("div");
            btnRow.className = "veyra-content";
            btnRow.style.cssText = "display: flex; gap: 6px; margin-top: 4px;";

            const toggleBtn = document.createElement("button");
            toggleBtn.id = "veyra-toggle-btn";
            toggleBtn.style.cssText = "flex: 1; background: #d9b66f; color: #1b1210; border: 0; border-radius: 6px; padding: 6px; font-weight: bold; cursor: pointer; pointer-events: auto;";
            toggleBtn.onclick = toggleAutoCastle;
            toggleBtn.innerText = "Start";
            btnRow.appendChild(toggleBtn);

            const debugBtn = document.createElement("button");
            debugBtn.innerText = "🐞";
            debugBtn.title = "Toggle Debug Mode";
            debugBtn.style.cssText = `padding: 6px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.2); background: ${isDebugEnabled ? "#2d8f2d" : "#221b28"}; color: #f8ead2; cursor: pointer; pointer-events: auto;`;
            debugBtn.onclick = () => {
                isDebugEnabled = !isDebugEnabled;
                GM_setValue("debug_enabled", isDebugEnabled);
                debugBtn.style.background = isDebugEnabled ? "#2d8f2d" : "#221b28";
            };
            btnRow.appendChild(debugBtn);

            const settingsBtn = document.createElement("button");
            settingsBtn.innerText = "⚙️";
            settingsBtn.title = "Priority Settings";
            settingsBtn.style.cssText = "padding: 6px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.2); background: #221b28; color: #f8ead2; cursor: pointer; pointer-events: auto;";
            settingsBtn.onclick = toggleSettingsMenu;
            btnRow.appendChild(settingsBtn);

            ui.appendChild(btnRow);
            document.body.appendChild(ui);

            window.minimizeUI = minimizeUI;

            applyUIPosition();
            restoreUIState();

            if (uiUpdateInterval) clearInterval(uiUpdateInterval);
            uiUpdateInterval = setInterval(updateDynamicHP, 1000);
            updateDynamicHP();
        }

        function onUIPointerDown(e) {
            if (e.target.closest("button") || e.target.closest("input") || e.target.closest("span[onclick]")) return;
            e.preventDefault();
            const ui = document.getElementById("veyra-autoplay-ui");
            const rect = ui.getBoundingClientRect();
            isWaiting = true;
            uiOffsetX = rect.left;
            uiOffsetY = rect.top;
            window.uiDragStartX = e.clientX;
            window.uiDragStartY = e.clientY;
            ui.style.cursor = "grabbing";
            try { ui.setPointerCapture(e.pointerId); } catch(err){}
            document.addEventListener("pointermove", onUIPointerMove);
            document.addEventListener("pointerup", onUIPointerUp);
            document.addEventListener("pointercancel", onUIPointerUp);
        }

        function onUIPointerMove(e) {
            if (!isWaiting) return;
            e.preventDefault();
            const ui = document.getElementById("veyra-autoplay-ui");
            ui.style.left = uiOffsetX + (e.clientX - window.uiDragStartX) + "px";
            ui.style.top = uiOffsetY + (e.clientY - window.uiDragStartY) + "px";
            ui.style.right = "auto";
        }

        function onUIPointerUp(e) {
            if (!isWaiting) return;
            isWaiting = false;
            const ui = document.getElementById("veyra-autoplay-ui");
            ui.style.cursor = "grab";
            try { ui.releasePointerCapture(e.pointerId); } catch(err){}
            const left = parseInt(ui.style.left);
            const top = parseInt(ui.style.top);
            if (!isNaN(left) && !isNaN(top)) {
                GM_setValue("ui_pos_left", left);
                GM_setValue("ui_pos_top", top);
            }
            document.removeEventListener("pointermove", onUIPointerMove);
            document.removeEventListener("pointerup", onUIPointerUp);
            document.removeEventListener("pointercancel", onUIPointerUp);
        }

        function restoreUIState() {
            const btn = document.getElementById("veyra-toggle-btn");
            const glow = document.getElementById("veyra-status-glow");
            if (!btn || !glow) return;
            if (isAutoCastleRunning) {
                btn.innerText = "Stop";
                btn.style.background = "#cf2d45";
                btn.style.color = "#f8ead2";
                glow.style.background = "#2d8f2d";
                glow.style.boxShadow = "0 0 10px #2d8f2d";
            } else {
                btn.innerText = "Start";
                btn.style.background = "#d9b66f";
                btn.style.color = "#1b1210";
                glow.style.background = "red";
                glow.style.boxShadow = "0 0 10px red";
            }
        }

                function toggleSettingsMenu() {
            if (document.getElementById("veyra-settings-modal")) return;
            debugLog("Opening settings modal");

            const modal = document.createElement("div");
            modal.id = "veyra-settings-modal";
            modal.style.cssText = `
                position: fixed; top: 100px; left: 50%; transform: translateX(-50%); z-index: 99999;
                background: rgba(15, 12, 20, 0.95); border: 1px solid rgba(241, 201, 107, 0.6);
                border-radius: 12px; padding: 16px; color: #f8ead2;
                font-family: Georgia, "Times New Roman", serif; font-size: 13px; width: 420px;
                box-shadow: 0 12px 40px rgba(0, 0, 0, 0.8);
                backdrop-filter: blur(12px); display: flex; flex-direction: column; gap: 12px;
            `;

            const header = document.createElement("div");
            header.style.cssText = "display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px; margin-bottom: 8px; cursor: grab;";
            header.innerHTML = `
                <span style="font-weight: bold; font-size: 15px; color: #ffd88a;">⚙️ Customize Auto-Pilot</span>
                <span id="close-settings-x" style="cursor:pointer; color:#d9b66f; font-weight:bold; font-size: 16px;">×</span>
            `;
            modal.appendChild(header);

            // Drag logic for modal
            let isModalWaiting = false, mOffsetX = 0, mOffsetY = 0, mStartX = 0, mStartY = 0;
            header.addEventListener('pointerdown', (e) => {
                if(e.target.id === 'close-settings-x') return;
                e.preventDefault();
                const rect = modal.getBoundingClientRect();
                isModalWaiting = true;
                mOffsetX = rect.left;
                mOffsetY = rect.top;
                mStartX = e.clientX;
                mStartY = e.clientY;
                header.style.cursor = "grabbing";
                try { header.setPointerCapture(e.pointerId); } catch(err){}
            });
            header.addEventListener('pointermove', (e) => {
                if(!isModalWaiting) return;
                e.preventDefault();
                modal.style.left = mOffsetX + (e.clientX - mStartX) + "px";
                modal.style.top = mOffsetY + (e.clientY - mStartY) + "px";
                modal.style.transform = "none";
            });
            const stopDrag = (e) => {
                if(!isModalWaiting) return;
                isModalWaiting = false;
                header.style.cursor = "grab";
                try { header.releasePointerCapture(e.pointerId); } catch(err){}
            };
            header.addEventListener('pointerup', stopDrag);
            header.addEventListener('pointercancel', stopDrag);

            const content = document.createElement("div");
            content.style.cssText = "display: flex; flex-direction: column; gap: 12px; max-height: 70vh; overflow-y: auto; padding-right: 4px;";

            const currentAttackType = GM_getValue("attack_tope", "slash");
            const atkRow = document.createElement("div");
            atkRow.style.cssText = "display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.05); padding: 8px 12px; border-radius: 8px;";
            atkRow.innerHTML = `
                <span style="font-weight:bold;">Attack Type:</span>
                <select id="attack-type-select" style="background:#221b28; color:#f8ead2; border:1px solid #555; border-radius:4px; padding:4px 8px;">
                    <option value="slash" ${currentAttackType === "slash" ? "selected" : ""}>Slash</option>
                    <option value="magic" ${currentAttackType === "magic" ? "selected" : ""}>Magic Attack</option>
                </select>
            `;
            content.appendChild(atkRow);

            const priorityLabel = document.createElement("div");
            priorityLabel.innerHTML = `<strong>Power Priorities:</strong><br><span style="font-size:11px; color:#cdbfba;">Select up to 10 powers. Define how many you want of each.</span>`;
            content.appendChild(priorityLabel);

            const priorityList = document.createElement("div");
            priorityList.id = "priority-list";
            priorityList.style.cssText = "display: flex; flex-direction: column; gap: 6px;";
            content.appendChild(priorityList);

            modal.appendChild(content);

            const btnRow = document.createElement("div");
            btnRow.style.cssText = "display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px;";
            btnRow.innerHTML = `
                <button id="close-settings-btn" style="background:#221b28; color:#f8ead2; border:1px solid rgba(255,255,255,0.2); border-radius:6px; padding:6px 16px; cursor:pointer;">Cancel</button>
                <button id="save-powers-btn" style="background:#d9b66f; color:#1b1210; border:0; border-radius:6px; padding:6px 16px; font-weight:bold; cursor:pointer;">Save</button>
            `;
            modal.appendChild(btnRow);

            document.body.appendChild(modal);

            let userPriorityMap = GM_getValue("user_priority_map", "{}"); try { userPriorityMap = typeof userPriorityMap === "string" ? JSON.parse(userPriorityMap) : userPriorityMap; } catch(e) { userPriorityMap = {}; }

            // Build 10 slots
            for (let i = 1; i <= 10; i++) {
                const row = document.createElement("div");
                row.style.cssText = "display: flex; gap: 8px; align-items: center; background: rgba(255,255,255,0.03); padding: 4px 8px; border-radius: 6px;";

                const label = document.createElement("span");
                label.innerText = `Slot ${i}:`;
                label.style.cssText = "width: 45px; font-size: 12px; color: #a8ffca;";
                row.appendChild(label);

                const select = document.createElement("select");
                select.style.cssText = "flex: 1; background:#221b28; color:#f8ead2; border:1px solid #555; border-radius:4px; padding:4px;";
                const defOpt = document.createElement("option");
                defOpt.value = "";
                defOpt.innerText = "None / Empty";
                select.appendChild(defOpt);

                temp_25.forEach(p => {
                    const opt = document.createElement("option");
                    opt.value = p;
                    opt.innerText = temp_26[p] || p;
                    // Note: original code saved priority map slightly differently, we assume map[power] = count
                    // Wait, original map was: GM_setValue("user_priority_map", { "powerName": count })
                    select.appendChild(opt);
                });
                row.appendChild(select);

                const qtyLabel = document.createElement("span");
                qtyLabel.innerText = "Qty:";
                qtyLabel.style.cssText = "font-size: 11px; color: #aaa;";
                row.appendChild(qtyLabel);

                const countInput = document.createElement("input");
                countInput.type = "number";
                countInput.title = "Target amount of this power to collect";
                countInput.min = "1";
                countInput.max = "10";
                countInput.style.cssText = "width: 40px; background:#221b28; color:#f8ead2; border:1px solid #555; border-radius:4px; padding:4px; text-align:center;";

                // Pre-fill logic (attempt to map old data back to UI slots sequentially)
                // Actually, the original stored `{ "Iron Veil": 3 }` etc.
                // We just need to distribute the keys across the 10 slots.
                countInput.value = "1";
                row.appendChild(countInput);

                priorityList.appendChild(row);
            }

            // Populate slots with existing map
            const keys = Object.keys(userPriorityMap);
            const rows = priorityList.querySelectorAll("div");
            keys.forEach((k, idx) => {
                if (idx < 10) {
                    const select = rows[idx].querySelector("select");
                    const countInput = rows[idx].querySelector("input");
                    if(select && countInput) {
                        select.value = k;
                        countInput.value = userPriorityMap[k] || 1;
                    }
                }
            });

            document.getElementById("save-powers-btn").onclick = () => {
                const newMap = {};
                const rows = priorityList.querySelectorAll("div");
                rows.forEach(r => {
                    const selectEl = r.querySelector("select");
                    const inputEl = r.querySelector("input");
                    if (selectEl && inputEl) {
                        const s = selectEl.value;
                        const c = parseInt(inputEl.value, 10);
                        if (s) newMap[s] = c;
                    }
                });
                GM_setValue("user_priority_map", JSON.stringify(newMap));
                powerPriorities = newMap;

                const atkType = document.getElementById("attack-type-select").value;
                GM_setValue("attack_tope", atkType);

                document.body.removeChild(modal);
                restoreUIState();
                debugLog("Settings saved");
            };

            const closeSettings = () => document.body.removeChild(modal);
            document.getElementById("close-settings-btn").onclick = closeSettings;
            document.getElementById("close-settings-x").onclick = closeSettings;
        }

        function getPlayerHP() {
            const temp_118 = temp_30,
                temp_119 = document["querySelectorAll"](".side-column .card p");
            for (let temp_120 of temp_119) {
                const temp_121 = temp_120["textContent"]["trim"]();
                if (temp_121["startsWith"]("HP:")) {
                    const temp_122 = temp_121["match"](/HP\s*:\s*(\d+)\s*\/\s*(\d+)/);
                    if (temp_122) return {
                        'current': parseInt(temp_122[0x1]),
                        'max': parseInt(temp_122[0x2])
                    };
                    return null;
                }
            }
            return null;
        }

        function getPlayerStats() {
            const temp_124 = temp_30,
                temp_125 = document["querySelectorAll"](".stat-line");
            let temp_126 = 0x0,
                temp_127 = 0x0;
            return temp_125["forEach"](temp_128 => {
                const temp_129 = temp_124,
                    temp_130 = temp_128["querySelector"]("span")?.["textContent"]["trim"]() || '',
                    temp_131 = temp_128["querySelector"]("strong")?.["textContent"]["trim"]() || '0';
                if (temp_130 === "Attack") temp_126 = parseInt(temp_131) || 0x0;
                if (temp_130 === "Defense") temp_127 = parseInt(temp_131) || 0x0;
            }), {
                'atk': temp_126,
                'def': temp_127
            };
        }

        function getEnemyStats() {
            const temp_133 = temp_30,
                temp_134 = document["querySelector"](".monster-info");
            if (!temp_134) return {
                'atk': "N/A",
                'def': "N/A"
            };
            const temp_135 = temp_134["textContent"],
                temp_136 = temp_135["match"](/ATK\s*(\d+)/),
                temp_137 = temp_135["match"](/DEF\s*(\d+)/);
            return {
                'atk': temp_136 ? parseInt(temp_136[0x1]) : "N/A",
                'def': temp_137 ? parseInt(temp_137[0x1]) : "N/A"
            };
        }

        function clickAttackButton() {
            const temp_139 = temp_30,
                temp_140 = GM_getValue("attack_tope", "slash"),
                temp_141 = document["querySelector"]("input[name=\"attack_type\"][value=\"" + temp_140 + '\x22]')?.["closest"]("form")?.["querySelector"]("button");
            if (temp_141 && !temp_141["disabled"] && temp_141["offsetParent"] !== null) return debugLog("Attackin12 with", temp_140), temp_141["click"](), !![];
            return debugLog("Attack button not found or disabled", {
                'attackType': temp_140
            }), ![];
        }

        function clickStartRunButton() {
            const temp_143 = temp_30,
                temp_144 = document["querySelector"]("form input[name=\"action\"][value=\"start_run\"]")?.["closest"]("form")?.["querySelector"]("button");
            if (temp_144) return temp_144["click"](), !![];
            return ![];
        }

        function clickLeftPathButton() {
            const temp_146 = temp_30,
                temp_147 = document["querySelector"]("input[name=\"choice\"][value=\"left\"]")?.["closest"]("form")?.["querySelector"]("button");
            if (temp_147) return debugLog("Taking Left Path"), temp_147["click"](), setTimeout(parseRecentRunLog, 0x12c), !![];
            return ![];
        }

        function useHealthPotion() {
            const temp_150 = temp_30,
                temp_151 = document["querySelector"]("input[name=\"action\"][value=\"use_run_item\"]")?.["closest"]("form")?.["querySelector"]("button");
            if (temp_151) return GM_setValue("potion_used_count", GM_getValue("potion_used_count", 0x0) + 0x1), debugLog("Using potion"), temp_151["click"](), !![];
            return ![];
        }

        function clickGenericContinueBtn() {
            const temp_153 = temp_30,
                temp_154 = document["querySelectorAll"]("button.btn");
            for (let temp_155 of temp_154) {
                const temp_156 = temp_155["innerText"]["toLowerCase"]()["trim"]();
                if (temp_156 === "continue" || temp_156 === "next" || temp_156 === "skip" || temp_156 === "proceed") return debugLog("Clicked generic continue", temp_156), temp_155["click"](), !![];
            }
            return ![];
        }

        function clickDarkButton() {
            const temp_158 = temp_30,
                temp_159 = document["querySelector"]("button.btn.dark");
            if (temp_159) return temp_159["click"](), !![];
            return ![];
        }


        function playBeep() {
            try {
                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                const osc = ctx.createOscillator();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(440, ctx.currentTime);
                osc.connect(ctx.destination);
                osc.start();
                osc.stop(ctx.currentTime + 0.5);
            } catch(e) {}
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

        function getAvailablePowersList() {
            const temp_162 = document.querySelectorAll(".power-list .power");
            const inventory = [];
            temp_162.forEach(card => {
                const strong = card.querySelector(".power-slot-head strong");
                if (strong) {
                    inventory.push({
                        name: strong.innerText.trim(),
                        rarity: strong.className
                    });
                }
            });
            return inventory;
        }

        function getBestPowerToDiscard(inventoryPowers) {
            for (let p of inventoryPowers) {
                const target = powerPriorities[p.name];
                if (!target) return p;

                const count = inventoryPowers.filter(ip => ip.name === p.name).length;
                if (count > target) return p;
            }
            return null;
        }

        function replacePowerIfBetter(cardEl, discardName, discardRarity) {
            const select = cardEl.querySelector("select[name=\"replace_id\"]");
            if (!select) return false;

            // Extract rarity keyword(s) from the CSS class string for matching
            const rarityKeywords = ["common", "uncommon", "rare", "epic", "legendary", "boss"];
            const discardRarityLower = discardRarity.toLowerCase();
            const targetRarityKeyword = rarityKeywords.find(r => discardRarityLower.includes(r)) || "";

            debugLog("replacePowerIfBetter looking for:", { discardName, discardRarity, targetRarityKeyword });

            // First pass: try to match BOTH name AND rarity exactly
            let bestOption = null;
            for (let opt of select.options) {
                const optText = opt.text.toLowerCase();
                if (optText.includes(discardName.toLowerCase())) {
                    // Check if this option also contains the target rarity keyword
                    if (targetRarityKeyword && optText.includes(targetRarityKeyword)) {
                        bestOption = opt;
                        break; // Exact match found
                    }
                }
            }

            // Fallback: if no exact name+rarity match, find the option with the LOWEST rarity
            // among all options matching the discard name
            if (!bestOption) {
                let lowestScore = 999;
                for (let opt of select.options) {
                    const optText = opt.text.toLowerCase();
                    if (optText.includes(discardName.toLowerCase())) {
                        // Find which rarity keyword is in this option text
                        let optScore = 999;
                        for (const rk of rarityKeywords) {
                            if (optText.includes(rk)) {
                                optScore = rarityKeywords.indexOf(rk);
                                break;
                            }
                        }
                        if (optScore < lowestScore) {
                            lowestScore = optScore;
                            bestOption = opt;
                        }
                    }
                }
            }

            if (bestOption) {
                select.value = bestOption.value;
                select.dispatchEvent(new Event("change", { bubbles: true }));
                const btn = select.closest("form")?.querySelector("button.btn");
                if (btn) {
                    debugLog("Replacing " + discardName + " (" + discardRarity + ") — selected: " + bestOption.text);
                    btn.click();
                    return true;
                }
            }

            debugLog("Could not find matching option for " + discardName + " (" + discardRarity + ")");
            return false;
        }

        function processPowerSelection() {
            const cards = document.querySelectorAll(".power-choice-card");
            if (cards.length === 0) return false;

            const inventoryPowers = getAvailablePowersList();
            const isFull = inventoryPowers.length >= 10;

            debugLog("Processing power selection", { inventoryCount: inventoryPowers.length, isFull });

            for (let card of cards) {
                const h3 = card.querySelector('h3');
                if (h3 && (h3.className.includes('legendary') || h3.className.includes('boss'))) {
                    playBeep();
                    debugLog("Legendary/Boss power found! Stopping script to let you choose.");
                    stopAutoCastle();
                    return true;
                }
            }

            let bestActionScore = -1;
            let bestCard = null;
            let bestReplacePower = null;

            cards.forEach(card => {
                const h3 = card.querySelector('h3');
                if (!h3) return;

                const offeredName = h3.innerText.split('(')[0].trim();
                const offeredRarityClass = h3.className;
                const offeredRarityValue = getRarityScore(offeredRarityClass);

                const targetCount = powerPriorities[offeredName];
                if (!targetCount) {
                    debugLog("Skipping offered power (not in priority map)", offeredName);
                    return;
                }

                const stackMeta = card.querySelector(".power-stack-meta");
                let maxGameStack = 3;
                if (stackMeta) {
                    const match = stackMeta.innerText.match(/\/(\d+)/);
                    if (match) maxGameStack = parseInt(match[1]);
                }

                const effectiveLimit = Math.min(maxGameStack, targetCount);
                const samePowersInInventory = inventoryPowers.filter(p => p.name === offeredName);
                const currentCount = samePowersInInventory.length;

                let score = 0;
                let powerToReplace = null;

                if (currentCount < effectiveLimit) {
                    if (isFull) {
                        const junkPower = getBestPowerToDiscard(inventoryPowers);
                        if (junkPower) {
                            score = 1000 + offeredRarityValue;
                            powerToReplace = junkPower;
                        } else {
                            debugLog("Cannot add wanted power because inventory is full of prioritized powers!", offeredName);
                            return;
                        }
                    } else {
                        score = 1000 + offeredRarityValue;
                        powerToReplace = null;
                    }
                } else {
                    const lowestRarityPower = samePowersInInventory.reduce((lowest, p) =>
                        getRarityScore(p.rarity) < getRarityScore(lowest.rarity) ? p : lowest
                    );

                    if (offeredRarityValue > getRarityScore(lowestRarityPower.rarity)) {
                        score = 500 + offeredRarityValue;
                        powerToReplace = lowestRarityPower;
                    } else {
                        return;
                    }
                }

                if (score > bestActionScore) {
                    bestActionScore = score;
                    bestCard = card;
                    bestReplacePower = powerToReplace;
                }
            });

            if (!bestCard || bestActionScore < 0) {
                debugLog("No valid power choice found, skipping");
                return clickDarkButton();
            }

            if (bestReplacePower) {
                return replacePowerIfBetter(bestCard, bestReplacePower.name, bestReplacePower.rarity);
            } else {
                const btn = bestCard.querySelector("button.btn");
                if (btn) {
                    const powerName = bestCard.querySelector('h3')?.innerText.split('(')[0].trim();
                    debugLog("Choosing new power (empty slot)", powerName);
                    btn.click();
                    return true;
                }
            }

            return clickDarkButton();
        }

        function parseRecentRunLog() {
            const temp_223 = temp_30,
                temp_224 = document["querySelector"]("section.card h2");
            if (!temp_224 || temp_224["textContent"]["trim"]() !== "Recent Run Log") return;
            const temp_225 = temp_224["parentElement"]["querySelectorAll"](".log");
            let temp_226 = GM_getValue("potion_gained_count", 0x1);
            temp_225["forEach"](temp_227 => {
                const temp_228 = temp_223,
                    temp_229 = temp_227["textContent"]["trim"]();
                if (temp_229["toLowerCase"]()["includes"]("gained") && temp_229["toLowerCase"]()["includes"]("blood potion")) {
                    let temp_230 = 0x0,
                        temp_231 = temp_229["match"](/Gained\s*(\d+)\s*x?\s*(?:Small\s*)?Blood Potion/i);
                    if (temp_231) temp_230 = parseInt(temp_231[0x1]);
                    else {
                        let temp_232 = temp_229["match"](/x(\d+)/);
                        if (temp_232) temp_230 = parseInt(temp_232[0x1]);
                        else temp_230 = 0x1;
                    }
                    temp_226 += temp_230;
                }
            }), GM_setValue("potion_gained_count", temp_226);
            const uiPts = document.getElementById("veyra-stat-potions");
            if (uiPts) uiPts.innerText = temp_226;

            const temp_233 = getPlayerStats(),
                temp_234 = getEnemyStats();
            if (temp_233["atk"] > 0x0) GM_setValue("snapshot_player_atk", temp_233["atk"]);
            if (temp_233["def"] > 0x0) GM_setValue("snapshot_player_def", temp_233["def"]);
            if (temp_234["atk"] !== "N/A") GM_setValue("snapshot_enemy_atk", temp_234["atk"]);
            if (temp_234["def"] !== "N/A") GM_setValue("snapshot_enemy_def", temp_234["def"]);
            let temp_235 = GM_getValue("highest_damage_dealt", 0x0),
                temp_236 = GM_getValue("highest_damage_received", 0x0);
            temp_225["forEach"](temp_237 => {
                const temp_238 = temp_223,
                    temp_239 = temp_237["textContent"]["trim"]();
                let temp_240 = temp_239["match"](/Dealt\s*(\d+)\s*damage/);
                if (temp_240) {
                    let temp_241 = parseInt(temp_240[0x1]);
                    !temp_239["toLowerCase"]()["includes"]("critical") && temp_241 > temp_235 && (temp_235 = temp_241);
                    const uiDmg = document.getElementById("veyra-stat-dmg");
                    if (uiDmg) uiDmg.innerText = temp_235;

                }
                let temp_242 = temp_239["match"](/Retaliation\s*dealt\s*(\d+)/);
                if (temp_242) {
                    let temp_243 = parseInt(temp_242[0x1]);
                    temp_243 > temp_236 && (temp_236 = temp_243);
                }
            }), GM_setValue("highest_damage_dealt", temp_235), GM_setValue("highest_damage_received", temp_236);
            const temp_244 = document["getElementById"]("battleFloorText"),
                temp_245 = document["getElementById"]("topEncounterText");
            if (temp_244) {
                const temp_246 = temp_244["textContent"]["trim"]();
                parseInt(temp_246) > 0x0 && GM_setValue("snapshot_floor", temp_246);
            }
            if (temp_245) {
                const temp_247 = temp_245["textContent"]["trim"]();
                temp_247 && temp_247 !== "0 / 20" && GM_setValue("snapshot_encounter", temp_247);
            }
        }

        function showRunSummary() {
            const temp_249 = temp_30,
                temp_250 = Date["now"]() - GM_getValue("run_start_time", Date["now"]()),
                temp_251 = Math["floor"](temp_250 / 0x3e8),
                temp_252 = String(Math["floor"](temp_251 / 0xe10))["padStart"](0x2, '0'),
                temp_253 = String(Math["floor"](temp_251 % 0xe10 / 0x3c))["padStart"](0x2, '0'),
                temp_254 = String(temp_251 % 0x3c)["padStart"](0x2, '0'),
                temp_255 = temp_252 + ':' + temp_253 + ':' + temp_254,
                temp_256 = GM_getValue("potion_gained_count", 0x1),
                temp_257 = GM_getValue("potion_used_count", 0x0),
                temp_258 = GM_getValue("snapshot_player_atk", 0x0),
                temp_259 = GM_getValue("snapshot_player_def", 0x0),
                temp_260 = GM_getValue("snapshot_enemy_atk", "N/A"),
                temp_261 = GM_getValue("snapshot_enemy_def", "N/A"),
                temp_262 = GM_getValue("highest_damage_dealt", 0x0),
                temp_263 = GM_getValue("highest_damage_received", 0x0),
                temp_264 = GM_getValue("snapshot_floor", '0'),
                temp_265 = GM_getValue("snapshot_encounter", "0 / 20");
            if (document["getElementById"]("veyra-run-summary")) return;
            const temp_266 = document["createElement"]("div");
            temp_266['id'] = "veyra-run-summary", temp_266["style"]["cssText"] = "\n       12    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);\n115           z-index: 99999; max-width: 620px; width: 90%;\n            background: rgba(12, 10, 16, 0.98); border: 1px sol276d rgba(241, 201, 107, 0.6);\n            border-radius: 20px; padding: 24px; color: #f8ead2;\n            font-family: Georgia, \"Times New Roman\", serif; box-shadow: 0 25px 60px rgba(0,0,0,0.9);\n            backdrop-filter: blur(10px);\n        ", temp_266["innerHTML"] = "\n       12    <h2 style=\"color:#ffd88a; text-align:center; margin-top:0;\">Run Complete115!</h2>\n            <div style=\"display:grid; gap:12px; margin:16px 0; border:1px solid rgba(255,255,255,0.1); border-rad276us:12px; padding:16px;\">\n                <div style=\"display:flex; justify-content:space-between; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:8px;\">\n                    <span>⏱️ Duration:</span>\n                    <strong style=\"color:#a8ffca;\">" + temp_255 + "</strong12\n                </div>\n                <div style=\"display:flex; justify-co115tent:space-between;\">\n                    <span>🧪 Potions Gained (incl. starter):</span>\n                    <strong>" + temp_256 + "</strong12\n                </div>\n                <div style=\"display:flex; justify-co115tent:space-between; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:8px;\">\n                    <span>💊276Potions Used:</span>\n                    <strong>" + temp_257 + "</strong12\n                </div>\n                <div style=\"display:flex; justify-co115tent:space-between;\">\n                    <span>⚔️ Final Player ATK/DEF:</span>\n                    <strong>" + temp_258 + " / " + temp_259 + temp_249(0x1f9) + temp_260 + " / " + temp_261 + "</strong12\n                </div>\n                <div style=\"display:flex; justify-co115tent:space-between;\">\n                    <span>🏰 Floor Reached:</span>\n                    <strong>" + temp_264 + " / 100</strong>\n                </div>\n                <div style=\"display:flex; just115fy-content:space-between; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:8px;\">\n                    <spa276>👾 Floor Encounter:</span>\n                    <strong>" + temp_265 + "</strong12\n                </div>\n                <div style=\"display:flex; justify-co115tent:space-between;\">\n                    <span>💥 Highest Damage Dealt (non-crit):</span>\n                    <strong276style=\"color:#f1c96b;\">" + temp_262 + "</strong12\n                </div>\n                <div style=\"display:flex; justify-co115tent:space-between;\">\n                    <span>💢 Highest Damage Received (non-crit):</span>\n                    <str276ng style=\"color:#cf2d45;\">" + temp_263 + "</strong12\n                </div>\n            </div>\n            <div style=\"display:f115ex; justify-content:center; gap:10px; margin-top:16px;\">\n                <button id=\"copy-report-btn\" style=\"background:276d9b66f; color:#1b1210; border:0; border-radius:8px; padding:8px 24px; cursor:pointer; font-weight:bold; font-size:14px;\">📋 Copy Full Report</button>\n                <button onclick=\"document.getElementById('veyra-run-summary').remove()\" style=\"background:#221b28; color:#f8ead2; border:1px solid rgba(26845,255,255,0.2); border-radius:8px; padding:8px 24px; cursor:p767inter; font-size:14px;\">Close</button>\n            </div>\n        ", document["body"]["appendChild"](temp_266);
            const temp_267 = document["getElementById"]("copy-report-btn");
            temp_267 && (temp_267["onclick"] = async function() {
                const temp_268 = temp_249,
                    temp_269 = "Duration12 " + temp_255 + "\nPotions Gained (incl. starter): " + temp_256 + "\nPotions Used: " + temp_257 + "\nFinal Player ATK/DEF: " + temp_258 + " / " + temp_259 + "\nFinal Enemy ATK/DEF: " + temp_260 + " / " + temp_261 + "\nFinal Floor: " + temp_264 + " / 100\nFinal Encounter: " + temp_265 + "\nHighest Damage Dealt (non-crit): " + temp_262 + "\nHighest Damage Received (non-crit): " + temp_263;
                try {
                    if (navigator["clipboard"] && navigator["clipboard"]["writeText"]) await navigator["clipboard"]["writeText"](temp_269), this["style"]["background"] = "#a8ffca", this["style"]["color"] = "#1b1210", this["innerText"] = "✅ Copied!", setTimeout(() => {
                        const rarityValues0 = temp_268;
                        this["style"]["background"] = "#d9b66f", this["style"]["color"] = "#1b1210", this["innerText"] = "📋 Copy Full Report";
                    }, 0x7d0);
                    else {
                        const rarityValues1 = document["createElement"]("textarea");
                        rarityValues1["value"] = temp_269, rarityValues1["style"]["position"] = "fixed", rarityValues1["style"]["opacity"] = '0', rarityValues1["style"]["left"] = "-9999px", document["body"]["appendChild"](rarityValues1), rarityValues1["focus"](), rarityValues1["select"](), document["execCommand"]("copy"), document["body"]["removeChild"](rarityValues1), this["style"]["background"] = "#a8ffca", this["style"]["color"] = "#1b1210", this["innerText"] = "✅ Copied!", setTimeout(() => {
                            const rarityValues2 = temp_268;
                            this["style"]["background"] = "#d9b66f", this["style"]["color"] = "#1b1210", this["innerText"] = "📋 Copy Full Report";
                        }, 0x7d0);
                    }
                } catch (rarityValues3) {
                    console["error"]("Copy failed:", rarityValues3), this["innerText"] = "❌ Failed", setTimeout(() => {
                        const rarityValues4 = temp_268;
                        this["innerText"] = "📋 Copy Full Report";
                    }, 0x7d0);
                }
            });
        }

        function isGameOver() {
            const rarityValues6 = temp_30,
                rarityValues7 = document["querySelector"]("input[name=\"attack_type\"][value=\"slash\"]"),
                rarityValues8 = document["querySelector"]("input[name=\"attack_type\"][value=\"magic\"]"),
                rarityValues9 = document["querySelector"](".power-choice-card"),
                temp_280 = document["querySelector"]("input[name=\"choice\"][value=\"left\"]"),
                temp_281 = document["querySelector"]("form input[name=\"action\"][value=\"start_run\"]"),
                temp_282 = Array["from"](document["querySelectorAll"]("button.btn"))["some"](temp_283 => {
                    const temp_284 = rarityValues6,
                        temp_285 = temp_283["innerText"]["toLowerCase"]()["trim"]();
                    return temp_285 === "continue" || temp_285 === "next" || temp_285 === "skip" || temp_285 === "proceed";
                }),
                temp_286 = rarityValues7 || rarityValues8 || rarityValues9 || temp_280 || temp_281 || temp_282,
                temp_287 = getPlayerHP(),
                temp_288 = temp_287 !== null;
            debugLog("isGameOver() check", {
                'hasSlash': !!rarityValues7,
                'hasMagic': !!rarityValues8,
                'hasPowerChoice': !!rarityValues9,
                'hasLeftPath': !!temp_280,
                'hasEnterCastle': !!temp_281,
                'hasGenericBtn': !!temp_282,
                'hasActiveAction': !!temp_286,
                'hasHP': !!temp_288,
                'hp_current': temp_287 ? temp_287["current"] : 0x0,
                'result': !temp_286 && !temp_288
            });
            if (temp_286) return ![];
            return !temp_288;
        }

        function mainLoop() {
            const temp_290 = temp_30;
            if (!isAutoCastleRunning) return;
            debugLog("Main loop tick starting"), parseRecentRunLog();
            if (isGameOver()) {
                debugLog("*** SCRIPT STOPPING DUE TO GAME OVER ***");
                const temp_291 = GM_getValue("run_is_complete", ![]);
                !temp_291 && (GM_setValue("run_is_complete", !![]), showRunSummary());
                stopAutoCastle();
                return;
            }
            const temp_293 = getPlayerHP();
            if (temp_293) {
                const temp_294 = temp_293["current"] / temp_293["max"] * 0x64;
                if (temp_294 <= healThreshold) {
                    if (useHealthPotion()) {
                        debugLog("Potion used, delaying next loop 300ms"), loopTimeout = setTimeout(mainLoop, 300);
                        return;
                    }
                }
            }
            if (document["querySelector"]("form input[name=\"action\"][value=\"start_run\"]")) {
                if (clickStartRunButton()) {
                    loopTimeout = setTimeout(mainLoop, 0x320);
                    return;
                }
            }
            if (document["querySelector"]("input[name=\"choice\"][value=\"left\"]")) {
                if (clickLeftPathButton()) {
                    loopTimeout = setTimeout(mainLoop, 0x320);
                    return;
                }
            }
            if (document["querySelector"](".power-choice-card")) {
                if (processPowerSelection()) {
                    debugLog("Power chosen, delaying next loop 300ms"), loopTimeout = setTimeout(mainLoop, 300);
                    return;
                }
            }
            if (document["querySelector"]("input[name=\"attack_type\"]")) {
                if (clickAttackButton()) {
                    debugLog("Attacked, delaying next loop 100ms"), loopTimeout = setTimeout(mainLoop, 100);
                    return;
                }
            }
            if (clickGenericContinueBtn()) {
                debugLog("Generic continue clicked, delaying 800ms"), loopTimeout = setTimeout(mainLoop, 300);
                return;
            }
            debugLog("No action taken, looping poll in 100ms"), loopTimeout = setTimeout(mainLoop, 100);
        }

        function toggleAutoCastle() {
            const temp_295 = temp_30;
            debugLog("Toggle button clicked. Current isRunning:", isAutoCastleRunning), isAutoCastleRunning ? stopAutoCastle() : startAutoCastle();
        }

        function startAutoCastle() {
            const temp_297 = temp_30;
            if (isAutoCastleRunning) return;
            GM_setValue("run_start_time", Date["now"]()), GM_setValue("run_is_complete", ![]), GM_setValue("potion_gained_count", 0x1), GM_setValue("potion_used_count", 0x0), GM_setValue("snapshot_player_atk", 0x0), GM_setValue("snapshot_player_def", 0x0), GM_setValue("snapshot_enemy_atk", "N/A"), GM_setValue("snapshot_enemy_def", "N/A"), GM_setValue("highest_damage_dealt", 0x0), GM_setValue("highest_damage_received", 0x0), GM_setValue("snapshot_floor", '0'), GM_setValue("snapshot_encounter", "0 / 20"), isAutoCastleRunning = !![], GM_setValue("veyra_enabled", !![]), restoreUIState(), loopTimeout && (clearTimeout(loopTimeout), loopTimeout = null), debugLog("*** SCRIPT STARTED BY USER ***"), mainLoop();
        }

        function stopAutoCastle() {
            const temp_298 = temp_30;
            isAutoCastleRunning = ![], GM_setValue("veyra_enabled", ![]), loopTimeout && (clearTimeout(loopTimeout), loopTimeout = null), restoreUIState(), debugLog("Script stopped manually or via game over");
        }
        let temp_299 = ![];

        function tryInjectUI() {
            const temp_301 = temp_30;
            if (document["getElementById"]("veyra-autoplay-ui")) return temp_299 = !![], !![];
            if (document["body"]) return initUI(), temp_299 = !![], !![];
            return ![];
        }
        document["readyState"] === "loading" ? document["addEventListener"]("DOMContentLoaded", tryInjectUI) : tryInjectUI();
        window["addEventListener"]("load", tryInjectUI);
        let temp_302 = 0x0;
        const temp_303 = setInterval(() => {
            if (temp_299) {
                clearInterval(temp_303);
                return;
            }
            temp_302++, tryInjectUI();
            if (temp_302 >= 0xa || temp_299) clearInterval(temp_303);
        }, 0x64);
        setTimeout(() => {
            isAutoCastleRunning = GM_getValue("veyra_enabled", ![]);
            if (isAutoCastleRunning) {
                if (loopTimeout) clearTimeout(loopTimeout);
                mainLoop();
            }
        }, 0x12c), GM_registerMenuCommand("Toggle Veyra Auto-Pilot", toggleAutoCastle);
})();
