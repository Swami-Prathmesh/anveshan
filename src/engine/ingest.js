/* ============================================================================
   ANVESHAN v4 - LAYER 8: INGESTION
   Real client-side parsing of the formats people actually research with:
   PDF, DOCX, PPTX, XLSX, ODT, CSV, TSV, JSON, HTML, Markdown, plain text and
   ZIP bundles. No server, no library, no upload: the bytes never leave the
   machine.

   PDFs are read by inflating the content streams and pulling the text-showing
   operators out of them. That works on born-digital documents. A scanned page
   is a picture of text, and this engine says so instead of inventing an OCR.
   ========================================================================== */
(function (root) {
  "use strict";
  var ANV = root.ANV = root.ANV || {};
  var L = ANV.lang;

  /* ------------------------------------------------------------- inflate --- */
  function hasStreams() {
    return typeof root.DecompressionStream === "function";
  }

  /* Inflate without Blob or Response: a plain stream pair works everywhere the
     DecompressionStream API exists, including contexts where fetch is blocked. */
  async function inflateWith(format, bytes) {
    if (!hasStreams()) throw new Error("this browser cannot inflate streams");
    var ds = new root.DecompressionStream(format);
    var writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    var reader = ds.readable.getReader();
    var chunks = [], total = 0, step;
    while (!(step = await reader.read()).done) {
      chunks.push(step.value);
      total += step.value.length;
    }
    var out = new Uint8Array(total), at = 0;
    for (var i = 0; i < chunks.length; i++) { out.set(chunks[i], at); at += chunks[i].length; }
    return out;
  }

  async function inflateRaw(bytes) { return inflateWith("deflate-raw", bytes); }

  async function inflateZlib(bytes) {
    // a zlib stream is a 2-byte header plus raw deflate; try both readings
    try { return await inflateWith("deflate-raw", bytes.subarray(2)); }
    catch (e) { return inflateWith("deflate", bytes); }
  }

  /* ----------------------------------------------------------------- zip --- */
  var decoder = null;
  function textOf(bytes) {
    if (!decoder) decoder = new TextDecoder("utf-8");
    return decoder.decode(bytes);
  }

  /** Minimal ZIP reader: end-of-central-directory, central directory, entries. */
  async function unzip(bytes) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var eocd = -1;
    for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("not a zip archive (no end-of-central-directory record)");
    var count = dv.getUint16(eocd + 10, true);
    var cdOffset = dv.getUint32(eocd + 16, true);
    var out = {}, p = cdOffset;
    for (var n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      var method = dv.getUint16(p + 10, true);
      var compSize = dv.getUint32(p + 20, true);
      var nameLen = dv.getUint16(p + 28, true);
      var extraLen = dv.getUint16(p + 30, true);
      var commentLen = dv.getUint16(p + 32, true);
      var localOffset = dv.getUint32(p + 42, true);
      var name = textOf(bytes.subarray(p + 46, p + 46 + nameLen));
      // local header carries its own name/extra lengths
      var lNameLen = dv.getUint16(localOffset + 26, true);
      var lExtraLen = dv.getUint16(localOffset + 28, true);
      var dataStart = localOffset + 30 + lNameLen + lExtraLen;
      var data = bytes.subarray(dataStart, dataStart + compSize);
      out[name] = { method: method, data: data };
      p += 46 + nameLen + extraLen + commentLen;
    }
    var files = {};
    for (var key in out) {
      var e = out[key];
      if (e.method === 0) files[key] = e.data;
      else if (e.method === 8) {
        try { files[key] = await inflateRaw(e.data); } catch (err) { files[key] = null; }
      }
    }
    return files;
  }

  /* ----------------------------------------------------------------- pdf --- */
  /** Pull readable text out of a PDF's content streams. */
  async function readPdf(bytes) {
    var raw = "";
    // latin1 view so byte offsets line up with the PDF syntax
    var CH = 8192;
    for (var i = 0; i < bytes.length; i += CH) {
      raw += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(bytes.length, i + CH)));
    }
    var streams = [], idx = 0;
    while (true) {
      var s = raw.indexOf("stream", idx);
      if (s < 0) break;
      var e = raw.indexOf("endstream", s);
      if (e < 0) break;
      var body = raw.slice(s + 6, e).replace(/^\r?\n/, "").replace(/\r?\n$/, "");
      var head = raw.slice(Math.max(0, s - 500), s);
      var isFlate = /\/FlateDecode/.test(head);
      streams.push({ body: body, flate: isFlate });
      idx = e + 9;
    }
    var texts = [];
    for (var k = 0; k < streams.length; k++) {
      var st = streams[k], payload = null;
      if (st.flate) {
        try {
          var bytesIn = new Uint8Array(st.body.length);
          for (var b = 0; b < st.body.length; b++) bytesIn[b] = st.body.charCodeAt(b) & 0xff;
          var outBytes = await inflateZlib(bytesIn);
          payload = textOf(outBytes);
        } catch (err) { payload = null; }
      } else {
        payload = st.body;
      }
      if (!payload) continue;
      if (!/BT[\s\S]{0,4000}ET/.test(payload) && !/Tj|TJ/.test(payload)) continue;
      texts.push(extractTextOps(payload));
    }
    var text = texts.join("\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    var meta = {};
    var m;
    if ((m = raw.match(/\/Title\s*\(([^)]{1,200})\)/))) meta.title = m[1];
    if ((m = raw.match(/\/Author\s*\(([^)]{1,200})\)/))) meta.author = m[1];
    if ((m = raw.match(/\/CreationDate\s*\(D:(\d{4})(\d{2})(\d{2})/))) meta.date = m[1] + "-" + m[2] + "-" + m[3];
    var pages = (raw.match(/\/Type\s*\/Page[^s]/g) || []).length;
    return {
      text: text, meta: meta, pages: pages,
      // a scanned page has essentially no text layer; a short born-digital
      // page is still born-digital, so the test is per page, not absolute
      scanned: pages > 0 && text.replace(/\s/g, "").length / pages < 40,
      note: text.length ? null : "no text layer found: this looks like a scanned document, which needs OCR. That is not available offline here, and guessing at the content would be worse than saying so."
    };
  }

  /** Text-showing operators: (string) Tj, [..] TJ, ' and " variants. */
  function extractTextOps(content) {
    var out = [], i = 0;
    function readLiteral(pos) {
      var depth = 1, s = "";
      pos++;
      while (pos < content.length && depth > 0) {
        var ch = content[pos];
        if (ch === "\\") {
          var nx = content[pos + 1];
          if (nx === "n") { s += "\n"; pos += 2; continue; }
          if (nx === "r") { s += "\r"; pos += 2; continue; }
          if (nx === "t") { s += "\t"; pos += 2; continue; }
          if (nx === "(" || nx === ")" || nx === "\\") { s += nx; pos += 2; continue; }
          if (nx >= "0" && nx <= "7") { s += String.fromCharCode(parseInt(content.substr(pos + 1, 3), 8)); pos += 4; continue; }
          s += nx; pos += 2; continue;
        }
        if (ch === "(") depth++;
        if (ch === ")") { depth--; if (!depth) { pos++; break; } }
        s += ch; pos++;
      }
      return { text: s, pos: pos };
    }
    while (i < content.length) {
      var ch = content[i];
      if (ch === "(") {
        var r = readLiteral(i);
        out.push(r.text);
        i = r.pos;
        continue;
      }
      if (ch === "<" && content[i + 1] !== "<") {
        var end = content.indexOf(">", i);
        if (end < 0) break;
        var hex = content.slice(i + 1, end).replace(/[^0-9A-Fa-f]/g, "");
        var str = "";
        for (var h = 0; h + 1 < hex.length; h += 2) {
          var code = parseInt(hex.substr(h, 2), 16);
          if (code >= 32 || code === 10) str += String.fromCharCode(code);
        }
        out.push(str);
        i = end + 1;
        continue;
      }
      if (ch === "T" && /^T[dD*]/.test(content.substr(i, 2))) { out.push("\n"); i += 2; continue; }
      i++;
    }
    return out.join("")
      .replace(/\u0000/g, "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  /* ------------------------------------------------------- office formats -- */
  function stripXml(xml) {
    return xml
      .replace(/<w:p[ >]/g, "\n<w:p ")
      .replace(/<a:p>/g, "\n<a:p>")
      .replace(/<text:p[ >]/g, "\n<text:p ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(+d); })
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function unescapeXml(s) {
    return String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(+d); });
  }

  /**
   * A spreadsheet is only searchable if its cells keep their column names, so
   * the first row is treated as a header and every later row becomes a
   * "column: value" sentence. Shared-string and inline-string cells are both
   * resolved; without that a sheet of text reads as a list of numbers.
   */
  function readXlsx(files) {
    var shared = [];
    if (files["xl/sharedStrings.xml"]) {
      var ss = textOf(files["xl/sharedStrings.xml"]);
      (ss.match(/<si>[\s\S]*?<\/si>/g) || []).forEach(function (si) {
        var bits = (si.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).map(function (t) { return t.replace(/<[^>]+>/g, ""); });
        shared.push(unescapeXml(bits.join("")));
      });
    }
    var sheets = Object.keys(files).filter(function (k) { return /^xl\/worksheets\/sheet\d+\.xml$/.test(k) && files[k]; });
    var out = [];
    sheets.forEach(function (name) {
      var xml = textOf(files[name]);
      var rows = xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || [];
      var header = {};
      rows.forEach(function (row, ri) {
        var cells = row.match(/<c[^>]*[\s\S]*?<\/c>/g) || [];
        var pairs = [];
        cells.forEach(function (c) {
          var ref = (c.match(/r="([A-Z]+)\d+"/) || [])[1] || "";
          var type = (c.match(/t="([^"]+)"/) || [])[1] || "";
          var v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
          var inline = c.match(/<is>[\s\S]*?<\/is>/);
          var val = "";
          if (type === "s" && v != null) val = shared[+v] != null ? shared[+v] : "";
          else if (v != null) val = v;
          else if (inline) val = unescapeXml(inline[0].replace(/<[^>]+>/g, ""));
          if (val === "" || val == null) return;
          pairs.push({ col: ref, val: unescapeXml(String(val)) });
        });
        if (!pairs.length) return;
        if (ri === 0) {
          pairs.forEach(function (p) { header[p.col] = p.val; });
          out.push("columns: " + pairs.map(function (p) { return p.val; }).join(", "));
          return;
        }
        out.push(pairs.map(function (p) { return (header[p.col] || p.col) + ": " + p.val; }).join("; "));
      });
    });
    return out.join("\n");
  }

  async function readZipXml(bytes, wanted) {
    var files = await unzip(bytes), parts = [];
    for (var name in files) {
      if (!files[name]) continue;
      if (!wanted.test(name)) continue;
      parts.push(stripXml(textOf(files[name])));
    }
    return parts.join("\n\n");
  }

  function parseCsv(text) {
    var rows = [], row = [], cell = "", q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === "," || c === "\t") { row.push(cell); cell = ""; }
      else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (c !== "\r") cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  function csvToText(text) {
    var rows = parseCsv(text);
    if (!rows.length) return { text: "", rows: 0, cols: 0 };
    var header = rows[0];
    var lines = [];
    for (var i = 1; i < rows.length && i <= 400; i++) {
      var pairs = [];
      for (var j = 0; j < Math.min(header.length, rows[i].length); j++) {
        if (String(rows[i][j]).trim()) pairs.push(header[j].trim() + ": " + rows[i][j].trim());
      }
      if (pairs.length) lines.push(pairs.join("; "));
    }
    return { text: lines.join("\n"), rows: rows.length - 1, cols: header.length };
  }

  function htmlToText(html) {
    return String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
      .replace(/<\/(p|div|h[1-6]|li|tr|section|article)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function jsonToText(json) {
    var out = [];
    (function walk(node, path) {
      if (node == null) return;
      if (Array.isArray(node)) {
        node.slice(0, 200).forEach(function (v, i) { walk(v, path + "[" + i + "]"); });
      } else if (typeof node === "object") {
        Object.keys(node).slice(0, 200).forEach(function (k) { walk(node[k], path ? path + "." + k : k); });
      } else if (String(node).trim()) {
        out.push(path + ": " + node);
      }
    })(json, "");
    return out.slice(0, 800).join("\n");
  }

  /* -------------------------------------------------------- injection scan - */
  var INJECTION = [
    { id: "instruction-override", re: /\b(ignore (all |any )?(previous|prior|above) (instructions|prompts?)|disregard (your|the) (instructions|rules)|you are now|new instructions:)\b/i, note: "text that tries to address the system rather than the reader" },
    { id: "exfiltration", re: /\b(send|post|upload|forward)\b[^.]{0,60}\b(to|at)\b\s*(https?:\/\/|[\w.-]+@)/i, note: "instruction to send data somewhere" },
    { id: "credential", re: /\b(api[_-]?key|password|secret|bearer|token)\s*[:=]\s*\S+/i, note: "a credential-shaped string" },
    { id: "hidden-text", re: /[\u200b-\u200f\u202a-\u202e\u2060\ufeff]{2,}/, note: "zero-width or direction-override characters used to hide text" },
    { id: "html-script", re: /<script\b|onerror\s*=|javascript:/i, note: "executable markup in a document" },
    { id: "template", re: /\{\{[^}]{2,60}\}\}|\$\{[^}]{2,60}\}/, note: "template placeholders that may expand at render time" }
  ];

  function scanForInjection(text) {
    var hits = [];
    INJECTION.forEach(function (r) {
      var m = String(text).match(new RegExp(r.re.source, "gi"));
      if (m) hits.push({ id: r.id, note: r.note, sample: String(m[0]).slice(0, 80), count: m.length });
    });
    return { clean: hits.length === 0, hits: hits,
      note: hits.length ? "This document contains text that looks like an instruction to a machine, not content for a reader. It is indexed as text only and never executed."
                        : "No injection patterns found." };
  }

  /* ------------------------------------------------------------- chunking -- */
  function chunk(text, size, overlap) {
    size = size || 900; overlap = overlap || 120;
    var paras = String(text).split(/\n{2,}/), out = [], buf = "";
    paras.forEach(function (p) {
      if ((buf + " " + p).length > size && buf) {
        out.push(buf.trim());
        buf = buf.slice(Math.max(0, buf.length - overlap)) + " " + p;
      } else {
        buf += (buf ? "\n\n" : "") + p;
      }
    });
    if (buf.trim()) out.push(buf.trim());
    // a single huge paragraph still needs splitting
    var final = [];
    out.forEach(function (c) {
      if (c.length <= size * 1.6) { final.push(c); return; }
      for (var i = 0; i < c.length; i += size - overlap) final.push(c.slice(i, i + size));
    });
    return final.filter(function (c) { return c.trim().length > 40; });
  }

  /* ----------------------------------------------------------- file read --- */
  function extOf(name) { return (String(name).match(/\.([a-z0-9]+)$/i) || [, ""])[1].toLowerCase(); }

  var IMAGE = /^(png|jpe?g|gif|webp|bmp|tiff?|heic|svg)$/i;
  var AUDIO = /^(mp3|wav|ogg|m4a|flac|aac|opus)$/i;
  var VIDEO = /^(mp4|mov|avi|mkv|webm)$/i;

  async function readFile(file) {
    var name = file.name || "document";
    var ext = extOf(name);
    var bytes = new Uint8Array(await file.arrayBuffer());
    var out = { name: name, ext: ext, text: "", meta: {}, note: null, kind: "document" };

    try {
      if (ext === "pdf") {
        var pdf = await readPdf(bytes);
        out.text = pdf.text; out.meta = pdf.meta; out.pages = pdf.pages;
        out.scanned = pdf.scanned;          // surfaced so the UI can say "needs OCR"
        out.kind = "pdf";
        if (pdf.note) out.note = pdf.note;
      } else if (ext === "docx" || ext === "pptx" || ext === "xlsx" || ext === "odt" || ext === "odp" || ext === "ods") {
        if (ext === "xlsx") {
          var files = await unzip(bytes);
          out.text = readXlsx(files);
          out.kind = "spreadsheet";
          out.meta.sheets = Object.keys(files).filter(function (k) { return /^xl\/worksheets\/sheet\d+\.xml$/.test(k); }).length;
        } else {
          var wanted = ext === "docx" ? /^word\/(document|footnotes|endnotes)\.xml$/
            : ext === "pptx" ? /^ppt\/slides\/slide\d+\.xml$/
            : /^content\.xml$/;
          out.text = await readZipXml(bytes, wanted);
          out.kind = ext === "pptx" ? "slides" : "document";
          if (ext === "pptx") out.slides = (Object.keys(await unzip(bytes)).filter(function (k) { return /^ppt\/slides\/slide\d+\.xml$/.test(k); })).length;
        }
        if (!out.text) out.note = "the archive opened but no text was found inside it";
      } else if (ext === "csv" || ext === "tsv") {
        var c = csvToText(textOf(bytes));
        out.text = c.text; out.meta.rows = c.rows; out.meta.columns = c.cols; out.kind = "dataset";
        if (!c.rows) out.note = "the file has no data rows after the header";
      } else if (ext === "json") {
        var parsed = JSON.parse(textOf(bytes));
        out.text = jsonToText(parsed); out.kind = "dataset";
      } else if (ext === "html" || ext === "htm") {
        out.text = htmlToText(textOf(bytes)); out.kind = "webpage";
      } else if (ext === "md" || ext === "markdown") {
        out.text = textOf(bytes).replace(/```[\s\S]*?```/g, " ").replace(/^#+\s*/gm, "").trim();
        out.kind = "notes";
      } else if (ext === "txt" || ext === "text" || ext === "rtf") {
        out.text = textOf(bytes).replace(/\\[a-z]+\d* ?/g, " ").trim();
        out.kind = "text";
      } else if (ext === "zip") {
        var zf = await unzip(bytes);
        var names = Object.keys(zf).filter(function (n) { return zf[n] && !/\/$/.test(n); });
        var collected = [];
        for (var i = 0; i < names.length && i < 60; i++) {
          var sub = names[i], subExt = extOf(sub);
          if (/^(txt|md|csv|tsv|json|html|htm)$/.test(subExt) && zf[sub]) {
            var t = textOf(zf[sub]);
            collected.push("## " + sub + "\n" + (subExt === "html" || subExt === "htm" ? htmlToText(t) : subExt === "csv" ? csvToText(t).text : t));
          }
        }
        out.text = collected.join("\n\n"); out.kind = "bundle";
        out.meta.entries = names.length;
        if (!out.text) out.note = "the archive contains " + names.length + " file(s) but none in a readable text format";
      } else if (IMAGE.test(ext)) {
        out.kind = "image";
        out.text = "Image file " + name + " (" + Math.round(file.size / 1024) + " KB).";
        out.note = "images are catalogued by name, size and format only. Reading text out of a picture needs OCR, which is not available offline here.";
      } else if (AUDIO.test(ext) || VIDEO.test(ext)) {
        out.kind = AUDIO.test(ext) ? "audio" : "video";
        out.text = "";
        out.note = "audio and video need decoding and speech recognition. Offline this engine can only index a transcript you provide, so paste one in the text box instead.";
      } else {
        out.text = textOf(bytes);
        out.kind = "unknown";
      }
    } catch (err) {
      out.note = "could not read this file: " + (err && err.message ? err.message : "unknown error");
    }

    out.text = String(out.text || "").replace(/\u0000/g, "").trim();
    out.words = out.text ? out.text.split(/\s+/).length : 0;
    out.scan = scanForInjection(out.text);
    return out;
  }

  /* ------------------------------------------------------------ ingest ----- */
  var INGEST_LANG = /[\u0900-\u097F]/;

  /**
   * Turn a parsed file into indexable documents. Each chunk becomes its own
   * record so a long report is retrieved by section, not by its cover page.
   */
  function toDocuments(read, opts) {
    opts = opts || {};
    var docs = [];
    var baseId = "u" + Date.now().toString(36);
    var title = (read.meta && read.meta.title) || read.name.replace(/\.[a-z0-9]+$/i, "");
    var date = (read.meta && read.meta.date) || new Date().toISOString().slice(0, 10);
    var pieces = chunk(read.text, opts.size, opts.overlap);
    if (!pieces.length && read.text) pieces = [read.text];
    pieces.forEach(function (piece, i) {
      var tags = uniqWords(piece).slice(0, 8);
      docs.push({
        id: baseId + "-" + i,
        t: title + (pieces.length > 1 ? " (part " + (i + 1) + ")" : ""),
        s: opts.source || read.name,
        o: opts.org || "Your import",
        ty: "import",
        y: parseInt(date.slice(0, 4), 10) || new Date().getFullYear(),
        d: date,
        u: opts.url || "",
        l: INGEST_LANG.test(piece) ? "hi" : "en",
        a: opts.authority || 3,
        k: tags,
        e: tags.slice(0, 4),
        b: piece,
        imported: true,
        origin: { name: read.name, kind: read.kind, words: read.words, note: read.note }
      });
    });
    return docs;
  }

  function uniqWords(text) {
    var seen = {}, out = [];
    L.tokenise(text).forEach(function (w) {
      if (w.length < 4 || seen[w]) return;
      seen[w] = 1; out.push(w);
    });
    return out.sort(function (a, b) { return b.length - a.length; });
  }

  /** Near-duplicate check against what is already indexed. */
  function isDuplicate(doc, index) {
    var docs = (index && index.docs) || root.DOCS || [];
    var evd = ANV.evidence;
    for (var i = 0; i < docs.length; i++) {
      if (docs[i].id === doc.id) continue;
      if (evd.textSimilarity(docs[i].b, doc.b) > 0.82) return docs[i];
    }
    return null;
  }

  /**
   * Add documents to the live index, incrementally: only the new records are
   * tokenised, and the index is rebuilt in one pass. Returns what changed.
   */
  function addToIndex(docs, opts) {
    opts = opts || {};
    var added = [], skipped = [];
    docs.forEach(function (d) {
      var dup = isDuplicate(d, root.INDEX);
      if (dup && !opts.force) { skipped.push({ id: d.id, duplicateOf: dup.id, title: dup.t }); return; }
      (root.DOCS || []).push(d);
      added.push(d);
    });
    if (added.length && typeof root.rebuildEverything === "function") {
      root.rebuildEverything();
    } else if (added.length && typeof root.buildIndex === "function") {
      root.INDEX = root.buildIndex(root.DOCS);
    }
    var version = (ANV.learn && ANV.learn.snapshot) ? ANV.learn.snapshot("import: " + added.length + " document(s)") : null;
    return { added: added.length, skipped: skipped, version: version, total: (root.DOCS || []).length };
  }

  ANV.ingest = {
    readFile: readFile, unzip: unzip, readPdf: readPdf, inflateRaw: inflateRaw,
    csvToText: csvToText, htmlToText: htmlToText, jsonToText: jsonToText,
    scanForInjection: scanForInjection, chunk: chunk, toDocuments: toDocuments,
    isDuplicate: isDuplicate, addToIndex: addToIndex,
    SUPPORTED: ["pdf", "docx", "pptx", "xlsx", "odt", "csv", "tsv", "json", "html", "md", "txt", "zip"],
    UNSUPPORTED: { images: "catalogued, not read (no offline OCR)", audio: "needs a transcript", video: "needs a transcript" }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = ANV.ingest;
})(typeof globalThis !== "undefined" ? globalThis : this);
