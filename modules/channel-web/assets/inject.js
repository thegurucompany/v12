// full backward compatibility
const DEFAULT_CHAT_ID = 'bp-web-widget'
const DEFAULT_IFRAME_ID = 'bp-widget'
const DEFAULT_IFRAME_CLASS = 'bp-widget-web'

function _getContainerId(chatId) {
  return chatId ? chatId + '-container' : DEFAULT_CHAT_ID
}

function _getIframeId(chatId) {
  return chatId || DEFAULT_IFRAME_ID
}

function _injectDOMElement(tagName, selector, options) {
  const element = document.createElement(tagName)
  if (options) {
    Object.keys(options).forEach(function(key) {
      element[key] = options[key]
    })
  }
  document.querySelector(selector).appendChild(element)
  return element
}

function _generateIFrameHTML(host, config) {
  const botId = config.botId || ''
  const options = encodeURIComponent(JSON.stringify({ config: config }))
  const viewMode = config.viewMode || 'Embedded'
  let iframeSrc = host + '/lite/' + botId + '/?m=channel-web&v=' + viewMode + '&options=' + options
  if (config.ref) {
    iframeSrc += '&ref=' + encodeURIComponent(config.ref)
  }
  const title = config.botConvoDescription || config.botName || config.botId

  const iframeId = _getIframeId(config.chatId)
  return (
    '<iframe id="' +
    iframeId +
    '" title="' +
    encodeURIComponent(title) +
    '" frameborder="0" allowtransparency="true" src="' +
    iframeSrc +
    '" class="' +
    DEFAULT_IFRAME_CLASS +
    '" style="background:transparent !important;"/>'
  )
}

const chatRefs = {}

// provides proper chat reference
function _getChatRef(chatId) {
  chatId = chatId || DEFAULT_CHAT_ID
  const fakeChatRef = {
    postMessage: function() {
      console.warn(
        'No webchat with id ' + chatId + ' has not been initialized, \n please use window.botpressWebChat.init first.'
      )
    }
  }

  return chatRefs[chatId] || fakeChatRef
}

function configure(payload, chatId) {
  const chatWindow = _getChatRef(chatId)
  chatWindow.postMessage({ action: 'configure', payload: payload }, '*')
}
function sendEvent(payload, chatId) {
  const chatWindow = _getChatRef(chatId)
  chatWindow.postMessage({ action: 'event', payload: payload }, '*')
}
function sendPayload(payload, chatId) {
  const chatWindow = _getChatRef(chatId)
  chatWindow.postMessage({ action: 'sendPayload', payload: payload }, '*')
}
function mergeConfig(payload, chatId) {
  const chatWindow = _getChatRef(chatId)
  chatWindow.postMessage({ action: 'mergeConfig', payload: payload }, '*')
}

/**
 *
 * @param {object} config Configuration object you want to apply to your webchat instance
 * @param {string} targetSelector css selector under which you want your webchat to be rendered
 */
function init(config, targetSelector) {
  targetSelector = targetSelector || 'body'
  const chatId = config.chatId || DEFAULT_CHAT_ID
  const host = config.host || window.ROOT_PATH || ''

  const cssHref = host + '/assets/modules/channel-web/inject.css'
  _injectDOMElement('link', 'head', { rel: 'stylesheet', href: cssHref })

  const iframeHTML = _generateIFrameHTML(host, config)

  const containerId = _getContainerId(config.chatId)
  const iframeId = _getIframeId(config.chatId)
  _injectDOMElement('div', targetSelector, { id: containerId, innerHTML: iframeHTML })

  const iframeEl = document.querySelector('#' + containerId + ' #' + iframeId)
  const iframeRef = iframeEl.contentWindow
  chatRefs[chatId] = iframeRef

  // Sync background with host page to work around browsers refusing transparent iframes
  _syncBackgroundWithHost(iframeEl, iframeRef)
}

/**
 * Reads the host page's computed background color and applies it to the iframe
 * so it visually blends with the host, bypassing browsers that refuse to honor
 * transparent backgrounds on iframe canvases (e.g. PrimeVue dark mode).
 * A MutationObserver watches for theme class changes on the host <html>/<body>.
 */
function _syncBackgroundWithHost(iframeEl, iframeRef) {
  function getHostBg() {
    // Try <html> first, then <body>
    var bg = window.getComputedStyle(document.documentElement).backgroundColor
    if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') {
      bg = window.getComputedStyle(document.body).backgroundColor
    }
    // If still transparent, try the first meaningful parent
    if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') {
      var el = iframeEl.parentElement
      while (el && el !== document.documentElement) {
        bg = window.getComputedStyle(el).backgroundColor
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') break
        el = el.parentElement
      }
    }
    return bg
  }

  function applyBg() {
    var bg = getHostBg()
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
      iframeEl.style.setProperty('background-color', bg, 'important')
      // Also tell the iframe content to set its html background
      iframeRef.postMessage({ action: 'setHostBackground', payload: { color: bg } }, '*')
    }
  }

  // Apply once the iframe has loaded
  if (iframeEl.contentDocument && iframeEl.contentDocument.readyState === 'complete') {
    applyBg()
  } else {
    iframeEl.addEventListener('load', applyBg)
  }
  // Also apply after a short delay (in case CRM loads styles async)
  setTimeout(applyBg, 1000)
  setTimeout(applyBg, 3000)

  // Watch for theme changes on <html> and <body> (class or data-* attribute changes)
  var observer = new MutationObserver(function() {
    setTimeout(applyBg, 100)
  })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'data-mode', 'style'] })
  if (document.body) {
    observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme', 'data-mode', 'style'] })
  }
}

window.botpressWebChat = {
  init: init,
  configure: configure,
  sendEvent: sendEvent,
  mergeConfig: mergeConfig,
  sendPayload: sendPayload
}
window.chatoWebChat = window.botpressWebChat;

window.addEventListener('message', function(payload) {
  const data = payload.data
  if (!data || !data.type) {
    return
  }

  const iframeSelector = '#' + _getIframeId(data.chatId)
  if (data.type === 'setClass') {
    document.querySelector(iframeSelector).setAttribute('class', data.value)
  } else if (data.type === 'setWidth') {
    // Skip inline width on mobile so CSS media queries can take over
    if (window.innerWidth <= 768) {
      document.querySelector(iframeSelector).style.width = ''
      return
    }
    const width = typeof data.value === 'number' ? data.value + 'px' : data.value

    document.querySelector(iframeSelector).style.width = width
  }
})
