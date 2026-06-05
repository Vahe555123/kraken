(function () {
  // Edit only this value when backend API domain changes.
  var API_BASE = "https://monetoplusapp.com";

  if (
    window.location.href.includes("localhost") ||
    window.location.href.includes("127.0.0.1")
  ) {
    API_BASE = "http://localhost:3000";
  }

  var WHATSAPP_BASE_URL = "https://wa.me/41772895081?text=";

  function normalizeBase(base) {
    return (base || "").replace(/\/+$/, "");
  }

  function buildUrl(path) {
    var cleanPath = path || "";
    if (!cleanPath) return normalizeBase(API_BASE);
    return normalizeBase(API_BASE) + (cleanPath.charAt(0) === "/" ? cleanPath : "/" + cleanPath);
  }

  function safeHeadersToObject(headers) {
    try {
      var result = {};
      if (!headers || typeof headers.forEach !== "function") return result;
      headers.forEach(function (value, key) {
        result[key] = value;
      });
      return result;
    } catch (err) {
      console.error("❌ [API CONFIG] Failed to convert headers to object:", err);
      return {};
    }
  }

  async function parseJsonResponse(response, url) {
    var contentType = (response.headers && response.headers.get("content-type")) || "";
    var headersObj = safeHeadersToObject(response.headers);

    console.group("🌐 [API RESPONSE]");
    console.log("➡️ URL:", url);
    console.log("📡 STATUS:", response.status, response.statusText);
    console.log("📦 CONTENT-TYPE:", contentType);
    console.log("🧾 HEADERS:", headersObj);
    console.log("✅ RESPONSE.OK:", response.ok);
    console.log("🔄 REDIRECTED:", response.redirected);
    console.log("📍 FINAL RESPONSE URL:", response.url);

    var res = null;
    var rawText = "";

    try {
      var clonedResponse = response.clone();
      res = await response.json();
      console.log("📥 JSON RESPONSE:", res);

      try {
        rawText = await clonedResponse.text();
        console.log("📄 RAW RESPONSE TEXT:", rawText);
      } catch (cloneTextErr) {
        console.warn("⚠️ Could not read cloned raw text:", cloneTextErr);
      }
    } catch (jsonErr) {
      console.warn("⚠️ response.json() failed:", jsonErr);

      try {
        rawText = await response.text();
        console.log("📄 RAW RESPONSE TEXT:", rawText);
      } catch (textErr) {
        console.error("❌ Failed to read response.text():", textErr);
      }

      if (response.ok) {
        var parseError = new Error("Invalid JSON from " + url);
        parseError.status = response.status;
        parseError.url = url;
        parseError.text = rawText;
        parseError.contentType = contentType;
        parseError.headers = headersObj;

        console.error("❌ JSON PARSE ERROR:", parseError);
        console.groupEnd();
        throw parseError;
      }
    }

    if (!response.ok) {
      var httpError = new Error("HTTP " + response.status + " for " + url);
      httpError.status = response.status;
      httpError.url = url;
      httpError.data = res;
      httpError.text = rawText;
      httpError.contentType = contentType;
      httpError.headers = headersObj;

      console.error("❌ HTTP ERROR OBJECT:", httpError);
      console.groupEnd();
      throw httpError;
    }

    console.log("✅ SUCCESS PARSED RESPONSE:", {
      url: url,
      status: response.status,
      ok: response.ok,
      data: res,
      text: rawText
    });
    console.groupEnd();

    return {
      url: url,
      response: response,
      data: typeof res === "undefined" ? null : res,
      text: rawText
    };
  }

  window.FORM_PUBLIC_URL = window.location.origin || "";
  window.FORM_API_BASE = normalizeBase(API_BASE);
  window.MAIN_API_BASE = normalizeBase(API_BASE);
  window.API_BASE = normalizeBase(API_BASE);
  window.WHATSAPP_BASE_URL = WHATSAPP_BASE_URL;

  console.group("⚙️ [API CONFIG INIT]");
  console.log("🌍 window.location.href:", window.location.href);
  console.log("🌍 window.location.origin:", window.location.origin);
  console.log("🔗 API_BASE:", window.API_BASE);
  console.log("📝 FORM_PUBLIC_URL:", window.FORM_PUBLIC_URL);
  console.log("📞 WHATSAPP_BASE_URL:", window.WHATSAPP_BASE_URL);
  console.groupEnd();

  window.getApiBaseCandidates = function () {
    var candidates = [window.API_BASE];
    console.log("📌 [getApiBaseCandidates] candidates:", candidates);
    return candidates;
  };

  window.fetchJsonWithApiFallback = async function (path, init) {
    var url = buildUrl(path);
    var requestInit = init || {};

    console.group("🚀 [fetchJsonWithApiFallback]");
    console.log("➡️ PATH:", path);
    console.log("➡️ FULL URL:", url);
    console.log("⚙️ INIT:", requestInit);
    console.log("📨 METHOD:", requestInit.method || "GET");
    console.log("🧾 HEADERS:", requestInit.headers || {});
    console.log("📦 BODY:", requestInit.body || null);

    try {
      var response = await fetch(url, requestInit);

      console.log("📡 FETCH COMPLETED:", {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        redirected: response.redirected,
        type: response.type,
        url: response.url
      });

      var parsed = await parseJsonResponse(response, url);
      console.log("✅ [fetchJsonWithApiFallback] FINAL PARSED RESULT:", parsed);
      console.groupEnd();
      return parsed;
    } catch (error) {
      console.error("❌ [fetchJsonWithApiFallback] ERROR:", error);
      console.error("❌ ERROR MESSAGE:", error && error.message);
      console.error("❌ ERROR STATUS:", error && error.status);
      console.error("❌ ERROR URL:", error && error.url);
      console.error("❌ ERROR TEXT:", error && error.text);
      console.error("❌ ERROR DATA:", error && error.data);
      console.groupEnd();
      throw error;
    }
  };

  window.fetchWithApiFallback = async function (path, init) {
    var url = buildUrl(path);
    var requestInit = init || {};

    console.group("🚀 [fetchWithApiFallback]");
    console.log("➡️ PATH:", path);
    console.log("➡️ FULL URL:", url);
    console.log("⚙️ INIT:", requestInit);
    console.log("📨 METHOD:", requestInit.method || "GET");
    console.log("🧾 HEADERS:", requestInit.headers || {});
    console.log("📦 BODY:", requestInit.body || null);

    try {
      var response = await fetch(url, requestInit);
      var headersObj = safeHeadersToObject(response.headers);

      console.log("📡 FETCH RESPONSE:", {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        redirected: response.redirected,
        type: response.type,
        url: response.url,
        headers: headersObj
      });

      if (!response.ok) {
        var rawText = "";
        try {
          rawText = await response.clone().text();
        } catch (readErr) {
          console.warn("⚠️ Could not read raw error response:", readErr);
        }

        var error = new Error("HTTP " + response.status + " for " + url);
        error.status = response.status;
        error.url = url;
        error.text = rawText;
        error.headers = headersObj;

        console.error("❌ [fetchWithApiFallback] HTTP ERROR:", error);
        console.groupEnd();
        throw error;
      }

      console.log("✅ [fetchWithApiFallback] SUCCESS");
      console.groupEnd();

      return { url: url, response: response };
    } catch (error) {
      console.error("❌ [fetchWithApiFallback] ERROR:", error);
      console.error("❌ ERROR MESSAGE:", error && error.message);
      console.error("❌ ERROR STATUS:", error && error.status);
      console.error("❌ ERROR URL:", error && error.url);
      console.error("❌ ERROR TEXT:", error && error.text);
      console.groupEnd();
      throw error;
    }
  };
})();