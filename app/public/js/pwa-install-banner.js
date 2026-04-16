/**
 * Bottom bar: install via beforeinstallprompt (Chromium) or short instructions (e.g. iOS Safari).
 * Dismiss state is stored in localStorage; hidden when already running as installed PWA.
 *
 * beforeinstallprompt is registered immediately (not on DOMContentLoaded) so we do not miss
 * an early event. Chrome may still omit it (Incognito, policies, first visit before SW active);
 * in that case we point users to the address bar / browser menu.
 */
(function () {
  var STORAGE_KEY = 'cyrus_pwa_install_banner_dismissed_v1';
  var deferredPrompt = null;
  var swRegisterStarted = false;

  function storageDismissed() {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch (e) {
      return false;
    }
  }
  function setDismissed() {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch (e) {}
  }

  function isStandalone() {
    try {
      if (window.matchMedia('(display-mode: standalone)').matches) return true;
      if (window.matchMedia('(display-mode: minimal-ui)').matches) return true;
    } catch (e) {}
    if (typeof navigator.standalone === 'boolean' && navigator.standalone) return true;
    return false;
  }

  function isIos() {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function isIosSafari() {
    if (!isIos()) return false;
    var ua = navigator.userAgent;
    var isChrome = /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
    return !isChrome;
  }

  function registerSw() {
    if (swRegisterStarted) return;
    swRegisterStarted = true;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function () {});
  }

  function removeBanner() {
    var el = document.getElementById('pwa-install-banner');
    if (el) el.remove();
    document.body.classList.remove('pwa-install-banner-visible');
  }

  function desktopBrowserInstallHintHtml() {
    var ua = navigator.userAgent || '';
    if (/Edg\//.test(ua)) {
      return 'Edge: use the <strong>app / install</strong> control in the address bar if you see it, or open the menu (⋯) → <strong>Apps</strong> → <strong>Install this site as an app</strong>.';
    }
    if (/OPR|Opera/i.test(ua)) {
      return 'Opera: check the address bar for an <strong>install</strong> or <strong>plus</strong> control, or use the main menu if it lists installing this site.';
    }
    if (/Firefox\//.test(ua)) {
      return 'Firefox: use the <strong>address bar</strong> or menu if your build offers <strong>Install</strong> for this site.';
    }
    if (/Chrome\//.test(ua)) {
      return 'Chrome: look at the <strong>right end of the address bar</strong> for an install / monitor icon and click it. If it is not there, open the menu (⋮) → <strong>Save and share</strong> → <strong>Install page as app…</strong> (wording can vary by version).';
    }
    return 'Use your browser’s <strong>address bar</strong> or <strong>main menu</strong> if it offers an install or “add to apps” option for this site.';
  }

  function attachChromiumInstallHandler() {
    var primary = document.getElementById('pwa-install-banner-install');
    if (!primary || isIos()) return;
    primary.onclick = function () {
      if (!deferredPrompt) return;
      var ev = deferredPrompt;
      ev.prompt();
      var choice = ev.userChoice;
      function afterChoice() {
        deferredPrompt = null;
        if (!document.getElementById('pwa-install-banner')) return;
        primary.style.display = 'none';
        var t = document.getElementById('pwa-install-banner-text');
        if (t) {
          t.innerHTML =
            '<strong>Install Cyrus</strong><br />' + desktopBrowserInstallHintHtml();
        }
      }
      if (choice && typeof choice.finally === 'function') {
        choice.finally(afterChoice);
      } else {
        afterChoice();
      }
    };
  }

  function syncChromiumInstallButton() {
    var primary = document.getElementById('pwa-install-banner-install');
    if (!primary || isIos()) return;
    if (deferredPrompt) {
      primary.style.display = '';
      primary.disabled = false;
      primary.textContent = 'Install';
      primary.classList.remove('pwa-install-banner__btn--ghost');
      attachChromiumInstallHandler();
    } else {
      primary.style.display = 'none';
      primary.disabled = true;
    }
  }

  registerSw();

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    syncChromiumInstallButton();
    var t = document.getElementById('pwa-install-banner-text');
    if (t && !isIos()) {
      t.innerHTML =
        '<strong>Install Cyrus</strong><br />Tap <strong>Install</strong> here, or use your browser’s address bar / menu if you prefer.';
    }
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    removeBanner();
  });

  function showBanner() {
    if (isStandalone() || storageDismissed()) return;

    var bar = document.createElement('aside');
    bar.id = 'pwa-install-banner';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Install app');

    var text = document.createElement('div');
    text.className = 'pwa-install-banner__text';
    text.id = 'pwa-install-banner-text';

    var actions = document.createElement('div');
    actions.className = 'pwa-install-banner__actions';

    var primary = document.createElement('button');
    primary.type = 'button';
    primary.className = 'pwa-install-banner__btn';
    primary.id = 'pwa-install-banner-install';

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'pwa-install-banner__close';
    close.setAttribute('aria-label', 'Dismiss');
    close.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>';

    function applyCopy() {
      if (isIos()) {
        if (isIosSafari()) {
          text.innerHTML =
            '<strong>Add Cyrus to your Home Screen</strong><br />Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.';
        } else {
          text.innerHTML =
            '<strong>Add Cyrus to your Home Screen</strong><br />Use your browser’s menu and choose <strong>Add to Home Screen</strong>, or open in Safari and use Share → Add to Home Screen.';
        }
        primary.textContent = 'Got it';
        primary.style.display = '';
        primary.disabled = false;
        primary.classList.remove('pwa-install-banner__btn--ghost');
        primary.onclick = function () {
          setDismissed();
          removeBanner();
        };
        return;
      }

      var hint = desktopBrowserInstallHintHtml();
      if (deferredPrompt) {
        text.innerHTML =
          '<strong>Install Cyrus</strong><br />Tap <strong>Install</strong> here, or use your browser’s address bar / menu if you prefer.';
      } else {
        text.innerHTML =
          '<strong>Install Cyrus</strong><br />' +
          hint +
          ' If an <strong>Install</strong> button appears here after a moment, you can use that too. <span style="opacity:0.85">First visit? Try <strong>reload</strong> once the site has finished loading.</span>';
      }
      primary.textContent = 'Install';
      primary.classList.remove('pwa-install-banner__btn--ghost');
      if (deferredPrompt) {
        primary.style.display = '';
        primary.disabled = false;
        attachChromiumInstallHandler();
      } else {
        primary.style.display = 'none';
        primary.disabled = true;
      }
    }

    close.onclick = function () {
      setDismissed();
      removeBanner();
    };

    actions.appendChild(primary);
    actions.appendChild(close);
    bar.appendChild(text);
    bar.appendChild(actions);
    document.body.appendChild(bar);
    bar.dataset.visible = '1';
    document.body.classList.add('pwa-install-banner-visible');

    applyCopy();
    syncChromiumInstallButton();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showBanner);
  } else {
    showBanner();
  }
})();
