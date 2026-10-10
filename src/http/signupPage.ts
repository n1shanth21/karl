// The HTML for GET /signup. One small phone-friendly page, no frameworks.
// It POSTs to /api/signup and then shows "text Karl at …" with a tap-to-text button.

export function signupPage(opts: { needsCode: boolean }): string {
  const codeField = opts.needsCode
    ? `<label>sign-up code<input id="code" autocomplete="off" placeholder="from the poster" required></label>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Text Karl</title>
<style>
  :root { --bg: #f6f8fb; --card: #fff; --text: #13294b; --muted: #5b6b82; --accent: #4b9cd3; --err: #b42318; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0e1726; --card: #17233a; --text: #eaf2fb; --muted: #9fb0c8; --err: #ff8a80; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px;
         background: var(--bg); color: var(--text); font: 17px/1.45 -apple-system, system-ui, sans-serif; }
  main { width: 100%; max-width: 380px; background: var(--card); border-radius: 18px; padding: 24px;
         box-shadow: 0 6px 24px rgba(0,0,0,.08); }
  h1 { margin: 0 0 4px; font-size: 26px; }
  p { margin: 0 0 18px; color: var(--muted); }
  label { display: block; margin-bottom: 14px; font-size: 14px; color: var(--muted); }
  input { display: block; width: 100%; margin-top: 6px; padding: 12px; font-size: 17px; border-radius: 10px;
          border: 1px solid rgba(127,127,127,.35); background: transparent; color: var(--text); }
  button, .text-btn { display: block; width: 100%; padding: 14px; border: 0; border-radius: 12px; font-size: 17px;
          font-weight: 600; background: var(--accent); color: #fff; text-align: center; text-decoration: none; cursor: pointer; }
  button:disabled { opacity: .6; }
  #error { color: var(--err); min-height: 1.4em; margin: 10px 0 0; }
  #done { display: none; }
  .number { font-size: 28px; font-weight: 700; margin: 6px 0 18px; }
  small { display: block; margin-top: 14px; color: var(--muted); }
</style>
</head>
<body>
<main>
  <form id="form">
    <h1>text karl 👋</h1>
    <p>the unc marketplace that lives in your texts. sign up and karl gives you your number to text.</p>
    <label>first name<input id="firstName" autocomplete="given-name" maxlength="30" required></label>
    <label>your phone<input id="phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="919-555-0123" required></label>
    ${codeField}
    <button id="submit">get my karl number</button>
    <div id="error" role="alert"></div>
    <small>we only use your number so you can text karl. karl never texts you first, and nobody sees your number.</small>
  </form>
  <div id="done">
    <h1>you're in 🎉</h1>
    <p>text karl at</p>
    <div class="number" id="number"></div>
    <a class="text-btn" id="smsLink" href="#">text karl now</a>
    <small>save this number. it's yours, so text this one (not a friend's karl number).</small>
  </div>
</main>
<script>
  const form = document.getElementById("form");
  const codeInput = document.getElementById("code");
  const urlCode = new URLSearchParams(location.search).get("code");
  if (codeInput && urlCode) codeInput.value = urlCode;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = document.getElementById("submit");
    const errorBox = document.getElementById("error");
    errorBox.textContent = "";
    button.disabled = true;
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: document.getElementById("firstName").value,
          phone: document.getElementById("phone").value,
          code: codeInput ? codeInput.value : undefined,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "something went wrong, try again");
      document.getElementById("number").textContent = data.karlNumberDisplay;
      document.getElementById("smsLink").href = data.smsLink;
      form.style.display = "none";
      document.getElementById("done").style.display = "block";
    } catch (err) {
      errorBox.textContent = err.message || "something went wrong, try again";
    } finally {
      button.disabled = false;
    }
  });
</script>
</body>
</html>`;
}
