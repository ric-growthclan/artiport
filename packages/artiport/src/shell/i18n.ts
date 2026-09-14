export interface Messages {
  sections: string;
  home: string;
  settings: string;
  loading: string;
  synced: string;
  syncing: string;
  offline: string;
  syncError: string;
  sessionExpired: string;
  pending(count: number): string;
  offlinePending(count: number): string;
  firstSyncFailed: string;
  firstSyncHint: string;
  retry: string;
  useOffline: string;
  noSections: string;
  noSectionsHint: string;
  missingSection: string;
  sync: string;
  status: string;
  pendingChanges: string;
  lastSync: string;
  lastError: string;
  syncNow: string;
  device: string;
  version: string;
  logout: string;
  wipe: string;
  wipeConfirm(pending: number): string;
  install: string;
  installIos: string;
  installOther: string;
  updateReady: string;
  reload: string;
  login: string;
  diagnostics: string;
  noIndexedDb: string;
}

const it: Messages = {
  sections: 'Sezioni',
  home: 'Home',
  settings: 'Impostazioni',
  loading: 'Carico i tuoi dati…',
  synced: 'Sincronizzato',
  syncing: 'Sincronizzo…',
  offline: 'Offline',
  syncError: 'Errore di sincronizzazione',
  sessionExpired: 'Sessione scaduta',
  pending: (n) => (n === 1 ? '1 modifica da inviare' : `${n} modifiche da inviare`),
  offlinePending: (n) => (n === 1 ? 'Offline · 1 modifica in attesa' : `Offline · ${n} modifiche in attesa`),
  firstSyncFailed: 'Non riesco a scaricare i tuoi dati',
  firstSyncHint:
    'È il primo avvio su questo dispositivo: prima di aprire le sezioni scarico i dati salvati, così non rischi di sovrascriverli.',
  retry: 'Riprova',
  useOffline: 'Continua offline',
  noSections: 'Ancora nessuna sezione',
  noSectionsHint: 'Chiedi a Claude di aggiungere un tuo artifact al hub.',
  missingSection: 'Questa sezione non esiste più.',
  sync: 'Sincronizzazione',
  status: 'Stato',
  pendingChanges: 'Modifiche in attesa',
  lastSync: 'Ultima sincronizzazione',
  lastError: 'Ultimo errore',
  syncNow: 'Sincronizza ora',
  device: 'Questo dispositivo',
  version: 'Versione',
  logout: 'Esci',
  wipe: 'Cancella i dati locali',
  wipeConfirm: (n) =>
    n > 0
      ? `Ci sono ${n} modifiche non ancora inviate: andranno perse. Cancellare comunque i dati di questo dispositivo?`
      : 'Cancellare i dati salvati su questo dispositivo? Quelli sincronizzati restano nel repository.',
  install: 'Installa l’app',
  installIos: 'Su iPhone tocca Condividi e poi “Aggiungi alla schermata Home”.',
  installOther: 'Dal menu del browser scegli “Installa app”.',
  updateReady: 'È disponibile una nuova versione.',
  reload: 'Aggiorna',
  login: 'Accedi',
  diagnostics: 'Diagnostica',
  noIndexedDb: 'IndexedDB non disponibile: i dati restano in memoria finché non vengono sincronizzati.',
};

const en: Messages = {
  sections: 'Sections',
  home: 'Home',
  settings: 'Settings',
  loading: 'Loading your data…',
  synced: 'Synced',
  syncing: 'Syncing…',
  offline: 'Offline',
  syncError: 'Sync error',
  sessionExpired: 'Session expired',
  pending: (n) => (n === 1 ? '1 change to send' : `${n} changes to send`),
  offlinePending: (n) => (n === 1 ? 'Offline · 1 change waiting' : `Offline · ${n} changes waiting`),
  firstSyncFailed: 'Could not download your data',
  firstSyncHint: 'This is the first launch on this device: saved data is downloaded before sections open, so nothing gets overwritten.',
  retry: 'Retry',
  useOffline: 'Continue offline',
  noSections: 'No sections yet',
  noSectionsHint: 'Ask Claude to add one of your artifacts to the hub.',
  missingSection: 'This section no longer exists.',
  sync: 'Sync',
  status: 'Status',
  pendingChanges: 'Pending changes',
  lastSync: 'Last sync',
  lastError: 'Last error',
  syncNow: 'Sync now',
  device: 'This device',
  version: 'Version',
  logout: 'Sign out',
  wipe: 'Clear local data',
  wipeConfirm: (n) =>
    n > 0
      ? `${n} changes have not been sent yet and will be lost. Clear this device anyway?`
      : 'Clear the data stored on this device? Synced data stays in the repository.',
  install: 'Install the app',
  installIos: 'On iPhone tap Share, then “Add to Home Screen”.',
  installOther: 'Choose “Install app” from the browser menu.',
  updateReady: 'A new version is available.',
  reload: 'Update',
  login: 'Sign in',
  diagnostics: 'Diagnostics',
  noIndexedDb: 'IndexedDB is unavailable: data stays in memory until it is synced.',
};

export function messages(lang: string): Messages {
  return lang.toLowerCase().startsWith('it') ? it : en;
}
