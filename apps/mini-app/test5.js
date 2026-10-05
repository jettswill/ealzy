const req = new Request("https://example.com/", {mode: "navigate"});
const controller = new AbortController();
try {
  fetch(req, {signal: controller.signal}).catch(() => {});
  console.log("SUCCESS");
} catch(e) {
  console.log("ERROR:", e.message);
}
