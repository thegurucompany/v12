/**
 * Chato Voice Agent — Injection script for conversational voice AI
 *
 * Usage (recommended — backend mode, fully proxied):
 *   <script src="https://studio.thegurucompany.com/assets/modules/channel-web/voice-inject.js"></script>
 *   <script>
 *     window.chatoVoiceAgent.init({
 *       host: "https://studio.thegurucompany.com",
 *       botId: "your-bot-id"
 *     });
 *   </script>
 *
 * All voice API traffic is proxied through the host backend.
 * No third-party domains or branding are exposed to the client.
 * Requires voiceAgent.apiKey configured in the bot's channel-web config.
 */
;(function () {
  'use strict'

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

  // State
  var _host = ''
  var _rootPath = ''
  var _botId = ''
  var _customCssUrl = ''
  var _interceptsInstalled = false
  var _origFetch = null
  var _origWebSocket = null
  var _origXHROpen = null

  // ── Public API ─────────────────────────────────────────────────────
  window.chatoVoiceAgent = {
    init: function (config) {
      if (!config || !config.host) {
        _log('error', 'host is required')
        return
      }

      _host = config.host.replace(/\/$/, '')

      // Extract root path from host for proxy URL construction
      try {
        var url = new URL(_host)
        _rootPath = url.pathname.replace(/\/$/, '')
      } catch (e) {
        _rootPath = ''
      }

      // Store botId for proxy URL construction
      if (config.botId) {
        _botId = config.botId
      }
      if (config.customCssUrl) {
        _customCssUrl = config.customCssUrl
      }

      // Direct mode: agentId provided in config
      if (config.agentId) {
        _startWidget({
          agentId: config.agentId,
          avatarUrl: config.avatarUrl || null,
          size: config.size || 'compact'
        })
        return
      }

      // Backend mode: fetch config securely
      if (!config.botId) {
        _log('error', 'Either agentId or botId is required')
        return
      }
      _fetchVoiceConfig(config.botId)
    }
  }

  // ── Logging (silent by default) ────────────────────────────────────
  function _log(level, message) {
    var prefix = '[ChatoVoice] '
    if (level === 'error') {
      console.error(prefix + message)
    }
  }

  // ── Fetch voice config from backend ────────────────────────────────
  function _fetchVoiceConfig(botId) {
    var url = _host + '/api/v1/bots/' + botId + '/mod/channel-web/voiceConfig'

    var xhr = new XMLHttpRequest()
    xhr.open('GET', url, true)
    xhr.setRequestHeader('Accept', 'application/json')

    xhr.onload = function () {
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
        _startWidget(voiceConfig)
      } catch (e) {
        _log('error', 'Failed to parse voice config')
      }
    }

    xhr.onerror = function () {
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
    // Block branding/external links
    url = url.replace(/https?:\/\/elevenlabs\.io\/[^\s"']*/g, '#')
    return url
  }

  function _rewriteWsUrl(url) {
    if (typeof url !== 'string') return url
    var wsHost = _host.replace(/^http/, 'ws')

    // LiveKit WebSocket
    url = url.replace(/wss?:\/\/livekit\.rtc\.elevenlabs\.io/g, wsHost + _rootPath + '/voice-lk')
    // API WebSocket (US)
    url = url.replace(/wss?:\/\/api\.us\.elevenlabs\.io/g, wsHost + _rootPath + '/voice-ws-us')
    // API WebSocket (global)
    url = url.replace(/wss?:\/\/api\.elevenlabs\.io/g, wsHost + _rootPath + '/voice-ws')

    return url
  }

  // ── Install network intercepts ─────────────────────────────────────
  function _installIntercepts() {
    if (_interceptsInstalled) return
    _interceptsInstalled = true

    // Intercept fetch()
    _origFetch = window.fetch
    window.fetch = function (input, init) {
      if (typeof input === 'string' && _isUpstreamUrl(input)) {
        input = _rewriteHttpUrl(input)
      } else if (input && typeof input === 'object' && input.url && _isUpstreamUrl(input.url)) {
        input = new Request(_rewriteHttpUrl(input.url), input)
      }
      return _origFetch.call(this, input, init)
    }

    // Intercept WebSocket
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

    // Intercept XMLHttpRequest.open()
    _origXHROpen = XMLHttpRequest.prototype.open
    XMLHttpRequest.prototype.open = function (method, url) {
      if (_isUpstreamUrl(url)) {
        url = _rewriteHttpUrl(url)
      }
      return _origXHROpen.apply(this, arguments)
    }
  }

  // ── Load widget & render ───────────────────────────────────────────
  var _widgetConfig = null
  var _widgetScriptLoaded = false

  function _startWidget(config) {
    _widgetConfig = config

    // Set custom tag name before widget loads
    window.__CHATO_VOICE_WIDGET_TAG_NAME__ = WIDGET_TAG_NAME

    // Install network intercepts before loading the widget
    _installIntercepts()

    if (_widgetScriptLoaded) {
      // Script already loaded (e.g. re-creating after call ended)
      _renderWidget(config)
      return
    }

    // Load the locally-hosted widget bundle
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
    // Remove any existing widget first
    var existing = document.querySelector(WIDGET_TAG_NAME)
    if (existing) {
      existing.remove()
    }

    var widget = document.createElement(WIDGET_TAG_NAME)
    widget.setAttribute('agent-id', config.agentId)

    if (config.avatarUrl) {
      widget.setAttribute('avatar-image-url', config.avatarUrl)
    }

    // Hide until customized
    widget.style.opacity = '0'
    widget.style.transition = 'opacity 0.3s ease'

    if (document.body) {
      document.body.appendChild(widget)
    } else {
      document.addEventListener('DOMContentLoaded', function () {
        document.body.appendChild(widget)
      })
    }

    // Wait for shadow DOM, then customize and reveal
    _customizeAndReveal(widget)
  }

  function _customizeAndReveal(widget) {
    var applied = false
    var attempts = 0
    var maxAttempts = 30

    var poll = setInterval(function () {
      attempts++
      if (applied || attempts > maxAttempts) {
        clearInterval(poll)
        setTimeout(function () {
          widget.style.opacity = '1'
        }, 300)
        return
      }

      var shadow = widget.shadowRoot
      if (!shadow) return
      if (!shadow.querySelector('button') && !shadow.querySelector('div')) return

      // Remove any remaining branding text
      _removeBranding(shadow)

      // Inject custom CSS into shadow DOM
      _injectCustomCss(shadow)

      // Watch for call ending — when the widget collapses and loses its
      // button, recreate it so the user sees the full card again
      _watchForCallEnd(widget, shadow)

      setTimeout(function () {
        widget.style.opacity = '1'
      }, 300)

      applied = true
      clearInterval(poll)
    }, 500)
  }

  // Observe the shadow DOM: when the call ends the widget removes the CTA
  // button and status text, leaving an empty box. Detect this and recreate.
  function _watchForCallEnd(widget, shadow) {
    var callActive = false

    var observer = new MutationObserver(function () {
      var wrapper = shadow.querySelector('[class*="_wrapper_"]')
      if (!wrapper) return

      var hasShow = wrapper.className.indexOf('_show_') !== -1 ||
                    wrapper.className.indexOf('_open_') !== -1
      var btn = shadow.querySelector('[class*="_btn_"]:not([class*="_btnIcon_"]):not([class*="_iconBtn_"])')
      var status = shadow.querySelector('[class*="_status_"]')

      // Detect call started (expanded state with no CTA button)
      if (hasShow && !btn) {
        callActive = true
      }

      // Detect call ended: was in a call, now collapsed with no button/status visible
      if (callActive && !btn && !status) {
        var box = shadow.querySelector('[class*="_box_"]')
        // Check if box is essentially empty (only avatar or nothing)
        if (box && box.offsetHeight < 80) {
          callActive = false
          observer.disconnect()
          // Small delay then recreate widget fresh
          setTimeout(function () {
            if (_widgetConfig) {
              _renderWidget(_widgetConfig)
            }
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

      if (typeof cls === 'string' && /powered|terms/i.test(cls)) {
        el.remove()
        continue
      }

      if (text === 'Powered by' ||
          /^Powered by\s/i.test(text)) {
        el.remove()
      }
    }

    var feedback = shadow.querySelectorAll('[class*="feedback"]')
    for (var j = 0; j < feedback.length; j++) {
      feedback[j].style.display = 'none'
    }
  }

  function _injectCustomCss(shadow) {
    if (!_customCssUrl) return

    var link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = _customCssUrl
    shadow.appendChild(link)
  }
})()
