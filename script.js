// Frontend pour API Apps Script uniquement (fetch, pas de google.script.run).
;(function () {
    var scanner = null;
    var isScanning = false;
    var selectedMode = 'entree';
    var API_URL = (typeof window !== 'undefined' && window.API_URL) || 'https://script.google.com/macros/s/AKfycbx5QmKP2EffNwzLXfd5nx7Ztr9Qsn0ALfQbpyZhgKRxfAbTlqmgJgKOjO9iekc-xAZR/exec';

    function setMode(mode) {
        selectedMode = (mode === 'sortie') ? 'sortie' : 'entree';
        var buttons = document.querySelectorAll('.mode-btn');
        buttons.forEach(function (btn) {
            btn.classList.toggle('active', btn.getAttribute('data-mode') === selectedMode);
        });
    }

    function getModeLabel() {
        return selectedMode === 'sortie' ? 'Sortie' : 'Entrée';
    }

    function verifierPermissionsCamera() {
        if (!navigator.permissions) return;
        navigator.permissions.query({ name: 'camera' }).then(function (r) {
            if (r.state === 'denied') {
                afficherPanneCamera();
            }
        }).catch(function () {});
    }

    function afficherPanneCamera() {
        var info = document.getElementById('permission-info');
        if (info) info.style.display = 'block';
    }

    function demarrerScanner() {
        if (typeof Html5QrcodeScanner === 'undefined') {
            document.getElementById('reader').innerHTML = '<div style="padding:20px;color:#ef4444;text-align:center;">Bibliothèque QR introuvable</div>';
            afficherPanneCamera();
            return;
        }
        if (scanner) {
            try { scanner.clear(); } catch (e) {}
            scanner = null;
        }
        document.getElementById('result').innerHTML = '';
        document.getElementById('btn-redemarrer').style.display = 'none';
        try {
            scanner = new Html5QrcodeScanner('reader', { qrbox: { width: 250, height: 250 }, fps: 20 });
            scanner.render(onScanSuccess, onScanError);
            isScanning = true;
        } catch (e) {
            document.getElementById('reader').innerHTML = '<div style="padding:20px;color:#ef4444;text-align:center;">Erreur démarrage scanner</div>';
            afficherPanneCamera();
        }
    }

    function onScanSuccess(decodedText) {
        if (!isScanning) return;
        if (scanner) {
            try { scanner.clear(); } catch (e) {}
            scanner = null;
            isScanning = false;
        }
        document.getElementById('btn-redemarrer').style.display = 'block';

        var matricule = (decodedText || '').toString().split('|')[0].trim() || (decodedText || '').toString().trim();
        traiterMatricule(matricule);
    }

    function onScanError(err) {
        try {
            var s = String(err || '');
            if (s.indexOf('QR code parse error') !== -1 || s.indexOf('No MultiFormat Readers were able') !== -1) return;
            if (s.indexOf('NotAllowed') !== -1 || s.indexOf('Permission') !== -1 || s.indexOf('NotFound') !== -1) {
                afficherPanneCamera();
            }
        } catch (e) {}
        console.debug('scan err', err);
    }

    // ============================================
    // Géolocalisation : on tente de récupérer la position au moment du scan.
    // Si l'utilisateur refuse ou que le GPS n'est pas disponible, on continue
    // sans bloquer le pointage — la position est alors laissée vide.
    // ============================================
    function obtenirPosition() {
        return new Promise(function (resolve) {
            if (!navigator.geolocation) {
                resolve({ longitude: '', latitude: '' });
                return;
            }
            navigator.geolocation.getCurrentPosition(
                function (pos) {
                    resolve({
                        longitude: pos.coords.longitude,
                        latitude: pos.coords.latitude
                    });
                },
                function () {
                    resolve({ longitude: '', latitude: '' }); // refusé / indisponible
                },
                { enableHighAccuracy: true, timeout: 6000, maximumAge: 30000 }
            );
        });
    }

    // ============================================
    // Le mode sélectionné détermine uniquement la colonne visée côté backend.
    // Entrée -> Date/Heure d'entrée (bloqué si déjà fait aujourd'hui).
    // Sortie -> Date/Heure de sortie, même sans entrée préalable.
    // ============================================
    function traiterMatricule(matricule) {
        if (!matricule) {
            afficherErreur('Veuillez saisir un matricule ou scanner un QR valide.');
            return;
        }

        document.getElementById('result').innerHTML =
            '<div class="result-card"><div class="result-header"><span id="result-icon">⏳</span>' +
            '<h2 id="result-title" style="color:#1d4ed8;">Vérification...</h2></div>' +
            '<div style="color:#1d4ed8; font-weight:600; text-align:center;">Mode : ' + getModeLabel() + '</div></div>';

        var action = selectedMode === 'entree' ? 'entree' : 'sortie';

        obtenirPosition().then(function (position) {
            callApi(action, matricule, position, function (response) {
                handleResult(response, getModeLabel().toLowerCase());
            }, function (error) {
                afficherErreur('Erreur API: ' + (error && error.message ? error.message : 'Impossible de contacter le backend'));
            });
        });
    }

    function callApi(action, matricule, position, onSuccess, onError) {
        if (!API_URL) {
            if (onError) onError({ message: 'Configurez window.API_URL dans index.html.' });
            return;
        }
        var url = API_URL + '?action=' + encodeURIComponent(action) + '&matricule=' + encodeURIComponent(matricule);
        if (position && position.longitude !== '' && position.latitude !== '') {
            url += '&longitude=' + encodeURIComponent(position.longitude) + '&latitude=' + encodeURIComponent(position.latitude);
        }
        fetch(url, { method: 'GET', headers: { Accept: 'application/json' } })
            .then(function (response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.json();
            })
            .then(function (data) { if (onSuccess) onSuccess(data || {}); })
            .catch(function (error) { if (onError) onError(error); });
    }

    function handleResult(result, type) {
        if (result && result.success) {
            afficherSucces(result, type);
        } else {
            afficherErreur((result && result.message) ? result.message : 'Erreur inconnue');
        }
    }

    function afficherSucces(result, type) {
        var icon = type === 'entrée' ? '✅' : '🚪';
        var title = type === 'entrée' ? 'Entrée enregistrée' : 'Sortie enregistrée';
        var color = type === 'entrée' ? '#166534' : '#991b1b';
        document.getElementById('result').innerHTML =
            '<div class="result-card"><div class="result-header"><span id="result-icon">' + icon + '</span>' +
            '<h2 id="result-title" style="color:' + color + ';">' + title + '</h2></div>' +
            '<div id="result-content">' +
            '<div class="info-item"><span class="label">Matricule:</span><span class="value">' + (result.matricule || '') + '</span></div>' +
            '<div class="info-item"><span class="label">Nom:</span><span class="value">' + (result.nom || '') + '</span></div>' +
            '<div class="info-item"><span class="label">Date:</span><span class="value">' + (result.date || '') + '</span></div>' +
            '<div class="info-item"><span class="label">Heure:</span><span class="value">' + (result.heure || '') + '</span></div>' +
            '</div></div>';
        afficherToast(result.message || title, 'success');
    }

    function afficherErreur(message) {
        var clean = String(message || 'Erreur');
        document.getElementById('result').innerHTML =
            '<div class="result-card" style="border:1px solid rgba(239,68,68,0.5); background: rgba(254,242,242,0.92);">' +
            '<div class="result-header"><span style="font-size:36px">❌</span><h2 style="color:#991b1b; font-size:22px;">Erreur</h2></div>' +
            '<div style="color:#991b1b; text-align:center; padding:10px; font-weight:600;">' + clean + '</div></div>';
        afficherToast(clean, 'error');
    }

    function afficherToast(message, type) {
        var toast = document.createElement('div');
        toast.className = 'toast toast-' + type;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(function () {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 3200);
    }

    window.redemarrerScanner = function () {
        document.getElementById('result').innerHTML = '';
        document.getElementById('btn-redemarrer').style.display = 'none';
        if (scanner) {
            try { scanner.clear(); } catch (e) {}
            scanner = null;
        }
        setTimeout(demarrerScanner, 300);
    };

    window.onload = function () {
        setMode('entree');
        document.querySelectorAll('.mode-btn').forEach(function (btn) {
            btn.addEventListener('click', function () { setMode(btn.getAttribute('data-mode')); });
        });

        var manualForm = document.getElementById('manual-form');
        if (manualForm) {
            manualForm.addEventListener('submit', function (evt) {
                evt.preventDefault();
                var input = document.getElementById('manual-matricule');
                var matricule = input.value.trim();
                if (!matricule) return;
                traiterMatricule(matricule);
                input.value = '';
            });
        }

        verifierPermissionsCamera();

        if (document.getElementById('reader')) {
            demarrerScanner();
        }
    };

    window.onbeforeunload = function () {
        if (scanner) {
            try { scanner.clear(); } catch (e) {}
            scanner = null;
        }
    };
})();