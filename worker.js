// Cloudmoon-InPlay Cloudflare Worker Script

export default {
  async fetch(request) {
    return handleRequest(request);
  }
};

const AD_PATTERNS = [
  "googlesyndication.com",
  "doubleclick.net",
  "googleadservices.com",
  "google-analytics.com",
  "googletagmanager.com",
  "googletagservices.com",
  "adservice.google.com",
  "pagead2.googlesyndication.com",
  "tpc.googlesyndication.com",
  "video-ad-stats.googlesyndication.com",
  "ads.google.com",
  "adssettings.google.com",
  "static.ads-twitter.com",
  "ads-api.twitter.com",
  "ads.facebook.com",
  "an.facebook.com",
  "adnxs.com",
  "advertising.com",
  "outbrain.com",
  "taboola.com",
  "criteo.com",
  "pubmatic.com",
  "rubiconproject.com",
  "openx.net",
  "adsafeprotected.com",
  "moatads.com",
  "scorecardresearch.com",
  "/ads/",
  "/ad/",
  "/advert/",
  "/advertisement/",
  "/adsense/",
  "/adserver/",
  "/analytics/",
  "prebid",
  "advertis",
  "banner",
  "popup"
];

function isAdRequest(url) {
  const urlLower = url.toLowerCase();
  return AD_PATTERNS.some((pattern) => urlLower.includes(pattern));
}

async function handleRequest(request) {
  const url = new URL(request.url);
  
  if (url.pathname === "/" || url.pathname === "") {
    return new Response(getMainHTML(), {
      headers: {
        "Content-Type": "text/html",
        "Permissions-Policy": "accelerometer=*, gyroscope=*, camera=*, microphone=*, geolocation=*, hid=*, midi=*, clipboard-read=*, clipboard-write=*, xr-spatial-tracking=*, gamepad=*"
      }
    });
  }
  
  if (url.pathname === "/manifest.json") {
    return new Response(getManifest(), {
      headers: { "Content-Type": "application/manifest+json" }
    });
  }
  
  if (url.pathname === "/sw.js") {
    return new Response(getServiceWorker(), {
      headers: {
        "Content-Type": "application/javascript",
        "Service-Worker-Allowed": "/"
      }
    });
  }
  
  if (url.pathname === "/favicon.png") {
    const iconRes = await fetch("https://ssl.gstatic.com/classroom/favicon.png");
    const iconHeaders = new Headers(iconRes.headers);
    iconHeaders.set("Cache-Control", "public, max-age=86400");
    return new Response(iconRes.body, {
      status: iconRes.status,
      headers: iconHeaders
    });
  }

  return proxyCloudMoon(request);
}

async function proxyCloudMoon(request) {
  const url = new URL(request.url);
  let targetURL;
  
  if (url.pathname.startsWith("/proxy/")) {
    const encodedURL = url.pathname.substring("/proxy/".length);
    try {
      targetURL = decodeURIComponent(encodedURL);
      if (url.search) {
        targetURL += url.search;
      }
    } catch (e) {
      return new Response("Invalid proxy URL", { status: 400 });
    }
  } else {
    targetURL = "https://web.cloudmoonapp.com" + url.pathname + url.search;
  }

  if (isAdRequest(targetURL)) {
    return new Response("", { status: 204 });
  }

  const headers = new Headers(request.headers);
  headers.set("Host", new URL(targetURL).host);
  headers.delete("cf-connecting-ip");
  headers.delete("cf-ray");
  headers.delete("x-forwarded-proto");
  headers.delete("x-real-ip");
  
  if (!headers.has("User-Agent")) {
    headers.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");
  }

  const proxyRequest = new Request(targetURL, {
    method: request.method,
    headers,
    body: request.body,
    redirect: "follow"
  });

  let response;
  try {
    response = await fetch(proxyRequest);
  } catch (error) {
    return new Response("Failed to fetch resource", { status: 502 });
  }

  const newHeaders = new Headers(response.headers);
  newHeaders.set("Access-Control-Allow-Origin", "*");
  newHeaders.set("Access-Control-Allow-Methods", "*");
  newHeaders.set("Access-Control-Allow-Headers", "*");
  newHeaders.set("Access-Control-Allow-Credentials", "true");
  newHeaders.delete("Content-Security-Policy");
  newHeaders.delete("X-Frame-Options");
  newHeaders.delete("Frame-Options");

  const contentType = response.headers.get("Content-Type") || "";
  if (contentType.includes("text/html")) {
    let html = await response.text();
    html = blockAdsInHTML(html);
    
    const injectionCode = `
<style id="cm-ad-blocker-css">
  .a-div-horizontal, .a-div-vertical, .a-div-placeholder, .a-div-box {
    display: none !important;
    visibility: hidden !important;
    opacity: 0 !important;
    pointer-events: none !important;
    position: absolute !important;
    width: 0 !important;
    height: 0 !important;
    overflow: hidden !important;
  }
</style>
<script id="cm-fix-js">
(function(){
  setTimeout(function() {
    try {
      localStorage.clear();
      sessionStorage.clear();
      document.cookie.split(";").forEach(function(c) { 
        document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/"); 
      });
    } catch(e) {}
    window.location.reload();
  }, 28 * 60 * 1000);

  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    const url = args[0];
    if (typeof url === 'string' && isAdUrl(url)) {
      return Promise.reject(new Error('Ad blocked'));
    }
    return originalFetch.apply(this, args);
  };
  
  const originalXHR = window.XMLHttpRequest.prototype.open;
  window.XMLHttpRequest.prototype.open = function(method, url) {
    if (isAdUrl(url)) return;
    return originalXHR.apply(this, arguments);
  };
  
  function isAdUrl(url) {
    const adPatterns = [
      'googlesyndication', 'doubleclick', 'googleadservices',
      'google-analytics', 'googletagmanager', 'googletagservices',
      '/ads/', '/ad/', '/advert', 'adsense', 'analytics'
    ];
    return adPatterns.some(pattern => url.toLowerCase().includes(pattern));
  }
  
  function removeAds() {
    const adDivs = document.querySelectorAll('.a-div-horizontal, .a-div-vertical, .a-div-placeholder, .a-div-box');
    adDivs.forEach(el => {
      el.style.display = 'none';
      try { el.remove(); } catch (e) {}
    });
  }
  
  function fixButtons() { 
    var allBtns = document.querySelectorAll("button.google-button, button.apple-button");
    for (var i = 0; i < allBtns.length; i++) {
      var btn = allBtns[i];
      var styleAttr = btn.getAttribute("style") || "";
      if (styleAttr.indexOf("123, 108, 196") !== -1 || styleAttr.indexOf("123,108,196") !== -1) {
        btn.style.setProperty("display", "flex", "important");
        btn.style.setProperty("visibility", "visible", "important");
        btn.style.setProperty("opacity", "1", "important");
      } else if (styleAttr.indexOf("255, 255, 255") !== -1 || styleAttr.indexOf("#fff") !== -1 || btn.querySelector("svg")) {
        btn.style.setProperty("display", "none", "important");
      }
    }
  }
  
  removeAds();
  fixButtons();
  setInterval(function() {
    fixButtons();
    removeAds();
  }, 200);

  var observer = new MutationObserver(function() {
    fixButtons();
    removeAds();
  });
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
  }

  var origOpen = window.open;
  var workerOrigin = window.location.origin;
  function sendGameUrl(url) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({type: "LOAD_GAME", url: url}, workerOrigin);
    }
  }
  window.open = function(u, t, f) {
    if (u && u.indexOf('/run-site/') > -1) {
      sendGameUrl(u);
      return { closed: false, close: function(){}, location: { href: u } };
    }
    return origOpen.call(this, u, t, f);
  };
})();
<\/script>`;

    if (html.includes("</head>")) {
      html = html.replace("</head>", injectionCode + "</head>");
    } else {
      html = injectionCode + html;
    }
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders
    });
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders
  });
}

function blockAdsInHTML(html) {
  html = html.replace(/<script[^>]*googlesyndication[^>]*>[\s\S]*?<\/script>/gi, "");
  html = html.replace(/<script[^>]*adsbygoogle[^>]*>[\s\S]*?<\/script>/gi, "");
  html = html.replace(/<script[^>]*google-analytics[^>]*>[\s\S]*?<\/script>/gi, "");
  html = html.replace(/<div[^>]*id="google_ads[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "");
  return html;
}

function getMainHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Home - Classroom</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; background: #0d1117; color: #c9d1d9; overflow: hidden; }
        #container { width: 100vw; height: 100vh; display: flex; flex-direction: column; }
        #frame-container { flex: 1; width: 100%; height: 100%; background: white; position: relative; }
        iframe { width: 100%; height: 100%; border: none; background: white; outline: none; }
        #btn-dock { position: fixed; bottom: 18px; left: 18px; display: flex; gap: 10px; z-index: 9999; }
        .dock-btn { width: 44px; height: 44px; border-radius: 50%; border: none; background: rgba(45, 45, 45, 0.85); color: #e0e0e0; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 10px rgba(0,0,0,0.4); }
        .dock-btn:hover { background: rgba(74, 74, 74, 0.95); }
    </style>
</head>
<body>
    <div id="container">
        <div id="frame-container"></div>
    </div>
    <div id="btn-dock">
        <button class="dock-btn" onclick="goBack()" title="Home">🏠</button>
        <button class="dock-btn" onclick="enterFullscreen()" title="Fullscreen">⛶</button>
    </div>
    <script>
        const frameContainer = document.getElementById('frame-container');
        let mainURL = '/web.cloudmoonapp.com/';
        let currentIframe = null;
        const SHADOW_LAYERS = 4;

        function createMultiLayerShadowFrame(url) {
            frameContainer.innerHTML = '';
            let currentHost = document.createElement('div');
            currentHost.style.width = '100%';
            currentHost.style.height = '100%';
            frameContainer.appendChild(currentHost);
            
            for (let i = 0; i < SHADOW_LAYERS; i++) {
                const shadowRoot = currentHost.attachShadow({ mode: 'closed' });
                if (i < SHADOW_LAYERS - 1) {
                    const nextHost = document.createElement('div');
                    nextHost.style.width = '100%';
                    nextHost.style.height = '100%';
                    shadowRoot.appendChild(nextHost);
                    currentHost = nextHost;
                } else {
                    const iframe = document.createElement('iframe');
                    iframe.style.width = '100%';
                    iframe.style.height = '100%';
                    iframe.style.border = 'none';
                    iframe.setAttribute('sandbox', 'allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-presentation allow-same-origin allow-scripts allow-downloads allow-pointer-lock allow-top-navigation-by-user-activation');
                    iframe.setAttribute('allow', 'accelerometer; camera; encrypted-media; geolocation; gyroscope; hid; microphone; midi; clipboard-read; clipboard-write; xr-spatial-tracking; gamepad');
                    iframe.src = url;
                    shadowRoot.appendChild(iframe);
                    currentIframe = iframe;
                }
            }
        }

        createMultiLayerShadowFrame(mainURL);

        function goBack() {
            createMultiLayerShadowFrame(mainURL);
        }

        function enterFullscreen() {
            if (document.documentElement.requestFullscreen) {
                document.documentElement.requestFullscreen();
            }
        }

        window.addEventListener('message', (event) => {
            if (event.origin !== window.location.origin) return;
            if (event.data && event.data.type === 'LOAD_GAME') {
                createMultiLayerShadowFrame(event.data.url);
            }
        });
    </script>
</body>
</html>`;
}

function getManifest() {
  return JSON.stringify({
    name: "CloudMoon",
    short_name: "CloudMoon",
    start_url: "/",
    display: "standalone",
    background_color: "#0d1117",
    theme_color: "#2d2d2d"
  });
}

function getServiceWorker() {
  return `
    self.addEventListener('install', (e) => self.skipWaiting());
    self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));
    self.addEventListener('fetch', (e) => {
      e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    });
  `;
}
