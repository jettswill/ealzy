const req = new Request("https://example.com/assets/app.js", {mode: "cors"});
const req2 = new Request(req, {cache: "reload"});
console.log("mode:", req2.mode);
