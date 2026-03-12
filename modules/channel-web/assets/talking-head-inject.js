/**
 * Chato 3D Avatar — Injection script for animated 3D avatar with lip-sync
 *
 * Usage (loads on top of voice-inject.js):
 *   <script src="https://your-host/assets/modules/channel-web/voice-inject.js"></script>
 *   <script src="https://your-host/assets/modules/channel-web/talking-head-inject.js"></script>
 *   <script>
 *     window.chatoTalkingHead.init({
 *       host: "https://your-host",
 *       botId: "your-bot-id",
 *       // All voice-inject.js options are forwarded automatically:
 *       userId: { id: "123", firstName: "John" },
 *       dynamicVariables: { plan: "premium" },
 *       // 3D Avatar options (optional — also configurable from backend):
 *       avatar3dModelUrl: "/assets/modules/channel-web/models/avatar.glb",
 *       avatar3dCameraView: "upper" // full | mid | upper | head
 *     });
 *   </script>
 *
 * This script:
 * 1. Initializes voice-inject.js for audio (hidden UI)
 * 2. Renders a 3D avatar using TalkingHead + Three.js
 * 3. Connects HeadAudio for real-time lip-sync from ElevenLabs audio stream
 * 4. Provides custom UI controls (call/hangup buttons, status)
 */
;(function () {
  'use strict'

  // ── Asset paths (relative to host) ───────────────────────────────────
  var TALKINGHEAD_BASE = '/assets/modules/channel-web/talkinghead/'
  var TALKINGHEAD_MODULE = TALKINGHEAD_BASE + 'talkinghead.mjs'
  var HEADAUDIO_MODULE = TALKINGHEAD_BASE + 'headaudio.mjs'
  var HEADWORKLET_MODULE = TALKINGHEAD_BASE + 'headworklet.mjs'
  var HEADAUDIO_MODEL = TALKINGHEAD_BASE + 'model-en-mixed.bin'
  var CSS_PATH = '/assets/modules/channel-web/talking-head.css'

  // Three.js CDN (loaded via importmap)
  var THREE_VERSION = '0.180.0'
  var THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@' + THREE_VERSION

  // ── State ────────────────────────────────────────────────────────────
  var _host = ''
  var _botId = ''
  var _config = null
  var _head = null          // TalkingHead instance
  var _headaudio = null     // HeadAudio instance
  var _callActive = false
  var _containerEl = null
  var _statusEl = null
  var _callBtnEl = null
  var _minimizedEl = null   // Minimized bubble element
  var _isMinimized = false
  var _initialized = false

  // Intercepted AudioContext for capturing ElevenLabs audio
  var _capturedAudioCtx = null
  var _audioSourceNodes = []

  // ── Public API ─────────────────────────────────────────────────────
  window.chatoTalkingHead = {
    init: function (config) {
      if (!config || !config.host) {
        _log('error', 'host is required')
        return
      }

      var newBotId = config.botId || config.agentId || ''

      // Auto-cleanup: if already initialized with a DIFFERENT bot, destroy first
      if (_initialized && newBotId !== _botId) {
        _destroy()
      }

      // Already initialized with the same bot — no-op
      if (_initialized) {
        return
      }

      _host = config.host.replace(/\/$/, '')
      _botId = newBotId
      _config = config

      // Intercept RTCPeerConnection + AudioContext BEFORE voice-inject.js loads the widget
      _installEarlyIntercepts()

      // Fetch voice config to get 3D avatar settings
      if (config.botId) {
        _fetchConfigAndStart(config)
      } else if (config.agentId) {
        _startDirect(config)
      } else {
        _log('error', 'Either agentId or botId is required')
      }
    },

    destroy: function () {
      _destroy()
    }
  }

  // ── Internal destroy ────────────────────────────────────────────────
  // Tears down 3D avatar, voice widget, DOM elements, and resets state
  // so init() can be called again (e.g. with a different bot).
  function _destroy() {
    if (!_initialized) return

    // 1. End active call
    if (_callActive) {
      try { _endCall() } catch (e) {}
    }

    // 2. Dispose TalkingHead + HeadAudio (Three.js cleanup)
    var head = window.__chato3dHead
    var headaudio = window.__chato3dHeadAudio
    if (headaudio) {
      try { headaudio.disconnect() } catch (e) {}
    }
    if (head) {
      // stop() must come BEFORE close() — stop() calls suspend() internally,
      // which throws if the AudioContext is already closed.
      try { head.stop() } catch (e) {}
      try {
        if (head.audioCtx && head.audioCtx.state !== 'closed') {
          head.audioCtx.close()
        }
      } catch (e) {}
    }
    window.__chato3dHead = null
    window.__chato3dHeadAudio = null

    // 3. Remove DOM elements
    if (_containerEl && _containerEl.parentNode) {
      _containerEl.parentNode.removeChild(_containerEl)
    }
    if (_minimizedEl && _minimizedEl.parentNode) {
      _minimizedEl.parentNode.removeChild(_minimizedEl)
    }

    // 4. Destroy voice-inject.js (removes widget + restores intercepts)
    if (window.chatoVoiceAgent && window.chatoVoiceAgent.destroy) {
      window.chatoVoiceAgent.destroy()
    } else {
      // Fallback: at least remove the widget element
      var voiceWidget = document.querySelector('chato-voice-agent')
      if (voiceWidget) voiceWidget.remove()
    }

    // 5. Remove injected CSS
    var css = document.querySelector('link[href*="talking-head.css"]')
    if (css) css.remove()

    // 6. Remove event listeners
    if (_speakingListener) {
      window.removeEventListener('chato3d:speaking', _speakingListener)
      _speakingListener = null
    }
    if (_callEndedListener) {
      window.removeEventListener('chato3d:callended', _callEndedListener)
      _callEndedListener = null
    }

    // 7. Clear captured streams/elements arrays
    _capturedRemoteStreams = []
    _capturedAudioElements = []
    _capturedWebRTCStreams = []
    _pendingStreams = []
    _pendingBridgeNodes = []

    // 8. Reset state
    _containerEl = null
    _statusEl = null
    _callBtnEl = null
    _minimizedEl = null
    _isMinimized = false
    _callActive = false
    _host = ''
    _botId = ''
    _config = null
    _initialized = false
  }

  // ── Logging ──────────────────────────────────────────────────────────
  function _log(level, msg) {
    var prefix = '[Chato3D] '
    if (level === 'error') console.error(prefix + msg)
    else if (level === 'warn') console.warn(prefix + msg)
  }

  // ── Fetch config from backend ────────────────────────────────────────
  function _fetchConfigAndStart(config) {
    var url = _host + '/api/v1/bots/' + _botId + '/mod/channel-web/voiceConfig'
    var xhr = new XMLHttpRequest()
    xhr.open('GET', url, true)
    xhr.setRequestHeader('Accept', 'application/json')
    xhr.onload = function () {
      if (xhr.status !== 200) {
        _log('error', 'Voice config not available (HTTP ' + xhr.status + ')')
        return
      }
      try {
        var voiceConfig = JSON.parse(xhr.responseText)
        if (!voiceConfig.agentId) {
          _log('error', 'Invalid voice config')
          return
        }

        // Merge backend 3D config with local overrides
        var mergedConfig = {
          host: config.host,
          botId: config.botId,
          userId: config.userId,
          dynamicVariables: config.dynamicVariables,
          customCssUrl: config.customCssUrl,
          agentId: voiceConfig.agentId,
          avatarUrl: voiceConfig.avatarUrl,
          size: voiceConfig.size,
          avatar3dEnabled: config.avatar3dEnabled !== undefined ? config.avatar3dEnabled : voiceConfig.avatar3dEnabled,
          avatar3dModelUrl: config.avatar3dModelUrl || voiceConfig.avatar3dModelUrl,
          avatar3dCameraView: config.avatar3dCameraView || voiceConfig.avatar3dCameraView || 'upper'
        }

        if (!mergedConfig.avatar3dEnabled) {
          // 3D not enabled — fall back to normal voice widget
          _initVoiceOnly(mergedConfig)
          return
        }
        if (!mergedConfig.avatar3dModelUrl) {
          _log('error', 'avatar3dModelUrl is required when avatar3dEnabled is true')
          _initVoiceOnly(mergedConfig)
          return
        }

        _start3DAvatar(mergedConfig)
      } catch (e) {
        _log('error', 'Failed to parse voice config: ' + e)
      }
    }
    xhr.onerror = function () {
      _log('error', 'Network error fetching voice config')
    }
    xhr.send()
  }

  function _startDirect(config) {
    if (!config.avatar3dEnabled || !config.avatar3dModelUrl) {
      _initVoiceOnly(config)
      return
    }
    _start3DAvatar(config)
  }

  // Fall back to voice-only (no 3D)
  function _initVoiceOnly(config) {
    if (window.chatoVoiceAgent && window.chatoVoiceAgent.init) {
      window.chatoVoiceAgent.init(config)
    }
  }

  // ── Early intercepts ──────────────────────────────────────────────
  // Multi-layer intercept strategy to capture ElevenLabs/LiveKit audio.
  // LiveKit uses WebRTC and renders audio via <audio srcObject=MediaStream>,
  // which bypasses Web Audio API entirely. We intercept at multiple levels:
  //   1. HTMLMediaElement.play() — catches when LiveKit's <audio> starts playing
  //   2. HTMLMediaElement.srcObject setter — catches WebRTC stream assignment
  //   3. RTCPeerConnection ontrack — captures remote audio tracks directly
  //   4. AudioNode.prototype.connect — fallback for Web Audio API routing
  var _capturedRemoteStreams = []  // MediaStreams from WebRTC
  var _capturedAudioElements = [] // <audio>/<video> elements
  var _capturedWebRTCStreams = []  // Streams from RTCPeerConnection ontrack
  var _OrigRTCPeerConnection = window.RTCPeerConnection
  var _OrigAudioContext = window.AudioContext || window.webkitAudioContext

  function _installEarlyIntercepts() {

    // ── Layer 1: Intercept HTMLMediaElement.prototype.play ──────────
    // When LiveKit's <audio> element calls play(), it has a valid srcObject
    // (WebRTC MediaStream). We capture that stream for lip-sync.
    var _origPlay = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function () {
      var el = this
      console.log('[Chato3D] Intercepted play() on <' + el.tagName.toLowerCase() + '>', {
        src: el.src || '(none)',
        srcObject: !!el.srcObject,
        readyState: el.readyState
      })

      if (el.srcObject && el.srcObject instanceof MediaStream) {
        var stream = el.srcObject
        var audioTracks = stream.getAudioTracks()
        console.log('[Chato3D] play() has srcObject with ' + audioTracks.length + ' audio tracks')

        if (audioTracks.length > 0) {
          _capturedRemoteStreams.push(stream)
          _tryConnectStream(stream)
        }
      }

      return _origPlay.apply(this, arguments)
    }

    // ── Layer 2: Intercept srcObject setter ─────────────────────────
    // Catches the moment LiveKit assigns the WebRTC MediaStream to <audio>.
    // This fires before play() and gives us early access to the stream.
    var _origSrcObjectDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'srcObject')
    if (_origSrcObjectDesc && _origSrcObjectDesc.set) {
      Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
        get: _origSrcObjectDesc.get,
        set: function (stream) {
          console.log('[Chato3D] Intercepted srcObject assignment on <' + this.tagName.toLowerCase() + '>', {
            hasStream: !!stream,
            audioTracks: stream && stream.getAudioTracks ? stream.getAudioTracks().length : 0
          })

          if (stream && stream instanceof MediaStream) {
            var audioTracks = stream.getAudioTracks()
            if (audioTracks.length > 0) {
              _capturedRemoteStreams.push(stream)
              _tryConnectStream(stream)
            }
          }

          return _origSrcObjectDesc.set.call(this, stream)
        },
        configurable: true,
        enumerable: true
      })
    }

    // ── Layer 3: Intercept RTCPeerConnection ────────────────────────
    // Captures remote audio tracks directly from WebRTC, regardless of
    // how LiveKit renders them. Serves as an additional capture point.
    if (_OrigRTCPeerConnection) {
      window.RTCPeerConnection = function () {
        var pc = new (Function.prototype.bind.apply(_OrigRTCPeerConnection, [null].concat(Array.prototype.slice.call(arguments))))()

        pc.addEventListener('track', function (ev) {
          if (ev.track && ev.track.kind === 'audio') {
            console.log('[Chato3D] RTCPeerConnection ontrack: audio track captured', {
              trackId: ev.track.id,
              trackState: ev.track.readyState,
              streams: ev.streams ? ev.streams.length : 0
            })

            // Detect when remote audio track ends (agent hung up)
            ev.track.addEventListener('ended', function () {
              console.log('[Chato3D] Remote audio track ended — agent hung up')
              window.dispatchEvent(new CustomEvent('chato3d:callended'))
            })

            // Use the first stream associated with the track
            if (ev.streams && ev.streams.length > 0) {
              for (var i = 0; i < ev.streams.length; i++) {
                _capturedWebRTCStreams.push(ev.streams[i])
                _tryConnectStream(ev.streams[i])
              }
            } else {
              // No stream associated — create one from the track
              var newStream = new MediaStream([ev.track])
              _capturedWebRTCStreams.push(newStream)
              _tryConnectStream(newStream)
            }
          }
        })

        // Detect connection close (agent/server ended call)
        pc.addEventListener('connectionstatechange', function () {
          if (pc.connectionState === 'closed' || pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            console.log('[Chato3D] RTCPeerConnection state:', pc.connectionState, '— call ended')
            window.dispatchEvent(new CustomEvent('chato3d:callended'))
          }
        })

        return pc
      }
      window.RTCPeerConnection.prototype = _OrigRTCPeerConnection.prototype
      // Copy static properties
      try {
        window.RTCPeerConnection.generateCertificate = _OrigRTCPeerConnection.generateCertificate
      } catch (e) {}
    }

    // ── Layer 4 (fallback): Intercept AudioNode.prototype.connect ───
    // For audio that does flow through Web Audio API.
    var _origConnect = AudioNode.prototype.connect
    AudioNode.prototype.__chato3dOrigConnect = _origConnect
    var _bridgedNodes = new WeakSet()

    AudioNode.prototype.connect = function (destination) {
      var result = _origConnect.apply(this, arguments)

      // Detect audio going to speakers
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
              console.log('[Chato3D] AudioNode bridge → HeadAudio (same ctx)')
            } else {
              var msd = srcCtx.createMediaStreamDestination()
              _origConnect.call(this, msd)
              if (dstCtx.state === 'suspended') { dstCtx.resume() }
              var bridgeSource = dstCtx.createMediaStreamSource(msd.stream)
              _origConnect.call(bridgeSource, headaudio)
              console.log('[Chato3D] AudioNode bridge → HeadAudio (cross-ctx)')
            }
          } catch (e) {
            console.warn('[Chato3D] AudioNode bridge failed:', e.message)
          }
        } else {
          _pendingBridgeNodes.push(this)
        }
      }

      return result
    }

    // 5. Watch for <audio>/<video> elements being added to DOM
    if (document.body) {
      _observeAudioElements()
    } else {
      document.addEventListener('DOMContentLoaded', _observeAudioElements)
    }
  }

  // Nodes that connected to destination before HeadAudio was ready
  var _pendingBridgeNodes = []

  function _observeAudioElements() {
    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var nodes = mutations[i].addedNodes
        for (var j = 0; j < nodes.length; j++) {
          _checkForAudioElements(nodes[j])
        }
      }
    })
    observer.observe(document.documentElement, { childList: true, subtree: true })
  }

  function _checkForAudioElements(node) {
    if (!node || !node.tagName) return
    if (node.tagName === 'AUDIO' || node.tagName === 'VIDEO') {
      _capturedAudioElements.push(node)
      _tryConnectAudioElement(node)
    }
    // Check shadow DOM
    if (node.shadowRoot) {
      var els = node.shadowRoot.querySelectorAll('audio, video')
      for (var i = 0; i < els.length; i++) {
        _capturedAudioElements.push(els[i])
        _tryConnectAudioElement(els[i])
      }
    }
    // Check children
    if (node.querySelectorAll) {
      var children = node.querySelectorAll('audio, video')
      for (var k = 0; k < children.length; k++) {
        _capturedAudioElements.push(children[k])
        _tryConnectAudioElement(children[k])
      }
    }
  }

  // Try to connect a stream to HeadAudio (if ready)
  var _connectedStreams = new WeakSet()
  var _pendingStreams = []  // Streams captured before HeadAudio is ready

  function _tryConnectStream(stream) {
    var head = window.__chato3dHead
    var headaudio = window.__chato3dHeadAudio

    if (!head || !headaudio) {
      // Queue for later — HeadAudio not ready yet
      _pendingStreams.push(stream)
      console.log('[Chato3D] Stream queued (HeadAudio not ready yet)', {
        audioTracks: stream.getAudioTracks().length,
        active: stream.active,
        pendingTotal: _pendingStreams.length
      })
      return
    }
    if (_connectedStreams.has(stream)) return
    _connectedStreams.add(stream)

    var audioTracks = stream.getAudioTracks()
    console.log('[Chato3D] Connecting stream to HeadAudio...', {
      tracks: audioTracks.length,
      active: stream.active,
      trackStates: audioTracks.map(function (t) {
        return { id: t.id, enabled: t.enabled, readyState: t.readyState, muted: t.muted }
      }),
      audioCtxState: head.audioCtx.state
    })

    try {
      if (head.audioCtx.state === 'suspended') {
        head.audioCtx.resume()
      }
      var source = head.audioCtx.createMediaStreamSource(stream)
      // Connect to HeadAudio ONLY for lip-sync analysis.
      // Do NOT connect to destination — the original <audio> element
      // already plays through speakers. Connecting here too = double audio.
      source.connect(headaudio)
      console.log('[Chato3D] ✅ Stream connected to HeadAudio for lip-sync!')
    } catch (e) {
      console.warn('[Chato3D] Failed to connect stream:', e.message)
    }
  }

  var _connectedElements = new WeakSet()

  function _tryConnectAudioElement(el) {
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
      console.log('[Chato3D] Connected audio element to HeadAudio', {
        tag: el.tagName,
        src: el.src || el.currentSrc || '(no src)',
        paused: el.paused,
        readyState: el.readyState,
        audioCtxState: head.audioCtx.state
      })
    } catch (e) {
      // Already connected to another context — try captureStream
      try {
        if (el.captureStream) {
          var stream = el.captureStream()
          _tryConnectStream(stream)
        }
      } catch (e2) {}
    }
  }

  // ── Start 3D Avatar ──────────────────────────────────────────────────
  function _start3DAvatar(config) {
    _initialized = true

    // 1. Load CSS
    _loadCSS()

    // 2. Create container UI
    _createContainer()

    // 3. Initialize voice-inject.js hidden
    _initVoiceHidden(config)

    // 4. Load TalkingHead via importmap + ES module
    _loadTalkingHead(config)
  }

  function _loadCSS() {
    var link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = _host + CSS_PATH
    document.head.appendChild(link)
  }

  // ── Create UI Container ──────────────────────────────────────────────
  function _createContainer() {
    // Main container
    _containerEl = document.createElement('div')
    _containerEl.id = 'chato-3d-container'
    _containerEl.innerHTML =
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

    // Minimized bubble (hidden by default)
    _minimizedEl = document.createElement('div')
    _minimizedEl.id = 'chato-3d-minimized'
    _minimizedEl.innerHTML =
      '<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">' +
      '  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>' +
      '</svg>'
    _minimizedEl.style.display = 'none'

    if (document.body) {
      document.body.appendChild(_containerEl)
      document.body.appendChild(_minimizedEl)
    } else {
      document.addEventListener('DOMContentLoaded', function () {
        document.body.appendChild(_containerEl)
        document.body.appendChild(_minimizedEl)
      })
    }

    _statusEl = _containerEl.querySelector('#chato-3d-status')
    _callBtnEl = _containerEl.querySelector('#chato-3d-call-btn')

    // Call button click
    _callBtnEl.addEventListener('click', function () {
      if (_callActive) {
        _endCall()
      } else {
        _startCall()
      }
    })

    // Minimize button — collapse to small bubble
    var closeBtn = _containerEl.querySelector('#chato-3d-close-btn')
    closeBtn.addEventListener('click', function () {
      _minimizeAvatar()
    })

    // Restore from minimized bubble
    _minimizedEl.addEventListener('click', function () {
      _restoreAvatar()
    })
  }

  function _minimizeAvatar() {
    _isMinimized = true
    _containerEl.style.transform = 'scale(0)'
    _containerEl.style.opacity = '0'
    _containerEl.style.pointerEvents = 'none'
    setTimeout(function () {
      _containerEl.style.display = 'none'
      _minimizedEl.style.display = 'flex'
    }, 300)
  }

  function _restoreAvatar() {
    _isMinimized = false
    _minimizedEl.style.display = 'none'
    _containerEl.style.display = 'flex'
    // Force reflow before transition
    void _containerEl.offsetHeight
    _containerEl.style.transform = 'scale(1)'
    _containerEl.style.opacity = '1'
    _containerEl.style.pointerEvents = 'auto'
  }

  // ── Initialize voice-inject.js in hidden mode ────────────────────────
  function _initVoiceHidden(config) {
    // Tell voice-inject.js to initialize but we'll hide its widget
    if (!window.chatoVoiceAgent || !window.chatoVoiceAgent.init) {
      _log('error', 'voice-inject.js must be loaded before talking-head-inject.js')
      return
    }

    // Initialize voice agent (it will create the ElevenLabs widget)
    window.chatoVoiceAgent.init(config)

    // Persistently hide the ElevenLabs widget.
    // voice-inject.js recreates the widget after each call ends,
    // so we use a MutationObserver to catch every (re)creation.
    function _hideWidget(widget) {
      if (!widget) return
      widget.style.position = 'fixed'
      widget.style.left = '-9999px'
      widget.style.top = '-9999px'
      widget.style.opacity = '0'
      widget.style.pointerEvents = 'none'
      widget.style.width = '1px'
      widget.style.height = '1px'
      widget.style.overflow = 'hidden'
    }

    // Hide immediately if already present
    var existing = document.querySelector('chato-voice-agent')
    if (existing) _hideWidget(existing)

    // Watch for widget (re)creation.
    // voice-inject.js recreates the widget after each call ends.
    // When we see a NEW widget appear (not the first one), it means the call ended.
    var _widgetSeenOnce = !!existing

    var bodyObs = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var nodes = mutations[i].addedNodes
        for (var j = 0; j < nodes.length; j++) {
          var node = nodes[j]
          if (node.tagName && node.tagName.toLowerCase() === 'chato-voice-agent') {
            _hideWidget(node)

            // If we've seen the widget before, this is a recreation = call ended
            if (_widgetSeenOnce) {
              console.log('[Chato3D] Widget recreated — call ended')
              window.dispatchEvent(new CustomEvent('chato3d:callended'))
            }
            _widgetSeenOnce = true
          }
        }
      }
    })

    var target = document.body || document.documentElement
    bodyObs.observe(target, { childList: true, subtree: true })
  }

  // ── Load TalkingHead via ES Modules ──────────────────────────────────
  // Uses es-module-shims to support dynamic importmap injection,
  // since browsers don't allow adding importmaps after modules load.
  function _loadTalkingHead(config) {

    // Listen for ready event to connect audio
    window.addEventListener('chato3d:ready', function () {
      _connectAudioPipeline()
    })

    // 1. Add importmap FIRST (with shim type so es-module-shims handles it)
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

    // 2. Build the module code as a string
    var moduleCode = [
      'import { TalkingHead } from "talkinghead";',
      'import { HeadAudio } from "headaudio";',
      '',
      '(async function() {',
      '  try {',
      '    var avatarEl = document.getElementById("chato-3d-avatar");',
      '    if (!avatarEl) { console.error("[Chato3D] Avatar container not found"); return; }',
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
      '    // Set up HeadAudio for real-time lip-sync',
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
      '    var visemeCount = 0;',
      '    headaudio.onvalue = function(key, value) {',
      '      if (visemeCount < 5) { console.log("[Chato3D] Viseme:", key, value.toFixed(3)); }',
      '      visemeCount++;',
      '      if (head.mtAvatar && head.mtAvatar[key]) {',
      '        Object.assign(head.mtAvatar[key], { newvalue: value, needsUpdate: true });',
      '      }',
      '    };',
      '',
      '    head.opt.update = headaudio.update.bind(headaudio);',
      '',
      '    headaudio.onstarted = function() {',
      '      console.log("[Chato3D] Speech detected - starting lip-sync");',
      '      head.lookAtCamera(500);',
      '      head.speakWithHands();',
      '      window.dispatchEvent(new CustomEvent("chato3d:speaking", { detail: true }));',
      '    };',
      '',
      '    headaudio.onended = function() {',
      '      console.log("[Chato3D] Speech ended");',
      '      window.dispatchEvent(new CustomEvent("chato3d:speaking", { detail: false }));',
      '    };',
      '',
      '    // Debug: log mtAvatar keys to verify model has viseme blend shapes',
      '    console.log("[Chato3D] Avatar morph targets:", Object.keys(head.mtAvatar || {}).filter(function(k) { return k.indexOf("viseme") !== -1; }));',
      '',
      '    window.__chato3dHeadAudio = headaudio;',
      '',
      '    // Resume AudioContext on first user gesture (Chrome autoplay policy)',
      '    function resumeAudio() {',
      '      if (head.audioCtx && head.audioCtx.state === "suspended") {',
      '        head.audioCtx.resume().then(function() {',
      '          console.log("[Chato3D] AudioContext resumed");',
      '        });',
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

    // 3. Load es-module-shims, then inject our module
    var shimScript = document.createElement('script')
    shimScript.async = true
    shimScript.src = 'https://ga.jspm.io/npm:es-module-shims@2.5.1/dist/es-module-shims.js'
    shimScript.onload = function () {
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

  // ── Connect audio pipeline ───────────────────────────────────────────
  // After TalkingHead and HeadAudio are ready, connect any streams
  // that were captured before initialization.
  function _connectAudioPipeline() {
    var head = window.__chato3dHead
    var headaudio = window.__chato3dHeadAudio
    var _origConnect = AudioNode.prototype.__chato3dOrigConnect || AudioNode.prototype.connect

    console.log('[Chato3D] Connecting audio pipeline...',
      'pendingBridgeNodes:', _pendingBridgeNodes.length,
      'pendingStreams:', _pendingStreams.length,
      'capturedStreams:', _capturedRemoteStreams.length,
      'webrtcStreams:', _capturedWebRTCStreams.length,
      'elements:', _capturedAudioElements.length)

    // Replay pending bridge nodes — these connected to AudioDestinationNode
    // before HeadAudio was ready
    if (head && headaudio) {
      for (var p = 0; p < _pendingBridgeNodes.length; p++) {
        var node = _pendingBridgeNodes[p]
        try {
          var srcCtx = node.context
          var dstCtx = head.audioCtx

          if (srcCtx === dstCtx) {
            _origConnect.call(node, headaudio)
            console.log('[Chato3D] Replayed pending AudioNode bridge (same ctx)')
          } else {
            var msd = srcCtx.createMediaStreamDestination()
            _origConnect.call(node, msd)
            if (dstCtx.state === 'suspended') { dstCtx.resume() }
            var bridgeSource = dstCtx.createMediaStreamSource(msd.stream)
            _origConnect.call(bridgeSource, headaudio)
            console.log('[Chato3D] Replayed pending AudioNode bridge (cross-ctx)')
          }
        } catch (e) {
          console.warn('[Chato3D] Failed to replay pending bridge:', e.message)
        }
      }
      _pendingBridgeNodes = []
    }

    // Replay pending streams (queued before HeadAudio was ready)
    var pending = _pendingStreams.slice()
    _pendingStreams = []
    for (var s = 0; s < pending.length; s++) {
      _tryConnectStream(pending[s])
    }

    // Connect any WebRTC streams from RTCPeerConnection.ontrack
    for (var w = 0; w < _capturedWebRTCStreams.length; w++) {
      _tryConnectStream(_capturedWebRTCStreams[w])
    }

    // Connect any captured remote streams (from play/srcObject intercepts)
    for (var i = 0; i < _capturedRemoteStreams.length; i++) {
      _tryConnectStream(_capturedRemoteStreams[i])
    }

    // Connect any audio elements captured before HeadAudio was ready
    for (var j = 0; j < _capturedAudioElements.length; j++) {
      _tryConnectAudioElement(_capturedAudioElements[j])
    }

    // Also watch the voice widget shadow DOM for audio/video elements
    var widgetPoll = setInterval(function () {
      var widget = document.querySelector('chato-voice-agent')
      if (widget && widget.shadowRoot) {
        var els = widget.shadowRoot.querySelectorAll('audio, video')
        for (var k = 0; k < els.length; k++) {
          _tryConnectAudioElement(els[k])
        }
        // Observe future additions inside shadow DOM
        var shadowObs = new MutationObserver(function (muts) {
          for (var m = 0; m < muts.length; m++) {
            var nodes = muts[m].addedNodes
            for (var n = 0; n < nodes.length; n++) {
              _checkForAudioElements(nodes[n])
            }
          }
        })
        shadowObs.observe(widget.shadowRoot, { childList: true, subtree: true })
        clearInterval(widgetPoll)
      }
    }, 500)
  }

  // ── Call control ─────────────────────────────────────────────────────
  function _startCall() {
    // Programmatically click the ElevenLabs widget button
    var widget = document.querySelector('chato-voice-agent')
    if (!widget || !widget.shadowRoot) {
      _log('error', 'Voice widget not found')
      return
    }

    // Resume audio context on user gesture
    var head = window.__chato3dHead
    if (head && head.audioCtx && head.audioCtx.state === 'suspended') {
      head.audioCtx.resume().then(function () {
        console.log('[Chato3D] AudioContext resumed on call start')
        // Re-connect any streams that arrived while context was suspended
        _connectAudioPipeline()
      })
    }

    // Find and click the CTA button in the ElevenLabs widget
    var btn = widget.shadowRoot.querySelector('[class*="_btn_"]:not([class*="_btnIcon_"]):not([class*="_iconBtn_"])')
    if (btn) {
      btn.click()
      _callActive = true
      _updateCallUI('connecting')

      // Watch for call state changes
      _watchCallState(widget)
    } else {
      _log('error', 'Widget call button not found')
    }
  }

  function _endCall() {
    var widget = document.querySelector('chato-voice-agent')
    if (!widget || !widget.shadowRoot) return

    // Find the end-call button or the same toggle button
    var btn = widget.shadowRoot.querySelector('[class*="_btn_"]:not([class*="_btnIcon_"]):not([class*="_iconBtn_"])')
    if (btn) {
      btn.click()
    }

    _callActive = false
    _updateCallUI('idle')

    // Reset avatar mood
    var head = window.__chato3dHead
    if (head) {
      try { head.setMood('neutral') } catch (e) {}
    }
  }

  // Track speaking state via HeadAudio events (reliable, not shadow DOM)
  var _speakingListener = null
  var _callEndedListener = null

  function _watchCallState(widget) {
    // Use HeadAudio onstarted/onended events for speaking/listening status
    if (!_speakingListener) {
      _speakingListener = function (ev) {
        if (!_callActive) return
        if (ev.detail) {
          _updateCallUI('speaking')
        } else {
          _updateCallUI('listening')
        }
      }
      window.addEventListener('chato3d:speaking', _speakingListener)
    }

    // Detect agent-initiated call end (RTCPeerConnection closed / track ended)
    if (!_callEndedListener) {
      _callEndedListener = function () {
        if (_callActive) {
          console.log('[Chato3D] Call ended by agent — resetting UI')
          _callActive = false
          _updateCallUI('idle')

          // Reset avatar mood
          var head = window.__chato3dHead
          if (head) {
            try { head.setMood('neutral') } catch (e) {}
          }
        }
      }
      window.addEventListener('chato3d:callended', _callEndedListener)
    }

    // Set initial state to listening (call just started, waiting for bot)
    _updateCallUI('listening')
  }

  function _updateCallUI(state) {
    if (!_statusEl || !_callBtnEl) return

    switch (state) {
      case 'idle':
        _statusEl.textContent = ''
        _statusEl.className = ''
        _callBtnEl.classList.remove('active', 'hangup')
        _callBtnEl.title = 'Iniciar llamada'
        _callBtnEl.innerHTML =
          '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">' +
          '<path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 0 0-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/>' +
          '</svg>'
        break

      case 'connecting':
        _statusEl.textContent = 'Conectando...'
        _statusEl.className = 'chato-3d-status-connecting'
        _callBtnEl.classList.add('active')
        break

      case 'listening':
        _statusEl.textContent = 'Escuchando...'
        _statusEl.className = 'chato-3d-status-listening'
        _callBtnEl.classList.add('active', 'hangup')
        _callBtnEl.title = 'Terminar llamada'
        _callBtnEl.innerHTML =
          '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">' +
          '<path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>' +
          '</svg>'
        // Avatar: attentive expression
        var head = window.__chato3dHead
        if (head) {
          try { head.setMood('neutral') } catch (e) {}
        }
        break

      case 'speaking':
        _statusEl.textContent = 'Hablando...'
        _statusEl.className = 'chato-3d-status-speaking'
        // HeadAudio handles lip-sync automatically
        break
    }
  }
})()
