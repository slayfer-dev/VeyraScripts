// ==UserScript==
// @name         Check for Updates
// @version      1.0
// @match        *demonicscans.org/*
// @updateURL    https://raw.githubusercontent.com/slayfer-dev/VeyraScripts/refs/heads/main/src/TuScript.user.js
// @downloadURL  https://raw.githubusercontent.com/slayfer-dev/VeyraScripts/refs/heads/main/src/TuScript.user.js
// @grant        GM.xmlHttpRequest
// @grant        GM_info
// ==/UserScript==

(function() {
    'use strict';

    const RAW_URL = 'https://raw.githubusercontent.com/slayfer-dev/VeyraScripts/refs/heads/main/src/TuScript.user.js';
    const CURRENT_VERSION = GM_info.script.version;

    function checkForUpdates() {
        GM.xmlHttpRequest({
            method: "GET",
            url: RAW_URL + "?t=" + new Date().getTime(), // El parámetro '?t=' evita que el navegador use caché
            onload: function(response) {
                // Buscamos la línea que tiene el @version usando una expresión regular
                const match = response.responseText.match(/@version\s+([\d\.]+)/);
                if (match) {
                    const githubVersion = match[1];
                    
                    // Si la versión de GitHub es diferente y (asumimos) mayor
                    if (githubVersion !== CURRENT_VERSION) {
                        const userWantsUpdate = confirm(`¡Nueva versión de ${GM_info.script.name} disponible!\n\nVersión actual: ${CURRENT_VERSION}\nNueva versión: ${githubVersion}\n\n¿Deseas actualizar ahora?`);
                        if (userWantsUpdate) {
                            // Abrir el enlace del script dispara la actualización de Tampermonkey automáticamente
                            window.open(RAW_URL, '_blank');
                        }
                    }
                }
            }
        });
    }

    // Ejecutar la revisión de actualización (puedes ponerle un setTimeout si prefieres que no moleste apenas carga)
    checkForUpdates();

    // ... el resto de tu código ...
})();