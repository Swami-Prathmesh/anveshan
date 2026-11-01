/* Tiny globals the engine library expects from a UI. Defined before the engine
   so that no engine code has to guard against their absence. */
var TYPE_LABEL = {
  policy: "Policy", press: "Press release", report: "Report", paper: "Paper",
  standard: "Standard", dataset: "Dataset", model: "Model card", api: "API",
  scheme: "Scheme", dashboard: "Dashboard", science: "Science", space: "Space",
  tech: "Technology", health: "Health", history: "History", geography: "Geography",
  economy: "Economy", governance: "Governance", culture: "Culture", import: "Your import",
  article: "Encyclopaedia", entity: "Entity", preprint: "Preprint", book: "Book",
  archive: "Archive", text: "Primary text", question: "Q&A", code: "Code",
  image: "Image", observation: "Measurement", audio: "Audio", video: "Video",
  webpage: "Web page", place: "Place"
};
var TYPE_LABELS_3 = TYPE_LABEL;
function toast(msg) {
  var host = document.getElementById("toasts");
  if (!host) return;
  var el = document.createElement("div");
  el.className = "toast";
  el.textContent = String(msg);
  host.appendChild(el);
  setTimeout(function () { el.remove(); }, 3000);
}
