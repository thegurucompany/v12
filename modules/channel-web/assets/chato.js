window.chatoConfig = {};
window.chatoWebChat = {
  init: function (config) {
    window.chatoConfig = config;
  },
};
window.chatoProactiveMessage = null;

(function () {
  function getCurrentScriptSrc() {
    var host = window.chatoConfig.host;
    if (!host) {
      host = 'https://studio.thegurucompany.com';
    }
    return host;
  }

  function init() {
    var scriptSrc = getCurrentScriptSrc();
    // Load inject.js from the host
    var injectScript = document.createElement('script');
    injectScript.src = scriptSrc + '/assets/modules/channel-web/inject.js';
    injectScript.onload = function () {
      window.chatoWebChat.init(window.chatoConfig);
      // inject.js loaded
      var addEvent = window.addEventListener
        ? 'addEventListener'
        : 'attachEvent';
      var eventName = window.addEventListener ? 'message' : 'onmessage';

      window[addEvent](
        eventName,
        function (event) {
          var data = event.data || {};
          var name = data.name;
          if (!name) return;

          switch (name) {
            case 'webchatOpened':
              removeChatoProactiveMessage();
              try {
                localStorage.setItem('proactiveMessageDismissed', 'true');
              } catch (e) {}
              break;
          }
        },
        false
      );

      // Set proactive message timeout
      var proactiveTimeout = 5 * 1000;
      setTimeout(function () {
        var proactiveMessageDismissed = false;
        try {
          proactiveMessageDismissed = localStorage.getItem(
            'proactiveMessageDismissed'
          );
        } catch (e) {}
        if (proactiveMessageDismissed) return;

        if (!proactiveMessageDismissed) {
          // Inject proactive message into the page
          var proactiveMessage = document.createElement('a');
          window.chatoProactiveMessage = proactiveMessage;
          proactiveMessage.href = '#';
          proactiveMessage.className = 'chato-proactive-message';
          var proactiveMessageText = window.chatoConfig.proactiveMessage;
          if (!proactiveMessageText) {
            proactiveMessageText =
              '¿Tienes alguna pregunta? 🤖 Habla con ChatO 👉';
          }
          proactiveMessage.innerText = proactiveMessageText;

          proactiveMessage.onclick = function (e) {
            if (e.preventDefault) e.preventDefault();
            else e.returnValue = false;

            try {
              localStorage.setItem('proactiveMessageDismissed', 'true');
            } catch (e) {}

            // Open Botpress chat
            if (window.botpressWebChat) {
              window.botpressWebChat.sendEvent({ type: 'show' });
            }
          };

          // Append proactive message to the body or a specific element
          if (document.body) {
            document.body.appendChild(proactiveMessage);
          } else {
            // If document.body is not available, wait for it
            var addEvent = window.addEventListener
              ? 'addEventListener'
              : 'attachEvent';
            var eventName = window.addEventListener
              ? 'DOMContentLoaded'
              : 'onreadystatechange';

            document[addEvent](eventName, function () {
              document.body.appendChild(proactiveMessage);
            });
          }
        }
      }, proactiveTimeout);
    };
    if (document.body) {
      document.body.appendChild(injectScript);
    } else {
      // Wait for document.body to be available
      var addEvent = window.addEventListener
        ? 'addEventListener'
        : 'attachEvent';
      var eventName = window.addEventListener
        ? 'DOMContentLoaded'
        : 'onreadystatechange';

      document[addEvent](eventName, function () {
        document.body.appendChild(injectScript);
      });
    }
  }

  function removeChatoProactiveMessage() {
    if (
      !window.chatoProactiveMessage ||
      !window.chatoProactiveMessage.parentNode
    )
      return;

    window.chatoProactiveMessage.parentNode.removeChild(
      window.chatoProactiveMessage
    );
    window.chatoProactiveMessage = null;
  }

  if (
    document.readyState === 'complete' ||
    document.readyState === 'interactive'
  ) {
    init();
  } else {
    var addEvent = window.addEventListener ? 'addEventListener' : 'attachEvent';
    var eventName = window.addEventListener
      ? 'DOMContentLoaded'
      : 'onreadystatechange';

    document[addEvent](eventName, function () {
      init();
    });
  }
})();
