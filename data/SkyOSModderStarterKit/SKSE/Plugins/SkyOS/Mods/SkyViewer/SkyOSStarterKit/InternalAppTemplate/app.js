'use strict';

// This file belongs to your app. Replace it with your own JavaScript.
const actionButton = document.querySelector('#action-button');
const interactionState = document.querySelector('#interaction-state');

window.SkyOSApp?.on('host-ready', (host) => {
  window.SkyOSApp.setTitle('My SkyOS App');
  window.SkyOSApp.setDescription('A self-contained app for your mod.');
  window.SkyOSApp.setActions([{ id: 'example', label: 'Example action' }]);
  window.SkyOSApp.setStatus(`Connected to SkyOS bridge v${host.bridgeVersion}`);
});

window.SkyOSApp?.on('action-clicked', ({ id }) => {
  if (id === 'example' && interactionState) interactionState.textContent = 'SkyOS action bar connected';
});

actionButton?.addEventListener('click', () => {
  if (interactionState) interactionState.textContent = 'It works — now make it yours';
  actionButton.innerHTML = 'Interaction complete <span>✓</span>';
  window.SkyOSApp?.setStatus('Example interaction complete');
});
