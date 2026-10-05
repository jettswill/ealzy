const req = new Request("https://example.com/", {mode: "navigate"});
let fetchInput = req;
if (req instanceof Request && req.mode === "navigate") {
  fetchInput = req.url;
}
const controller = new AbortController();
try {
  const req2 = new Request(fetchInput, { signal: controller.signal, cache: "reload" });
  fetch(req2).catch(() => {});
  console.log("SUCCESS");
} catch(e) {
  console.log("ERROR:", e.message);
}
