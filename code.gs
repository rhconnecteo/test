// ============================================
// CONFIGURATION
// ============================================
var CONFIG = {
  SPREADSHEET_ID: '1JEWXzPYwZ60HWzFB0_BZJcBYmm0QQD29shP23WQ6BVg',
  EMPLOYEE_SHEET_NAME: 'Employe',
  PRESENCE_SHEET_NAME: 'Fiche de présence',
  TIMEZONE: 'Africa/Nairobi'
};

// ============================================
// doGet / doPost — API JSON uniquement
// (le frontend est un site statique séparé : index.html + style.css + script.js,
//  qui appelle cette URL de déploiement via fetch())
// ============================================
function doGet(e) {
  return handleApiRequest(e);
}

function doPost(e) {
  return handleApiRequest(e);
}

function doOptions(e) {
  return createCorsResponse({ success: true, message: 'CORS preflight OK' });
}

function handleApiRequest(e) {
  var params = normalizeRequestData(e);
  var action = resolveAction(params);
  var matricule = String(params.matricule || params.codeQr || params.qr || params.code || '').trim();

  if (!action && !matricule) {
    return createCorsResponse({ success: false, message: 'Aucune action ni matricule fournis.' });
  }

  try {
    switch (action) {
      case 'ping':
        return createCorsResponse({ success: true, message: 'API OK', date: getTodayDate(), heure: getNowTime(), timezone: CONFIG.TIMEZONE });

      case 'ajouter':
      case 'ajout':
        return createCorsResponse(ajouterEmploye(params.matricule, params.nom, params.fonction, params.codeQr || params.code || '-'));

      case 'statut':
        if (!matricule) return createCorsResponse({ success: false, message: 'Matricule manquant' });
        var statut = verifierStatut(matricule);
        return createCorsResponse(statut ? { success: true, data: statut } : { success: false, message: '❌ Matricule non trouvé' });

      case 'entree':
      case 'checkin':
        if (!matricule) return createCorsResponse({ success: false, message: 'Matricule manquant' });
        return createCorsResponse(enregistrerEntree(matricule, params.longitude, params.latitude));

      case 'sortie':
      case 'checkout':
        if (!matricule) return createCorsResponse({ success: false, message: 'Matricule manquant' });
        return createCorsResponse(enregistrerSortie(matricule, params.longitude, params.latitude));

      case 'stats':
      case 'statistiques':
        return createCorsResponse(getStatistiques());

      case 'rapport':
      case 'report':
        return createCorsResponse({ success: true, data: getRapportDuJour() });

      default:
        return createCorsResponse({
          success: false,
          message: 'Action inconnue.',
          actions: ['ping', 'ajouter', 'statut', 'entree', 'sortie', 'stats', 'rapport']
        });
    }
  } catch (error) {
    console.error('Erreur handleApiRequest:', error);
    return createCorsResponse({ success: false, message: 'Erreur serveur: ' + error.toString() });
  }
}

function normalizeRequestData(e) {
  var data = {};
  if (e && e.parameter) {
    Object.keys(e.parameter).forEach(function (key) { data[key] = e.parameter[key]; });
  }
  if (e && e.postData && e.postData.contents) {
    try {
      var parsed = JSON.parse(e.postData.contents);
      if (parsed && typeof parsed === 'object') {
        Object.keys(parsed).forEach(function (key) { data[key] = parsed[key]; });
      }
    } catch (err) { /* JSON invalide, on ignore */ }
  }
  return data;
}

function resolveAction(params) {
  if (!params) return '';
  return String(params.action || params.type || params.endpoint || params.mode || '').toLowerCase();
}

// Note : ContentService ne permet pas de définir des en-têtes CORS custom depuis Apps Script.
// L'appel fonctionne en simple GET/POST sans en-têtes spéciaux, ce qui évite les erreurs de preflight.
function createCorsResponse(payload) {
  var output = ContentService.createTextOutput(JSON.stringify(payload));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

function normalizeText(value) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
}

// Uniformise une cellule de date (objet Date ou texte) en 'dd/MM/yyyy'.
function formatCellDate(cell) {
  if (cell == null || cell === '') return '';
  if (Object.prototype.toString.call(cell) === '[object Date]') {
    return Utilities.formatDate(cell, CONFIG.TIMEZONE, 'dd/MM/yyyy');
  }
  return String(cell).trim();
}

function getTodayDate() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'dd/MM/yyyy');
}

function getNowTime() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'HH:mm:ss');
}

// ============================================
// FEUILLES
// ============================================
function getEmployeeSheet() {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(CONFIG.EMPLOYEE_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.EMPLOYEE_SHEET_NAME);
    sheet.appendRow(['Matricule', 'Nom et Prénoms', 'Fonction', 'Code QR']);
  }
  return sheet;
}

function getPresenceSheet() {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(CONFIG.PRESENCE_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.PRESENCE_SHEET_NAME);
    sheet.appendRow(["Matricule", "Date d'entrée", "Heure d'entrée", "Date de sortie", "Heure de sortie", "Longitude", "Latitude"]);
  }
  return sheet;
}

function findEmployeeRow(key) {
  try {
    if (!key) return null;
    var sheet = getEmployeeSheet();
    var data = sheet.getDataRange().getValues();
    var targetLower = normalizeText(key).toLowerCase();

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var matricule = row[0] ? normalizeText(row[0]) : '';
      var codeQr = row[3] ? normalizeText(row[3]) : '';
      if (matricule.toLowerCase() === targetLower || (codeQr && codeQr.toLowerCase() === targetLower)) {
        return { row: row, index: i };
      }
    }
    return null;
  } catch (e) {
    console.error('Erreur findEmployeeRow:', e);
    return null;
  }
}

function getEmployeeByMatricule(matricule) {
  var found = findEmployeeRow(matricule);
  if (!found) return null;
  return { matricule: found.row[0], nom: found.row[1] || '', fonction: found.row[2] || '', codeQr: found.row[3] || '' };
}

// ============================================
// STATUT DU JOUR
// ============================================
function verifierStatut(matricule) {
  try {
    var employee = findEmployeeRow(matricule);
    if (!employee) return null;

    var sheet = getPresenceSheet();
    var data = sheet.getDataRange().getValues();
    var today = getTodayDate();
    var normalizedMatricule = normalizeText(matricule);
    var openRow = null;

    for (var i = data.length - 1; i >= 1; i--) {
      var row = data[i];
      if (normalizeText(row[0]) !== normalizedMatricule) continue;
      if (formatCellDate(row[1]) === today && formatCellDate(row[3]) === '') {
        openRow = row;
        break;
      }
    }

    return {
      matricule: employee.row[0],
      nom: employee.row[1] || '',
      fonction: employee.row[2] || '',
      codeQr: employee.row[3] || '',
      estPresent: !!openRow,
      heureEntree: openRow ? (openRow[2] || '') : ''
    };
  } catch (error) {
    console.error('Erreur verifierStatut:', error);
    return null;
  }
}

// ============================================
// ENTRÉE — écrit dans Date d'entrée / Heure d'entrée.
// Une seconde entrée le même jour (tant que la sortie n'est pas faite) est bloquée.
// ============================================
function enregistrerEntree(matricule, longitude, latitude) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    return { success: false, message: 'Le système est occupé, réessayez.' };
  }

  try {
    if (!matricule) return { success: false, message: 'Matricule manquant' };

    var employee = findEmployeeRow(matricule);
    if (!employee) return { success: false, message: '❌ Matricule non trouvé dans la base Employé' };

    var sheet = getPresenceSheet();
    var data = sheet.getDataRange().getValues();
    var today = getTodayDate();
    var normalizedMatricule = normalizeText(matricule);

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (normalizeText(row[0]) === normalizedMatricule && formatCellDate(row[1]) === today && formatCellDate(row[3]) === '') {
        return {
          success: false,
          message: (employee.row[1] || 'Cette personne') + ' est déjà enregistrée (entrée à ' + (row[2] || '') + ')',
          matricule: employee.row[0],
          nom: employee.row[1] || ''
        };
      }
    }

    var now = new Date();
    var dateStr = Utilities.formatDate(now, CONFIG.TIMEZONE, 'dd/MM/yyyy');
    var heureStr = Utilities.formatDate(now, CONFIG.TIMEZONE, 'HH:mm:ss');
    var lonVal = normalizeCoord(longitude);
    var latVal = normalizeCoord(latitude);
    sheet.appendRow([employee.row[0], dateStr, heureStr, '', '', lonVal, latVal]);

    return {
      success: true,
      message: 'Entrée enregistrée',
      matricule: employee.row[0],
      nom: employee.row[1] || '',
      fonction: employee.row[2] || '',
      date: dateStr,
      heure: heureStr,
      longitude: lonVal,
      latitude: latVal
    };
  } catch (error) {
    console.error('Erreur enregistrerEntree:', error);
    return { success: false, message: 'Erreur: ' + error.toString() };
  } finally {
    lock.releaseLock();
  }
}

// Convertit en nombre valide, ou '' si absent/invalide (coordonnée non fournie).
function normalizeCoord(value) {
  if (value === undefined || value === null || value === '') return '';
  var num = parseFloat(value);
  return isNaN(num) ? '' : num;
}

// ============================================
// SORTIE — écrit dans Date de sortie / Heure de sortie,
// même si aucune entrée n'a été enregistrée aujourd'hui.
// ============================================
function enregistrerSortie(matricule, longitude, latitude) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    return { success: false, message: 'Le système est occupé, réessayez.' };
  }

  try {
    if (!matricule) return { success: false, message: 'Matricule manquant' };

    var employee = findEmployeeRow(matricule);
    if (!employee) return { success: false, message: '❌ Matricule non trouvé dans la base Employé' };

    var sheet = getPresenceSheet();
    var data = sheet.getDataRange().getValues();
    var today = getTodayDate();
    var normalizedMatricule = normalizeText(matricule);
    var now = new Date();
    var dateStr = Utilities.formatDate(now, CONFIG.TIMEZONE, 'dd/MM/yyyy');
    var heureStr = Utilities.formatDate(now, CONFIG.TIMEZONE, 'HH:mm:ss');
    var lonVal = normalizeCoord(longitude);
    var latVal = normalizeCoord(latitude);

    // 1) Ligne d'entrée du jour encore ouverte (sortie vide) -> on la complète.
    var targetRowIndex = -1;
    for (var i = data.length - 1; i >= 1; i--) {
      var row = data[i];
      if (normalizeText(row[0]) === normalizedMatricule && formatCellDate(row[1]) === today && formatCellDate(row[3]) === '') {
        targetRowIndex = i + 1;
        break;
      }
    }

    if (targetRowIndex !== -1) {
      sheet.getRange(targetRowIndex, 4).setValue(dateStr);
      sheet.getRange(targetRowIndex, 5).setValue(heureStr);
      // On ne remplace la position que si la sortie en fournit une —
      // sinon on garde celle enregistrée à l'entrée.
      if (lonVal !== '' && latVal !== '') {
        sheet.getRange(targetRowIndex, 6).setValue(lonVal);
        sheet.getRange(targetRowIndex, 7).setValue(latVal);
      }
      return {
        success: true,
        message: 'Sortie enregistrée',
        matricule: employee.row[0],
        nom: employee.row[1] || '',
        fonction: employee.row[2] || '',
        date: dateStr,
        heure: heureStr,
        longitude: lonVal,
        latitude: latVal
      };
    }

    // 2) Pas d'entrée ouverte : on refuse seulement une 2e sortie le même jour.
    for (var j = data.length - 1; j >= 1; j--) {
      var rowJ = data[j];
      if (normalizeText(rowJ[0]) === normalizedMatricule && formatCellDate(rowJ[1]) === today && formatCellDate(rowJ[3]) === today) {
        return {
          success: false,
          message: (employee.row[1] || 'Cette personne') + ' a déjà validé la sortie aujourd\'hui (' + (rowJ[4] || '') + ')',
          matricule: employee.row[0],
          nom: employee.row[1] || ''
        };
      }
    }

    // 3) Sinon : sortie seule, entrée laissée vide.
    sheet.appendRow([employee.row[0], '', '', dateStr, heureStr, lonVal, latVal]);

    return {
      success: true,
      message: 'Sortie enregistrée',
      matricule: employee.row[0],
      nom: employee.row[1] || '',
      fonction: employee.row[2] || '',
      date: dateStr,
      heure: heureStr,
      longitude: lonVal,
      latitude: latVal
    };
  } catch (error) {
    console.error('Erreur enregistrerSortie:', error);
    return { success: false, message: 'Erreur: ' + error.toString() };
  } finally {
    lock.releaseLock();
  }
}

// ============================================
// STATISTIQUES DU JOUR
// ============================================
function getStatistiques() {
  try {
    var employeeData = getEmployeeSheet().getDataRange().getValues();
    var total = 0;
    for (var i = 1; i < employeeData.length; i++) {
      if (employeeData[i][0] && employeeData[i][0] !== '') total++;
    }

    var presenceData = getPresenceSheet().getDataRange().getValues();
    var today = getTodayDate();
    var present = 0;
    var seen = {};

    for (var j = 1; j < presenceData.length; j++) {
      var row = presenceData[j];
      var matricule = normalizeText(row[0]);
      if (!matricule) continue;
      if (formatCellDate(row[1]) === today && formatCellDate(row[3]) === '' && !seen[matricule]) {
        seen[matricule] = true;
        present++;
      }
    }

    return { success: true, total: total, present: present, absent: total - present, aujourdhui: today };
  } catch (error) {
    console.error('Erreur getStatistiques:', error);
    return { success: false, total: 0, present: 0, absent: 0 };
  }
}

// ============================================
// JOURNAL DU JOUR
// ============================================
function getRapportDuJour() {
  try {
    var data = getPresenceSheet().getDataRange().getValues();
    var rapport = [];
    var today = getTodayDate();

    for (var i = data.length - 1; i >= 1; i--) {
      var row = data[i];
      var matricule = normalizeText(row[0]);
      if (!matricule) continue;

      var dateEntree = formatCellDate(row[1]);
      var dateSortie = formatCellDate(row[3]);

      if (dateEntree === today || dateSortie === today) {
        var employee = getEmployeeByMatricule(matricule) || { nom: '', fonction: '' };
        rapport.push({
          matricule: matricule,
          nom: employee.nom || '',
          fonction: employee.fonction || '',
          heureEntree: dateEntree === today ? (row[2] || '') : '',
          heureSortie: dateSortie === today ? (row[4] || '') : '',
          present: (dateEntree === today && dateSortie === '')
        });
      }
    }
    return rapport;
  } catch (error) {
    console.error('Erreur getRapportDuJour:', error);
    return [];
  }
}

// ============================================
// AJOUT D'UN COLLABORATEUR
// ============================================
function ajouterEmploye(matricule, nom, fonction, codeQr) {
  try {
    matricule = String(matricule || '').trim();
    nom = String(nom || '').trim();
    fonction = String(fonction || '').trim();
    codeQr = String(codeQr || '-').trim();
    var codeQrValide = (codeQr && codeQr !== '-') ? codeQr : '';

    if (!matricule || !nom || !fonction) {
      return { success: false, message: 'Matricule, nom et fonction sont obligatoires.' };
    }
    if (findEmployeeRow(matricule) || (codeQrValide && findEmployeeRow(codeQrValide))) {
      return { success: false, message: 'Ce collaborateur existe déjà dans la base.' };
    }

    getEmployeeSheet().appendRow([matricule, nom, fonction, codeQr]);

    return { success: true, message: 'Collaborateur ajouté avec succès', matricule: matricule, nom: nom, fonction: fonction, codeQr: codeQr };
  } catch (error) {
    console.error('Erreur ajouterEmploye:', error);
    return { success: false, message: 'Erreur: ' + error.toString() };
  }
}

function testConnexion() {
  try {
    var sheet = getEmployeeSheet();
    return { success: true, message: 'Connexion réussie', nomFeuille: sheet.getName(), nbLignes: sheet.getLastRow() };
  } catch (error) {
    return { success: false, message: 'Erreur: ' + error.toString() };
  }
}