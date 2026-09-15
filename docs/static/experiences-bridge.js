/**
 * Click-through bridge for the Algolia Experiences widget.
 *
 * The widget renders results into #autocomplete but only navigates when the
 * experience's link mapping is configured in the Algolia dashboard; without
 * it, clicks do nothing. This bridge captures the widget's search responses
 * (the DOM items carry only their hit position, e.g. id "…pages:2") and
 * navigates to the matching record's URL on click.
 *
 * The widget's client may use fetch OR XMLHttpRequest — both are intercepted.
 */
(function () {
  var latest = [];

  // Debug handle: inspect captured hits from the console.
  window.__expBridge = { get latest() { return latest; } };

  function capture(body) {
    try {
      var data = JSON.parse(body);
      var results = data && data.results;
      if (Array.isArray(results)) {
        // Multi-query: merge all sections' hits in order.
        var merged = [];
        for (var i = 0; i < results.length; i++) {
          if (results[i] && Array.isArray(results[i].hits)) merged = merged.concat(results[i].hits);
        }
        latest = merged;
      } else if (data && Array.isArray(data.hits)) {
        latest = data.hits;
      }
    } catch (e) {
      /* not a search response */
    }
  }

  function isSearchUrl(url) {
    return typeof url === 'string' && /algolia\.[a-z.]+\/1\/indexes\/[^/]+\/quer/.test(url);
  }

  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function () {
      var args = arguments;
      var url = typeof args[0] === 'string' ? args[0] : args[0] && args[0].url;
      var promise = origFetch.apply(this, args);
      if (isSearchUrl(url)) {
        promise
          .then(function (res) {
            res
              .clone()
              .text()
              .then(capture)
              .catch(function () {});
          })
          .catch(function () {});
      }
      return promise;
    };
  }

  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__expSearchUrl = isSearchUrl(url);
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    var xhr = this;
    if (xhr.__expSearchUrl) {
      xhr.addEventListener('load', function () {
        capture(xhr.responseText);
      });
    }
    return origSend.apply(this, arguments);
  };

  document.addEventListener(
    'click',
    function (e) {
      var item = e.target && e.target.closest ? e.target.closest('.ais-AutocompleteIndexItem') : null;
      if (!item) return;
      var match = /:(\d+)$/.exec(item.id);
      var hit = match ? latest[Number(match[1])] : null;
      if (hit && hit.url) {
        e.preventDefault();
        e.stopPropagation();
        window.location.href = hit.url;
      }
    },
    true,
  );
})();
