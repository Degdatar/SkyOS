(() => {
  const state = { documents: [], selectedMod: '', selectedDocMod: '', activeDocumentId: '', readerRequestId: 0, modules: [], modulesLoaded: false, nativeApps: [], firstPartyApps: {}, skyAppsQuery: '', moduleSearch: '', documentSearch: '', activeModule: '', activePage: 'home', searchPreviousPage: 'home', hotkeyTarget: 'toggle', pdf: null, moduleFrame: null, modApp: null, modAppBridgeReady: false, searchResults: [], searchQuery: '', searchLimit: 500, showFormIDs: true, skyNetInstalled: null, actionStatus: '', monitorTimer: 0, monitorInterval: 2000, monitorTab: 'overview', monitorShowPlugins: true, monitorPluginsLoaded: false, monitorPluginsSignature: '', monitorModuleSignature: '', monitorFunctionSignature: '', monitorComparisonSignature: '', skycollectionItems: [], skycollectionDisplayItems: [], skycollectionDisplayLocations: [], skycollectionFilter: 'all', skycollectionRarity: 'all', skycollectionPlugin: 'all', skycollectionSearch: '', skycollectionSettings: {}, skyMissionsStoreOffers: [], monitorSnapshot: null, monitorKey: 0x44 };
  Object.assign(state, { skycollectionLocations: [], skycollectionRecentLocations: new Set(), skycollectionExpandedCategories: new Set(), documentsLoaded: false, documentsLoading: false });
  Object.assign(state, { launchSplashEnabled: true, launchSplashPending: false, launchSplashShownThisSession: false, launchSplashActive: false, launchSplashTimer: 0 });
  let captureStatusTimer = 0;
  const skyCounterUIBridge = { frame: null, ready: false, pending: [] };
  function forwardSkyCounterUIEvent(type, payload) {
    const frame = byId('skycounter-module-frame');
    skyCounterUIBridge.frame = frame;
    if (payload?.clearStream === true) skyCounterUIBridge.pending.length = 0;
    if (!frame?.contentWindow || !skyCounterUIBridge.ready) {
      skyCounterUIBridge.pending.push({ type, payload });
      if (skyCounterUIBridge.pending.length > 64) skyCounterUIBridge.pending.shift();
      return;
    }
    frame.contentWindow.postMessage({ channel: 'skycounter-ui', type, payload }, '*');
  }
  function flushSkyCounterUIEvents() {
    const frame = byId('skycounter-module-frame');
    if (!frame?.contentWindow || !skyCounterUIBridge.ready) return;
    skyCounterUIBridge.frame = frame;
    for (const event of skyCounterUIBridge.pending.splice(0)) {
      frame.contentWindow.postMessage({ channel: 'skycounter-ui', ...event }, '*');
    }
  }
  window.addEventListener('message', (event) => {
    if (event.data?.channel === 'skyos-app-frame' && event.data.type === 'resize') {
      const frame = Array.from(document.querySelectorAll('iframe.embedded-app-frame'))
        .find((candidate) => candidate.contentWindow === event.source);
      const requestedHeight = Number(event.data.height);
      if (frame && Number.isFinite(requestedHeight)) {
        frame.style.height = `${Math.max(620, Math.min(10000, Math.ceil(requestedHeight)))}px`;
      }
      return;
    }
    const frame = byId('skycounter-module-frame');
    if (!frame || event.source !== frame.contentWindow || event.data?.channel !== 'skycounter-ui' || event.data.type !== 'ready') return;
    skyCounterUIBridge.frame = frame;
    skyCounterUIBridge.ready = true;
    flushSkyCounterUIEvents();
  });
  const byId = (id) => document.getElementById(id);
  function finishLaunchSplash() {
    if (state.launchSplashTimer) window.clearTimeout(state.launchSplashTimer);
    state.launchSplashTimer = 0;
    state.launchSplashActive = false;
    const overlay = byId('launch-splash');
    const image = byId('launch-splash-image');
    if (image) {
      image.onload = null;
      image.onerror = null;
    }
    if (overlay) {
      overlay.hidden = true;
      overlay.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('skyos-launch-splash-active');
  }
  function startLaunchSplashWhenReady() {
    if (!state.launchSplashPending || !state.modulesLoaded) return;
    state.launchSplashPending = false;
    if (!state.launchSplashEnabled) return;
    const overlay = byId('launch-splash');
    const image = byId('launch-splash-image');
    if (!overlay || !image) return;
    state.launchSplashActive = true;
    image.onload = () => {
      if (!state.launchSplashActive) return;
      state.launchSplashShownThisSession = true;
      overlay.hidden = false;
      overlay.setAttribute('aria-hidden', 'false');
      document.body.classList.add('skyos-launch-splash-active');
      if (state.launchSplashTimer) window.clearTimeout(state.launchSplashTimer);
      state.launchSplashTimer = window.setTimeout(finishLaunchSplash, 10000);
    };
    image.onerror = finishLaunchSplash;
    // Ultralight cannot play HTML video. Animated WebP is decoded as an image.
    // Keep the desktop visible until the asset has loaded successfully.
    state.launchSplashTimer = window.setTimeout(finishLaunchSplash, 15000);
    image.src = 'SkyOS-Splash.webp?v=20261026-animated-webp-1';
  }
  function isCurrencyItemRecord(item) {
    if (!item || typeof item !== 'object') return false;
    const name = String(item.name || '').trim().toLocaleLowerCase();
    const plugin = String(item.plugin || '').trim().toLocaleLowerCase();
    const category = String(item.category || '').trim().toLocaleLowerCase();
    const localFormID = String(item.localFormID || '').replace(/^0x/i, '').toUpperCase().padStart(8, '0');
    const formID = String(item.formID || '').replace(/^0x/i, '').toUpperCase().padStart(8, '0');
    return category === 'currency' || plugin === 'goldininventory.esp' ||
      name === 'gold' || name === 'septim' || name === 'septims' ||
      ((plugin === 'skyrim.esm' || !plugin) && (localFormID === '0000000F' || formID === '0000000F'));
  }
  const skyOSAppBridgeChannel = 'skyos-app';
  function sendSkyOSAppMessage(type, payload = {}) {
    const frame = byId('mod-app-frame');
    if (!frame?.contentWindow || !state.modApp || !state.modAppBridgeReady) return;
    frame.contentWindow.postMessage({ channel: skyOSAppBridgeChannel, version: 1, type, payload }, '*');
  }
  function setSkyOSAppActions(actions) {
    const host = byId('mod-app-actions');
    if (!host) return;
    host.replaceChildren();
    if (!Array.isArray(actions)) return;
    for (const action of actions.slice(0, 5)) {
      if (!action || typeof action.id !== 'string' || !/^[\w-]{1,40}$/.test(action.id)) continue;
      const label = String(action.label || '').trim().slice(0, 32);
      if (!label) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mod-app-action';
      button.textContent = label;
      button.addEventListener('click', () => sendSkyOSAppMessage('action-clicked', { id: action.id }));
      host.appendChild(button);
    }
  }
  function handleSkyOSAppMessage(event) {
    const frame = byId('mod-app-frame');
    const message = event.data;
    if (!frame || event.source !== frame.contentWindow || message?.channel !== skyOSAppBridgeChannel || message.version !== 1 || !state.modApp) return;
    const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};
    if (message.type === 'ready') {
      state.modAppBridgeReady = true;
      sendSkyOSAppMessage('host-ready', { appId: state.modApp.id, name: state.modApp.name, description: state.modApp.description, bridgeVersion: 1 });
      sendSkyOSAppMessage('visibility', { visible: state.activePage === 'mod-app' });
    } else if (message.type === 'set-title') {
      byId('mod-app-title').textContent = String(payload.value || state.modApp.name || state.modApp.id).slice(0, 80);
    } else if (message.type === 'set-description') {
      byId('mod-app-description').textContent = String(payload.value || '').slice(0, 180);
    } else if (message.type === 'set-actions') {
      setSkyOSAppActions(payload.actions);
    } else if (message.type === 'set-status') {
      SkyOS.setActionStatus(String(payload.value || '').slice(0, 120));
    } else if (message.type === 'close') {
      SkyOS.openApp('skyapps');
    }
  }
  window.addEventListener('message', handleSkyOSAppMessage);
  const skyAchievementsBridge = { frame: null, ready: false, pending: new Map(), nextUpdateId: 1 };
  function postSkyAchievementsUpdate(frame, kind, data) {
    const id = skyAchievementsBridge.nextUpdateId++;
    frame.contentWindow.postMessage({ channel: 'skyachievements', type: 'update', payload: { id, kind, data } }, '*');
  }
  function sendSkyAchievementsUpdate(kind, data) {
    if (state.activePage !== 'skyachievements') return;
    const frame = byId('skyachievements-frame');
    skyAchievementsBridge.frame = frame;
    if (!frame?.contentWindow || !skyAchievementsBridge.ready) {
      skyAchievementsBridge.pending.set(kind, data);
      return;
    }
    postSkyAchievementsUpdate(frame, kind, data);
  }
  function flushSkyAchievementsUpdates() {
    const frame = byId('skyachievements-frame');
    if (!frame?.contentWindow || !skyAchievementsBridge.ready) return;
    for (const [kind, data] of skyAchievementsBridge.pending) postSkyAchievementsUpdate(frame, kind, data);
    skyAchievementsBridge.pending.clear();
  }
  window.addEventListener('message', (event) => {
    const frame = byId('skyachievements-frame');
    if (!frame || event.source !== frame.contentWindow || event.data?.channel !== 'skyachievements') return;
    if (event.data.type === 'diagnostic') {
      const message = String(event.data.payload?.message || 'unknown iframe diagnostic').replace(/[\r\n\t]/g, ' ').slice(0, 180);
      invoke('skyos_skyachievements_diagnostic', message);
      return;
    }
    if (event.data.type === 'update-ack') {
      const payload = event.data.payload || {};
      const message = `iframe ack id=${Number(payload.id) || 0} kind=${String(payload.kind || 'unknown')} ok=${payload.ok === true}${payload.detail ? ` detail=${String(payload.detail).slice(0, 80)}` : ''}`;
      invoke('skyos_skyachievements_diagnostic', message);
      return;
    }
    if (event.data.type === 'achievement-unlocked') {
      const payload = event.data.payload || {};
      const clean = (value, limit) => String(value || '').replace(/[\r\n\t]/g, ' ').slice(0, limit);
      const name = clean(payload.name, 160);
      if (!name) return;
      const requirements = clean(payload.requirements, 400);
      const iconUrl = clean(payload.iconUrl, 2048);
      invoke('skyos_skyachievements_unlocked', `${name}\n${requirements}\n${iconUrl}`);
      return;
    }
    if (event.data.type !== 'ready') return;
    skyAchievementsBridge.frame = frame;
    skyAchievementsBridge.ready = true;
    invoke('skyos_skyachievements_diagnostic', 'iframe ready handshake received; flushing queued updates');
    flushSkyAchievementsUpdates();
  });
  const skyAchievementsFrame = byId('skyachievements-frame');
  if (skyAchievementsFrame) {
    const announceSkyAchievementsHost = () => {
      skyAchievementsBridge.ready = false;
      invoke('skyos_skyachievements_diagnostic', 'iframe load observed; sending host-ready handshake');
      skyAchievementsFrame.contentWindow?.postMessage({ channel: 'skyachievements', type: 'host-ready' }, '*');
    };
    skyAchievementsFrame.addEventListener('load', announceSkyAchievementsHost);
    announceSkyAchievementsHost();
  }
  const skyMissionsBridge = { frame: null, ready: false, pending: new Map(), nextUpdateId: 1 };
  function postSkyMissionsUpdate(frame, kind, data) {
    const id = skyMissionsBridge.nextUpdateId++;
    frame.contentWindow.postMessage({ channel: 'skymissions', type: 'update', payload: { id, kind, data } }, '*');
  }
  function sendSkyMissionsUpdate(kind, data, sendWhileHidden = false) {
    if (!sendWhileHidden && state.activePage !== 'skymissions') return;
    const frame = byId('skymissions-frame');
    skyMissionsBridge.frame = frame;
    if (!frame?.contentWindow || !skyMissionsBridge.ready) {
      skyMissionsBridge.pending.set(kind, data);
      return;
    }
    postSkyMissionsUpdate(frame, kind, data);
  }
  function flushSkyMissionsUpdates() {
    const frame = byId('skymissions-frame');
    if (!frame?.contentWindow || !skyMissionsBridge.ready) return;
    for (const [kind, data] of skyMissionsBridge.pending) postSkyMissionsUpdate(frame, kind, data);
    skyMissionsBridge.pending.clear();
  }
  window.addEventListener('message', (event) => {
    const frame = byId('skymissions-frame');
    if (!frame || event.source !== frame.contentWindow || event.data?.channel !== 'skymissions') return;
    if (event.data.type === 'mission-completed') {
      const payload = event.data.payload || {};
      const title = String(payload.title || '').replace(/[\r\n\t]/g, ' ').trim().slice(0, 160);
      const reward = Math.max(0, Math.floor(Number(payload.reward) || 0));
      if (title && reward > 0) invoke('skyos_skymissions_mission_complete', `${title}\n${reward}`);
      return;
    }
    if (event.data.type === 'store-purchase') {
      const payload = event.data.payload || {};
      invoke('skyos_skymissions_store_purchase', `${String(payload.appId || '').slice(0, 80)}\n${String(payload.offerId || '').slice(0, 100)}\n${String(payload.price || 0)}\n${String(payload.name || '').slice(0, 100)}`);
      return;
    }
    if (event.data.type === 'store-stock-request') {
      const reason = String(event.data.payload?.reason || 'initial').replace(/[\r\n\t]/g, ' ').slice(0, 40);
      invoke('skyos_skymissions_store_stock', reason);
      return;
    }
    if (event.data.type === 'store-icons-request') {
      const formIDs = Array.isArray(event.data.payload?.formIDs)
        ? event.data.payload.formIDs.slice(0, 10).map((id) => String(id || '').trim().toUpperCase()).filter((id) => /^[0-9A-F]{8}$/.test(id))
        : [];
      if (formIDs.length) invoke('skyos_skymissions_store_icons', [...new Set(formIDs)].join(','));
      return;
    }
    if (event.data.type === 'diagnostic' || event.data.type === 'update-ack') {
      const payload = event.data.payload || {};
      const message = event.data.type === 'diagnostic'
        ? String(payload.message || 'unknown iframe diagnostic')
        : `iframe ack id=${Number(payload.id) || 0} kind=${String(payload.kind || 'unknown')} ok=${payload.ok === true}${payload.detail ? ` detail=${String(payload.detail).slice(0, 80)}` : ''}`;
      invoke('skyos_skymissions_diagnostic', message.replace(/[\r\n\t]/g, ' ').slice(0, 180));
      return;
    }
    if (event.data.type !== 'ready') return;
    skyMissionsBridge.frame = frame;
    skyMissionsBridge.ready = true;
    invoke('skyos_skymissions_diagnostic', 'iframe ready handshake received; flushing queued updates');
    flushSkyMissionsUpdates();
  });
  const skyMissionsFrame = byId('skymissions-frame');
  if (skyMissionsFrame) {
    const announceSkyMissionsHost = () => {
      skyMissionsBridge.ready = false;
      invoke('skyos_skymissions_diagnostic', 'iframe load observed; sending host-ready handshake');
      skyMissionsFrame.contentWindow?.postMessage({ channel: 'skymissions', type: 'host-ready' }, '*');
    };
    skyMissionsFrame.addEventListener('load', announceSkyMissionsHost);
    announceSkyMissionsHost();
  }
  const skyRewriteDashboardBridge = { frame: null, ready: false, pending: [] };
  function sendSkyRewriteDashboard(type, payload) {
    const frame = byId('skyrewrite-dashboard-frame');
    skyRewriteDashboardBridge.frame = frame;
    if (!frame?.contentWindow || !skyRewriteDashboardBridge.ready) {
      skyRewriteDashboardBridge.pending = skyRewriteDashboardBridge.pending.filter((entry) => entry.type !== type);
      skyRewriteDashboardBridge.pending.push({ type, payload });
      return;
    }
    frame.contentWindow.postMessage({ channel: 'skyrewrite-dashboard', type, payload }, '*');
  }
  function flushSkyRewriteDashboardBridge() {
    const frame = byId('skyrewrite-dashboard-frame');
    if (!frame?.contentWindow || !skyRewriteDashboardBridge.ready) return;
    for (const item of skyRewriteDashboardBridge.pending.splice(0)) frame.contentWindow.postMessage({ channel: 'skyrewrite-dashboard', ...item }, '*');
  }
  window.addEventListener('message', (event) => {
    const frame = byId('skyrewrite-dashboard-frame');
    if (!frame || event.source !== frame.contentWindow || event.data?.channel !== 'skyrewrite-dashboard') return;
    if (event.data.type === 'ready') {
      if (skyRewriteDashboardBridge.ready) return;
      skyRewriteDashboardBridge.frame = frame;
      skyRewriteDashboardBridge.ready = true;
      sendSkyRewriteDashboard('visibility', state.activePage === 'skyrewrite');
      flushSkyRewriteDashboardBridge();
    } else if (event.data.type === 'request-history') {
      if (state.activePage === 'skyrewrite') {
        const offset = Math.max(0, Math.min(2000, Number(event.data.offset) || 0));
        const limit = Math.max(1, Math.min(100, Number(event.data.limit) || 100));
        invoke('skyos_skyrewrite_history', `${offset}|${limit}`);
      }
    }
    else if (event.data.type === 'legacy-settings') {
      const module = state.modules.find((entry) => entry.id.toLowerCase() === 'skyrewrite');
      const legacy = event.data.payload && typeof event.data.payload === 'object' ? event.data.payload : {};
      if (module) {
        module.values = module.values || {};
        let changed = false;
        for (const setting of (module.manifest.settings || [])) {
          if (setting.type === 'hotkey') continue;
          if (Object.prototype.hasOwnProperty.call(module.values, setting.id)) continue;
          module.values[setting.id] = Object.prototype.hasOwnProperty.call(legacy, setting.id) ? legacy[setting.id] : setting.default;
          changed = true;
        }
        if (changed) invoke('skyos_save_module_settings', `SkyRewrite\n${JSON.stringify(module.values)}`);
        sendSkyRewriteDashboard('settings', module.values);
      }
    }
    else if (event.data.type === 'action') {
      const name = String(event.data.name || '');
      if (name.startsWith('skyos_skyrewrite_')) invoke(name, String(event.data.value || ''));
    }
  });
  const skyRewriteFrame = byId('skyrewrite-dashboard-frame');
  if (skyRewriteFrame) {
    const announceSkyRewriteHost = () => skyRewriteFrame.contentWindow?.postMessage({ channel: 'skyrewrite-dashboard', type: 'host-ready' }, '*');
    skyRewriteFrame.addEventListener('load', announceSkyRewriteHost, { once: true });
    announceSkyRewriteHost();
  }
  const esc = (value) => String(value).replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const keyNames = {
    1: 'Escape', 2: '1', 3: '2', 4: '3', 5: '4', 6: '5', 7: '6', 8: '7', 9: '8', 10: '9', 11: '0',
    12: '-', 13: '=', 14: 'Backspace', 15: 'Tab', 16: 'Q', 17: 'W', 18: 'E', 19: 'R', 20: 'T', 21: 'Y',
    22: 'U', 23: 'I', 24: 'O', 25: 'P', 26: '[', 27: ']', 28: 'Enter', 29: 'Left Ctrl', 30: 'A', 31: 'S',
    32: 'D', 33: 'F', 34: 'G', 35: 'H', 36: 'J', 37: 'K', 38: 'L', 39: ';', 40: "'", 41: '`', 42: 'Left Shift',
    43: '\\', 44: 'Z', 45: 'X', 46: 'C', 47: 'V', 48: 'B', 49: 'N', 50: 'M', 51: ',', 52: '.', 53: '/',
    54: 'Right Shift', 55: 'Numpad *', 56: 'Left Alt', 57: 'Space', 58: 'Caps Lock', 59: 'F1', 60: 'F2',
    61: 'F3', 62: 'F4', 63: 'F5', 64: 'F6', 65: 'F7', 66: 'F8', 67: 'F9', 68: 'F10', 87: 'F11', 88: 'F12'
  };
  const keyName = (code) => keyNames[code] || `Key 0x${Number(code).toString(16).padStart(2, '0').toUpperCase()}`;
  const monitorSnapshotRequestTab = () => state.monitorTab === 'plugins' && (!state.monitorShowPlugins || state.monitorPluginsLoaded) ? 'overview' : state.monitorTab;

  function pluginForFormID(value) {
    const formID = Number(value) >>> 0;
    if (!formID || !Array.isArray(state.monitorSnapshot?.plugins)) return '';
    const index = ((formID >>> 24) & 0xFF) === 0xFE
      ? `FE:${((formID >>> 12) & 0xFFF).toString(16).toUpperCase().padStart(3, '0')}`
      : ((formID >>> 24) & 0xFF).toString(16).toUpperCase().padStart(2, '0');
    return state.monitorSnapshot.plugins.find((plugin) => String(plugin.loadOrderIndex || '').toUpperCase() === index)?.name || '';
  }

  function experienceModule(id) {
    return state.modules.find((module) => module.id.toLowerCase() === id.toLowerCase());
  }

  function applySkyExperienceSettings() {
    const collection = experienceModule('SkyCollection');
    const counter = experienceModule('SkyCounterUI');
    const collectionValues = collection?.values || {};
    const counterValues = counter?.values || {};
    state.skycollectionSettings = {
      showPluginName: collectionValues.showPluginName !== false,
      showItemCount: collectionValues.showItemCount !== false,
      showFormID: collectionValues.showFormID !== false,
      showCategory: collectionValues.showCategory !== false,
      showSubcategory: collectionValues.showSubcategory !== false,
      showRarityBadge: collectionValues.showRarityBadge !== false,
      showPluginFilter: collectionValues.showPluginFilter !== false,
      sortOrder: ['name', 'most-found', 'rarity'].includes(collectionValues.sortOrder) ? collectionValues.sortOrder : 'name'
    };
    const counterEnabled = counterValues.enabled !== false;
    const counterOptions = {
      enabled: counterEnabled,
      renderIcons: counterValues.renderIcons !== false,
      captureLocationScreenshots: counterValues.captureLocationScreenshots !== false,
      messageDesign: ['relic-card', 'loot-banner', 'quest-toast', 'minimal-pill'].includes(counterValues.messageDesign) ? counterValues.messageDesign : 'relic-card',
      theme: ['dwemer', 'frost', 'imperial', 'arcane'].includes(counterValues.theme) ? counterValues.theme : 'dwemer',
      position: ['top-center', 'center-center', 'top-left', 'top-right', 'center-left', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right'].includes(counterValues.position) ? counterValues.position : 'top-center',
      size: ['compact', 'standard', 'large'].includes(counterValues.size) ? counterValues.size : 'standard',
      durationMs: [500, 1000, 1500, 2000, 2500, 3000].includes(Number(counterValues.messageDurationMs ?? counterValues.durationMs)) ? Number(counterValues.messageDurationMs ?? counterValues.durationMs) : 1500,
      showItemCount: counterValues.showItemCount !== false,
      showPluginName: counterValues.showPluginName !== false,
      showCategory: counterValues.showCategory !== false
    };
    invoke('skyos_skycounter_options', JSON.stringify(counterOptions));
    renderSkyCollection();
  }

  function renderFilterPicker(name, options, selectedValue) {
    const collectionPicker = name.startsWith('collection-');
    const ownerPrefix = collectionPicker ? 'skycollection' : 'skyrewrite';
    const dataAttribute = collectionPicker ? 'data-skycollection-picker' : 'data-skyrewrite-picker';
    const picker = document.querySelector(`[${dataAttribute}="${name}"]`);
    if (!picker) return;
    const triggerLabel = picker.querySelector(`.${ownerPrefix}-picker-trigger span`);
    const optionHost = picker.querySelector(`.${ownerPrefix}-picker-options`);
    const search = picker.querySelector(`.${ownerPrefix}-picker-search input`);
    const selected = options.find((option) => option.value === String(selectedValue)) || options[0];
    if (triggerLabel) triggerLabel.textContent = selected?.label || '';
    if (!optionHost) return;
    const needle = (search?.value || '').trim().toLocaleLowerCase();
    const matches = options.filter((option) => option.label.toLocaleLowerCase().includes(needle));
    const signature = JSON.stringify({ matches, selectedValue: String(selectedValue), needle });
    if (optionHost.dataset.signature === signature) return;
    optionHost.replaceChildren();
    optionHost.dataset.signature = signature;
    if (!matches.length) {
      const empty = document.createElement('div'); empty.className = `${ownerPrefix}-picker-empty`; empty.textContent = 'No matching filters'; optionHost.appendChild(empty);
      return;
    }
    for (const option of matches) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = `${ownerPrefix}-picker-option`; button.dataset.value = option.value;
      button.setAttribute('role', 'option'); button.setAttribute('aria-selected', option.value === String(selectedValue) ? 'true' : 'false');
      if (option.value === String(selectedValue)) button.classList.add('selected');
      button.textContent = option.label;
      optionHost.appendChild(button);
    }
  }

  function getFilterPickerOptions(name) {
    if (name === 'collection-rarity') return [
      { value: 'all', label: 'All rarities' }, { value: 'recent', label: 'Recent discoveries' },
      { value: 'Common', label: 'Common' }, { value: 'Uncommon', label: 'Uncommon' },
      { value: 'Rare', label: 'Rare' }, { value: 'Epic', label: 'Epic' }, { value: 'Legendary', label: 'Legendary' }
    ];
    if (name === 'collection-plugin') {
      const plugins = [...new Set([...state.skycollectionItems, ...state.skycollectionLocations].map((item) => item.plugin).filter(Boolean))].sort((a, b) => a.localeCompare(b));
      return [{ value: 'all', label: 'All plugins' }, ...plugins.map((plugin) => ({ value: plugin, label: plugin }))];
    }
    return [];
  }

  function getFilterPickerValue(name) {
    if (name === 'collection-rarity') return state.skycollectionRarity;
    if (name === 'collection-plugin') return state.skycollectionPlugin;
    return 'all';
  }

  function modLogoOrGlyph(src, className, glyph) {
    if (typeof src === 'string' && (/^data:image\/(png|jpeg|webp);base64,/i.test(src) || /^file:\/\/\//i.test(src))) {
      const image = document.createElement('img');
      image.className = `${className} mod-logo`;
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.src = src;
      image.addEventListener('error', () => image.replaceWith(modLogoOrGlyph('', className, glyph)), { once: true });
      return image;
    }
    const fallback = document.createElement('span');
    fallback.className = className;
    fallback.textContent = glyph;
    return fallback;
  }

  const themeTextDefaults = {
    dark: '#e9edf2', light: '#302b22', cyberpunk: '#f4efff',
    'vampire-neon': '#f5eaf0', 'deep-blue': '#e8f3ff'
  };
  const supportedFonts = ['main', 'neon', 'dwemer', 'terminal', 'aspire', 'timeburner', 'balingkang'];
  const textPalette = ['#e9edf2', '#f0c77a', '#70d2df', '#8de0b5', '#b8a0ff', '#ff82bc', '#ff9b72', '#ffffff', '#9ca8b8', '#302b22'];

  function applyTextColor(color, persist = true) {
    if (!/^#[0-9a-f]{6}$/i.test(color || '')) return;
    document.documentElement.style.setProperty('--skyos-user-text', color);
    const picker = byId('text-color-choice');
    if (picker) picker.value = color;
    if (persist) {
      try { localStorage.setItem(`skyos-text-${document.documentElement.dataset.theme || 'dark'}`, color); } catch { /* Keep the choice for this session. */ }
    }
  }

  function applyTheme(theme) {
    const supported = ['dark', 'light', 'cyberpunk', 'vampire-neon', 'deep-blue'].includes(theme) ? theme : 'dark';
    document.documentElement.dataset.theme = supported;
    const selector = byId('theme-choice');
    if (selector) selector.value = supported;
    let savedColor = '';
    try {
      localStorage.setItem('skyos-theme', supported);
      savedColor = localStorage.getItem(`skyos-text-${supported}`) || '';
    } catch { /* Keep the choice for this session. */ }
    applyTextColor(savedColor || themeTextDefaults[supported], false);
  }

  function applyFont(font, persist = true) {
    const supported = supportedFonts.includes(font) ? font : 'main';
    document.documentElement.dataset.font = supported;
    const selector = byId('font-choice');
    if (selector) selector.value = supported;
    if (persist) {
      try { localStorage.setItem('skyos-font', supported); } catch { /* Keep the choice for this session. */ }
    }
  }

  let initialTheme = 'dark';
  let initialFont = 'main';
  try {
    initialTheme = localStorage.getItem('skyos-theme') || 'dark';
    initialFont = localStorage.getItem('skyos-font') || 'main';
  } catch { /* Use the default appearance for this session. */ }
  document.documentElement.dataset.theme = initialTheme;
  document.documentElement.dataset.font = initialFont;

  function closePdfDocument() {
    if (state.pdf?.session) invoke('skyos_close_pdf_document', String(state.pdf.session));
    state.pdf = null;
  }

  function showPdf(target, result) {
    const pdfState = {
      session: Number(result.session),
      pages: Number(result.pages),
      pageNumber: 1,
      requestId: 0
    };
    if (!Number.isSafeInteger(pdfState.session) || pdfState.session <= 0 ||
        !Number.isSafeInteger(pdfState.pages) || pdfState.pages <= 0) {
      const message = document.createElement('p');
      message.className = 'pdf-render-status';
      message.textContent = 'PDFium returned invalid document details.';
      target.replaceChildren(message);
      return;
    }
    state.pdf = pdfState;
    const toolbar = document.createElement('div'); toolbar.className = 'pdf-toolbar';
    const previous = document.createElement('button'); previous.className = 'secondary'; previous.textContent = '← Previous';
    previous.addEventListener('click', () => changePdfPage(-1));
    const counter = document.createElement('span'); counter.id = 'pdf-page-counter';
    const next = document.createElement('button'); next.className = 'secondary'; next.textContent = 'Next →';
    next.addEventListener('click', () => changePdfPage(1));
    toolbar.append(previous, counter, next);
    const pageHost = document.createElement('div'); pageHost.id = 'pdf-page-host';
    target.replaceChildren(toolbar, pageHost);
    renderPdfCanvas();
  }

  function changePdfPage(delta) {
    if (!state.pdf) return;
    state.pdf.pageNumber = Math.max(1, Math.min(state.pdf.pages, state.pdf.pageNumber + delta));
    renderPdfCanvas();
  }

  function renderPdfCanvas() {
    if (!state.pdf) return;
    const pdfState = state.pdf;
    const requestId = ++pdfState.requestId;
    const pageHost = byId('pdf-page-host');
    if (!pageHost) return;
    const counter = byId('pdf-page-counter');
    if (counter) counter.textContent = `Page ${pdfState.pageNumber} of ${pdfState.pages}`;
    pageHost.replaceChildren();
    const loading = document.createElement('p');
    loading.className = 'pdf-render-status';
    loading.textContent = 'Rendering the complete page with PDFium…';
    pageHost.appendChild(loading);
    invoke('skyos_render_pdf_page', `${pdfState.session}\n${pdfState.pageNumber}\n${requestId}`);
  }
  function invoke(name, value = '') {
    if (window.skyrim && typeof window.skyrim[name] === 'function') window.skyrim[name](value);
    else if (typeof window[name] === 'function') window[name](value);
  }

  const SkyOS = window.SkyOS = {
    setStatus(text) { if (!state.actionStatus) byId('status').textContent = text; },
    setActionStatus(text) { state.actionStatus = String(text || 'Action complete'); byId('status').textContent = state.actionStatus; },
    setSkyCollectionCaptureStatus(text, active = false) {
      const status = byId('status');
      const message = String(text || '');
      if (!status || !message) return;
      status.textContent = message;
      if (captureStatusTimer) window.clearTimeout(captureStatusTimer);
      captureStatusTimer = 0;
      if (active) return;
      captureStatusTimer = window.setTimeout(() => {
        if (status.textContent === message) status.textContent = state.actionStatus || 'SkyOS ready';
        captureStatusTimer = 0;
      }, 5000);
    },
    setSkyNetStatus(installed) {
      state.skyNetInstalled = Boolean(installed);
      const home = byId('skynet-home-status');
      const tile = byId('skynet-home-tile');
      const settings = byId('skynet-settings-status');
      const badge = byId('skynet-status-badge');
      if (home) home.textContent = installed ? 'Fullscreen web browser · Installed' : 'SkyNet is not installed';
      if (tile) { tile.disabled = !installed; tile.title = installed ? 'Launch SkyNet' : 'Install the SkyOS-compatible SkyNet build to enable this app'; }
      if (settings) settings.textContent = installed ? 'SkyNet is installed and its SkyOS compatibility bridge is active.' : 'SkyNet is not installed, or its SkyOS compatibility bridge is missing. SkyNet launch is unavailable.';
      if (badge) { badge.textContent = installed ? 'INSTALLED' : 'NOT INSTALLED'; badge.className = `dependency-badge ${installed ? 'installed' : 'missing'}`; }
      if (state.activePage === 'skyview' && state.activeModule.toLowerCase() === 'skyos') renderModulePanel();
    },
    setFirstPartyApps(availability) {
      const names = {
        skysearch: 'SkySearch', skymonitor: 'SkyMonitor', skyrewrite: 'SkyRewrite',
        skycollection: 'SkyCollection', skycounter: 'SkyCounter UI', skyachievements: 'SkyAchievements', skymissions: 'SkyMissions'
      };
      const tiles = {
        skysearch: ['skysearch-home-tile', 'skysearch-home-status'],
        skymonitor: ['skymonitor-home-tile', 'skymonitor-home-status'],
        skyrewrite: ['skyrewrite-home-tile', 'skyrewrite-home-status'],
        skycollection: ['skycollection-home-tile', 'skycollection-home-status'],
        skycounter: ['skycounter-home-tile', 'skycounter-home-status'],
        skyachievements: ['skyachievements-home-tile', 'skyachievements-home-status'],
        skymissions: ['skymissions-home-tile', 'skymissions-home-status']
      };
      const descriptions = {
        skysearch: 'Search Skyrim records by category', skymonitor: 'Live Skyrim performance',
        skyrewrite: 'Persistent world history and simulation', skycollection: 'Your discovered item catalog',
        skycounter: 'Recent item discoveries', skyachievements: 'Your achievements and adventure history',
        skymissions: 'Missions, SkyStore, and character dashboard'
      };
      for (const key of Object.keys(names)) state.firstPartyApps[key] = availability?.[key] === true;
      for (const [key, [tileId, statusId]] of Object.entries(tiles)) {
        const installed = state.firstPartyApps[key];
        const name = names[key];
        const tile = byId(tileId);
        const status = byId(statusId);
        if (tile) {
          tile.hidden = !installed;
          tile.disabled = !installed;
          tile.title = installed ? `Open ${name}` : `${name} is not installed`;
        }
        if (status) status.textContent = installed ? `${descriptions[key]} · Installed` : `${name} is not installed`;
      }
      for (const button of document.querySelectorAll('.app[data-app]')) {
        const key = button.dataset.app;
        if (!(key in names)) continue;
        const installed = state.firstPartyApps[key];
        button.hidden = !installed;
        button.disabled = !installed;
        button.classList.toggle('disabled', !installed);
        button.title = installed ? names[key] : `${names[key]} is not installed`;
      }
      // Third-party registrations are rendered by SkyApps only. The fixed
      // first-party shortcut set above is managed from installed module status.
      renderSkyApps();
    },
    onShow() {
      if (!state.launchSplashShownThisSession) {
        state.launchSplashPending = true;
        startLaunchSplashWhenReady();
      }
      if (state.activePage === 'documents' && !state.documentsLoaded && !state.documentsLoading) this.refresh();
      if (state.activePage === 'skyrewrite') sendSkyRewriteDashboard('visibility', true);
      if (state.activePage === 'skymonitor' && !state.monitorTimer) {
        invoke('skyos_monitor_snapshot', monitorSnapshotRequestTab());
        state.monitorTimer = window.setInterval(() => invoke('skyos_monitor_snapshot', monitorSnapshotRequestTab()), state.monitorInterval);
      }
    },
    onHide() {
      finishLaunchSplash();
      if (state.activePage === 'skyrewrite') sendSkyRewriteDashboard('visibility', false);
      if (state.monitorTimer) { window.clearInterval(state.monitorTimer); state.monitorTimer = 0; }
    },
    hide() {
      if (state.activePage === 'skyrewrite') sendSkyRewriteDashboard('visibility', false);
      invoke('skyos_search_closed'); invoke('skyos_hide');
    },
    refresh(force = false) {
      if (state.documentsLoading || (state.documentsLoaded && !force)) return;
      state.documentsLoading = true;
      this.setStatus('Loading library…');
      invoke('skyos_list_documents');
    },
    setDocuments(items) {
      state.documents = Array.isArray(items) ? items : [];
      state.documentsLoaded = true;
      state.documentsLoading = false;
      if (!state.documents.some((doc) => doc.mod === state.selectedDocMod)) {
        state.selectedDocMod = '';
        state.activeDocumentId = '';
      }
      this.setStatus('Systems online');
      renderDocuments();
    },
    setModules(items) {
      state.modulesLoaded = true;
      state.modules = [];
      for (const item of (Array.isArray(items) ? items : [])) {
        try {
          const manifest = JSON.parse(String(item.manifest).replace(/^\uFEFF/, ''));
          let values = {};
          try { values = JSON.parse(item.settings || '{}'); } catch { /* Recover with manifest defaults. */ }
          if (manifest && typeof manifest.name === 'string') state.modules.push({ ...item, manifest, values: values && typeof values === 'object' ? values : {} });
        } catch (error) { console.warn(`SkyOS skipped invalid module manifest: ${item.id}`, error); }
      }
      state.skyMissionsStoreOffers = state.modules.flatMap((module) => {
        const offers = Array.isArray(module.manifest.skyStoreOffers) ? module.manifest.skyStoreOffers : [];
        return offers.slice(0, 100).filter((offer) => offer && typeof offer.id === 'string' && typeof offer.name === 'string').map((offer) => ({
          id: offer.id.slice(0, 80), appId: String(module.id || '').slice(0, 80), name: offer.name.slice(0, 100),
          description: String(offer.description || '').slice(0, 180), price: Math.max(0, Math.floor(Number(offer.price) || 0)),
          image: typeof offer.image === 'string' ? offer.image : ''
        }));
      });
      sendSkyMissionsUpdate('store', state.skyMissionsStoreOffers);
      syncHotkeysToNative();
      applySkyExperienceSettings();
      renderModuleTabs();
      const skyRewriteModule = state.modules.find((module) => module.id.toLowerCase() === 'skyrewrite');
      if (skyRewriteModule) {
        sendSkyRewriteDashboard('settings', skyRewriteModule.values);
        sendSkyRewriteDashboard('request-settings');
      }
      const searchModule = state.modules.find((module) => module.id.toLowerCase() === 'skysearch');
      const monitorModule = state.modules.find((module) => module.id.toLowerCase() === 'skymonitor');
      state.monitorInterval = Math.max(1500, Math.min(5000, Number(monitorModule?.values?.refreshInterval ?? 2000) || 2000));
      if (monitorModule) monitorModule.values.refreshInterval = state.monitorInterval;
      state.monitorShowPlugins = monitorModule?.values?.showPluginList !== false;
      if (state.activePage === 'skymonitor') {
        if (state.monitorTimer) window.clearInterval(state.monitorTimer);
        state.monitorTimer = window.setInterval(() => invoke('skyos_monitor_snapshot', monitorSnapshotRequestTab()), state.monitorInterval);
      }
      state.searchLimit = Math.max(1, Math.min(5000, Number(searchModule?.values?.maxResults ?? 500) || 500));
      state.showFormIDs = searchModule?.values?.showFormIDs !== false;
      if (state.activeModule && !state.modules.some((module) => module.id === state.activeModule)) state.activeModule = '';
      renderModulePanel();
      renderSkyApps();
      const coreModule = state.modules.find((module) => module.id.toLowerCase() === 'skyos');
      const splashSetting = coreModule?.manifest.settings?.find((setting) => setting?.id === 'showLaunchSplash');
      state.launchSplashEnabled = splashSetting ? settingValue(coreModule, splashSetting) !== false : true;
      startLaunchSplashWhenReady();
    },
    setNativeApps(items) {
      state.nativeApps = Array.isArray(items) ? items : [];
      renderSkyApps();
    },
    setSkyCollectionCatalog(items) {
      state.skycollectionItems = Array.isArray(items) ? items.filter((item) => !isCurrencyItemRecord(item)) : [];
      renderSkyCollection();
      sendSkyAchievementsUpdate('items', state.skycollectionItems);
      sendSkyMissionsUpdate('items', state.skycollectionItems);
    },
    setSkyAchievementsPlayer(name, level, health, magicka, stamina, followers, gender, factionsJSON) {
      let factions = [];
      try {
        const parsed = JSON.parse(String(factionsJSON || '[]'));
        if (Array.isArray(parsed)) factions = parsed;
      } catch (_) { factions = []; }
      sendSkyAchievementsUpdate('player', {
        name: String(name || ''), level: Number(level) || 0,
        health: Number(health) || 0, magicka: Number(magicka) || 0, stamina: Number(stamina) || 0,
        followers: Number(followers) || 0,
        gender: String(gender || 'male'), factions
      });
    },
    setSkyAchievementsAssets(assets) {
      sendSkyAchievementsUpdate('assets', assets && typeof assets === 'object' ? assets : {});
    },
    setSkyAchievementsHistory(history) {
      sendSkyAchievementsUpdate('history', history && typeof history === 'object' ? history : {});
    },
    setSkyMissionsPlayer(name, level, health, magicka, stamina, followers, gender, factionsJSON) {
      let factions = [];
      try { const parsed = JSON.parse(String(factionsJSON || '[]')); if (Array.isArray(parsed)) factions = parsed; } catch (_) { factions = []; }
      sendSkyMissionsUpdate('player', { name: String(name || ''), level: Number(level) || 0, health: Number(health) || 0,
        magicka: Number(magicka) || 0, stamina: Number(stamina) || 0, followers: Number(followers) || 0,
        gender: String(gender || 'male'), factions });
    },
    setSkyMissionsAssets(assets) {
      sendSkyMissionsUpdate('assets', assets && typeof assets === 'object' ? assets : {});
    },
    setSkyMissionsHistory(history) {
      const snapshot = history && typeof history === 'object' ? history : {};
      const events = Array.isArray(snapshot.events) ? snapshot.events : [];
      sendSkyMissionsUpdate('history', snapshot, true);
      sendSkyMissionsUpdate('mission-events', { events: events.slice(0, 64) }, true);
    },
    setSkyMissionsStoreOffers(offers) {
      sendSkyMissionsUpdate('store', Array.isArray(offers) ? offers : []);
    },
    setSkyMissionsStoreItems(stock) {
      sendSkyMissionsUpdate('game-store', stock && typeof stock === 'object' ? stock : { items: [] }, true);
    },
    setSkyMissionsStoreItemIcon(formID, icon) {
      const id = String(formID || '').trim().toUpperCase();
      const url = String(icon || '');
      if (!/^[0-9A-F]{8}$/.test(id) || !url) return;
      sendSkyMissionsUpdate(`game-store-icon:${id}`, { formID: id, icon: url }, true);
    },
    setSkyMissionsStorePurchaseResult(offerId, success) {
      sendSkyMissionsUpdate('game-store-purchase-result', { offerId: String(offerId || ''), success: success === true }, true);
    },
    setSkyCollectionLocations(items) {
      state.skycollectionLocations = Array.isArray(items) ? items : [];
      state.skycollectionRecentLocations.clear();
      if (String(state.skycollectionFilter).startsWith('location:')) {
        state.skycollectionFilter = 'Locations';
      }
      renderSkyCollection();
      sendSkyAchievementsUpdate('locations', state.skycollectionLocations);
      sendSkyMissionsUpdate('locations', state.skycollectionLocations);
    },
    setSkyCollectionLocation(location) {
      if (!location || typeof location.name !== 'string') return;
      const key = collectionLocationKey(location);
      const existing = state.skycollectionLocations.findIndex((entry) => collectionLocationKey(entry) === key);
      if (existing >= 0) state.skycollectionLocations[existing] = { ...state.skycollectionLocations[existing], ...location, key };
      else state.skycollectionLocations.push({ ...location, key });
      if (location.discoveredNow === true) state.skycollectionRecentLocations.add(key);
      renderSkyCollection();
      sendSkyAchievementsUpdate('locations', state.skycollectionLocations);
      sendSkyMissionsUpdate('locations', state.skycollectionLocations);
    },
    setSkyCollectionIcon(item) {
      if (!item || typeof item.icon !== 'string' || !item.icon) return;
      const key = collectionItemKey(item);
      state.skycollectionItems = state.skycollectionItems.map((entry) =>
        collectionItemKey(entry) === key ? { ...entry, icon: item.icon } : entry);
      document.querySelectorAll('.skycollection-item[data-collection-item-key]').forEach((card) => {
        if (card.dataset.collectionItemKey !== key) return;
        const art = card.querySelector('.skycollection-item-art');
        if (!art) return;
        const image = document.createElement('img');
        image.src = item.icon;
        image.alt = '';
        image.loading = 'lazy';
        image.decoding = 'async';
        art.replaceChildren(image);
      });
      sendSkyAchievementsUpdate('items', state.skycollectionItems);
      sendSkyMissionsUpdate('items', state.skycollectionItems);
    },
    setSkyCollectionPickup(payload) {
      const item = payload && typeof payload === 'object' ? payload.item : null;
      if (!item || typeof item.name !== 'string' || isCurrencyItemRecord(item)) return;
      const key = collectionItemKey(item);
      const existing = state.skycollectionItems.findIndex((entry) => collectionItemKey(entry) === key);
      if (existing >= 0) state.skycollectionItems[existing] = item;
      else state.skycollectionItems.unshift(item);
      renderSkyCollection();
      sendSkyAchievementsUpdate('items', state.skycollectionItems);
      sendSkyMissionsUpdate('items', state.skycollectionItems);
    },
    setSkyCounterUIPickup(payload) {
      const item = payload && typeof payload === 'object' ? payload.item : null;
      if (item && isCurrencyItemRecord(item)) return;
      forwardSkyCounterUIEvent('pickup', payload);
    },
    setSkyCounterUIIcon(item) {
      forwardSkyCounterUIEvent('icon', item);
    },
    setSkyCounterUILocation(location) {
      forwardSkyCounterUIEvent('location', location);
    },
    setSkyCollectionFilter(filter) {
      const valid = filter === 'all' || filter === 'unique' || collectionCategoryTree.some((group) => group.value === filter || group.children?.some((child) => child[0] === filter));
      state.skycollectionFilter = valid ? filter : 'all';
      const parent = collectionCategoryTree.find((group) => group.children?.some((child) => child[0] === state.skycollectionFilter));
      if (parent) state.skycollectionExpandedCategories.add(parent.value);
      document.querySelectorAll('[data-collection-filter]').forEach((button) => {
        const active = button.dataset.collectionFilter === state.skycollectionFilter;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      renderSkyCollection();
    },
    setMonitorTab(tab) {
      const next = ['overview', 'profiler', 'plugins'].includes(tab) ? tab : 'overview';
      state.monitorTab = next;
      if (next === 'plugins') { state.monitorPluginsLoaded = false; state.monitorPluginsSignature = ''; }
      if (next === 'profiler') { state.monitorModuleSignature = ''; state.monitorFunctionSignature = ''; state.monitorComparisonSignature = ''; }
      document.querySelectorAll('[data-monitor-tab]').forEach((button) => {
        const active = button.dataset.monitorTab === next;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      document.querySelectorAll('.monitor-tab-panel').forEach((panel) => { panel.hidden = panel.id !== `monitor-${next}`; });
      if (state.activePage === 'skymonitor') invoke('skyos_monitor_snapshot', next === 'plugins' && !state.monitorShowPlugins ? 'overview' : next);
    },
    setMonitorSnapshot(snapshot) {
      let received = snapshot && typeof snapshot === 'object' ? snapshot : null;
      if (received && state.monitorPluginsLoaded && Array.isArray(state.monitorSnapshot?.plugins) && (!Array.isArray(received.plugins) || received.plugins.length === 0)) {
        received = { ...received, plugins: state.monitorSnapshot.plugins };
      }
      if (received && state.monitorTab === 'plugins' && Array.isArray(received.plugins) && (received.plugins.length > 0 || Number(received.pluginCount) === 0)) state.monitorPluginsLoaded = true;
      state.monitorSnapshot = received;
      if (!state.monitorSnapshot) return;
      const display = (id, value) => {
        const node = byId(id);
        const text = value == null ? '—' : String(value);
        if (node && node.textContent !== text) node.textContent = text;
      };
      display('monitor-cpu', state.monitorSnapshot.cpuPercent == null ? '—' : `${Number(state.monitorSnapshot.cpuPercent).toFixed(1)}%`);
      display('monitor-ram', state.monitorSnapshot.ramBytes == null ? '—' : `${(Number(state.monitorSnapshot.ramBytes) / (1024 ** 3)).toFixed(2)} GB`);
      display('monitor-gpu', state.monitorSnapshot.gpuPercent == null ? '—' : `${Number(state.monitorSnapshot.gpuPercent).toFixed(1)}%`);
      display('monitor-vram', state.monitorSnapshot.vramBytes == null ? '—' : `${(Number(state.monitorSnapshot.vramBytes) / (1024 ** 3)).toFixed(2)} GB`);
      display('monitor-fps', state.monitorSnapshot.fps == null ? 'Unavailable' : `${Number(state.monitorSnapshot.fps).toFixed(0)}`);
      display('monitor-frame-time', state.monitorSnapshot.frameTimeMs == null ? '—' : `${Number(state.monitorSnapshot.frameTimeMs).toFixed(2)} ms`);
      display('monitor-main-cpu', state.monitorSnapshot.mainThreadCpuPercent == null ? '—' : `${Number(state.monitorSnapshot.mainThreadCpuPercent).toFixed(1)}%`);
      display('monitor-worker-cpu', state.monitorSnapshot.workerThreadsCpuPercent == null ? '—' : `${Number(state.monitorSnapshot.workerThreadsCpuPercent).toFixed(1)}%`);
      display('monitor-private-ram', state.monitorSnapshot.privateBytes == null ? '—' : `${(Number(state.monitorSnapshot.privateBytes) / (1024 ** 3)).toFixed(2)} GB`);
      const growth = Number(state.monitorSnapshot.privateGrowthBytesPerSecond);
      display('monitor-memory-growth', Number.isFinite(growth) ? `${growth >= 0 ? '+' : '−'}${(Math.abs(growth) / (1024 ** 2)).toFixed(2)} MB/s` : '—');
      display('monitor-system-ram', state.monitorSnapshot.systemRamBytes == null ? '—' : `${(Number(state.monitorSnapshot.systemRamBytes) / (1024 ** 3)).toFixed(1)} GB total`);
      display('monitor-thread-count', `Threads: ${state.monitorSnapshot.threadCount ?? '—'}`);
      display('monitor-plugin-count', state.monitorSnapshot.pluginCount ?? '—');
      display('monitor-script-count', state.monitorSnapshot.scriptCount == null ? '—' : Number(state.monitorSnapshot.scriptCount).toLocaleString());
      display('monitor-plugin-cpu', state.monitorSnapshot.cpuPercent == null ? '—' : `${Number(state.monitorSnapshot.cpuPercent).toFixed(1)}%`);
      display('monitor-plugin-ram', state.monitorSnapshot.ramBytes == null ? '—' : `${(Number(state.monitorSnapshot.ramBytes) / (1024 ** 3)).toFixed(2)} GB`);
      display('monitor-plugin-gpu', state.monitorSnapshot.gpuPercent == null ? '—' : `${Number(state.monitorSnapshot.gpuPercent).toFixed(1)}%`);
      if (state.monitorTab === 'profiler') {
      const profiler = state.monitorSnapshot.profiler || {};
      const profileStatus = byId('monitor-profile-status');
      const profileStart = byId('monitor-profile-start');
      const profileStop = byId('monitor-profile-stop');
      const moduleList = byId('monitor-module-list');
      const functionList = byId('monitor-function-list');
      if (profileStatus) {
        const diagnostics = profiler.active
          ? ` · ${Number(profiler.eventsSeen || 0).toLocaleString()} ETW events / ${Number(profiler.profileEventsSeen || 0).toLocaleString()} profile events / ${Number(profiler.threadMatched || 0).toLocaleString()} Skyrim-thread samples`
          : '';
        const stackStatus = profiler.active
          ? (profiler.stackCaptureEnabled ? ' · Call-stack capture active' : ' · Call-stack capture unavailable')
          : (profiler.stackResolutionStatus ? ` · ${profiler.stackResolutionStatus}` : '');
        profileStatus.textContent = `${profiler.status || 'Deep profiling is off'} · ${Number(profiler.sampleCount || 0).toLocaleString()} samples collected${diagnostics}${stackStatus}. ETW sample share is an estimate, not exact CPU time.`;
      }
      const profileBusy = Boolean(profiler.active) || ['Starting ETW session', 'Preparing next profile', 'Resolving sampled call stacks', 'Saving SkyMonitor.ini'].includes(profiler.status);
      if (profileStart) profileStart.disabled = profileBusy;
      if (profileStop) profileStop.disabled = !profiler.active;
      if (moduleList) {
        const modules = Array.isArray(profiler.modules) ? profiler.modules : [];
        const signature = JSON.stringify(modules);
        if (signature !== state.monitorModuleSignature) {
          moduleList.innerHTML = modules.length
            ? modules.map((module, index) => `<div class="monitor-plugin-row profiler-module-row"><span class="monitor-plugin-index">${index + 1}</span><strong title="${esc(module.name || '')}">${esc(module.name || 'Unknown module')}</strong><small>${Number(module.samples || 0).toLocaleString()} samples</small><span class="monitor-shared">${Number(module.sharePercent || 0).toFixed(1)}% of samples</span></div>`).join('')
            : `<div class="empty">${profiler.active ? 'Collecting samples…' : 'Start deep profile to collect native module samples.'}</div>`;
          state.monitorModuleSignature = signature;
        }
      }
      if (functionList) {
        const functions = Array.isArray(profiler.functions) ? profiler.functions : [];
        const functionSignature = JSON.stringify(functions);
        if (functionSignature !== state.monitorFunctionSignature) {
        const classifyFunction = (entry) => {
          if (entry.category) return String(entry.category);
          const moduleName = String(entry.module || '').toLowerCase();
          if (moduleName === 'skyrimse.exe' || moduleName === 'skyrim.exe') return 'Skyrim';
          if (/^(nv|nvidia|amd|ati|ig|intel).*\.dll$/.test(moduleName)) return 'Graphics drivers';
          if (/^(d3d|dxgi|dxcore|dwrite|d2d|xaudio|xinput|vulkan|opengl)/.test(moduleName)) return 'Graphics and audio runtime';
          if (/^(ntdll|kernel32|kernelbase|user32|win32u|gdi32|advapi32|sechost|ucrtbase|vcruntime|msvcp|combase|ole32|oleaut32|rpcrt4|ws2_32|bcrypt|crypt32|shell32|shcore|ntoskrnl|wow64)/.test(moduleName)) return 'Windows runtime';
          return 'SKSE / third-party modules';
        };
        const buckets = new Map();
        for (const entry of functions) {
          const category = classifyFunction(entry);
          if (!buckets.has(category)) buckets.set(category, []);
          buckets.get(category).push(entry);
        }
        const categoryOrder = ['Skyrim', 'SKSE / third-party modules', 'Graphics drivers', 'Graphics and audio runtime', 'Windows runtime'];
        const functionRows = categoryOrder.filter((category) => buckets.has(category)).map((category) => {
          const entries = buckets.get(category);
          const hits = entries.reduce((sum, entry) => sum + Number(entry.samples || 0), 0);
          const rows = entries.map((entry, index) => {
            const moduleName = String(entry.module || 'Unknown module');
            const functionName = String(entry.name || 'Unknown frame');
            const unresolved = functionName.match(/\+0x([0-9a-f]+)$/i);
            const symbolMissing = entry.symbolResolved === false || Boolean(unresolved);
            const displayName = unresolved
              ? (moduleName.toLowerCase() === 'skyrimse.exe' ? `Unresolved Skyrim offset 0x${unresolved[1]}` : `Unresolved module offset 0x${unresolved[1]}`)
              : functionName;
            return `<div class="monitor-plugin-row profiler-function-row"><span class="monitor-plugin-index">${index + 1}</span><strong title="${esc(`${moduleName}!${functionName}`)}">${esc(displayName)}<small>${esc(moduleName)}${symbolMissing ? ' · symbols unavailable' : ''}</small></strong><small>${Number(entry.samples || 0).toLocaleString()} inclusive hits</small><span class="monitor-shared">${Number(entry.sharePercent || 0).toFixed(1)}% of stack hits</span></div>`;
          }).join('');
          return `<div class="profiler-function-group"><header><strong>${esc(category)}</strong><span>${entries.length} entries · ${hits.toLocaleString()} inclusive hits</span></header>${rows}</div>`;
        }).join('');
        functionList.innerHTML = functions.length
          ? `${functionRows}<p class="profiler-attribution-note">Categories are based on module names. Third-party modules may be SKSE plugins or bundled runtimes; offset-only entries have no matching symbols on this PC.</p>`
          : `<div class="empty">${profiler.active ? 'Collecting call-stack samples…' : profiler.stackResolutionStatus ? esc(profiler.stackResolutionStatus) : profiler.stackCaptureEnabled === false && profiler.sampleCount ? 'Stack capture was unavailable in this run. Module samples were still saved.' : 'Function samples are resolved when you stop a profile.'}</div>`;
          state.monitorFunctionSignature = functionSignature;
        }
      }
      const comparisonHost = byId('monitor-profile-comparison');
      if (comparisonHost) {
        const comparison = profiler.comparison;
        const comparisonSignature = JSON.stringify(comparison || null);
        if (comparisonSignature !== state.monitorComparisonSignature && comparison && comparison.available) {
          const delta = comparison.frameTimeDeltaMs == null ? NaN : Number(comparison.frameTimeDeltaMs);
          const deltaText = Number.isFinite(delta) ? `${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(2)} ms` : 'Unavailable';
          const rows = Array.isArray(comparison.modules) ? comparison.modules.slice(0, 8) : [];
          const previousFrame = comparison.previousFrameTimeMs == null ? NaN : Number(comparison.previousFrameTimeMs);
          const currentFrame = comparison.currentFrameTimeMs == null ? NaN : Number(comparison.currentFrameTimeMs);
          comparisonHost.classList.remove('hidden');
          comparisonHost.innerHTML = `<div class="monitor-comparison-heading"><strong>Latest run vs previous run</strong><span>${esc(comparison.previousStarted || 'Previous capture')} → ${esc(comparison.currentStarted || 'Current capture')}</span></div><div class="monitor-comparison-stats"><span>Previous avg frame time <b>${Number.isFinite(previousFrame) ? `${previousFrame.toFixed(2)} ms` : 'Unavailable'}</b></span><span>Latest avg frame time <b>${Number.isFinite(currentFrame) ? `${currentFrame.toFixed(2)} ms` : 'Unavailable'}</b></span><span>Change <b>${deltaText}</b></span><span>Samples <b>${Number(comparison.previousSampleCount || 0).toLocaleString()} → ${Number(comparison.currentSampleCount || 0).toLocaleString()}</b></span></div>${rows.length ? `<div class="monitor-comparison-modules">${rows.map((item) => `<div><strong>${esc(item.name)}</strong><span>${Number(item.previousShare || 0).toFixed(1)}% → ${Number(item.currentShare || 0).toFixed(1)}%</span><b>${Number(item.shareDelta || 0) >= 0 ? '+' : '−'}${Math.abs(Number(item.shareDelta || 0)).toFixed(1)} pp</b></div>`).join('')}</div>` : ''}<small>Shares are sample distribution estimates. Frame time uses the profiler's periodic SkyMonitor readings.</small>`;
          state.monitorComparisonSignature = comparisonSignature;
        } else if (comparisonSignature !== state.monitorComparisonSignature) {
          comparisonHost.classList.add('hidden');
          comparisonHost.textContent = '';
          state.monitorComparisonSignature = comparisonSignature;
        }
      }
      }
      if (state.monitorTab === 'plugins') {
      const sort = byId('monitor-sort')?.value || 'load';
      const plugins = state.monitorShowPlugins && Array.isArray(state.monitorSnapshot.plugins)
        ? (window.SkyMonitorSortPlugins ? window.SkyMonitorSortPlugins(state.monitorSnapshot.plugins, sort) : [...state.monitorSnapshot.plugins])
        : [];
      const list = byId('monitor-plugin-list');
      if (list) {
        const signature = `${state.monitorShowPlugins ? 'visible' : 'hidden'}|${sort}|${plugins.length}`;
        if (signature !== state.monitorPluginsSignature) {
          if (!state.monitorShowPlugins) list.innerHTML = '<div class="empty">The loaded plugin list is hidden in SkyViewer settings.</div>';
          else if (!plugins.length) list.innerHTML = '<div class="empty">Plugin load-order data is unavailable right now.</div>';
          else list.innerHTML = plugins.map((plugin, index) => {
            const details = `${plugin.lightPlugin ? 'Light plugin' : 'Full plugin'} · ${Number(plugin.recordCount || 0).toLocaleString()} records · ${plugin.fileSize || 'size unavailable'} on disk`;
            return `<div class="monitor-plugin-row monitor-plugin-detail-row"><span class="monitor-plugin-index" title="Load-order/FormID index">${esc(plugin.loadOrderIndex || String(index + 1))}</span><strong title="${esc(plugin.name || '')}">${esc(plugin.name || 'Unknown plugin')}<small>${esc(plugin.type || 'Plugin')} · ${esc(details)}</small></strong><small>${plugin.lightPlugin ? 'ESL/light' : 'Full index'}</small><span class="monitor-shared" title="Per-plugin CPU, RAM, and GPU use is not available for ESP/ESM records">Shared engine usage</span></div>`;
          }).join('');
          state.monitorPluginsSignature = signature;
        }
      }
      }
    },
    openApp(app) {
      const optionalApps = {
        skysearch: ['skysearch', 'SkySearch'], skymonitor: ['skymonitor', 'SkyMonitor'],
        skyrewrite: ['skyrewrite', 'SkyRewrite'], skycollection: ['skycollection', 'SkyCollection'],
        skycounter: ['skycounter', 'SkyCounter UI'], skyachievements: ['skyachievements', 'SkyAchievements'], skymissions: ['skymissions', 'SkyMissions']
      };
      const optional = optionalApps[app];
      if (optional && state.firstPartyApps[optional[0]] !== true) {
        this.setStatus(`${optional[1]} is not installed`);
        return;
      }
      if (state.monitorTimer) { window.clearInterval(state.monitorTimer); state.monitorTimer = 0; }
      if (state.activePage === 'skysearch' && app !== 'skysearch') invoke('skyos_search_closed');
      if (app !== 'reader' && state.activePage === 'reader') state.readerRequestId++;
      if (app !== 'reader' && state.pdf) closePdfDocument();
      document.querySelectorAll('.page').forEach((node) => node.classList.add('hidden'));
      byId(app).classList.remove('hidden');
      state.activePage = app;
      if (state.modApp) sendSkyOSAppMessage('visibility', { visible: app === 'mod-app' });
      sendSkyRewriteDashboard('visibility', app === 'skyrewrite');
      if (app === 'skysearch') invoke('skyos_search_opened');
      const selectedRailApp = app === 'mod-app' ? 'skyapps' : app;
      document.querySelectorAll('.app').forEach((node) => node.classList.toggle('active', node.dataset.app === selectedRailApp));
      if (app === 'documents' && !state.documentsLoaded && !state.documentsLoading) this.refresh();
      if (!state.modulesLoaded && (app === 'skyview' || app === 'skysearch' || app === 'skyapps' || app === 'skymissions')) invoke('skyos_list_skyview_modules');
      if (app === 'skyapps') invoke('skyos_list_native_apps');
      if (app === 'skycollection') invoke('skyos_skycollection_catalog');
      if (app === 'skyachievements') invoke('skyos_skyachievements_request');
      if (app === 'skymissions') {
        invoke('skyos_skymissions_request');
        sendSkyMissionsUpdate('store', state.skyMissionsStoreOffers);
      }
      if (app === 'skymonitor') {
        invoke('skyos_monitor_snapshot', 'overview');
        if (state.monitorTab !== 'overview') window.setTimeout(() => {
          if (state.activePage === 'skymonitor') invoke('skyos_monitor_snapshot', monitorSnapshotRequestTab());
        }, 120);
        state.monitorTimer = window.setInterval(() => invoke('skyos_monitor_snapshot', monitorSnapshotRequestTab()), state.monitorInterval);
      }
    },
    setSkyRewriteHistory(events) {
      sendSkyRewriteDashboard('history', events);
      // SkyMissions receives its own bounded event snapshot; this payload can
      // contain the full lifetime journal for SkyAchievements counters.
    },
    notifySkyRewriteHistoryChanged() {
      if (state.activePage === 'skyrewrite') sendSkyRewriteDashboard('history-changed');
      if (state.firstPartyApps.skymissions === true && state.firstPartyApps.skyrewrite === true) {
        invoke('skyos_skymissions_event_snapshot');
      }
    },
    setSkyRewriteActionStatus(status) {
      sendSkyRewriteDashboard('action-status', String(status || ''));
    },
    openSearch() {
      if (state.activePage !== 'skysearch') state.searchPreviousPage = state.activePage;
      this.openApp('skysearch');
      byId('search-query').focus();
      byId('search-query').select();
    },
    openSkyApp(target, moduleId = '', fallbackModuleId = '') {
      if (target === 'skynet') return this.launchSkyNet();
      if (target === 'native') { this.setStatus('Opening app window…'); invoke('skyos_launch_native_app', `${moduleId}\n${fallbackModuleId}`); return; }
      if (target === 'web') {
        const app = state.nativeApps.find((entry) => String(entry.id || '').toLowerCase() === String(moduleId).toLowerCase());
        if (!app?.available || !app.url) { this.setStatus('This internal app is missing its index.html file'); return; }
        const title = byId('mod-app-title');
        if (title) title.textContent = app.name || app.id;
        const description = byId('mod-app-description');
        if (description) description.textContent = app.description || 'Mod app';
        const sameRegisteredPage = state.modApp?.id === app.id && byId('mod-app-frame')?.src === app.url;
        if (!sameRegisteredPage) state.modAppBridgeReady = false;
        state.modApp = app;
        setSkyOSAppActions([]);
        const frame = byId('mod-app-frame');
        if (frame && frame.src !== app.url) frame.src = app.url;
        this.openApp('mod-app');
        if (state.modAppBridgeReady) sendSkyOSAppMessage('host-ready', { appId: app.id, name: app.name, description: app.description, bridgeVersion: 1 });
        return;
      }
      if (moduleId) state.activeModule = moduleId;
      this.openApp(target);
    },
    nativeAppLaunchFailed(error, fallbackModuleId = '') {
      const module = state.modules.find((entry) => entry.id === fallbackModuleId);
      if (module) {
        state.activeModule = module.id;
        this.openApp('skyview');
        this.setStatus(`${error || 'App window did not open'} · opened its SkyViewer page instead`);
        return;
      }
      this.setStatus(error || 'The app window could not be opened');
    },
    closeSearch() {
      if (state.activePage !== 'skysearch') return;
      this.openApp(state.searchPreviousPage || 'home');
    },
    search(query, clearActionStatus = true) {
      if (clearActionStatus) { state.actionStatus = ''; this.setStatus('Searching Skyrim…'); }
      const text = String(query || '').trim();
      state.searchQuery = text;
      byId('search-results').innerHTML = '<div class="empty">Searching selected Skyrim record types…</div>';
      const selected = [...document.querySelectorAll('#search-filters input:checked')].map((input) => input.value);
      invoke('skyos_search', `${state.selectedMod ? `modrecords:${selected.length ? selected.join(',') : 'none'}` : selected.length ? selected.join(',') : 'none'}\n${text}\n${state.selectedMod}\n${state.searchLimit}`);
    },
    searchMod(name) { state.selectedMod = name; this.search(byId('search-query').value); },
    browseMods() { state.selectedMod = ''; this.search(byId('search-query').value); },
    refreshSearch() { if (state.activePage === 'skysearch') this.search(state.searchQuery, false); },
    refreshSearchAfter(delay = 450) { window.setTimeout(() => this.refreshSearch(), Math.max(0, Number(delay) || 0)); },
    setSearchResults(results) {
      state.searchResults = Array.isArray(results) ? results : [];
      renderSearchResults();
    },
    searchAction(action, formId, count) {
      invoke('skyos_search_action', `${action}\n${formId}\n${count}`);
    },
    launchSkyNet() {
      if (state.skyNetInstalled === false) { this.setStatus('SkyNet is not installed'); return; }
      this.setStatus('Opening SkyNet…');
      invoke('skyos_launch_skynet');
    },
    openDocument(id) {
      closePdfDocument();
      state.readerRequestId++;
      state.activeDocumentId = id;
      const skyOSModule = state.modules.find((module) => module.id.toLowerCase() === 'skyos');
      const readerSetting = skyOSModule?.manifest?.settings?.find((setting) => setting.id === 'useBuiltInDocumentReader');
      const useBuiltInReader = readerSetting && settingValue(skyOSModule, readerSetting) === true;
      if (state.skyNetInstalled && !useBuiltInReader) {
        this.setStatus('Opening document in SkyNet…');
        invoke('skyos_open_document', id);
      } else {
        this.openDocumentInSkyOSReader(id);
      }
    },
    openDocumentInSkyOSReader(id) {
      this.setStatus('Opening document in built-in reader…');
      document.querySelectorAll('.page').forEach((node) => node.classList.add('hidden'));
      byId('reader').classList.remove('hidden');
      state.activePage = 'reader';
      invoke('skyos_read_document', `${state.readerRequestId}\n${id}`);
    },
    beginHotkeyCapture(moduleId, settingId) {
      state.hotkeyTarget = `${moduleId}\n${settingId}`;
      const hint = byId('capture-hint');
      if (hint) { hint.classList.remove('hidden'); hint.textContent = 'Press a key. Hold Ctrl, Shift, or Alt first for a combination. Escape cancels, except for a Close hotkey.'; }
      document.querySelectorAll('.capture-hotkey').forEach((button) => { button.disabled = true; });
      invoke('skyos_begin_hotkey_capture', state.hotkeyTarget);
      this.setStatus(`Choose a shortcut for ${moduleId}`);
    },
    captureStarted(moduleId, settingId) { state.hotkeyTarget = `${moduleId}\n${settingId}`; },
    hotkeyCaptured(moduleId, settingId, shortcut) {
      const module = state.modules.find((entry) => entry.id.toLowerCase() === String(moduleId).toLowerCase());
      const setting = module?.manifest?.settings?.find((entry) => entry.id === settingId && entry.type === 'hotkey');
      if (module && setting) {
        const value = byId(hotkeyValueId(module, setting));
        if (value) value.textContent = shortcut;
        saveSetting(module, setting, shortcut);
      }
      state.hotkeyTarget = '';
      byId('capture-hint')?.classList.add('hidden');
      document.querySelectorAll('.capture-hotkey').forEach((button) => { button.disabled = false; });
      this.setStatus(`Shortcut set to ${shortcut}`);
    },
    captureCancelled() {
      const hint = byId('capture-hint');
      if (hint) hint.classList.add('hidden');
      state.hotkeyTarget = '';
      document.querySelectorAll('.capture-hotkey').forEach((button) => { button.disabled = false; });
      this.setStatus('Hotkey change cancelled');
    },
    openHotkeyPage(page) {
      if (page === 'skyview') {
        const module = state.modules.find((entry) => entry.id.toLowerCase() === 'skyos');
        if (module) state.activeModule = module.id;
      }
      this.openApp(page);
      if (page === 'skyview' && state.modulesLoaded) { renderModuleTabs(); renderModulePanel(); }
    },
    openHotkeyApp(moduleId) {
      const id = String(moduleId || '').toLowerCase();
      const pages = { skyrewrite: 'skyrewrite', skycollection: 'skycollection', skymonitor: 'skymonitor', skyachievements: 'skyachievements', skymissions: 'skymissions' };
      if (id === 'skysearch') { this.openSearch(); return; }
      if (pages[id]) { this.openApp(pages[id]); return; }
      const module = state.modules.find((entry) => entry.id.toLowerCase() === id);
      if (module) {
        state.activeModule = module.id;
        this.openApp('skyview');
        if (state.modulesLoaded) { renderModuleTabs(); renderModulePanel(); }
        return;
      }
      this.openApp('home');
    },
    hotkeyAction(moduleId, settingId) {
      if (String(moduleId).toLowerCase() === 'skysearch' && settingId === 'closeHotkey') this.closeSearch();
    },
    openDocumentResult(raw, requestId) {
      if (Number(requestId) !== state.readerRequestId) return;
      let result;
      try { result = JSON.parse(raw); } catch { result = { error: 'The document response was invalid.' }; }
      if (result.error) {
        byId('reader-title').textContent = 'Could not open document';
        byId('reader-mod').textContent = 'SKYOS';
        byId('reader-content').textContent = result.error;
        this.setStatus('Could not open document');
      } else {
        byId('reader-title').textContent = result.name;
        byId('reader-mod').textContent = state.selectedDocMod || 'MOD DOCUMENT';
        this.setStatus(result.type === 'pdf-native' ? 'Rendering PDF page…' : 'Document ready');
        const target = byId('reader-content');
        target.replaceChildren();
        if (result.type === 'pdf-native') {
          showPdf(target, result);
        } else if (result.type === 'html') {
          // Render as an isolated document; do not interpolate mod HTML into the SkyView shell.
          const frame = document.createElement('iframe');
          frame.setAttribute('sandbox', 'allow-same-origin');
          const modInfo = state.documents.find((doc) => doc.mod === state.selectedDocMod && doc.placeholder);
          let html = String(result.content);
          const replaceAssetReferences = (stem, dataUri) => {
            if (!dataUri) return;
            const expression = new RegExp(`(?:\\.\\.?/)?${stem}\\.(?:png|jpe?g|webp)`, 'gi');
            html = html.replace(expression, dataUri);
          };
          replaceAssetReferences('logo', modInfo?.logo);
          replaceAssetReferences('banner', modInfo?.banner);
          frame.srcdoc = html;
          target.appendChild(frame);
        } else {
          const pre = document.createElement('pre');
          pre.textContent = result.content;
          target.appendChild(pre);
        }
      }
      this.openApp('reader');
    },
    pdfPageResult(session, requestId, pageNumber, raw) {
      const pdfState = state.pdf;
      if (!pdfState || pdfState.session !== Number(session) || pdfState.requestId !== Number(requestId) ||
          pdfState.pageNumber !== Number(pageNumber)) return;
      let result;
      try { result = JSON.parse(raw); } catch { result = { error: 'PDFium returned an invalid page image.' }; }
      const pageHost = byId('pdf-page-host');
      if (!pageHost) return;
      if (result.error) {
        const message = document.createElement('p');
        message.className = 'pdf-render-status';
        message.textContent = `Could not render this PDF page: ${result.error}`;
        pageHost.replaceChildren(message);
        this.setStatus('Could not render PDF page');
        return;
      }
      if (!Number.isFinite(Number(result.width)) || !Number.isFinite(Number(result.height)) ||
          Number(result.width) <= 0 || Number(result.height) <= 0 ||
          typeof result.image !== 'string' || !result.image.startsWith('data:image/png;base64,')) {
        const message = document.createElement('p');
        message.className = 'pdf-render-status';
        message.textContent = 'PDFium returned an invalid page image.';
        pageHost.replaceChildren(message);
        return;
      }
      const pageImage = document.createElement('img');
      pageImage.className = 'pdf-page pdf-page-image';
      pageImage.alt = `Page ${pdfState.pageNumber} of ${pdfState.pages}`;
      pageImage.draggable = false;
      pageImage.style.width = '100%';
      pageImage.style.height = 'auto';
      pageImage.style.maxWidth = '1800px';
      pageImage.src = result.image;
      const pageStage = document.createElement('div');
      pageStage.className = 'pdf-page-stage';
      pageStage.style.width = '100%';
      pageStage.style.maxWidth = '1800px';
      pageStage.appendChild(pageImage);
      pageHost.replaceChildren(pageStage);
      this.setStatus(`PDF page ${pdfState.pageNumber} ready`);
    }
  };

  function renderSkyApps() {
    const host = byId('skyapps-grid');
    if (!host) return;
    host.replaceChildren();
    const apps = [
      { name: 'SkyDocuments', description: 'Mod guides and pages', target: 'documents', logo: 'skydocuments-logo.png' },
      { name: 'SkyViewer', description: 'PrismaUI MCM-style settings menu for supported mods', target: 'skyview', logo: 'skyviewer-logo.png' },
      { name: 'SkySearch', description: state.firstPartyApps.skysearch ? 'Search Skyrim records' : 'SkySearch is not installed', target: 'skysearch', logo: state.firstPartyApps.skysearch ? '../SkySearch/skysearch-logo.png' : 'skyos-logo.png', disabled: !state.firstPartyApps.skysearch },
      { name: 'SkyMonitor', description: state.firstPartyApps.skymonitor ? 'Live Skyrim process telemetry and load-order overview' : 'SkyMonitor is not installed', target: 'skymonitor', logo: state.firstPartyApps.skymonitor ? '../SkyMonitor/skymonitor-logo.png' : 'skyos-logo.png', disabled: !state.firstPartyApps.skymonitor },
      { name: 'SkyCounter UI', description: state.firstPartyApps.skycounter ? 'Pickup notices with cached item artwork' : 'SkyCounter UI is not installed', target: 'skycounter', logo: state.firstPartyApps.skycounter ? '../SkyCounterUI/skycounterui-logo.png' : 'skyos-logo.png', disabled: !state.firstPartyApps.skycounter },
      { name: 'SkyCollection', description: state.firstPartyApps.skycollection ? 'A catalog of every item and place you discover' : 'SkyCollection is not installed', target: 'skycollection', logo: state.firstPartyApps.skycollection ? '../SkyCollection/skycollection-logo.png' : 'skyos-logo.png', disabled: !state.firstPartyApps.skycollection },
      { name: 'SkyAchievements', description: state.firstPartyApps.skyachievements ? 'Achievement and adventure-history records' : 'SkyAchievements is not installed', target: 'skyachievements', logo: state.firstPartyApps.skyachievements ? '../SkyAchievements/skyachievements-logo.png' : 'skyos-logo.png', disabled: !state.firstPartyApps.skyachievements },
      { name: 'SkyMissions', description: state.firstPartyApps.skymissions ? 'Character dashboard, randomized missions, and SkyStore' : 'SkyMissions is not installed', target: 'skymissions', logo: state.firstPartyApps.skymissions ? '../SkyMissions/skymissions-logo.png' : 'skyos-logo.png', disabled: !state.firstPartyApps.skymissions },
      { name: 'SkyNet', description: state.skyNetInstalled ? 'Fullscreen web browser' : 'SkyNet is not installed', target: 'skynet', logo: state.skyNetInstalled ? '../SkyNet/skynet-logo.png' : 'skyos-logo.png', disabled: state.skyNetInstalled === false }
    ];
    const linkedNativeApps = new Set();
    const builtInAppNames = new Set(['skymonitor', 'skysearch', 'skymissions', 'skyachievements']);
    for (const module of state.modules.filter((entry) => entry.manifest.showInSkyApps === true)) {
      const canonicalName = String(module.manifest.name || module.id || '').trim().toLowerCase();
      // These first-party SkyOS pages are the apps; their SkyViewer modules
      // only provide settings and must not appear as duplicate SkyApps cards.
      if (builtInAppNames.has(canonicalName) || builtInAppNames.has(String(module.id || '').toLowerCase())) continue;
      const nativeAppId = typeof module.manifest.nativeAppId === 'string' ? module.manifest.nativeAppId.trim() : '';
      const nativeApp = nativeAppId ? state.nativeApps.find((app) => app.id.toLowerCase() === nativeAppId.toLowerCase()) : null;
      if (nativeApp) linkedNativeApps.add(nativeApp.id.toLowerCase());
      apps.push({
        name: module.manifest.name || module.id,
        description: nativeApp?.available ? (module.manifest.description || (nativeApp.mode === 'internal' ? 'Opens inside SkyOS' : 'Opens a standalone app window')) : (module.manifest.description || 'Mod app module'),
        target: nativeApp?.available ? (nativeApp.mode === 'internal' ? 'web' : 'native') : 'skyview',
        moduleId: nativeApp?.available ? nativeApp.id : module.id,
        fallbackModuleId: nativeApp?.available && nativeApp.mode !== 'internal' ? module.id : '',
        logo: nativeApp?.logo || module.logo || ''
      });
    }
    for (const app of state.nativeApps) {
      if (linkedNativeApps.has(String(app.id || '').toLowerCase())) continue;
      apps.push({ name: app.name || app.id, description: app.available ? (app.description || (app.mode === 'internal' ? 'Opens inside SkyOS' : 'Standalone mod app')) : (app.mode === 'internal' ? 'Internal app is missing index.html' : 'App plugin is not loaded or lacks the SkyOS launch export'), target: app.mode === 'internal' ? 'web' : 'native', moduleId: app.id, logo: app.logo || '', disabled: !app.available });
    }
    const query = state.skyAppsQuery.trim().toLocaleLowerCase();
    const visibleApps = apps.filter((app) => !query || `${app.name} ${app.description}`.toLocaleLowerCase().includes(query));
    if (!visibleApps.length) {
      const empty = document.createElement('div'); empty.className = 'empty skyapps-empty';
      empty.textContent = query ? `No apps match “${state.skyAppsQuery.trim()}”.` : 'No apps are currently registered.';
      host.appendChild(empty);
      return;
    }
    for (const app of visibleApps) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'tile'; button.disabled = Boolean(app.disabled);
      const image = app.logo ? document.createElement('img') : document.createElement('span');
      image.className = app.logo ? 'tile-art' : 'tile-art skyrewrite-glyph'; image.alt = '';
      if (app.logo) image.src = app.logo; else image.textContent = app.glyph || '◇';
      const title = document.createElement('strong'); title.textContent = app.name;
      const subtitle = document.createElement('small'); subtitle.textContent = app.description;
      button.append(image, title, subtitle);
      button.addEventListener('click', () => SkyOS.openSkyApp(app.target, app.moduleId || '', app.fallbackModuleId || ''));
      host.appendChild(button);
    }
  }

  function collectionItemKey(item) {
    return `${item?.plugin || ''}|${item?.localFormID || item?.formID || ''}`;
  }

  function collectionLocationKey(location) {
    return location?.key || `${location?.plugin || ''}|${location?.localFormID || location?.formID || ''}`;
  }

  const collectionCategoryTree = [
    { value: 'Weapons', label: 'Weapons', icon: '⚔', children: [
      ['Weapons/Swords', 'Swords', '🗡'], ['Weapons/Greatswords', 'Greatswords', '╱'], ['Weapons/Daggers', 'Daggers', '🔪'],
      ['Weapons/Maces', 'Maces', '🔨'], ['Weapons/War Axes', 'War Axes', '🪓'], ['Weapons/Battleaxes', 'Battleaxes', '⛏'],
      ['Weapons/Warhammers', 'Warhammers', '♟'], ['Weapons/Staves', 'Staves', '⟡'], ['Weapons/Bows', 'Bows', '🏹'], ['Weapons/Crossbows', 'Crossbows', '➶'],
      ['Weapons/Ammo (Arrows)', 'Ammo (Arrows)', '➤'], ['Weapons/Other', 'Other weapons', '✦']
    ] },
    { value: 'Armors', label: 'Armors', icon: '🛡', children: [
      ['Armors/Helmets', 'Helmets', '⛑'], ['Armors/Hoods', 'Hoods', '◕'], ['Armors/Robes', 'Robes', '♜'],
      ['Armors/Outfits', 'Outfits', '♧'], ['Armors/Gauntlets', 'Gauntlets', '♧'], ['Armors/Armors', 'Armors', '▣'],
      ['Armors/Boots', 'Boots', '♢'], ['Armors/Shields', 'Shields', '⛨'], ['Armors/Rings', 'Rings', '◉'],
      ['Armors/Necklaces', 'Necklaces', '♢'], ['Armors/Amulets', 'Amulets', '◇'], ['Armors/Capes', 'Capes', '◈'],
      ['Armors/Bikinis', 'Bikinis', '◇'], ['Armors/Other', 'Other armor', '◌']
    ] },
    { value: 'Consumables', label: 'Consumables', icon: '⚗', children: [
      ['Consumables/Potions', 'Potions', '♜'], ['Consumables/Alcohol', 'Alcohol', '🍺'],
      ['Consumables/Food', 'Food', '🍖'], ['Consumables/Fishes', 'Fishes', '♧']
    ] },
    { value: 'Ingredients', label: 'Ingredients', icon: '❀' },
    { value: 'Books', label: 'Books', icon: '▤', children: [
      ['Books/Skill Books', 'Skill Books', '✎'], ['Books/Letters', 'Letters', '✉'], ['Books/Bounties', 'Bounties', '⚑'],
      ['Books/Notes', 'Notes', '☷'], ['Books/Journals', 'Journals', '▱'],
      ['Books/Maps', 'Maps', '⌖'], ['Books/Recipes', 'Recipes', '♨'], ['Books/Spell Tomes', 'Spell Tomes', '✧'], ['Books/Books', 'Other Books', '▧']
    ] },
    { value: 'Building Materials', label: 'Building Materials', icon: '⌂' },
    { value: 'Ingots', label: 'Ingots', icon: '▰' }, { value: 'Hides', label: 'Hides', icon: '▩' },
    { value: 'Pelts', label: 'Pelts', icon: '❋' }, { value: 'Ores', label: 'Ores', icon: '⬟' },
    { value: 'Gems', label: 'Gems', icon: '⬢' }, { value: 'Soul Gems', label: 'Soul Gems', icon: '◍' },
    { value: 'Keys', label: 'Keys', icon: '⚿' }, { value: 'Currency', label: 'Currency', icon: '◉' },
    { value: 'Misc', label: 'Misc', icon: '⬡' },
    { value: 'Other', label: 'Other', icon: '⁕' }, { value: 'Dragon Claws', label: 'Dragon Claws', icon: '♠' },
    { value: 'Dragon Masks', label: 'Dragon Masks', icon: '☻' }, { value: 'unique', label: 'Unique · Quest Items', icon: '✹' },
    { value: 'Locations', label: 'Locations', icon: '⌖' }
  ];

  function buildCollectionCategoryNav() {
    const nav = byId('skycollection-filters');
    if (!nav) return;
    const signature = JSON.stringify({ expanded: [...state.skycollectionExpandedCategories].sort() });
    if (nav.dataset.signature === signature) return;
    const scrollTop = nav.scrollTop;
    nav.replaceChildren();
    nav.dataset.signature = signature;
    const addButton = (host, value, label, icon, child = false, expandable = false, expanded = false) => {
      const button = document.createElement('button'); button.type = 'button';
      button.dataset.collectionFilter = value; button.classList.toggle('is-child', child);
      if (expandable) button.dataset.collectionGroup = value;
      button.setAttribute('aria-pressed', 'false');
      if (expandable) button.setAttribute('aria-expanded', String(expanded));
      const glyph = document.createElement('span'); glyph.className = 'skycollection-filter-glyph'; glyph.setAttribute('aria-hidden', 'true'); glyph.textContent = icon;
      const text = document.createElement('span'); text.textContent = label;
      button.append(glyph, text);
      if (expandable) { const indicator = document.createElement('span'); indicator.className = 'skycollection-expand-indicator'; indicator.setAttribute('aria-hidden', 'true'); indicator.textContent = expanded ? '▾' : '›'; button.appendChild(indicator); }
      host.appendChild(button);
    };
    addButton(nav, 'all', 'All Items', '◉');
    for (const group of collectionCategoryTree) {
      const section = document.createElement('div'); section.className = 'skycollection-filter-group';
      const groupChildren = group.children;
      const expandable = Array.isArray(groupChildren);
      const expanded = state.skycollectionExpandedCategories.has(group.value);
      addButton(section, group.value, group.label, group.icon, false, expandable, expanded);
      if (expandable) {
        const children = document.createElement('div'); children.className = 'skycollection-filter-children'; children.hidden = !expanded;
        for (const [value, label, icon] of groupChildren) addButton(children, value, label, icon, true);
        section.appendChild(children);
      }
      nav.appendChild(section);
    }
    nav.scrollTop = scrollTop;
  }

  function collectionFormIdLabel(item) {
    const runtimeID = String(item?.formID || '').replace(/^0x/i, '').trim();
    if (runtimeID && /[1-9A-F]/i.test(runtimeID)) return `FormID ${runtimeID.toUpperCase().padStart(8, '0')}`;
    const localID = String(item?.localFormID || '').replace(/^0x/i, '').trim();
    if (localID && /[1-9A-F]/i.test(localID)) return `Local ID ${localID.toUpperCase().padStart(8, '0')}`;
    return 'FormID unavailable';
  }

  function enableCollectionPreview(art, record, location = false) {
    art.setAttribute('role', 'button');
    art.setAttribute('tabindex', '0');
    art.setAttribute('aria-label', `View ${location ? 'location' : 'item'}: ${record.name || 'Unknown'}`);
    art.dataset.collectionPreviewType = location ? 'location' : 'item';
    art.dataset.collectionPreviewKey = location ? collectionLocationKey(record) : collectionItemKey(record);
  }

  function openCollectionPreviewForArt(art) {
    const location = art.dataset.collectionPreviewType === 'location';
    const key = art.dataset.collectionPreviewKey;
    const entries = location ? state.skycollectionDisplayLocations : state.skycollectionDisplayItems;
    const getKey = location ? collectionLocationKey : collectionItemKey;
    const index = entries.findIndex((entry) => getKey(entry) === key);
    const record = index >= 0 ? entries[index] : location
      ? state.skycollectionLocations.find((entry) => getKey(entry) === key)
      : state.skycollectionItems.find((entry) => getKey(entry) === key);
    if (record) openCollectionPreview(record, location, index >= 0 ? entries : [record], Math.max(0, index), art);
  }

  function openCollectionPreview(record, location = false, entries = [record], startIndex = 0, opener = document.activeElement) {
    document.querySelector('.skycollection-preview-backdrop')?.closePreview?.();
    const returnFocus = opener;
    const records = Array.isArray(entries) && entries.length ? entries : [record];
    let index = Math.max(0, Math.min(records.length - 1, Number(startIndex) || 0));
    const backdrop = document.createElement('div');
    backdrop.className = 'skycollection-preview-backdrop';
    backdrop.setAttribute('role', 'presentation');
    const dialog = document.createElement('section');
    dialog.className = 'skycollection-preview';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'skycollection-preview-title');
    const header = document.createElement('header');
    const title = document.createElement('h2');
    title.id = 'skycollection-preview-title';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'skycollection-preview-close';
    close.setAttribute('aria-label', 'Close preview');
    close.textContent = '×';
    header.append(title, close);
    const art = document.createElement('div');
    art.className = 'skycollection-preview-art';
    const image = document.createElement('img');
    image.decoding = 'async';
    image.loading = 'eager';
    const empty = document.createElement('span');
    const previous = document.createElement('button');
    previous.type = 'button';
    previous.className = 'skycollection-preview-arrow previous';
    previous.setAttribute('aria-label', 'Previous preview');
    previous.textContent = '‹';
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'skycollection-preview-arrow next';
    next.setAttribute('aria-label', 'Next preview');
    next.textContent = '›';
    const counter = document.createElement('span');
    counter.className = 'skycollection-preview-count';
    counter.setAttribute('aria-live', 'polite');
    art.append(image, empty, previous, next, counter);
    const detail = document.createElement('p');
    detail.className = 'skycollection-preview-detail';
    dialog.append(header, art, detail);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    document.body.classList.add('collection-preview-open');
    const updatePreview = () => {
      const current = records[index] || record;
      const name = current.name || (location ? 'Unknown location' : 'Unknown item');
      const imageSource = location ? current.image : current.icon;
      title.textContent = name;
      if (imageSource) {
        image.src = imageSource;
        image.alt = `${name} ${location ? 'screenshot' : 'image'}`;
        image.hidden = false;
        empty.hidden = true;
      } else {
        image.removeAttribute('src');
        image.alt = '';
        image.hidden = true;
        empty.textContent = location ? 'Screenshot pending' : 'No item image available';
        empty.hidden = false;
      }
      detail.textContent = location
        ? `Location · ${current.plugin || 'Unknown plugin'}`
        : `${String(current.category || 'Item').replaceAll('/', ' · ')} · ${current.plugin || 'Unknown plugin'}`;
      counter.textContent = `${index + 1} / ${records.length}`;
      const canNavigate = records.length > 1;
      previous.hidden = next.hidden = !canNavigate;
      counter.hidden = !canNavigate;
      previous.setAttribute('aria-label', `Previous preview: ${records[(index - 1 + records.length) % records.length]?.name || ''}`);
      next.setAttribute('aria-label', `Next preview: ${records[(index + 1) % records.length]?.name || ''}`);
    };
    const movePreview = (direction) => {
      if (records.length < 2) return;
      index = (index + direction + records.length) % records.length;
      updatePreview();
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') closePreview();
      else if (event.key === 'ArrowLeft') { event.preventDefault(); movePreview(-1); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); movePreview(1); }
    };
    const closePreview = () => {
      document.removeEventListener('keydown', onKeyDown);
      backdrop.remove();
      document.body.classList.remove('collection-preview-open');
      if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus();
    };
    backdrop.closePreview = closePreview;
    backdrop.addEventListener('click', (event) => { if (event.target === backdrop) closePreview(); });
    close.addEventListener('click', closePreview);
    previous.addEventListener('click', () => movePreview(-1));
    next.addEventListener('click', () => movePreview(1));
    document.addEventListener('keydown', onKeyDown);
    updatePreview();
    close.focus();
  }

  function collectionCard(item, collectible = false) {
    const card = document.createElement('article'); card.className = 'skycollection-item';
    card.dataset.collectionItemKey = collectionItemKey(item);
    if (collectible) {
      card.classList.add('skycollection-collectible');
      const rarity = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'].includes(item.rarity) ? item.rarity : (item.unique ? 'Legendary' : 'Common');
      card.classList.add(`rarity-${(state.skycollectionSettings.showRarityBadge === false ? 'Common' : rarity).toLowerCase()}`);
      card.dataset.rarity = rarity;
      if (item.unique === true) card.classList.add('is-unique');
    }
    const art = document.createElement('div'); art.className = 'skycollection-item-art';
    if (item.icon) {
      const image = document.createElement('img'); image.src = item.icon; image.alt = ''; image.loading = 'lazy'; image.decoding = 'async'; art.appendChild(image);
    } else {
      const glyph = document.createElement('span'); glyph.textContent = '◇'; art.appendChild(glyph);
      const pending = document.createElement('small'); pending.textContent = 'NO ICON YET'; art.appendChild(pending);
    }
    enableCollectionPreview(art, item);
    if (collectible) {
      const heading = document.createElement('header'); heading.className = 'skycollection-card-heading';
      const name = document.createElement('strong'); name.textContent = item.name || 'Unknown item'; heading.appendChild(name);
      if (state.skycollectionSettings.showRarityBadge !== false) { const badge = document.createElement('span'); badge.className = 'skycollection-rarity-badge'; badge.textContent = item.rarity || (item.unique ? 'Legendary' : 'Common'); heading.appendChild(badge); }
      const details = document.createElement('div'); details.className = 'skycollection-card-details';
      if (state.skycollectionSettings.showCategory !== false) {
        const category = document.createElement('span'); category.className = 'skycollection-card-category';
        const categoryParts = String(item.category || 'Item').split('/').filter(Boolean);
        category.textContent = categoryParts[0] || 'Item';
        details.appendChild(category);
        if (state.skycollectionSettings.showSubcategory !== false && categoryParts.length > 1) {
          const subcategory = document.createElement('span');
          subcategory.className = 'skycollection-card-subcategory';
          subcategory.textContent = categoryParts[categoryParts.length - 1];
          details.appendChild(subcategory);
        }
      } else if (state.skycollectionSettings.showSubcategory !== false) {
        const categoryParts = String(item.category || '').split('/').filter(Boolean);
        if (categoryParts.length > 1) {
          const subcategory = document.createElement('span');
          subcategory.className = 'skycollection-card-subcategory';
          subcategory.textContent = categoryParts[categoryParts.length - 1];
          details.appendChild(subcategory);
        }
      }
      if (state.skycollectionSettings.showItemCount !== false) { const total = document.createElement('span'); total.className = 'skycollection-found'; total.textContent = `Found ${Number(item.totalFound || 0).toLocaleString()}×`; details.appendChild(total); }
      if (state.skycollectionSettings.showPluginName !== false) { const plugin = document.createElement('small'); plugin.className = 'skycollection-card-plugin'; plugin.textContent = item.plugin || 'Unknown plugin'; details.appendChild(plugin); }
      if (state.skycollectionSettings.showFormID !== false) { const id = document.createElement('small'); id.className = 'skycollection-formid'; id.textContent = collectionFormIdLabel(item); details.appendChild(id); }
      card.append(heading, art, details); return card;
    }
    const copy = document.createElement('div'); copy.className = 'skycollection-item-copy';
    const name = document.createElement('strong'); name.textContent = item.name || 'Unknown item';
    const type = document.createElement('span'); type.textContent = item.unique ? `${item.category || 'Item'} · Unique` : (item.category || 'Item');
    const plugin = document.createElement('small'); plugin.textContent = item.plugin || 'Unknown plugin';
    const id = document.createElement('small'); id.className = 'skycollection-formid'; id.textContent = collectionFormIdLabel(item);
    const total = document.createElement('span'); total.className = 'skycollection-found'; total.textContent = `Found ${Number(item.totalFound || 0).toLocaleString()}×`;
    copy.append(name, type, plugin, id); card.append(art, copy, total); return card;
  }

  function collectionLocationCard(location) {
    const card = document.createElement('article');
    card.className = 'skycollection-item skycollection-collectible skycollection-location-card rarity-common';
    card.dataset.collectionLocationKey = collectionLocationKey(location);
    const heading = document.createElement('header'); heading.className = 'skycollection-card-heading';
    const name = document.createElement('strong'); name.textContent = location.name || 'Unknown location'; heading.appendChild(name);
    const art = document.createElement('div'); art.className = 'skycollection-item-art skycollection-location-art';
    if (location.image) {
      const image = document.createElement('img'); image.src = location.image; image.alt = `${location.name || 'Location'} screenshot`; image.loading = 'lazy'; image.decoding = 'async'; art.appendChild(image);
    } else {
      const pending = document.createElement('small'); pending.textContent = 'SCREENSHOT PENDING'; art.appendChild(pending);
    }
    enableCollectionPreview(art, location, true);
    const details = document.createElement('div'); details.className = 'skycollection-card-details';
    const category = document.createElement('span'); category.className = 'skycollection-card-category'; category.textContent = 'LOCATION'; details.appendChild(category);
    if (state.skycollectionSettings.showPluginName !== false) { const plugin = document.createElement('small'); plugin.className = 'skycollection-card-plugin'; plugin.textContent = location.plugin || 'Unknown plugin'; details.appendChild(plugin); }
    if (state.skycollectionSettings.showFormID !== false) { const id = document.createElement('small'); id.className = 'skycollection-formid'; id.textContent = collectionFormIdLabel(location); details.appendChild(id); }
    card.append(heading, art, details);
    return card;
  }

  function reconcileCollectionGrid(grid, records, keyProperty, getKey, createCard, emptyMessage) {
    if (!records.length) {
      const currentEmpty = grid.children.length === 1 && grid.firstElementChild?.dataset.collectionEmpty === 'true';
      if (currentEmpty && grid.firstElementChild.textContent === emptyMessage) return;
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.dataset.collectionEmpty = 'true';
      empty.textContent = emptyMessage;
      grid.replaceChildren(empty);
      return;
    }

    const existing = new Map();
    [...grid.children].forEach((card) => {
      const key = card.dataset[keyProperty];
      if (key) existing.set(key, card);
      else card.remove();
    });

    const desired = records.map((record) => {
      const key = getKey(record);
      let card = existing.get(key);
      const signature = JSON.stringify([record, state.skycollectionSettings]);
      if (!card || card.dataset.collectionRenderSignature !== signature) {
        const updated = createCard(record);
        updated.dataset.collectionRenderSignature = signature;
        if (card) card.replaceWith(updated);
        card = updated;
      }
      existing.delete(key);
      return card;
    });

    existing.forEach((card) => card.remove());
    desired.forEach((card, index) => {
      if (grid.children[index] !== card) grid.insertBefore(card, grid.children[index] || null);
    });
  }

  function renderSkyCollection() {
    const grid = byId('skycollection-grid');
    if (!grid || state.activePage !== 'skycollection') return;
    buildCollectionCategoryNav();
    const settings = state.skycollectionSettings;
    if (String(state.skycollectionFilter).startsWith('location:')) state.skycollectionFilter = 'Locations';
    const count = byId('skycollection-count');
    if (count) { const discoveries = state.skycollectionItems.length + state.skycollectionLocations.length; count.textContent = `${discoveries.toLocaleString()} discoveries`; count.hidden = settings.showItemCount === false; }
    const pluginPicker = byId('skycollection-plugin-filter-wrap');
    if (pluginPicker) pluginPicker.hidden = settings.showPluginFilter === false;
    const plugins = [...new Set([...state.skycollectionItems, ...state.skycollectionLocations].map((item) => item.plugin).filter(Boolean))];
    if (state.skycollectionPlugin !== 'all' && !plugins.includes(state.skycollectionPlugin)) state.skycollectionPlugin = 'all';
    renderFilterPicker('collection-plugin', getFilterPickerOptions('collection-plugin'), state.skycollectionPlugin);
    renderFilterPicker('collection-rarity', getFilterPickerOptions('collection-rarity'), state.skycollectionRarity);
    const search = state.skycollectionSearch.trim().toLocaleLowerCase();
    const recentKeys = new Set(state.skycollectionItems.slice(0, 12).map(collectionItemKey));
    document.querySelectorAll('[data-collection-filter]').forEach((button) => {
      const active = button.dataset.collectionFilter === state.skycollectionFilter;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
      if (button.dataset.collectionGroup) button.setAttribute('aria-expanded', String(state.skycollectionExpandedCategories.has(button.dataset.collectionGroup)));
    });
    const locationMode = state.skycollectionFilter === 'Locations';
    if (locationMode) {
      let locations = [...state.skycollectionLocations];
      if (state.skycollectionRarity === 'recent') locations = locations.filter((location) => state.skycollectionRecentLocations.has(collectionLocationKey(location)));
      else if (state.skycollectionRarity !== 'all') locations = [];
      if (state.skycollectionPlugin !== 'all') locations = locations.filter((location) => location.plugin === state.skycollectionPlugin);
      locations = locations.filter((location) => !search || `${location.name || ''} ${location.formID || ''} ${location.localFormID || ''} ${location.plugin || ''}`.toLocaleLowerCase().includes(search));
      locations.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
      state.skycollectionDisplayLocations = locations;
      state.skycollectionDisplayItems = [];
      const status = byId('skycollection-status');
      if (status) status.textContent = `${locations.length.toLocaleString()} locations shown · Added when you first enter a place; returning will not create another discovery.`;
      const emptyMessage = state.skycollectionLocations.length
        ? 'No discovered locations match these filters.'
        : 'Enter a location in game to discover it and capture its first-visit screenshot.';
      reconcileCollectionGrid(grid, locations, 'collectionLocationKey', collectionLocationKey, collectionLocationCard, emptyMessage);
      return;
    }
    const matches = state.skycollectionItems.filter((item) => {
      const category = String(item.category || 'Other');
      if (state.skycollectionFilter === 'unique' && item.unique !== true) return false;
      if (state.skycollectionFilter !== 'all' && state.skycollectionFilter !== 'unique' && category !== state.skycollectionFilter && !category.startsWith(`${state.skycollectionFilter}/`)) return false;
      const rarity = item.rarity || (item.unique ? 'Legendary' : 'Common');
      if (state.skycollectionRarity === 'recent' && !recentKeys.has(collectionItemKey(item))) return false;
      if (!['all', 'recent'].includes(state.skycollectionRarity) && rarity !== state.skycollectionRarity) return false;
      if (state.skycollectionPlugin !== 'all' && item.plugin !== state.skycollectionPlugin) return false;
      return !search || `${item.name || ''} ${item.formID || ''} ${item.localFormID || ''} ${item.plugin || ''} ${item.category || ''}`.toLocaleLowerCase().includes(search);
    }).sort((a, b) => {
      if (settings.sortOrder === 'most-found') return Number(b.totalFound || 0) - Number(a.totalFound || 0) || String(a.name || '').localeCompare(String(b.name || ''));
      if (settings.sortOrder === 'rarity') {
        const rank = { Common: 0, Uncommon: 1, Rare: 2, Epic: 3, Legendary: 4 };
        return (rank[b.rarity] || 0) - (rank[a.rarity] || 0) || String(a.name || '').localeCompare(String(b.name || ''));
      }
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
    state.skycollectionDisplayItems = matches;
    state.skycollectionDisplayLocations = [];
    const status = byId('skycollection-status');
    if (status) status.textContent = `${matches.length.toLocaleString()} shown · This save has its own catalog. Missing icons render automatically, one at a time, while SkyCollection is open.`;
    const emptyMessage = state.skycollectionItems.length
      ? 'No discovered items match these filters.'
      : 'Acquire items in game and they will be added here automatically.';
    reconcileCollectionGrid(grid, matches, 'collectionItemKey', collectionItemKey, (item) => collectionCard(item, true), emptyMessage);
  }

  function renderDocuments() {
    const list = byId('document-mod-list');
    const browser = byId('document-browser');
    if (!list || !browser) return;
    list.replaceChildren();
    if (!state.documents.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No mod documents found. Add files under Data/SKSE/Plugins/SkyOS/Mods/<ModName>/SkyDocuments.';
      list.appendChild(empty);
      browser.replaceChildren();
      const note = document.createElement('div'); note.className = 'empty';
      note.textContent = 'Documents from each mod will appear here. Select a mod on the left to browse its files.';
      browser.appendChild(note);
      return;
    }
    const documentsByMod = new Map();
    for (const doc of state.documents) {
      if (!documentsByMod.has(doc.mod)) documentsByMod.set(doc.mod, []);
      documentsByMod.get(doc.mod).push(doc);
    }
    const query = state.documentSearch.trim().toLocaleLowerCase();
    const mods = [...documentsByMod.keys()].sort((a, b) => a.localeCompare(b))
      .filter((mod) => !query || mod.toLocaleLowerCase().includes(query));
    if (!mods.length) {
      const empty = document.createElement('div'); empty.className = 'app-list-empty';
      empty.textContent = 'No apps match this search.';
      list.appendChild(empty);
    }
    for (const mod of mods) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'document-mod';
      button.setAttribute('aria-pressed', String(mod === state.selectedDocMod));
      const modDocuments = documentsByMod.get(mod);
      const logo = modDocuments.find((doc) => doc.logo)?.logo;
      const icon = modLogoOrGlyph(logo, 'document-mod-icon', '▤');
      const label = document.createElement('span'); label.className = 'document-mod-label'; label.textContent = mod;
      const count = document.createElement('small'); count.textContent = String(modDocuments.reduce((total, doc) => total + Number(!doc.placeholder), 0));
      button.append(icon, label, count);
      button.addEventListener('click', () => {
        state.selectedDocMod = mod;
        state.activeDocumentId = '';
        renderDocuments();
      });
      list.appendChild(button);
    }
    renderDocumentBrowser(documentsByMod);
  }

  function renderDocumentBrowser(documentsByMod = new Map()) {
    const browser = byId('document-browser');
    browser.replaceChildren();
    if (!state.selectedDocMod) {
      const empty = document.createElement('div'); empty.className = 'empty';
      empty.textContent = 'Select a mod on the left. Its document tabs will appear here; choose a document to open it.';
      browser.appendChild(empty);
      return;
    }
    const selectedDocuments = documentsByMod.get(state.selectedDocMod) || state.documents.filter((doc) => doc.mod === state.selectedDocMod);
    const docs = selectedDocuments.filter((doc) => !doc.placeholder);
    const logo = selectedDocuments.find((doc) => doc.logo)?.logo;
    const showcase = document.createElement('header'); showcase.className = 'document-mod-showcase';
    const modInfo = selectedDocuments.find((doc) => doc.logo || doc.banner);
    const banners = { SkyOS: 'skyos-header.jpg', SkyNet: 'skyos-header.jpg', SkySearch: '../SkySearch/skysearch-header.png', SkyViewer: 'skyviewer-header.jpg' };
    const banner = document.createElement('img'); banner.className = 'document-mod-banner'; banner.alt = ''; banner.loading = 'lazy'; banner.decoding = 'async'; banner.src = modInfo && modInfo.banner ? modInfo.banner : (banners[state.selectedDocMod] || 'skyos-header.jpg');
    const shade = document.createElement('div'); shade.className = 'document-mod-shade';
    const copy = document.createElement('div'); copy.className = 'document-mod-copy';
    const icon = modLogoOrGlyph((modInfo && modInfo.logo) || logo, 'document-mod-hero-logo', '▤');
    const text = document.createElement('div');
    const eyebrow = document.createElement('p'); eyebrow.className = 'eyebrow'; eyebrow.textContent = 'MOD LIBRARY · FIELD GUIDE';
    const name = document.createElement('h2'); name.textContent = state.selectedDocMod;
    const help = document.createElement('p'); help.textContent = `${docs.length} guide${docs.length === 1 ? '' : 's'} and document${docs.length === 1 ? '' : 's'} · Select a card to read`;
    text.append(eyebrow, name, help); copy.append(icon, text); showcase.append(banner, shade, copy); browser.appendChild(showcase);
    const tabs = document.createElement('nav'); tabs.className = 'document-tabs'; tabs.setAttribute('aria-label', `${state.selectedDocMod} documents`);
    for (const doc of docs) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'document-tab';
      button.classList.toggle('active', doc.id === state.activeDocumentId);
      const icon = modLogoOrGlyph(logo, 'document-tab-icon', doc.extension.toLowerCase() === '.pdf' ? '▧' : '▤');
      const label = document.createElement('span'); label.className = 'document-card-copy';
      const docName = document.createElement('strong'); docName.textContent = doc.name;
      const type = document.createElement('small'); type.textContent = `${doc.extension.toUpperCase().replace('.', '')} · ${Math.max(1, Math.ceil(doc.size / 1024))} KB`;
      label.append(docName, type);
      const open = document.createElement('b'); open.className = 'document-card-open'; open.textContent = 'OPEN →';
      button.append(icon, label, open);
      button.addEventListener('click', () => {
        state.activeDocumentId = doc.id;
        SkyOS.openDocument(doc.id);
      });
      tabs.appendChild(button);
    }
    browser.appendChild(tabs);
    if (!docs.length) {
      const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'This mod has no supported documents.';
      browser.appendChild(empty);
    }
  }

  function allModules() {
    const core = state.modules.find((module) => module.id.toLowerCase() === 'skyos') || {
      id: 'SkyOS', manifest: { name: 'SkyOS', description: 'Core SkyOS controls', icon: '✦', accent: '#dcad66', settings: [
        { id: 'openHotkey', label: 'Open SkyOS', type: 'hotkey', default: 'F11' },
        { id: 'closeHotkey', label: 'Close SkyOS', type: 'hotkey', default: 'Escape' },
        { id: 'documentsHotkey', label: 'Open SkyDocuments', type: 'hotkey', default: '' },
        { id: 'skyViewerHotkey', label: 'Open SkyViewer', type: 'hotkey', default: '' }
      ] }, page: '', values: {}
    };
    return [core, ...state.modules.filter((module) => module.id.toLowerCase() !== 'skyos')];
  }

  function hotkeyValueId(module, setting) {
    const modulePart = String(module.id).toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const settingPart = String(setting.id).toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return `hotkey-value-${modulePart}-${settingPart}`;
  }

  function syncHotkeysToNative() {
    for (const module of allModules()) {
      for (const setting of (Array.isArray(module.manifest.settings) ? module.manifest.settings : [])) {
        if (setting?.type !== 'hotkey' || typeof setting.id !== 'string') continue;
        const value = settingValue(module, setting);
        invoke('skyos_set_app_hotkey', `${module.id}\n${setting.id}\n${value == null ? '' : String(value)}`);
      }
    }
  }

  function renderModuleTabs() {
    const tabs = byId('module-tabs');
    if (!tabs) return;
    tabs.replaceChildren();
    const query = state.moduleSearch.trim().toLocaleLowerCase();
    const modules = allModules().filter((module) => !query || [module.id, module.manifest.name, module.manifest.description]
      .some((value) => String(value || '').toLocaleLowerCase().includes(query)));
    if (!modules.length) {
      const empty = document.createElement('div'); empty.className = 'app-list-empty';
      empty.textContent = 'No apps match this search.';
      tabs.appendChild(empty);
    }
    for (const module of modules) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'module-tab';
      const badgeIcon = modLogoOrGlyph(module.logo || module.manifest.logo, 'module-tab-icon', module.manifest.icon || '✦');
      const label = document.createElement('span');
      label.textContent = module.manifest.name || module.id;
      button.append(badgeIcon, label);
      if (typeof module.manifest.accent === 'string' && /^#[0-9a-f]{6}$/i.test(module.manifest.accent)) {
        button.style.setProperty('--module-accent', module.manifest.accent);
      }
      button.classList.toggle('active', module.id === state.activeModule);
      button.addEventListener('click', () => {
        state.activeModule = module.id;
        tabs.querySelectorAll('.module-tab').forEach((tab) => tab.classList.toggle('active', tab === button));
        renderModulePanel();
      });
      tabs.appendChild(button);
    }
  }

  function settingValue(module, setting) {
    const hasSavedValue = module.values && Object.prototype.hasOwnProperty.call(module.values, setting.id);
    const savedValue = hasSavedValue ? module.values[setting.id] : undefined;
    const isCoreRecoveryKey = String(module.id).toLowerCase() === 'skyos'
      && (setting.id === 'openHotkey' || setting.id === 'closeHotkey');
    if (isCoreRecoveryKey && (savedValue == null || String(savedValue).trim() === '')) return setting.default;
    return hasSavedValue ? savedValue : setting.default;
  }

  function saveSetting(module, setting, value) {
    if (setting.type === 'number') {
      value = Number(value);
      if (!Number.isFinite(value)) return settingValue(module, setting);
      if (setting.min != null) value = Math.max(Number(setting.min), value);
      if (setting.max != null) value = Math.min(Number(setting.max), value);
    }
    if (module.id.toLowerCase() === 'skymonitor' && setting.id === 'refreshInterval') {
      value = Math.max(1500, Math.min(5000, Number(value) || 2000));
    }
    module.values = module.values || {};
    if (module.id.toLowerCase() === 'skyrewrite') {
      for (const entry of (module.manifest.settings || [])) {
        if (entry.type !== 'hotkey' && !Object.prototype.hasOwnProperty.call(module.values, entry.id)) module.values[entry.id] = entry.default;
      }
    }
    module.values[setting.id] = value;
    invoke('skyos_save_module_settings', `${module.id}\n${JSON.stringify(module.values)}`);
    if (module.id.toLowerCase() === 'skyrewrite') sendSkyRewriteDashboard('settings', module.values);
    if (setting.type === 'hotkey') invoke('skyos_set_app_hotkey', `${module.id}\n${setting.id}\n${value == null ? '' : String(value)}`);
    if (module.id.toLowerCase() === 'skyos' && setting.id === 'showLaunchSplash') {
      state.launchSplashEnabled = value !== false;
      if (!state.launchSplashEnabled && state.launchSplashActive) finishLaunchSplash();
    }
    if (module.id.toLowerCase() === 'skyos' && setting.id === 'showSplash') {
      invoke('skyos_set_skynet_splash', value ? '1' : '0');
    }
    if (module.id.toLowerCase() === 'skysearch') {
      if (setting.id === 'maxResults') state.searchLimit = Math.max(1, Math.min(5000, Number(value) || 500));
      if (setting.id === 'showFormIDs') state.showFormIDs = value !== false;
      SkyOS.refreshSearch();
    }
    if (['skycollection', 'skycounterui'].includes(module.id.toLowerCase())) applySkyExperienceSettings();
    if (module.id.toLowerCase() === 'skymonitor') {
      if (setting.id === 'refreshInterval') {
        state.monitorInterval = Math.max(1500, Math.min(5000, Number(value) || 2000));
        if (state.activePage === 'skymonitor') {
          if (state.monitorTimer) window.clearInterval(state.monitorTimer);
          state.monitorTimer = window.setInterval(() => invoke('skyos_monitor_snapshot', monitorSnapshotRequestTab()), state.monitorInterval);
        }
      }
      if (setting.id === 'showPluginList') state.monitorShowPlugins = value !== false;
      if (state.monitorSnapshot) SkyOS.setMonitorSnapshot({ ...state.monitorSnapshot, plugins: [...(state.monitorSnapshot.plugins || [])] });
    }
    postSettingsToModulePage(module);
    return value;
  }

  function postSettingsToModulePage(module) {
    if (state.moduleFrame && state.activeModule === module.id && state.moduleFrame.contentWindow) {
      state.moduleFrame.contentWindow.postMessage({ type: 'skyos:settings', module: module.id, settings: module.values || {} }, '*');
    }
  }

  function renderModulePanel() {
    const panel = byId('module-panel');
    if (!panel) return;
    state.moduleFrame = null;
    panel.replaceChildren();
    if (!state.activeModule) {
      const empty = document.createElement('div'); empty.className = 'empty';
      empty.textContent = 'Select a mod on the left to open its settings.';
      panel.appendChild(empty);
      return;
    }
    const module = allModules().find((entry) => entry.id === state.activeModule);
    if (!module) return;
    const manifest = module.manifest;
    if (typeof manifest.accent === 'string' && /^#[0-9a-f]{6}$/i.test(manifest.accent)) {
      panel.style.setProperty('--module-accent', manifest.accent);
    } else {
      panel.style.removeProperty('--module-accent');
    }
    const heading = document.createElement('div');
    heading.className = 'module-heading';
    const icon = modLogoOrGlyph(module.logo || manifest.logo, 'tile-icon amber module-logo', manifest.icon || '✦');
    const title = document.createElement('div');
    const name = document.createElement('h2'); name.textContent = manifest.name || module.id;
    const description = document.createElement('p'); description.textContent = manifest.description || 'Mod settings';
    title.append(name, description); heading.append(icon, title); panel.appendChild(heading);
    if (module.page) {
      const frame = document.createElement('iframe');
      frame.className = 'module-page';
      frame.setAttribute('sandbox', 'allow-scripts');
      const page = String(module.page)
        .split('{{SKYOS_LOGO}}').join(module.logo || '')
        .split('{{SKYOS_BANNER}}').join(module.banner || '');
      frame.srcdoc = page;
      state.moduleFrame = frame;
      frame.addEventListener('load', () => postSettingsToModulePage(module));
      panel.appendChild(frame);
    }
    const hotkeySettings = Array.isArray(manifest.settings) ? manifest.settings.filter((setting) => setting && setting.type === 'hotkey') : [];
    if (hotkeySettings.length) {
      const controls = document.createElement('div'); controls.className = 'module-settings module-hotkey-settings';
      const heading = document.createElement('h3'); heading.textContent = 'Keyboard shortcuts'; controls.appendChild(heading);
      for (const setting of hotkeySettings) controls.appendChild(makeHotkeyRow(module, setting));
      const hint = document.createElement('p'); hint.id = 'capture-hint'; hint.className = 'capture-hint hidden';
      hint.textContent = 'Press a key. Hold Ctrl, Shift, or Alt first for a combination. Escape cancels, except for a Close hotkey.';
      controls.appendChild(hint);
      const note = document.createElement('p'); note.className = 'search-hint'; note.textContent = 'Use a single key or a combination such as Alt+C, Shift+D, or Ctrl+F9.';
      controls.appendChild(note); panel.appendChild(controls);
    }
    const settings = Array.isArray(manifest.settings) ? manifest.settings.filter((setting) => setting && setting.type !== 'hotkey' && (setting.requiresSkyNet !== true || state.skyNetInstalled === true)) : [];
    if (settings.length) {
      const form = document.createElement('div'); form.className = 'module-settings';
      const settingGroups = new Map();
      for (const setting of settings) {
        if (!setting || typeof setting.id !== 'string' || typeof setting.label !== 'string') continue;
        let settingHost = form;
        const groupName = typeof setting.group === 'string' ? setting.group.trim() : '';
        if (groupName) {
          if (!settingGroups.has(groupName)) {
            const group = document.createElement('section'); group.className = 'module-setting-group';
            const groupHeading = document.createElement('h3'); groupHeading.textContent = groupName;
            group.appendChild(groupHeading); form.appendChild(group); settingGroups.set(groupName, group);
          }
          settingHost = settingGroups.get(groupName);
        }
        const row = document.createElement('div'); row.className = 'module-setting';
        const main = document.createElement('div'); main.className = 'module-setting-main';
        const caption = document.createElement('span'); caption.textContent = setting.label;
        const value = settingValue(module, setting);
        let input;
        if (setting.type === 'action') {
          input = document.createElement('button'); input.type = 'button'; input.className = 'quiet-button module-action-button';
          input.textContent = setting.buttonLabel || setting.label;
          let confirmReset = false;
          let confirmTimer = 0;
          input.addEventListener('click', () => {
            
            if (setting.action !== 'resetCollection') return;
            if (!confirmReset) {
              confirmReset = true;
              input.textContent = 'Confirm reset collection';
              input.classList.add('confirming');
              confirmTimer = window.setTimeout(() => { confirmReset = false; input.textContent = setting.buttonLabel || setting.label; input.classList.remove('confirming'); }, 6000);
              return;
            }
            if (confirmTimer) window.clearTimeout(confirmTimer);
            confirmReset = false;
            invoke('skyos_skycollection_reset');
            input.textContent = setting.buttonLabel || setting.label;
            input.classList.remove('confirming');
          });
        } else if (setting.type === 'boolean') {
          input = document.createElement('input'); input.type = 'checkbox'; input.checked = Boolean(value); input.setAttribute('role', 'switch'); input.setAttribute('aria-label', setting.label); input.setAttribute('aria-checked', String(input.checked));
          const toggle = document.createElement('span'); toggle.className = 'module-toggle'; toggle.dataset.state = input.checked ? 'on' : 'off';
          const offLabel = document.createElement('span'); offLabel.className = 'module-toggle-label module-toggle-off'; offLabel.textContent = 'OFF';
          const onLabel = document.createElement('span'); onLabel.className = 'module-toggle-label module-toggle-on'; onLabel.textContent = 'ON';
          toggle.append(offLabel, input, onLabel);
          input.addEventListener('change', () => { input.setAttribute('aria-checked', String(input.checked)); toggle.dataset.state = input.checked ? 'on' : 'off'; saveSetting(module, setting, input.checked); });
          main.append(caption, toggle);
        } else if (setting.type === 'color') {
          row.classList.add('module-setting-color-row');
          input = document.createElement('div'); input.className = 'module-color-picker';
          const palette = document.createElement('div'); palette.className = 'module-color-palette'; palette.setAttribute('role', 'group'); palette.setAttribute('aria-label', `${setting.label} palette`);
          const controls = document.createElement('div'); controls.className = 'module-color-controls';
          const customLabel = document.createElement('div'); customLabel.className = 'module-color-custom';
          const customCaption = document.createElement('span'); customCaption.textContent = 'Custom color';
          const customPicker = document.createElement('input'); customPicker.type = 'color'; customPicker.setAttribute('aria-label', `Choose custom ${setting.label.toLowerCase()}`);
          const current = document.createElement('span'); current.className = 'module-color-current';
          const currentChip = document.createElement('i'); currentChip.setAttribute('aria-hidden', 'true');
          const currentValue = document.createElement('code');
          const swatches = [];
          const validColor = (candidate) => /^#[0-9a-f]{6}$/i.test(String(candidate || ''));
          const selectedColor = validColor(value) ? String(value) : (validColor(setting.default) ? String(setting.default) : '#F4D28D');
          const applyColor = (candidate, persist = true) => {
            const color = String(candidate || '');
            if (!validColor(color)) return;
            customPicker.value = color;
            currentChip.style.backgroundColor = color;
            currentValue.textContent = color.toUpperCase();
            for (const swatch of swatches) swatch.button.setAttribute('aria-pressed', String(swatch.color.toLowerCase() === color.toLowerCase()));
            if (persist) saveSetting(module, setting, color);
          };
          for (const option of (Array.isArray(setting.options) ? setting.options : [])) {
            const color = String(typeof option === 'string' ? option : option?.value ?? '');
            if (!validColor(color)) continue;
            const label = String(typeof option === 'string' ? option : option?.label ?? color);
            const swatch = document.createElement('button'); swatch.type = 'button'; swatch.className = 'module-color-swatch';
            swatch.style.setProperty('--swatch-color', color); swatch.title = `${label} · ${color}`;
            swatch.setAttribute('aria-label', `${label}, ${color}`); swatch.setAttribute('aria-pressed', 'false');
            swatch.addEventListener('click', () => applyColor(color));
            palette.appendChild(swatch); swatches.push({ button: swatch, color });
          }
          customLabel.append(customCaption, customPicker);
          customPicker.addEventListener('change', () => applyColor(customPicker.value));
          current.append(currentChip, currentValue);
          controls.append(customLabel, current);
          input.append(palette, controls);
          applyColor(selectedColor, false);
        } else if (setting.type === 'select' && Array.isArray(setting.options)) {
          input = document.createElement('div'); input.className = 'module-choice';
          const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'module-choice-trigger'; trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false');
          const selectedLabel = document.createElement('span');
          const selectedOption = setting.options.find((option) => String(typeof option === 'string' ? option : option.value) === String(value ?? setting.default ?? ''));
          selectedLabel.textContent = typeof selectedOption === 'string' ? selectedOption : String(selectedOption?.label ?? selectedOption?.value ?? 'Choose…');
          const caret = document.createElement('i'); caret.setAttribute('aria-hidden', 'true'); caret.textContent = '⌄'; trigger.append(selectedLabel, caret);
          const menu = document.createElement('div'); menu.className = 'module-choice-menu'; menu.hidden = true; menu.setAttribute('role', 'listbox'); menu.setAttribute('aria-label', setting.label);
          for (const option of setting.options) {
            const optionValue = String(typeof option === 'string' ? option : option.value ?? '');
            const optionLabel = String(typeof option === 'string' ? option : option.label ?? option.value ?? '');
            const choice = document.createElement('button'); choice.type = 'button'; choice.className = 'module-choice-option'; choice.setAttribute('role', 'option'); choice.setAttribute('aria-selected', String(optionValue === String(value ?? setting.default ?? ''))); choice.textContent = optionLabel;
            choice.addEventListener('click', () => {
              saveSetting(module, setting, optionValue);
              selectedLabel.textContent = optionLabel;
              menu.querySelectorAll('.module-choice-option').forEach((entry) => entry.setAttribute('aria-selected', String(entry === choice)));
              menu.hidden = true; trigger.setAttribute('aria-expanded', 'false');
            });
            menu.appendChild(choice);
          }
          trigger.addEventListener('click', () => {
            const opening = menu.hidden;
            document.querySelectorAll('.module-choice-menu:not([hidden])').forEach((other) => { other.hidden = true; other.parentElement.querySelector('.module-choice-trigger')?.setAttribute('aria-expanded', 'false'); });
            menu.hidden = !opening; trigger.setAttribute('aria-expanded', String(opening));
          });
          input.append(trigger, menu);
        } else if (setting.type === 'select' && Array.isArray(setting.options)) {
          input = document.createElement('select');
          for (const option of setting.options) {
            const item = document.createElement('option');
            if (typeof option === 'string') { item.value = option; item.textContent = option; }
            else { item.value = String(option.value ?? ''); item.textContent = String(option.label ?? option.value ?? ''); }
            input.appendChild(item);
          }
          input.value = value ?? setting.default ?? '';
          input.addEventListener('change', () => saveSetting(module, setting, input.value));
        } else {
          input = document.createElement('input');
          input.type = setting.type === 'number' ? 'number' : 'text';
          if (setting.type === 'number') {
            if (setting.min != null) input.min = setting.min;
            if (setting.max != null) input.max = setting.max;
            input.step = 'any';
          }
          input.value = value ?? '';
          input.addEventListener('change', () => {
            if (setting.type !== 'number') { saveSetting(module, setting, input.value); return; }
            if (input.value.trim() === '') { input.value = String(settingValue(module, setting) ?? setting.default ?? ''); return; }
            input.value = String(saveSetting(module, setting, input.value));
          });
        }
        if (setting.type !== 'boolean') main.append(caption, input);
        row.appendChild(main);
        const noteParts = [];
        if (typeof setting.description === 'string' && setting.description) noteParts.push(setting.description);
        if (setting.type === 'number' && (setting.min != null || setting.max != null)) {
          const bounds = [];
          if (setting.min != null) bounds.push(`Min: ${setting.min}`);
          if (setting.max != null) bounds.push(`Max: ${setting.max}`);
          const unit = setting.unit || setting.suffix;
          noteParts.push(`${bounds.join(' · ')}${unit ? ` ${unit}` : ''}`);
        }
        if (noteParts.length) { const note = document.createElement('small'); note.className = 'setting-description'; note.textContent = noteParts.join(' · '); row.appendChild(note); }
        settingHost.appendChild(row);
      }
      panel.appendChild(form);
    }
    if (module.id !== 'SkyOS' && !module.page && !settings.length && !hotkeySettings.length) {
      const empty = document.createElement('div'); empty.className = 'empty';
      empty.textContent = 'This module has no settings yet. Add settings to its module.json manifest.';
      panel.appendChild(empty);
    }
  }

  function makeHotkeyRow(module, setting) {
    const row = document.createElement('div'); row.className = 'hotkey-row';
    const caption = document.createElement('strong'); caption.textContent = setting.label || setting.id;
    const value = document.createElement('kbd'); value.id = hotkeyValueId(module, setting); value.textContent = String(settingValue(module, setting) || 'Unassigned');
    const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary capture-hotkey';
    button.textContent = 'Change'; button.addEventListener('click', () => SkyOS.beginHotkeyCapture(module.id, setting.id));
    const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'quiet-button reset-hotkey'; reset.textContent = 'Reset';
    reset.addEventListener('click', () => {
      const shortcut = String(setting.default || '');
      value.textContent = shortcut || 'Unassigned';
      saveSetting(module, setting, shortcut);
    });
    row.append(caption, value, button, reset);
    return row;
  }

  function renderSearchResults() {
    const host = byId('search-results');
    if (!host) return;
    host.replaceChildren();
    if (state.selectedMod) {
      const selected = document.createElement('div'); selected.className = 'selected-mod-banner';
      const back = document.createElement('button'); back.type = 'button'; back.className = 'secondary'; back.textContent = '← All mods';
      back.addEventListener('click', () => SkyOS.browseMods());
      const title = document.createElement('strong'); title.textContent = state.selectedMod;
      const hint = document.createElement('small'); hint.textContent = 'Showing matching records from this mod. Use the category filters above to narrow the list.';
      selected.append(back, title, hint); host.appendChild(selected);
    }
    if (!state.searchResults.length) {
      const empty = document.createElement('div'); empty.className = 'empty';
      empty.textContent = state.selectedMod ? 'No records from this mod match the current search and filters.' : 'No matches found in the selected loaded record categories.';
      host.appendChild(empty); return;
    }
    const module = state.modules.find((entry) => entry.id.toLowerCase() === 'skysearch');
    const itemDefault = Number(module?.values?.itemCount ?? 1);
    const spawnDefault = Number(module?.values?.spawnCount ?? 1);
    for (const result of state.searchResults) {
      const card = document.createElement('article'); card.className = 'search-result';
      const detail = document.createElement('div'); detail.className = 'search-result-info';
      const title = document.createElement('strong'); title.textContent = result.name || 'Unnamed result';
      const meta = document.createElement('small');
      meta.textContent = result.kind === 'file' ? `${result.category} · local file` : result.kind === 'mod' ? 'Installed mod · select to browse its records' : state.showFormIDs ? `${result.category} · FormID ${result.id}` : result.category;
      detail.append(title, meta); card.appendChild(detail);
      if (result.kind === 'mod') {
        const browse = document.createElement('button'); browse.type = 'button'; browse.className = 'primary'; browse.textContent = 'Browse mod records';
        browse.addEventListener('click', () => SkyOS.searchMod(result.name)); card.appendChild(browse);
      }
      if (result.category === 'Quest' && result.questDetails) {
        const questDetails = result.questDetails;
        const panel = document.createElement('details'); panel.className = 'quest-details';
        const questStatus = questDetails.completed ? 'Completed' : questDetails.running ? 'Running' : "Hasn't Started";
        const summary = document.createElement('summary'); summary.textContent = `Quest details · Stage ${questDetails.currentStage} · ${questStatus}`;
        panel.appendChild(summary);
        const goals = document.createElement('ul');
        for (const objective of questDetails.objectives || []) {
          const item = document.createElement('li'); item.textContent = `${objective.index}: ${objective.text || 'Unnamed objective'}`; goals.appendChild(item);
        }
        if (!goals.childElementCount) { const item = document.createElement('li'); item.textContent = 'No objective descriptions are available for this quest.'; goals.appendChild(item); }
        panel.appendChild(goals); card.appendChild(panel);
        const stageHint = document.createElement('small'); stageHint.className = 'quest-stage-hint'; stageHint.textContent = 'Stage entries below come from this save’s quest journal. Enter another known stage ID in the controls to request it through Papyrus.';
        panel.appendChild(stageHint);
        for (const questStage of questDetails.stages || []) {
          const row = document.createElement('div'); row.className = 'quest-stage-row';
          const description = document.createElement('span'); description.textContent = `Stage ${questStage.id}: ${questStage.text}`;
          const advance = document.createElement('button'); advance.type = 'button'; advance.className = 'secondary'; advance.textContent = 'Set stage';
          advance.addEventListener('click', () => SkyOS.searchAction('quest-stage', result.id, questStage.id));
          row.append(description, advance); panel.appendChild(row);
        }
      }
      if (result.category === 'Cell') {
        const teleport = document.createElement('button'); teleport.type = 'button'; teleport.className = 'primary'; teleport.textContent = 'Teleport to cell';
        teleport.addEventListener('click', () => SkyOS.searchAction('teleport-cell', result.id, 1));
        card.appendChild(teleport);
      }
      if (result.kind !== 'file') {
        const actions = document.createElement('div'); actions.className = 'search-result-actions';
        if (result.category === 'Quest') {
          for (const [action, label] of [['quest-start', 'Start quest'], ['quest-complete', 'Complete quest'], ['quest-reset', 'Reset quest']]) {
            const button = document.createElement('button'); button.type = 'button'; button.className = action === 'quest-complete' ? 'primary' : 'secondary'; button.textContent = label;
            button.addEventListener('click', () => SkyOS.searchAction(action, result.id, 1)); actions.appendChild(button);
          }
          const stage = document.createElement('input'); stage.type = 'number'; stage.min = '0'; stage.max = '65535'; stage.step = 'any'; stage.className = 'search-count'; stage.placeholder = 'Stage ID'; stage.setAttribute('aria-label', 'Quest stage ID');
          const stageBounds = document.createElement('small'); stageBounds.className = 'number-bounds-hint'; stageBounds.textContent = 'Min: 0 · Max: 65535';
          const setStage = document.createElement('button'); setStage.type = 'button'; setStage.className = 'secondary'; setStage.textContent = 'Set stage';
          setStage.addEventListener('click', () => { const value = Number(stage.value); if (Number.isInteger(value) && value >= 0 && value <= 65535) SkyOS.searchAction('quest-stage', result.id, value); });
          actions.append(stage, stageBounds, setStage);
        }
        if (result.actor) {
          const toNpc = document.createElement('button'); toNpc.type = 'button'; toNpc.className = 'secondary'; toNpc.textContent = 'Teleport to NPC';
          toNpc.addEventListener('click', () => SkyOS.searchAction('teleport-player', result.id, 1)); actions.appendChild(toNpc);
          const toPlayer = document.createElement('button'); toPlayer.type = 'button'; toPlayer.className = 'secondary'; toPlayer.textContent = 'Teleport NPC to player';
          toPlayer.addEventListener('click', () => SkyOS.searchAction('teleport-actor', result.id, 1)); actions.appendChild(toPlayer);
        }
        const count = document.createElement('input'); count.type = 'number'; count.min = '1'; count.step = 'any'; count.className = 'search-count'; count.setAttribute('aria-label', 'Action count');
        if (result.inventory) {
          count.max = '2140000000'; count.value = String(Math.min(2140000000, Math.max(1, Number.isFinite(itemDefault) ? itemDefault : 1)));
          const countBounds = document.createElement('small'); countBounds.className = 'number-bounds-hint'; countBounds.textContent = 'Min: 1 · Max: 2140000000';
          const add = document.createElement('button'); add.type = 'button'; add.className = 'primary'; add.textContent = 'Add to inventory';
          add.addEventListener('click', () => {
            const amount = Math.max(1, Math.min(2140000000, Math.floor(Number(count.value) || 1)));
            count.value = String(amount); SkyOS.searchAction('add', result.id, amount);
          });
          actions.append(count, countBounds, add);
        } else if (result.learn) {
          const learn = document.createElement('button'); learn.type = 'button'; learn.className = 'primary'; learn.textContent = result.category === 'Shout' ? 'Learn shout' : result.category === 'Perk' ? 'Learn perk' : 'Learn spell';
          learn.addEventListener('click', () => SkyOS.searchAction('learn', result.id, 1)); actions.appendChild(learn);
        } else if (result.spawn) {
          count.max = '100'; count.value = String(Math.min(100, Math.max(1, Number.isFinite(spawnDefault) ? spawnDefault : 1)));
          const countBounds = document.createElement('small'); countBounds.className = 'number-bounds-hint'; countBounds.textContent = 'Min: 1 · Max: 100';
          const spawn = document.createElement('button'); spawn.type = 'button'; spawn.className = 'primary'; spawn.textContent = 'Spawn here';
          spawn.addEventListener('click', () => {
            const amount = Math.max(1, Math.min(100, Math.floor(Number(count.value) || 1)));
            count.value = String(amount); SkyOS.searchAction('spawn', result.id, amount);
          });
          actions.append(count, countBounds, spawn);
          const caution = document.createElement('small'); caution.className = 'spawn-warning'; caution.textContent = 'Advised not to go higher than 1 unless you know what you’re doing.'; actions.appendChild(caution);
        }
        if (actions.childElementCount) card.appendChild(actions);
      }
      host.appendChild(card);
    }
    if (state.searchResults.length >= state.searchLimit) {
      const cap = document.createElement('div'); cap.className = 'empty';
      cap.textContent = `Showing the first ${state.searchLimit} matches. Raise Maximum results per search in SkyViewer → SkySearch settings, or narrow the category filters.`;
      host.appendChild(cap);
    }
  }

  window.addEventListener('message', (event) => {
    if (!state.moduleFrame || event.source !== state.moduleFrame.contentWindow || !event.data || event.data.type !== 'skyos:set-setting') return;
    const module = allModules().find((entry) => entry.id === state.activeModule);
    if (!module || module.id === 'SkyOS') return;
    const setting = (module.manifest.settings || []).find((entry) => entry && entry.id === event.data.id);
    if (!setting) return;
    const value = event.data.value;
    if (setting.type === 'boolean' && typeof value !== 'boolean') return;
    if (setting.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) return;
    if ((setting.type === 'text' || setting.type === 'select') && typeof value !== 'string') return;
    if (setting.type === 'select' && Array.isArray(setting.options)) {
      const options = setting.options.map((option) => typeof option === 'string' ? option : String(option.value ?? ''));
      if (!options.includes(value)) return;
    }
    saveSetting(module, setting, value);
  });

  document.querySelectorAll('.app:not(.disabled)').forEach((button) => button.addEventListener('click', () => SkyOS.openApp(button.dataset.app)));
  byId('refresh-documents').addEventListener('click', () => SkyOS.refresh(true));
  document.querySelectorAll('[data-monitor-tab]').forEach((button) => button.addEventListener('click', () => SkyOS.setMonitorTab(button.dataset.monitorTab)));
  byId('skycollection-filters').addEventListener('click', (event) => {
    const button = event.target.closest('[data-collection-filter]');
    if (!button) return;
    const group = button.dataset.collectionGroup;
    if (group) {
      if (state.skycollectionExpandedCategories.has(group)) state.skycollectionExpandedCategories.delete(group);
      else state.skycollectionExpandedCategories.add(group);
    }
    SkyOS.setSkyCollectionFilter(button.dataset.collectionFilter);
  });
  byId('skycollection-grid').addEventListener('click', (event) => {
    const art = event.target.closest('.skycollection-item-art[role="button"]');
    if (art) openCollectionPreviewForArt(art);
  });
  byId('skycollection-grid').addEventListener('keydown', (event) => {
    const art = event.target.closest('.skycollection-item-art[role="button"]');
    if (!art || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    openCollectionPreviewForArt(art);
  });
  byId('skycollection-search').addEventListener('input', (event) => { state.skycollectionSearch = event.target.value || ''; renderSkyCollection(); });
  byId('monitor-sort').addEventListener('change', () => { if (state.monitorSnapshot) SkyOS.setMonitorSnapshot({ ...state.monitorSnapshot, plugins: [...(state.monitorSnapshot.plugins || [])] }); });
  byId('monitor-profile-start').addEventListener('click', () => invoke('skyos_monitor_profile_start'));
  byId('monitor-profile-stop').addEventListener('click', () => invoke('skyos_monitor_profile_stop'));
  document.querySelectorAll('.skyrewrite-picker, .skycollection-picker').forEach((picker) => {
    const collectionPicker = picker.classList.contains('skycollection-picker');
    const ownerPrefix = collectionPicker ? 'skycollection' : 'skyrewrite';
    const name = collectionPicker ? picker.dataset.skycollectionPicker : picker.dataset.skyrewritePicker;
    const trigger = picker.querySelector(`.${ownerPrefix}-picker-trigger`);
    const popover = picker.querySelector(`.${ownerPrefix}-picker-popover`);
    const search = picker.querySelector(`.${ownerPrefix}-picker-search input`);
    trigger.addEventListener('click', () => {
      const opening = popover.hidden;
      document.querySelectorAll('.skyrewrite-picker-popover, .skycollection-picker-popover').forEach((menu) => { menu.hidden = true; menu.parentElement.querySelector('.skyrewrite-picker-trigger, .skycollection-picker-trigger')?.setAttribute('aria-expanded', 'false'); });
      popover.hidden = !opening;
      trigger.setAttribute('aria-expanded', opening ? 'true' : 'false');
      if (opening) { if (search) { search.value = ''; renderFilterPicker(name, getFilterPickerOptions(name), getFilterPickerValue(name)); search.focus(); } }
    });
    if (search) search.addEventListener('input', () => renderFilterPicker(name, getFilterPickerOptions(name), getFilterPickerValue(name)));
    picker.querySelector(`.${ownerPrefix}-picker-options`).addEventListener('click', (event) => {
      const option = event.target.closest(`.${ownerPrefix}-picker-option`);
      if (!option) return;
      if (name === 'collection-plugin') state.skycollectionPlugin = option.dataset.value;
      else if (name === 'collection-rarity') state.skycollectionRarity = option.dataset.value;
      popover.hidden = true; trigger.setAttribute('aria-expanded', 'false');
      const triggerLabel = trigger.querySelector('span');
      const chosen = getFilterPickerOptions(name).find((entry) => entry.value === option.dataset.value);
      if (triggerLabel && chosen) triggerLabel.textContent = chosen.label;
      renderSkyCollection();
    });
    if (search) search.addEventListener('keydown', (event) => { if (event.key === 'Escape') { popover.hidden = true; trigger.setAttribute('aria-expanded', 'false'); trigger.focus(); } });
  });
  document.addEventListener('click', (event) => {
    if (event.target.closest('.module-choice')) return;
    document.querySelectorAll('.module-choice-menu:not([hidden])').forEach((menu) => { menu.hidden = true; menu.parentElement.querySelector('.module-choice-trigger')?.setAttribute('aria-expanded', 'false'); });
  });
  document.addEventListener('click', (event) => {
    if (event.target.closest('.skyrewrite-picker, .skycollection-picker')) return;
    document.querySelectorAll('.skyrewrite-picker-popover:not([hidden]), .skycollection-picker-popover:not([hidden])').forEach((menu) => { menu.hidden = true; menu.parentElement.querySelector('.skyrewrite-picker-trigger, .skycollection-picker-trigger')?.setAttribute('aria-expanded', 'false'); });
  });
  byId('skyapps-search-input').addEventListener('input', (event) => { state.skyAppsQuery = event.target.value || ''; renderSkyApps(); });
  byId('module-app-search').addEventListener('input', (event) => { state.moduleSearch = event.target.value || ''; renderModuleTabs(); });
  byId('document-app-search').addEventListener('input', (event) => { state.documentSearch = event.target.value || ''; renderDocuments(); });
  byId('search-form').addEventListener('submit', (event) => { event.preventDefault(); SkyOS.search(byId('search-query').value); });
  const searchCategories = [
    ['npc', 'NPCs'], ['cell', 'Cells'], ['weapon', 'Weapons'], ['armor', 'Armor'], ['ingredient', 'Ingredients'],
    ['misc', 'Miscellaneous'], ['key', 'Keys'], ['quest', 'Quests'], ['spell', 'Spells'], ['shout', 'Shouts'],
    ['perk', 'Perks'], ['book', 'Books'], ['ammo', 'Ammunition'], ['apparatus', 'Apparatus'], ['soul gem', 'Soul gems'],
    ['scroll', 'Scrolls'], ['container', 'Containers'], ['furniture', 'Furniture'], ['light', 'Lights'], ['static', 'Statics'],
    ['activator', 'Activators'], ['flora', 'Flora'], ['tree', 'Trees'], ['mod', 'Mods']
  ];
  const filterHost = byId('search-filters');
  for (const [value, label] of searchCategories) {
    const wrapper = document.createElement('label'); wrapper.className = 'search-filter';
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = value;
    input.checked = true;
    const text = document.createElement('span'); text.textContent = label;
    wrapper.append(input, text); filterHost.appendChild(wrapper);
  }
  byId('search-select-all').addEventListener('click', () => { filterHost.querySelectorAll('input').forEach((input) => { input.checked = true; }); });
  byId('search-clear-all').addEventListener('click', () => { filterHost.querySelectorAll('input').forEach((input) => { input.checked = false; }); });
  byId('theme-choice').addEventListener('change', (event) => applyTheme(event.target.value));
  byId('font-choice').addEventListener('change', (event) => applyFont(event.target.value));
  byId('text-color-choice').addEventListener('input', (event) => applyTextColor(event.target.value));
  const palette = byId('text-color-palette');
  for (const color of textPalette) {
    const swatch = document.createElement('button'); swatch.type = 'button'; swatch.className = 'color-swatch';
    swatch.style.setProperty('--swatch-color', color); swatch.title = color; swatch.setAttribute('aria-label', `Use text color ${color}`);
    swatch.addEventListener('click', () => applyTextColor(color)); palette.appendChild(swatch);
  }
  byId('reset-text-color').addEventListener('click', () => applyTextColor(themeTextDefaults[document.documentElement.dataset.theme] || themeTextDefaults.dark));
  document.addEventListener('wheel', (event) => {
    if (document.body.classList.contains('collection-preview-open')) return;
    if (event.ctrlKey || event.shiftKey || event.deltaX !== 0 || event.deltaY === 0) return;
    if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const multiplier = 1.65;
    let step = event.deltaY;
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) step *= 16;
    else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) step *= Math.max(1, window.innerHeight * 0.8);
    step *= multiplier;
    let node = event.target instanceof Element ? event.target : null;
    while (node && node !== document.body) {
      const overflow = window.getComputedStyle(node).overflowY;
      if ((overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') && node.scrollHeight > node.clientHeight + 1) {
        const canScroll = step < 0 ? node.scrollTop > 0 : node.scrollTop + node.clientHeight < node.scrollHeight - 1;
        if (canScroll) {
          event.preventDefault();
          node.scrollTop += step;
          return;
        }
      }
      node = node.parentElement;
    }
  }, { passive: false });
  applyTheme(document.documentElement.dataset.theme || 'dark');
  applyFont(document.documentElement.dataset.font || 'main', false);
  window.addEventListener('DOMContentLoaded', () => { SkyOS.setStatus('SkyViewer ready · F11 to close'); invoke('skyos_list_skyview_modules'); });
})();




