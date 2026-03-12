/**
 * Chato Voice Agent — Injection script for conversational voice AI
 *
 * Usage (voice-only — widget mode):
 *   <script src="https://your-host/assets/modules/channel-web/voice-inject.js"></script>
 *   <script>
 *     window.chatoVoiceAgent.init({
 *       host: "https://your-host",
 *       botId: "your-bot-id",
 *       userId: { id: "123", firstName: "John", lastName: "Doe", email: "john@example.com" },
 *       dynamicVariables: { plan: "premium", company: "Acme" }
 *     });
 *   </script>
 *
 * Usage (3D avatar mode — same script, one extra flag):
 *   <script src="https://your-host/assets/modules/channel-web/voice-inject.js"></script>
 *   <script>
 *     window.chatoVoiceAgent.init({
 *       host: "https://your-host",
 *       botId: "your-bot-id",
 *       avatar3dEnabled: true,
 *       avatar3dModelUrl: "/assets/modules/channel-web/models/avatar.glb",
 *       avatar3dCameraView: "upper" // full | mid | upper | head
 *     });
 *   </script>
 *
 * When avatar3dEnabled is true, the voice widget is hidden and a 3D avatar
 * with lip-sync replaces it. All voice API traffic is still proxied.
 */
;(function () {
  'use strict'

  // Prevent double execution if script is loaded twice
  if (window.__chatoVoiceInjected) return
  window.__chatoVoiceInjected = true

  // ── Configuration ──────────────────────────────────────────────────
  var WIDGET_SCRIPT_PATH = '/assets/modules/channel-web/convai-widget.js'
  var WIDGET_TAG_NAME = 'chato-voice-agent'

  // Upstream domains that must be intercepted and proxied
  var INTERCEPT_DOMAINS = [
    'api.elevenlabs.io',
    'api.us.elevenlabs.io',
    'livekit.rtc.elevenlabs.io',
    'elevenlabs.io'
  ]

  // 3D avatar asset paths (relative to host)
  var TALKINGHEAD_BASE = '/assets/modules/channel-web/talkinghead/'
  var TALKINGHEAD_MODULE = TALKINGHEAD_BASE + 'talkinghead.mjs'
  var HEADAUDIO_MODULE = TALKINGHEAD_BASE + 'headaudio.mjs'
  var HEADWORKLET_MODULE = TALKINGHEAD_BASE + 'headworklet.mjs'
  var HEADAUDIO_MODEL = TALKINGHEAD_BASE + 'model-en-mixed.bin'
  var CSS_3D_PATH = '/assets/modules/channel-web/talking-head.css'
  var THREE_VERSION = '0.180.0'
  var THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@' + THREE_VERSION

  // ── State (voice) ─────────────────────────────────────────────────
  var _host = ''
  var _rootPath = ''
  var _botId = ''
  var _customCssUrl = ''
  var _dynamicVariables = null
  var _interceptsInstalled = false
  var _initialized = false
  var _origFetch = null
  var _origWebSocket = null
  var _origXHROpen = null
  var _widgetConfig = null
  var _widgetScriptLoaded = false
  var _pendingConfigXhr = null

  // ── State (3D avatar) ─────────────────────────────────────────────
  var _3dActive = false           // Whether 3D mode is currently active
  var _3dCallActive = false
  var _3dContainerEl = null
  var _3dStatusEl = null
  var _3dCallBtnEl = null
  var _3dMinimizedEl = null
  var _3dIsMinimized = false
  var _3dSpeakingListener = null
  var _3dCallEndedListener = null

  // Audio intercepts (installed once, never stacked)
  var _audioInterceptsInstalled = false
  var _capturedRemoteStreams = []
  var _capturedAudioElements = []
  var _capturedWebRTCStreams = []
  var _pendingBridgeNodes = []
  var _pendingStreams = []
  var _connectedStreams = new WeakSet()
  var _connectedElements = new WeakSet()
  var _OrigRTCPeerConnection = window.RTCPeerConnection

  // 3D module loading (once flags — never re-inject scripts)
  var _shimLoaded = false
  var _importmapAdded = false
  var _3dReadyListenerAdded = false

  // MutationObservers to disconnect on destroy
  var _3dBodyObserver = null
  var _3dAudioElementObserver = null
  var _3dShadowObserver = null
  var _3dWidgetPollInterval = null

  // ── Auto-cleanup on page unload ────────────────────────────────────
  window.addEventListener('beforeunload', function () {
    if (_initialized) _destroyVoice()
  })

  // ── Public API ─────────────────────────────────────────────────────
  window.chatoVoiceAgent = {
    init: function (config) {
      if (!config || !config.host) {
        _log('error', 'host is required')
        return
      }

      var newBotId = config.botId || config.agentId || ''

      // Auto-cleanup: if already initialized with a DIFFERENT bot, destroy first
      if (_initialized && newBotId !== _botId) {
        _destroyVoice()
      }

      // Already initialized with the same bot — no-op
      if (_initialized) return

      _host = config.host.replace(/\/$/, '')
      _botId = newBotId

      // Extract root path from host for proxy URL construction
      try {
        var url = new URL(_host)
        _rootPath = url.pathname.replace(/\/$/, '')
      } catch (e) {
        _rootPath = ''
      }

      if (config.customCssUrl) {
        _customCssUrl = config.customCssUrl
      }

      // Build dynamic variables from userId and/or explicit dynamicVariables
      _dynamicVariables = _buildDynamicVariables(config)

      // Send dynamic variables to backend for server-side injection
      if (_dynamicVariables && config.botId) {
        _sendDynamicVarsToBackend()
      }

      _initialized = true

      // Direct mode: agentId provided in config
      if (config.agentId) {
        if (config.avatar3dEnabled && config.avatar3dModelUrl) {
          _start3DAvatar(config)
        } else {
          _startWidget({
            agentId: config.agentId,
            avatarUrl: config.avatarUrl || null,
            size: config.size || 'compact'
          })
        }
        return
      }

      // Backend mode: fetch config securely
      if (!config.botId) {
        _log('error', 'Either agentId or botId is required')
        return
      }
      _fetchVoiceConfig(config)
    },

    destroy: function () {
      _destroyVoice()
    }
  }

  // ── Internal destroy ────────────────────────────────────────────────
  function _destroyVoice() {
    if (!_initialized) return

    // Abort any in-flight config XHR
    if (_pendingConfigXhr) {
      try { _pendingConfigXhr.abort() } catch (e) {}
      _pendingConfigXhr = null
    }

    // ── 3D avatar cleanup ──────────────────────────────────────────
    if (_3dActive) {
      // End active call
      if (_3dCallActive) {
        try { _3dEndCall() } catch (e) {}
      }

      // Dispose TalkingHead + HeadAudio
      var head = window.__chato3dHead
      var headaudio = window.__chato3dHeadAudio
      if (headaudio) {
        try { headaudio.disconnect() } catch (e) {}
      }
      if (head) {
        try { head.stop() } catch (e) {}
        try {
          if (head.audioCtx && head.audioCtx.state !== 'closed') {
            head.audioCtx.close()
          }
        } catch (e) {}
      }
      window.__chato3dHead = null
      window.__chato3dHeadAudio = null

      // Remove 3D DOM elements
      if (_3dContainerEl && _3dContainerEl.parentNode) {
        _3dContainerEl.parentNode.removeChild(_3dContainerEl)
      }
      if (_3dMinimizedEl && _3dMinimizedEl.parentNode) {
        _3dMinimizedEl.parentNode.removeChild(_3dMinimizedEl)
      }

      // Remove 3D CSS
      var css = document.querySelector('link[href*="talking-head.css"]')
      if (css) css.remove()

      // Disconnect MutationObservers
      if (_3dBodyObserver) { _3dBodyObserver.disconnect(); _3dBodyObserver = null }
      if (_3dAudioElementObserver) { _3dAudioElementObserver.disconnect(); _3dAudioElementObserver = null }
      if (_3dShadowObserver) { _3dShadowObserver.disconnect(); _3dShadowObserver = null }
      if (_3dWidgetPollInterval) { clearInterval(_3dWidgetPollInterval); _3dWidgetPollInterval = null }

      // Remove event listeners
      if (_3dSpeakingListener) {
        window.removeEventListener('chato3d:speaking', _3dSpeakingListener)
        _3dSpeakingListener = null
      }
      if (_3dCallEndedListener) {
        window.removeEventListener('chato3d:callended', _3dCallEndedListener)
        _3dCallEndedListener = null
      }

      // Clear captured streams/elements
      _capturedRemoteStreams = []
      _capturedAudioElements = []
      _capturedWebRTCStreams = []
      _pendingStreams = []
      _pendingBridgeNodes = []
      _connectedStreams = new WeakSet()
      _connectedElements = new WeakSet()

      // Reset 3D state
      _3dContainerEl = null
      _3dStatusEl = null
      _3dCallBtnEl = null
      _3dMinimizedEl = null
      _3dIsMinimized = false
      _3dCallActive = false
      _3dActive = false
    }

    // ── Voice widget cleanup ───────────────────────────────────────
    var widgetWrapper = document.getElementById('chato-voice-widget-wrapper')
    if (widgetWrapper) widgetWrapper.remove()
    var widget = document.querySelector(WIDGET_TAG_NAME)
    if (widget) widget.remove()

    // Restore native fetch/WebSocket/XHR if we intercepted them
    if (_interceptsInstalled) {
      if (_origFetch) window.fetch = _origFetch
      if (_origWebSocket) window.WebSocket = _origWebSocket
      if (_origXHROpen) XMLHttpRequest.prototype.open = _origXHROpen
      _interceptsInstalled = false
    }

    // Reset voice state
    _origFetch = null
    _origWebSocket = null
    _origXHROpen = null
    _widgetConfig = null
    _widgetScriptLoaded = false
    _host = ''
    _rootPath = ''
    _botId = ''
    _customCssUrl = ''
    _dynamicVariables = null
    _initialized = false
  }

  // ── Logging ────────────────────────────────────────────────────────
  function _log(level, message) {
    var prefix = '[ChatoVoice] '
    if (level === 'error') {
      console.error(prefix + message)
    } else {
      console.log(prefix + message)
    }
  }

  // ── Build dynamic variables from config ─────────────────────────────
  function _buildDynamicVariables(config) {
    var vars = {}
    var hasVars = false

    if (config.userId && typeof config.userId === 'object') {
      var u = config.userId
      if (u.id)        { vars.user_id = String(u.id);       hasVars = true }
      if (u.firstName) { vars.first_name = String(u.firstName); hasVars = true }
      if (u.lastName)  { vars.last_name = String(u.lastName);  hasVars = true }
      if (u.email)     { vars.email = String(u.email);      hasVars = true }

      for (var key in u) {
        if (u.hasOwnProperty(key) && key !== 'id' && key !== 'firstName' && key !== 'lastName' && key !== 'email') {
          vars[key] = String(u[key])
          hasVars = true
        }
      }
    }

    if (config.dynamicVariables && typeof config.dynamicVariables === 'object') {
      for (var k in config.dynamicVariables) {
        if (config.dynamicVariables.hasOwnProperty(k)) {
          vars[k] = String(config.dynamicVariables[k])
          hasVars = true
        }
      }
    }

    return hasVars ? vars : null
  }

  // ── Send dynamic variables to backend ──────────────────────────────
  function _sendDynamicVarsToBackend() {
    var url = _host + '/api/v1/bots/' + _botId + '/mod/channel-web/voiceDynamicVars'
    var xhr = new XMLHttpRequest()
    xhr.open('POST', url, true)
    xhr.setRequestHeader('Content-Type', 'application/json')
    xhr.send(JSON.stringify({ dynamicVariables: _dynamicVariables }))
  }

  // ── Fetch voice config from backend ────────────────────────────────
  // Extended to detect avatar3dEnabled from backend config and merge
  // with client-side overrides.
  function _fetchVoiceConfig(clientConfig) {
    // Abort any in-flight config request
    if (_pendingConfigXhr) {
      try { _pendingConfigXhr.abort() } catch (e) {}
      _pendingConfigXhr = null
    }

    var url = _host + '/api/v1/bots/' + _botId + '/mod/channel-web/voiceConfig'

    var xhr = new XMLHttpRequest()
    _pendingConfigXhr = xhr
    xhr.open('GET', url, true)
    xhr.setRequestHeader('Accept', 'application/json')

    xhr.onload = function () {
      _pendingConfigXhr = null

      // Guard: if destroyed while XHR was in flight, do nothing
      if (!_initialized) return

      if (xhr.status !== 200) {
        _log('error', 'Voice agent not configured (HTTP ' + xhr.status + ')')
        return
      }

      try {
        var voiceConfig = JSON.parse(xhr.responseText)
        if (!voiceConfig.agentId) {
          _log('error', 'Invalid voice config received')
          return
        }

        // Merge backend config with client overrides for 3D avatar
        var avatar3dEnabled = clientConfig.avatar3dEnabled !== undefined
          ? clientConfig.avatar3dEnabled
          : voiceConfig.avatar3dEnabled
        var avatar3dModelUrl = clientConfig.avatar3dModelUrl || voiceConfig.avatar3dModelUrl
        var avatar3dCameraView = clientConfig.avatar3dCameraView || voiceConfig.avatar3dCameraView || 'upper'

        if (avatar3dEnabled && avatar3dModelUrl) {
          // Guard: if 3D is already active (e.g. double init race), skip
          if (_3dActive) return

          _start3DAvatar({
            host: clientConfig.host,
            botId: clientConfig.botId,
            userId: clientConfig.userId,
            dynamicVariables: clientConfig.dynamicVariables,
            customCssUrl: clientConfig.customCssUrl,
            agentId: voiceConfig.agentId,
            avatarUrl: voiceConfig.avatarUrl,
            size: voiceConfig.size,
            avatar3dEnabled: true,
            avatar3dModelUrl: avatar3dModelUrl,
            avatar3dCameraView: avatar3dCameraView
          })
        } else {
          _startWidget(voiceConfig)
        }
      } catch (e) {
        _log('error', 'Failed to parse voice config: ' + e)
      }
    }

    xhr.onerror = function () {
      _pendingConfigXhr = null
      _log('error', 'Network error fetching voice config')
    }

    xhr.send()
  }

  // ── URL rewriting helpers ──────────────────────────────────────────
  function _isUpstreamUrl(url) {
    if (typeof url !== 'string') return false
    for (var i = 0; i < INTERCEPT_DOMAINS.length; i++) {
      if (url.indexOf(INTERCEPT_DOMAINS[i]) !== -1) return true
    }
    return false
  }

  function _getProxyBase() {
    var bid = _botId || '_'
    return _host + '/api/v1/bots/' + bid + '/mod/channel-web/voiceProxy'
  }

  function _rewriteHttpUrl(url) {
    if (typeof url !== 'string') return url
    var proxyBase = _getProxyBase()
    url = url.replace(/https?:\/\/api\.us\.elevenlabs\.io/g, proxyBase)
    url = url.replace(/https?:\/\/api\.elevenlabs\.io/g, proxyBase)
    url = url.replace(/https?:\/\/elevenlabs\.io\/[^\s"']*/g, '#')
    return url
  }

  function _rewriteWsUrl(url) {
    if (typeof url !== 'string') return url
    var wsHost = _host.replace(/^http/, 'ws')
    url = url.replace(/wss?:\/\/livekit\.rtc\.elevenlabs\.io/g, wsHost + _rootPath + '/voice-lk')
    url = url.replace(/wss?:\/\/api\.us\.elevenlabs\.io/g, wsHost + _rootPath + '/voice-ws-us')
    url = url.replace(/wss?:\/\/api\.elevenlabs\.io/g, wsHost + _rootPath + '/voice-ws')
    return url
  }

  // ── Install network intercepts (fetch/WS/XHR) ─────────────────────
  function _installIntercepts() {
    if (_interceptsInstalled) return
    _interceptsInstalled = true

    _origFetch = window.fetch
    window.fetch = function (input, init) {
      if (typeof input === 'string' && _isUpstreamUrl(input)) {
        input = _rewriteHttpUrl(input)
      } else if (input && typeof input === 'object' && input.url && _isUpstreamUrl(input.url)) {
        input = new Request(_rewriteHttpUrl(input.url), input)
      }
      return _origFetch.call(this, input, init)
    }

    _origWebSocket = window.WebSocket
    var ProxiedWebSocket = function (url, protocols) {
      if (_isUpstreamUrl(url)) {
        url = _rewriteWsUrl(url)
      }
      if (protocols !== undefined) {
        return new _origWebSocket(url, protocols)
      }
      return new _origWebSocket(url)
    }
    ProxiedWebSocket.prototype = _origWebSocket.prototype
    ProxiedWebSocket.CONNECTING = _origWebSocket.CONNECTING
    ProxiedWebSocket.OPEN = _origWebSocket.OPEN
    ProxiedWebSocket.CLOSING = _origWebSocket.CLOSING
    ProxiedWebSocket.CLOSED = _origWebSocket.CLOSED
    window.WebSocket = ProxiedWebSocket

    _origXHROpen = XMLHttpRequest.prototype.open
    XMLHttpRequest.prototype.open = function (method, url) {
      if (_isUpstreamUrl(url)) {
        url = _rewriteHttpUrl(url)
      }
      return _origXHROpen.apply(this, arguments)
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // ██  VOICE-ONLY MODE (widget)
  // ═══════════════════════════════════════════════════════════════════

  function _startWidget(config) {
    _widgetConfig = config

    window.__CHATO_VOICE_WIDGET_TAG_NAME__ = WIDGET_TAG_NAME
    _installIntercepts()

    if (_widgetScriptLoaded) {
      _renderWidget(config)
      return
    }

    var script = document.createElement('script')
    script.src = _host + WIDGET_SCRIPT_PATH
    script.async = true

    script.onload = function () {
      _widgetScriptLoaded = true
      _renderWidget(config)
    }

    script.onerror = function () {
      _log('error', 'Failed to load voice widget script')
    }

    document.head.appendChild(script)
  }

  function _renderWidget(config) {
    var existing = document.querySelector(WIDGET_TAG_NAME)
    if (existing) {
      // In 3D mode the widget lives inside a wrapper div — remove that too
      var existingWrapper = document.getElementById('chato-voice-widget-wrapper')
      if (existingWrapper) {
        existingWrapper.remove()
      } else {
        existing.remove()
      }
    }

    var widget = document.createElement(WIDGET_TAG_NAME)
    widget.setAttribute('agent-id', config.agentId)

    if (config.avatarUrl) {
      widget.setAttribute('avatar-image-url', config.avatarUrl)
    }

    if (_dynamicVariables) {
      try {
        widget.setAttribute('dynamic-variables', JSON.stringify(_dynamicVariables))
      } catch (e) {
        _log('error', 'Failed to serialize dynamic variables')
      }
    }

    if (_3dActive) {
      // In 3D mode: widget must stay functional (audio, WebRTC, button clicks)
      // but invisible. We use a wrapping div with containment so the widget's
      // fixed-position shadow DOM children cannot escape.

      // Pre-accept terms: The widget has an internal terms-acceptance gate that
      // blocks startSession until the user clicks "Accept" in a terms dialog.
      // Since the widget is hidden in 3D mode, the user can never see or click
      // that dialog. We set our own terms-key attribute + localStorage entry so
      // the widget initializes with terms already accepted.
      var TERMS_KEY = '__chato_3d_terms_accepted'
      try { localStorage.setItem(TERMS_KEY, 'true') } catch (e) {
        _log('error', 'Failed to set terms key in localStorage: ' + e)
      }
      widget.setAttribute('terms-key', TERMS_KEY)

      var wrapper = document.createElement('div')
      wrapper.id = 'chato-voice-widget-wrapper'
      wrapper.style.cssText = 'position:fixed;right:0;bottom:0;width:400px;height:600px;overflow:hidden;contain:layout paint;opacity:0.001;pointer-events:none;z-index:-1;'
      wrapper.appendChild(widget)

      if (document.body) {
        document.body.appendChild(wrapper)
      } else {
        document.addEventListener('DOMContentLoaded', function () {
          document.body.appendChild(wrapper)
        })
      }
      // Don't call _customizeAndReveal — widget must stay hidden
    } else {
      widget.style.opacity = '0'
      widget.style.transition = 'opacity 0.3s ease'

      if (document.body) {
        document.body.appendChild(widget)
      } else {
        document.addEventListener('DOMContentLoaded', function () {
          document.body.appendChild(widget)
        })
      }

      _customizeAndReveal(widget)
    }
  }

  function _customizeAndReveal(widget) {
    var applied = false
    var attempts = 0
    var maxAttempts = 30

    var poll = setInterval(function () {
      attempts++
      if (applied || attempts > maxAttempts) {
        clearInterval(poll)
        setTimeout(function () { widget.style.opacity = '1' }, 300)
        return
      }

      var shadow = widget.shadowRoot
      if (!shadow) return
      if (!shadow.querySelector('button') && !shadow.querySelector('div')) return

      _removeBranding(shadow)
      _injectCustomCss(shadow)
      _watchForCallEnd(widget, shadow)

      setTimeout(function () { widget.style.opacity = '1' }, 300)
      applied = true
      clearInterval(poll)
    }, 500)
  }

  function _watchForCallEnd(widget, shadow) {
    var callActive = false
    var observer = new MutationObserver(function () {
      var wrapper = shadow.querySelector('[class*="_wrapper_"]')
      if (!wrapper) return

      var hasShow = wrapper.className.indexOf('_show_') !== -1 ||
                    wrapper.className.indexOf('_open_') !== -1
      var btn = shadow.querySelector('[class*="_btn_"]:not([class*="_btnIcon_"]):not([class*="_iconBtn_"]):not([class*="_secondary_"]):not([class*="_disabled_"])')
      var status = shadow.querySelector('[class*="_status_"]')

      if (hasShow && !btn) callActive = true

      if (callActive && !btn && !status) {
        var box = shadow.querySelector('[class*="_box_"]')
        if (box && box.offsetHeight < 80) {
          callActive = false
          observer.disconnect()
          setTimeout(function () {
            if (_widgetConfig) _renderWidget(_widgetConfig)
          }, 500)
        }
      }
    })
    observer.observe(shadow, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
  }

  function _removeBranding(shadow) {
    var allElements = shadow.querySelectorAll('*')
    for (var i = allElements.length - 1; i >= 0; i--) {
      var el = allElements[i]
      var cls = el.className || ''
      var text = (el.textContent || '').trim()
      if (typeof cls === 'string' && /powered|terms/i.test(cls)) { el.remove(); continue }
      if (text === 'Powered by' || /^Powered by\s/i.test(text)) { el.remove() }
    }
    var feedback = shadow.querySelectorAll('[class*="feedback"]')
    for (var j = 0; j < feedback.length; j++) { feedback[j].style.display = 'none' }
  }

  function _injectCustomCss(shadow) {
    if (!_customCssUrl) return
    var link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = _customCssUrl
    shadow.appendChild(link)
  }

  // ═══════════════════════════════════════════════════════════════════
  // ██  3D AVATAR MODE
  // ═══════════════════════════════════════════════════════════════════

  function _start3DAvatar(config) {
    if (_3dActive) return // Already running — prevent double init
    _3dActive = true

    // Install audio intercepts ONCE (prototype patches survive destroy)
    _installAudioIntercepts()

    // Install network intercepts for proxy
    _installIntercepts()

    // Load 3D CSS
    var link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = _host + CSS_3D_PATH
    document.head.appendChild(link)

    // Create 3D UI container
    _3dCreateContainer()

    // Initialize voice widget hidden (for audio backend)
    _3dInitVoiceHidden(config)

    // Load TalkingHead via ES modules
    _3dLoadTalkingHead(config)
  }

  // ── Audio intercepts (installed ONCE, never stacked) ───────────────
  function _installAudioIntercepts() {
    if (_audioInterceptsInstalled) return
    _audioInterceptsInstalled = true

    // Layer 1: HTMLMediaElement.prototype.play
    var _origPlay = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function () {
      if (this.srcObject && this.srcObject instanceof MediaStream) {
        var stream = this.srcObject
        if (stream.getAudioTracks().length > 0) {
          _capturedRemoteStreams.push(stream)
          _3dTryConnectStream(stream)
        }
      }
      return _origPlay.apply(this, arguments)
    }

    // Layer 2: srcObject setter
    var _origSrcObjectDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'srcObject')
    if (_origSrcObjectDesc && _origSrcObjectDesc.set) {
      Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
        get: _origSrcObjectDesc.get,
        set: function (stream) {
          if (stream && stream instanceof MediaStream && stream.getAudioTracks().length > 0) {
            _capturedRemoteStreams.push(stream)
            _3dTryConnectStream(stream)
          }
          return _origSrcObjectDesc.set.call(this, stream)
        },
        configurable: true,
        enumerable: true
      })
    }

    // Layer 3: RTCPeerConnection
    if (_OrigRTCPeerConnection) {
      window.RTCPeerConnection = function () {
        var pc = new (Function.prototype.bind.apply(_OrigRTCPeerConnection, [null].concat(Array.prototype.slice.call(arguments))))()

        pc.addEventListener('track', function (ev) {
          if (ev.track && ev.track.kind === 'audio') {
            ev.track.addEventListener('ended', function () {
              window.dispatchEvent(new CustomEvent('chato3d:callended'))
            })
            if (ev.streams && ev.streams.length > 0) {
              for (var i = 0; i < ev.streams.length; i++) {
                _capturedWebRTCStreams.push(ev.streams[i])
                _3dTryConnectStream(ev.streams[i])
              }
            } else {
              var newStream = new MediaStream([ev.track])
              _capturedWebRTCStreams.push(newStream)
              _3dTryConnectStream(newStream)
            }
          }
        })

        pc.addEventListener('connectionstatechange', function () {
          if (pc.connectionState === 'closed' || pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            window.dispatchEvent(new CustomEvent('chato3d:callended'))
          }
        })

        return pc
      }
      window.RTCPeerConnection.prototype = _OrigRTCPeerConnection.prototype
      try { window.RTCPeerConnection.generateCertificate = _OrigRTCPeerConnection.generateCertificate } catch (e) {}
    }

    // Layer 4: AudioNode.prototype.connect
    var _origConnect = AudioNode.prototype.connect
    AudioNode.prototype.__chato3dOrigConnect = _origConnect
    var _bridgedNodes = new WeakSet()

    AudioNode.prototype.connect = function (destination) {
      var result = _origConnect.apply(this, arguments)
      if (destination instanceof AudioDestinationNode && !_bridgedNodes.has(this)) {
        _bridgedNodes.add(this)
        var headaudio = window.__chato3dHeadAudio
        var head = window.__chato3dHead
        if (headaudio && head) {
          try {
            var srcCtx = this.context
            var dstCtx = head.audioCtx
            if (srcCtx === dstCtx) {
              _origConnect.call(this, headaudio)
            } else {
              var msd = srcCtx.createMediaStreamDestination()
              _origConnect.call(this, msd)
              if (dstCtx.state === 'suspended') { dstCtx.resume() }
              var bridgeSource = dstCtx.createMediaStreamSource(msd.stream)
              _origConnect.call(bridgeSource, headaudio)
            }
          } catch (e) {}
        } else {
          _pendingBridgeNodes.push(this)
        }
      }
      return result
    }

    // Layer 5: Watch for <audio>/<video> elements added to DOM
    _3dAudioElementObserver = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var nodes = mutations[i].addedNodes
        for (var j = 0; j < nodes.length; j++) {
          _3dCheckForAudioElements(nodes[j])
        }
      }
    })
    var observeTarget = document.body || document.documentElement
    _3dAudioElementObserver.observe(observeTarget, { childList: true, subtree: true })
  }

  function _3dCheckForAudioElements(node) {
    if (!node || !node.tagName) return
    if (node.tagName === 'AUDIO' || node.tagName === 'VIDEO') {
      _capturedAudioElements.push(node)
      _3dTryConnectAudioElement(node)
    }
    if (node.shadowRoot) {
      var els = node.shadowRoot.querySelectorAll('audio, video')
      for (var i = 0; i < els.length; i++) {
        _capturedAudioElements.push(els[i])
        _3dTryConnectAudioElement(els[i])
      }
    }
    if (node.querySelectorAll) {
      var children = node.querySelectorAll('audio, video')
      for (var k = 0; k < children.length; k++) {
        _capturedAudioElements.push(children[k])
        _3dTryConnectAudioElement(children[k])
      }
    }
  }

  function _3dTryConnectStream(stream) {
    var head = window.__chato3dHead
    var headaudio = window.__chato3dHeadAudio

    if (!head || !headaudio) {
      _pendingStreams.push(stream)
      return
    }
    if (_connectedStreams.has(stream)) return
    _connectedStreams.add(stream)

    try {
      if (head.audioCtx.state === 'suspended') { head.audioCtx.resume() }
      var source = head.audioCtx.createMediaStreamSource(stream)
      source.connect(headaudio)
    } catch (e) {}
  }

  function _3dTryConnectAudioElement(el) {
    var head = window.__chato3dHead
    var headaudio = window.__chato3dHeadAudio
    if (!head || !headaudio) return
    if (_connectedElements.has(el)) return
    _connectedElements.add(el)

    try {
      var source = head.audioCtx.createMediaElementSource(el)
      var gain = head.audioCtx.createGain()
      gain.gain.value = 1.0
      source.connect(gain)
      gain.connect(headaudio)
      gain.connect(head.audioCtx.destination)
    } catch (e) {
      try {
        if (el.captureStream) {
          _3dTryConnectStream(el.captureStream())
        }
      } catch (e2) {}
    }
  }

  // ── 3D UI Container ────────────────────────────────────────────────
  function _3dCreateContainer() {
    // Remove any existing containers (prevents duplicates)
    var oldContainer = document.getElementById('chato-3d-container')
    if (oldContainer) oldContainer.remove()
    var oldMinimized = document.getElementById('chato-3d-minimized')
    if (oldMinimized) oldMinimized.remove()

    _3dContainerEl = document.createElement('div')
    _3dContainerEl.id = 'chato-3d-container'
    _3dContainerEl.innerHTML =
      '<div id="chato-3d-avatar"></div>' +
      '<div id="chato-3d-controls">' +
      '  <div id="chato-3d-status"></div>' +
      '  <button id="chato-3d-call-btn" type="button" title="Iniciar llamada">' +
      '    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">' +
      '      <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 0 0-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/>' +
      '    </svg>' +
      '  </button>' +
      '  <button id="chato-3d-close-btn" type="button" title="Minimizar">' +
      '    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">' +
      '      <path d="M19 13H5v-2h14v2z"/>' +
      '    </svg>' +
      '  </button>' +
      '</div>' +
      '<div id="chato-3d-loading">Cargando avatar 3D...</div>'

    _3dMinimizedEl = document.createElement('div')
    _3dMinimizedEl.id = 'chato-3d-minimized'
    _3dMinimizedEl.innerHTML =
      '<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">' +
      '  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>' +
      '</svg>'
    _3dMinimizedEl.style.display = 'none'

    if (document.body) {
      document.body.appendChild(_3dContainerEl)
      document.body.appendChild(_3dMinimizedEl)
    } else {
      document.addEventListener('DOMContentLoaded', function () {
        document.body.appendChild(_3dContainerEl)
        document.body.appendChild(_3dMinimizedEl)
      })
    }

    _3dStatusEl = _3dContainerEl.querySelector('#chato-3d-status')
    _3dCallBtnEl = _3dContainerEl.querySelector('#chato-3d-call-btn')

    _3dCallBtnEl.addEventListener('click', function () {
      if (_3dCallActive) { _3dEndCall() } else { _3dStartCall() }
    })

    _3dContainerEl.querySelector('#chato-3d-close-btn').addEventListener('click', function () {
      _3dIsMinimized = true
      _3dContainerEl.style.transform = 'scale(0)'
      _3dContainerEl.style.opacity = '0'
      _3dContainerEl.style.pointerEvents = 'none'
      setTimeout(function () {
        _3dContainerEl.style.display = 'none'
        _3dMinimizedEl.style.display = 'flex'
      }, 300)
    })

    _3dMinimizedEl.addEventListener('click', function () {
      _3dIsMinimized = false
      _3dMinimizedEl.style.display = 'none'
      _3dContainerEl.style.display = 'flex'
      void _3dContainerEl.offsetHeight
      _3dContainerEl.style.transform = 'scale(1)'
      _3dContainerEl.style.opacity = '1'
      _3dContainerEl.style.pointerEvents = 'auto'
    })
  }

  // ── Init voice widget hidden (for audio backend in 3D mode) ────────
  function _3dInitVoiceHidden(config) {
    // Start the voice widget (this handles loading the script + rendering)
    // _renderWidget will detect _3dActive and keep it hidden
    _startWidget({
      agentId: config.agentId,
      avatarUrl: config.avatarUrl || null,
      size: config.size || 'compact'
    })

    var _widgetSeenOnce = !!document.querySelector(WIDGET_TAG_NAME)

    // Watch for widget re-creation (after call ends, convai recreates it)
    _3dBodyObserver = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var nodes = mutations[i].addedNodes
        for (var j = 0; j < nodes.length; j++) {
          var node = nodes[j]
          if (node.tagName && node.tagName.toLowerCase() === WIDGET_TAG_NAME) {
            // Ensure terms-key is set on recreated widgets
            if (!node.getAttribute('terms-key')) {
              var TK = '__chato_3d_terms_accepted'
              try { localStorage.setItem(TK, 'true') } catch (e) {}
              node.setAttribute('terms-key', TK)
            }
            // Re-wrap in hidden container if not already wrapped
            if (!node.parentElement || node.parentElement.id !== 'chato-voice-widget-wrapper') {
              var w = document.getElementById('chato-voice-widget-wrapper')
              if (!w) {
                w = document.createElement('div')
                w.id = 'chato-voice-widget-wrapper'
                w.style.cssText = 'position:fixed;right:0;bottom:0;width:400px;height:600px;overflow:hidden;contain:layout paint;opacity:0.001;pointer-events:none;z-index:-1;'
                document.body.appendChild(w)
              }
              w.appendChild(node)
            }
            if (_widgetSeenOnce) {
              window.dispatchEvent(new CustomEvent('chato3d:callended'))
            }
            _widgetSeenOnce = true
          }
        }
      }
    })

    var target = document.body || document.documentElement
    _3dBodyObserver.observe(target, { childList: true, subtree: true })
  }

  // ── Load TalkingHead via ES Modules ────────────────────────────────
  function _3dLoadTalkingHead(config) {
    // Listen for ready event ONCE
    if (!_3dReadyListenerAdded) {
      _3dReadyListenerAdded = true
      window.addEventListener('chato3d:ready', function () {
        _3dConnectAudioPipeline()
      })
    }

    // Add importmap ONCE
    if (!_importmapAdded) {
      _importmapAdded = true
      var importmap = document.createElement('script')
      importmap.type = 'importmap-shim'
      importmap.textContent = JSON.stringify({
        imports: {
          'three': THREE_CDN + '/build/three.module.js/+esm',
          'three/addons/': THREE_CDN + '/examples/jsm/',
          'talkinghead': _host + TALKINGHEAD_MODULE,
          'headaudio': _host + HEADAUDIO_MODULE
        }
      })
      document.head.appendChild(importmap)
    }

    // Build module code
    var moduleCode = [
      'import { TalkingHead } from "talkinghead";',
      'import { HeadAudio } from "headaudio";',
      '',
      '(async function() {',
      '  try {',
      '    var avatarEl = document.getElementById("chato-3d-avatar");',
      '    if (!avatarEl) { console.error("[Chato3D] Avatar container not found"); return; }',
      '    if (!avatarEl.isConnected) { return; }',
      '',
      '    var head = new TalkingHead(avatarEl, {',
      '      ttsEndpoint: null,',
      '      lipsyncModules: [],',
      '      cameraView: ' + JSON.stringify(config.avatar3dCameraView || 'upper') + ',',
      '      modelFPS: 30,',
      '      cameraRotateEnable: true',
      '    });',
      '',
      '    window.__chato3dHead = head;',
      '',
      '    var modelUrl = ' + JSON.stringify(config.avatar3dModelUrl) + ';',
      '    if (modelUrl.indexOf("http") !== 0 && modelUrl.indexOf("//") !== 0) {',
      '      modelUrl = ' + JSON.stringify(_host) + ' + modelUrl;',
      '    }',
      '',
      '    var loadingEl = document.getElementById("chato-3d-loading");',
      '    await head.showAvatar({',
      '      url: modelUrl,',
      '      body: "F",',
      '      avatarMood: "neutral",',
      '      lipsyncLang: "en"',
      '    }, function(ev) {',
      '      if (ev.lengthComputable && loadingEl) {',
      '        var pct = Math.min(100, Math.round(ev.loaded / ev.total * 100));',
      '        loadingEl.textContent = "Cargando avatar " + pct + "%";',
      '      }',
      '    });',
      '',
      '    if (loadingEl) loadingEl.style.display = "none";',
      '',
      '    if (!avatarEl.isConnected) { head.stop(); return; }',
      '',
      '    await head.audioCtx.audioWorklet.addModule(' + JSON.stringify(_host + HEADWORKLET_MODULE) + ');',
      '',
      '    var headaudio = new HeadAudio(head.audioCtx, {',
      '      parameterData: {',
      '        vadGateActiveDb: -35,',
      '        vadGateInactiveDb: -55',
      '      }',
      '    });',
      '',
      '    await headaudio.loadModel(' + JSON.stringify(_host + HEADAUDIO_MODEL) + ');',
      '',
      '    headaudio.onvalue = function(key, value) {',
      '      if (head.mtAvatar && head.mtAvatar[key]) {',
      '        Object.assign(head.mtAvatar[key], { newvalue: value, needsUpdate: true });',
      '      }',
      '    };',
      '',
      '    head.opt.update = headaudio.update.bind(headaudio);',
      '',
      '    headaudio.onstarted = function() {',
      '      head.lookAtCamera(500);',
      '      head.speakWithHands();',
      '      window.dispatchEvent(new CustomEvent("chato3d:speaking", { detail: true }));',
      '    };',
      '',
      '    headaudio.onended = function() {',
      '      window.dispatchEvent(new CustomEvent("chato3d:speaking", { detail: false }));',
      '    };',
      '',
      '    window.__chato3dHeadAudio = headaudio;',
      '',
      '    function resumeAudio() {',
      '      if (head.audioCtx && head.audioCtx.state === "suspended") {',
      '        head.audioCtx.resume();',
      '      }',
      '      document.removeEventListener("click", resumeAudio);',
      '      document.removeEventListener("touchstart", resumeAudio);',
      '    }',
      '    document.addEventListener("click", resumeAudio);',
      '    document.addEventListener("touchstart", resumeAudio);',
      '',
      '    window.dispatchEvent(new CustomEvent("chato3d:ready"));',
      '',
      '    document.addEventListener("visibilitychange", function() {',
      '      if (document.visibilityState === "visible") { head.start(); }',
      '      else { head.stop(); }',
      '    });',
      '',
      '  } catch (err) {',
      '    console.error("[Chato3D] Failed to initialize TalkingHead:", err);',
      '    var loadEl = document.getElementById("chato-3d-loading");',
      '    if (loadEl) loadEl.textContent = "Error: " + err.message;',
      '  }',
      '})();'
    ].join('\n')

    // Load es-module-shims ONCE, then inject module code
    if (_shimLoaded) {
      // Shim already loaded — just inject the module
      var moduleScript = document.createElement('script')
      moduleScript.type = 'module-shim'
      moduleScript.textContent = moduleCode
      document.head.appendChild(moduleScript)
    } else {
      var shimScript = document.createElement('script')
      shimScript.async = true
      shimScript.src = 'https://ga.jspm.io/npm:es-module-shims@2.5.1/dist/es-module-shims.js'
      shimScript.onload = function () {
        _shimLoaded = true
        var moduleScript = document.createElement('script')
        moduleScript.type = 'module-shim'
        moduleScript.textContent = moduleCode
        document.head.appendChild(moduleScript)
      }
      shimScript.onerror = function () {
        _log('error', 'Failed to load es-module-shims')
        var loadEl = document.getElementById('chato-3d-loading')
        if (loadEl) loadEl.textContent = 'Error cargando dependencias'
      }
      document.head.appendChild(shimScript)
    }
  }

  // ── Connect audio pipeline (after TalkingHead ready) ───────────────
  function _3dConnectAudioPipeline() {
    var head = window.__chato3dHead
    var headaudio = window.__chato3dHeadAudio
    var _origConnect = AudioNode.prototype.__chato3dOrigConnect || AudioNode.prototype.connect

    // Replay pending bridge nodes
    if (head && headaudio) {
      for (var p = 0; p < _pendingBridgeNodes.length; p++) {
        try {
          var node = _pendingBridgeNodes[p]
          var srcCtx = node.context
          var dstCtx = head.audioCtx
          if (srcCtx === dstCtx) {
            _origConnect.call(node, headaudio)
          } else {
            var msd = srcCtx.createMediaStreamDestination()
            _origConnect.call(node, msd)
            if (dstCtx.state === 'suspended') { dstCtx.resume() }
            var bridgeSource = dstCtx.createMediaStreamSource(msd.stream)
            _origConnect.call(bridgeSource, headaudio)
          }
        } catch (e) {}
      }
      _pendingBridgeNodes = []
    }

    // Replay pending streams
    var pending = _pendingStreams.slice()
    _pendingStreams = []
    for (var s = 0; s < pending.length; s++) { _3dTryConnectStream(pending[s]) }

    for (var w = 0; w < _capturedWebRTCStreams.length; w++) { _3dTryConnectStream(_capturedWebRTCStreams[w]) }
    for (var i = 0; i < _capturedRemoteStreams.length; i++) { _3dTryConnectStream(_capturedRemoteStreams[i]) }
    for (var j = 0; j < _capturedAudioElements.length; j++) { _3dTryConnectAudioElement(_capturedAudioElements[j]) }

    // Watch voice widget shadow DOM for audio/video
    _3dWidgetPollInterval = setInterval(function () {
      var widget = document.querySelector(WIDGET_TAG_NAME)
      if (widget && widget.shadowRoot) {
        var els = widget.shadowRoot.querySelectorAll('audio, video')
        for (var k = 0; k < els.length; k++) { _3dTryConnectAudioElement(els[k]) }
        _3dShadowObserver = new MutationObserver(function (muts) {
          for (var m = 0; m < muts.length; m++) {
            var nodes = muts[m].addedNodes
            for (var n = 0; n < nodes.length; n++) { _3dCheckForAudioElements(nodes[n]) }
          }
        })
        _3dShadowObserver.observe(widget.shadowRoot, { childList: true, subtree: true })
        clearInterval(_3dWidgetPollInterval)
        _3dWidgetPollInterval = null
      }
    }, 500)
  }

  // ── 3D Call control ────────────────────────────────────────────────
  function _3dStartCall() {
    var widget = document.querySelector(WIDGET_TAG_NAME)
    if (!widget || !widget.shadowRoot) { _log('error', 'Voice widget not found'); return }

    var head = window.__chato3dHead
    if (head && head.audioCtx && head.audioCtx.state === 'suspended') {
      head.audioCtx.resume().then(function () { _3dConnectAudioPipeline() })
    }

    var shadow = widget.shadowRoot
    var btn = shadow.querySelector('[class*="_btn_"]:not([class*="_btnIcon_"]):not([class*="_iconBtn_"]):not([class*="_secondary_"]):not([class*="_disabled_"])')
    if (!btn) { _log('error', 'Widget call button not found'); return }

    // Pre-grant mic permission while user activation from the 3D button click
    // is still valid, so the widget's internal getUserMedia succeeds.
    var _preGrantStream = null
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      _preGrantStream = stream
      setTimeout(function () {
        if (_preGrantStream) {
          _preGrantStream.getTracks().forEach(function (t) { t.stop() })
          _preGrantStream = null
        }
      }, 5000)
    }).catch(function (err) {
      _log('error', 'getUserMedia pre-grant failed: ' + err.name + ': ' + err.message)
    })

    btn.click()

    _3dCallActive = true
    _3dUpdateCallUI('connecting')
    _3dWatchCallState()
  }

  function _3dEndCall() {
    var widget = document.querySelector(WIDGET_TAG_NAME)
    if (widget && widget.shadowRoot) {
      var shadow = widget.shadowRoot
      // End call button has _secondary_ class (like "Cancel"), so we can't use the
      // start-call selector. Find non-icon _secondary_ buttons and pick the one
      // that is NOT inside a terms container.
      var candidates = shadow.querySelectorAll('[class*="_btn_"][class*="_secondary_"]:not([class*="_iconBtn_"])')
      var btn = null
      for (var ci = 0; ci < candidates.length; ci++) {
        var c = candidates[ci]
        var text = (c.textContent || '').trim()
        var inTerms = false
        var parent = c.parentElement
        while (parent && parent !== shadow) {
          if (parent.className && parent.className.indexOf('_terms') !== -1) {
            inTerms = true
            break
          }
          parent = parent.parentElement
        }
        if (!inTerms && text.length > 0) {
          btn = c
          break
        }
      }
      if (btn) btn.click()
    }
    _3dCallActive = false
    _3dUpdateCallUI('idle')
    var head = window.__chato3dHead
    if (head) { try { head.setMood('neutral') } catch (e) {} }
    // Re-render widget so it resets to initial state with the call button available
    // (after ending a call the widget's DOM changes and the start-call button disappears)
    setTimeout(function () {
      if (_widgetConfig) _renderWidget(_widgetConfig)
    }, 800)
  }

  function _3dWatchCallState() {
    if (!_3dSpeakingListener) {
      _3dSpeakingListener = function (ev) {
        if (!_3dCallActive) return
        _3dUpdateCallUI(ev.detail ? 'speaking' : 'listening')
      }
      window.addEventListener('chato3d:speaking', _3dSpeakingListener)
    }

    if (!_3dCallEndedListener) {
      _3dCallEndedListener = function () {
        if (_3dCallActive) {
          _3dCallActive = false
          _3dUpdateCallUI('idle')
          var head = window.__chato3dHead
          if (head) { try { head.setMood('neutral') } catch (e) {} }
          // Re-render widget to reset state for next call
          setTimeout(function () {
            if (_widgetConfig) _renderWidget(_widgetConfig)
          }, 800)
        }
      }
      window.addEventListener('chato3d:callended', _3dCallEndedListener)
    }

    _3dUpdateCallUI('listening')
  }

  function _3dUpdateCallUI(state) {
    if (!_3dStatusEl || !_3dCallBtnEl) return

    var PHONE_SVG = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 0 0-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/></svg>'
    var HANGUP_SVG = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/></svg>'

    switch (state) {
      case 'idle':
        _3dStatusEl.textContent = ''
        _3dStatusEl.className = ''
        _3dCallBtnEl.classList.remove('active', 'hangup')
        _3dCallBtnEl.title = 'Iniciar llamada'
        _3dCallBtnEl.innerHTML = PHONE_SVG
        break
      case 'connecting':
        _3dStatusEl.textContent = 'Conectando...'
        _3dStatusEl.className = 'chato-3d-status-connecting'
        _3dCallBtnEl.classList.add('active')
        break
      case 'listening':
        _3dStatusEl.textContent = 'Escuchando...'
        _3dStatusEl.className = 'chato-3d-status-listening'
        _3dCallBtnEl.classList.add('active', 'hangup')
        _3dCallBtnEl.title = 'Terminar llamada'
        _3dCallBtnEl.innerHTML = HANGUP_SVG
        var head = window.__chato3dHead
        if (head) { try { head.setMood('neutral') } catch (e) {} }
        break
      case 'speaking':
        _3dStatusEl.textContent = 'Hablando...'
        _3dStatusEl.className = 'chato-3d-status-speaking'
        break
    }
  }
})()
