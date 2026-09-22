/**
 * The interface, as a single self-contained page: no external stylesheet, font
 * or script, so it works with no network and inside a packaged binary.
 */
export const PAGE = /* html */ `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>html2apk</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f5f5f7;
    --card: #ffffff;
    --text: #17171a;
    --muted: #6b6b76;
    --line: #dededf;
    --accent: #1f6feb;
    --accent-text: #ffffff;
    --ok: #1a7f37;
    --err: #b3261e;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #16161a;
      --card: #1f1f24;
      --text: #f2f2f4;
      --muted: #a0a0ad;
      --line: #33333b;
      --accent: #4c8dff;
      --ok: #4ac26b;
      --err: #ff7b72;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 32px 16px 64px;
    background: var(--bg);
    color: var(--text);
    font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  main { max-width: 620px; margin: 0 auto; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  .sub { color: var(--muted); margin: 0 0 28px; }
  .card {
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 22px;
  }
  label { display: block; font-weight: 600; margin: 0 0 6px; }
  .hint { color: var(--muted); font-size: 13px; font-weight: 400; }
  input, select {
    width: 100%;
    padding: 11px 12px;
    margin: 0 0 18px;
    border: 1px solid var(--line);
    border-radius: 9px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
  }
  input:focus, select:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  button {
    width: 100%;
    padding: 13px;
    border: 0;
    border-radius: 9px;
    background: var(--accent);
    color: var(--accent-text);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  button:disabled { opacity: .55; cursor: default; }
  .progress { margin-top: 22px; display: none; }
  .progress.on { display: block; }
  .track { height: 8px; background: var(--line); border-radius: 99px; overflow: hidden; }
  .fill { height: 100%; width: 0; background: var(--accent); transition: width .3s ease; }
  .step { margin-top: 10px; color: var(--muted); font-size: 14px; }
  .done { margin-top: 22px; display: none; }
  .done.on { display: block; }
  .ok { color: var(--ok); font-weight: 600; }
  .err { color: var(--err); font-weight: 600; }
  pre {
    white-space: pre-wrap;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 9px;
    padding: 12px;
    font-size: 13px;
    max-height: 260px;
    overflow: auto;
  }
  a.download {
    display: block;
    text-align: center;
    padding: 13px;
    margin-top: 12px;
    border-radius: 9px;
    background: var(--ok);
    color: #fff;
    text-decoration: none;
    font-weight: 600;
  }
  footer { color: var(--muted); font-size: 13px; margin-top: 22px; text-align: center; }
</style>
</head>
<body>
<main>
  <h1>html2apk</h1>
  <p class="sub">Transforme un site web ou un dossier HTML en application Android.</p>

  <div class="card">
    <form id="f">
      <label for="source">Site ou dossier
        <span class="hint">— une adresse <code>https://…</code> ou un chemin de dossier</span>
      </label>
      <input id="source" name="source" placeholder="https://exemple.fr" required />

      <label for="nom">Nom de l'application <span class="hint">— facultatif</span></label>
      <input id="nom" name="nom" placeholder="Mon application" />

      <label for="identifiant">Identifiant Android <span class="hint">— facultatif</span></label>
      <input id="identifiant" name="identifiant" placeholder="com.moi.monapp" />

      <label for="moteur">Environnement de build</label>
      <select id="moteur" name="moteur">
        <option value="auto">Automatique (Docker si disponible)</option>
        <option value="docker">Docker</option>
        <option value="local">Outils installés sur cette machine</option>
      </select>

      <button id="go" type="submit">Créer l'APK</button>
    </form>

    <div class="progress" id="p">
      <div class="track"><div class="fill" id="fill"></div></div>
      <div class="step" id="step">Démarrage…</div>
    </div>

    <div class="done" id="d"></div>
  </div>

  <footer>
    L'APK est signé avec une clé de debug : installable sur un téléphone,
    pas publiable sur le Play Store.
  </footer>
</main>

<script>
  const f = document.getElementById("f");
  const go = document.getElementById("go");
  const p = document.getElementById("p");
  const fill = document.getElementById("fill");
  const stepText = document.getElementById("step");
  const done = document.getElementById("d");

  function escape(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  f.addEventListener("submit", async (event) => {
    event.preventDefault();
    go.disabled = true;
    done.className = "done";
    done.innerHTML = "";
    p.className = "progress on";
    fill.style.width = "0";
    stepText.textContent = "Démarrage…";

    const body = {
      source: document.getElementById("source").value.trim(),
      nom: document.getElementById("nom").value.trim(),
      identifiant: document.getElementById("identifiant").value.trim(),
      moteur: document.getElementById("moteur").value,
    };

    let id;
    try {
      const started = await fetch("/api/build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await started.json();
      if (!started.ok) { throw new Error(payload.erreur || "Requête refusée"); }
      id = payload.id;
    } catch (error) {
      finish({ statut: "échec", erreur: String(error.message || error) });
      return;
    }

    const timer = setInterval(async () => {
      let job;
      try {
        job = await (await fetch("/api/jobs/" + id)).json();
      } catch { return; }

      if (job.total > 0) {
        fill.style.width = Math.round((job.etape / job.total) * 100) + "%";
      }
      if (job.libelle) { stepText.textContent = job.libelle; }

      if (job.statut !== "en cours") {
        clearInterval(timer);
        finish(job, id);
      }
    }, 600);
  });

  function finish(job, id) {
    go.disabled = false;
    done.className = "done on";

    if (job.statut === "terminé") {
      fill.style.width = "100%";
      stepText.textContent = "Terminé";
      done.innerHTML =
        '<p class="ok">✓ APK prêt — ' + escape(job.taille) + ", " + escape(job.duree) + "</p>" +
        '<p class="hint">Enregistré sur cette machine : ' + escape(job.chemin) + "</p>" +
        '<a class="download" href="/api/jobs/' + id + '/apk">Télécharger l\\'APK</a>';
      return;
    }

    p.className = "progress";
    done.innerHTML =
      '<p class="err">✗ Build échoué</p>' +
      "<pre>" + escape(job.erreur || "Erreur inconnue") + "</pre>";
  }
</script>
</body>
</html>
`;
