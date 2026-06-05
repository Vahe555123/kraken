/* Опционально для нестандартного API в dev: "DEV_API_BASE": "http://127.0.0.1:3000" */
if(location.href.includes("localhost") || location.href.includes("127.0.0.1")) {
  window.__FORM_RUNTIME_CONFIG__ = {
    "FORM_PUBLIC_URL": "http://localhost:3000",
    "FORM_API_BASE": "http://localhost:3000",
    "MAIN_API_BASE": "http://localhost:3000",
    "WHATSAPP_BASE_URL": "https://wa.me/41772895081?text="
  };
} else {
  window.__FORM_RUNTIME_CONFIG__ = {
    "FORM_PUBLIC_URL": "https://monetoplusapp.com",
    "FORM_API_BASE": "https://monetoplusapp.com",
    "MAIN_API_BASE": "https://monetoplusapp.com",
    "WHATSAPP_BASE_URL": "https://wa.me/41772895081?text="
  };
}