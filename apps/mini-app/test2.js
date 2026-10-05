const req = new Request("https://example.com/assets/app.js", {mode: "cors"});
try {
  const req2 = new Request(req, {cache: "reload"});
  console.log("SUCCESS");
} catch(e) {
  console.log("ERROR:", e.message);
}
