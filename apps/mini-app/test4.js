const req = new Request("https://example.com/", {mode: "navigate"});
const controller = new AbortController();
try {
  const req2 = new Request(req, {signal: controller.signal});
  console.log("SUCCESS");
} catch(e) {
  console.log("ERROR:", e.message);
}
