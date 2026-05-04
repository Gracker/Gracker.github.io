(function() {
  var indexPromise = null;
  var entries = [];

  function onReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback);
    } else {
      callback();
    }
  }

  function textFromNode(node, selector) {
    var target = node.querySelector(selector);
    return target ? target.textContent.trim() : "";
  }

  function stripHtml(html) {
    var holder = document.createElement("div");
    holder.innerHTML = html || "";
    return (holder.textContent || holder.innerText || "").replace(/\s+/g, " ").trim();
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function format(template, values) {
    return String(template || "").replace(/\$\{(\w+)\}/g, function(_, key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : "";
    });
  }

  function termsFromQuery(query) {
    return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  }

  function highlight(text, terms) {
    var escaped = escapeHtml(text);
    terms.forEach(function(term) {
      if (!term) return;
      escaped = escaped.replace(new RegExp("(" + escapeRegExp(escapeHtml(term)) + ")", "ig"), "<em>$1</em>");
    });
    return escaped;
  }

  function excerpt(content, terms) {
    if (!content) return "";
    var lower = content.toLowerCase();
    var firstHit = terms.reduce(function(best, term) {
      var index = lower.indexOf(term);
      return index >= 0 && (best < 0 || index < best) ? index : best;
    }, -1);
    var start = firstHit > 60 ? firstHit - 60 : 0;
    var raw = content.slice(start, start + 180);
    return (start > 0 ? "..." : "") + raw + (content.length > start + 180 ? "..." : "");
  }

  function loadIndex(config) {
    if (indexPromise) return indexPromise;

    indexPromise = fetch(config.path, { credentials: "same-origin" })
      .then(function(response) {
        if (!response.ok) {
          throw new Error("Search index request failed: " + response.status);
        }
        return response.text();
      })
      .then(function(xmlText) {
        var xml = new DOMParser().parseFromString(xmlText, "application/xml");
        entries = Array.prototype.slice.call(xml.querySelectorAll("entry")).map(function(entry) {
          var title = textFromNode(entry, "title");
          var url = textFromNode(entry, "url") || (entry.querySelector("link") && entry.querySelector("link").getAttribute("href")) || "#";
          var content = stripHtml(textFromNode(entry, "content"));
          return {
            title: title,
            url: url,
            content: content,
            haystack: (title + " " + content).toLowerCase()
          };
        });
      });

    return indexPromise;
  }

  function search(query) {
    var terms = termsFromQuery(query);
    if (!terms.length) return [];

    return entries
      .filter(function(entry) {
        return terms.every(function(term) {
          return entry.haystack.indexOf(term) >= 0;
        });
      })
      .map(function(entry) {
        var lowerTitle = entry.title.toLowerCase();
        var score = terms.reduce(function(total, term) {
          return total + (lowerTitle.indexOf(term) >= 0 ? 3 : 1);
        }, 0);
        return { entry: entry, score: score };
      })
      .sort(function(a, b) {
        return b.score - a.score || a.entry.title.localeCompare(b.entry.title);
      });
  }

  function init() {
    var configNode = document.getElementById("local-search-config");
    var input = document.getElementById("local-search-input");
    var popup = document.querySelector(".local-search-popup");
    var hits = document.getElementById("local-search-hits");
    var stats = document.getElementById("local-search-stats");
    if (!configNode || !input || !popup || !hits || !stats) return;
    popup.classList.add("local-search-empty");

    var config = {
      path: configNode.getAttribute("data-path") || "/search.xml",
      perPage: parseInt(configNode.getAttribute("data-per-page") || "10", 10),
      empty: configNode.getAttribute("data-empty") || "No results found for: ${query}",
      stats: configNode.getAttribute("data-stats") || "${hits} results found",
      loading: configNode.getAttribute("data-loading") || "Loading search index...",
      error: configNode.getAttribute("data-error") || "Failed to load the search index. Please try again later."
    };

    function render(query) {
      var trimmed = query.trim();
      var terms = termsFromQuery(trimmed);
      hits.innerHTML = "";

      if (!trimmed) {
        stats.textContent = "";
        popup.classList.add("local-search-empty");
        return;
      }
      popup.classList.remove("local-search-empty");

      if (!entries.length) {
        stats.textContent = config.loading;
        loadIndex(config).then(function() {
          render(input.value);
        }).catch(function() {
          stats.textContent = config.error;
        });
        return;
      }

      var results = search(trimmed);
      stats.textContent = format(config.stats, { hits: results.length, query: trimmed });

      if (!results.length) {
        hits.innerHTML =
          '<div class="algolia-hit-empty">' +
          '<div class="algolia-hit-empty-label">' +
          escapeHtml(format(config.empty, { hits: 0, query: trimmed })) +
          "</div></div>";
        return;
      }

      hits.innerHTML = '<ul class="algolia-hit-list">' + results.slice(0, config.perPage).map(function(result) {
        var entry = result.entry;
        var itemExcerpt = excerpt(entry.content, terms);
        return (
          '<li class="algolia-hit-item">' +
          '<a class="algolia-hit-item-link" href="' + escapeHtml(entry.url) + '">' +
          highlight(entry.title, terms) +
          "</a>" +
          (itemExcerpt ? '<div class="local-search-excerpt">' + highlight(itemExcerpt, terms) + "</div>" : "") +
          "</li>"
        );
      }).join("") + "</ul>";
    }

    function closePopup() {
      input.value = "";
      hits.innerHTML = "";
      stats.textContent = "";
      popup.style.display = "none";
      popup.classList.add("local-search-empty");
      document.body.style.overflow = "";
      Array.prototype.slice.call(document.querySelectorAll(".algolia-pop-overlay")).forEach(function(overlay) {
        overlay.remove();
      });
    }

    function openPopup(event) {
      if (event) event.stopPropagation();
      if (!document.querySelector(".algolia-pop-overlay")) {
        var overlay = document.createElement("div");
        overlay.className = "search-popup-overlay algolia-pop-overlay";
        overlay.addEventListener("click", closePopup);
        document.body.insertBefore(overlay, document.body.firstChild);
      }
      document.body.style.overflow = "hidden";
      popup.style.display = "block";
      if (!input.value.trim()) {
        popup.classList.add("local-search-empty");
      }
      loadIndex(config).catch(function() {
        stats.textContent = config.error;
      });
      input.focus();
    }

    input.addEventListener("input", function() {
      render(input.value);
    });

    var closeButton = popup.querySelector(".popup-btn-close");
    if (closeButton) {
      closeButton.addEventListener("click", closePopup);
    }

    document.addEventListener("keydown", function(event) {
      if (event.key === "Escape") closePopup();
    });

    Array.prototype.slice.call(document.querySelectorAll(".popup-trigger")).forEach(function(trigger) {
      trigger.addEventListener("click", openPopup);
    });

    Array.prototype.slice.call(document.querySelectorAll(".site-search")).forEach(function(searchIcon) {
      searchIcon.classList.remove("site-search-loading");
    });
  }

  onReady(init);
})();
