/* ============================================================================
   ANVESHAN v4 - LAYER 1: LANGUAGE
   Script detection, Devanagari <-> Latin transliteration, sandhi-aware
   Sanskrit segmentation, language-specific stemming, multilingual stopwords,
   tokenisation and sentence segmentation.

   Everything is deterministic and runs locally. No transliteration service,
   no translation API: the Sanskrit/Hindi handling here is rule-based, and the
   rules are stated in the code rather than hidden behind a model.
   ========================================================================== */
(function (root) {
  "use strict";

  var ANV = root.ANV = root.ANV || {};

  /* ---------------------------------------------------------------- scripts */
  var DEVA = /[\u0900-\u097F]/;
  var LATIN = /[A-Za-z]/;

  function scriptOf(text) {
    var s = String(text || ""), deva = 0, lat = 0;
    for (var i = 0; i < s.length; i++) {
      if (DEVA.test(s[i])) deva++;
      else if (LATIN.test(s[i])) lat++;
    }
    if (deva && lat) return "mixed";
    if (deva) return "deva";
    if (lat) return "latin";
    return "none";
  }
  function isDevanagariChar(ch) {
    var c = ch.charCodeAt(0);
    return c >= 0x0900 && c <= 0x097F;
  }

  /* --------------------------------------------------------- transliteration */
  // Devanagari -> Latin (IAST-ish, ASCII friendly). Longest keys first.
  // Latin -> Devanagari. Longest match wins, so digraphs are listed first.
  var L2D = [
    ["ksh", "क्ष"], ["gy", "ज्ञ"], ["tr", "त्र"], ["shr", "श्र"],
    ["kh", "ख"], ["gh", "घ"], ["chh", "छ"], ["ch", "च"], ["jh", "झ"], ["th", "थ"],
    ["dh", "ध"], ["ph", "फ"], ["bh", "भ"], ["sh", "श"], ["ss", "ष"], ["aa", "आ"],
    ["ee", "ई"], ["oo", "ऊ"], ["ai", "ऐ"], ["au", "औ"], ["ri", "ऋ"], ["ng", "ंग"],
    ["k", "क"], ["q", "क़"], ["g", "ग"], ["c", "च"], ["j", "ज"], ["t", "त"], ["d", "द"],
    ["n", "न"], ["p", "प"], ["f", "फ़"], ["b", "ब"], ["m", "म"], ["y", "य"], ["r", "र"],
    ["l", "ल"], ["v", "व"], ["w", "व"], ["s", "स"], ["h", "ह"], ["z", "ज़"],
    ["a", "अ"], ["i", "इ"], ["u", "उ"], ["e", "ए"], ["o", "ओ"], ["x", "क्ष"]
  ];
  var MATRA = { "a": "", "aa": "ा", "i": "ि", "ee": "ी", "u": "ु", "oo": "ू", "ri": "ृ",
                "e": "े", "ai": "ै", "o": "ो", "au": "ौ" };
  var VOWEL_START = { "a": "अ", "aa": "आ", "i": "इ", "ee": "ई", "u": "उ", "oo": "ऊ", "ri": "ऋ",
                      "e": "ए", "ai": "ऐ", "o": "ओ", "au": "औ" };
  var HALANT = "्";

  /* A Devanagari consonant carries an inherent "a" unless a matra, a virama
     or anusvara follows it. Getting this wrong is what makes machine
     transliteration produce "bhrt" for "bharat", so it is handled explicitly. */
  var D_CONS = { "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n", "च": "ch", "छ": "chh",
    "ज": "j", "झ": "jh", "ञ": "n", "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n",
    "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n", "प": "p", "फ": "ph", "ब": "b",
    "भ": "bh", "म": "m", "य": "y", "र": "r", "ल": "l", "व": "v", "श": "sh", "ष": "sh",
    "स": "s", "ह": "h", "ळ": "l", "क़": "q", "ख़": "kh", "ग़": "g", "ज़": "z", "ड़": "r",
    "ढ़": "rh", "फ़": "f", "य़": "y" };
  var D_MATRA = { "ा": "aa", "ि": "i", "ी": "ee", "ु": "u", "ू": "oo", "ृ": "ri",
    "े": "e", "ै": "ai", "ो": "o", "ौ": "au" };
  var D_VOWEL = { "अ": "a", "आ": "aa", "इ": "i", "ई": "ee", "उ": "u", "ऊ": "oo",
    "ऋ": "ri", "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au" };
  var D_CLUSTER = { "क्ष": "ksh", "ज्ञ": "gy", "त्र": "tr", "श्र": "shr", "द्य": "dy", "ह्म": "hm" };

  function devaToLatin(text) {
    var s = String(text || ""), out = "", i = 0;
    while (i < s.length) {
      var three = s.substr(i, 3), two = s.substr(i, 2), ch = s[i];
      if (D_CLUSTER[three]) { out += D_CLUSTER[three] + "a"; i += 3; continue; }
      if (D_CLUSTER[two]) { out += D_CLUSTER[two] + "a"; i += 2; continue; }
      if (D_CONS[two]) {                       // nukta consonants are two code points
        out += D_CONS[two]; i += 2;
        out += vowelAfter(s, i); continue;
      }
      if (D_CONS[ch]) { out += D_CONS[ch]; i += 1; out += vowelAfter(s, i); continue; }
      if (D_VOWEL[ch]) { out += D_VOWEL[ch]; i += 1; continue; }
      if (ch === "ं" || ch === "ँ") { out += "n"; i += 1; continue; }
      if (ch === "ः") { out += "h"; i += 1; continue; }
      if (ch === "्" || ch === "ऽ") { i += 1; continue; }
      if (ch === "।") { out += "."; i += 1; continue; }
      out += ch; i += 1;
    }
    return out;
  }

  // returns the vowel written after a consonant at position i, advancing nothing
  function vowelAfter(s, i) {
    var m = D_MATRA[s[i]];
    if (m !== undefined) return m;
    if (s[i] === "्") return "";
    return "a";
  }

  function latinToDeva(text) {
    var s = String(text || "").toLowerCase(), out = "", i = 0, afterConsonant = false;
    while (i < s.length) {
      var matched = false;
      for (var t = 0; t < L2D.length; t++) {
        var k = L2D[t][0];
        if (s.substr(i, k.length) === k) {
          if (VOWEL_START[k] !== undefined) {
            // after a consonant a vowel is a matra (inherent "a" is silent)
            out += afterConsonant ? MATRA[k] : VOWEL_START[k];
            afterConsonant = false;
          } else {
            if (afterConsonant) out += HALANT;   // cluster: add the virama
            out += L2D[t][1];
            afterConsonant = true;
          }
          i += k.length; matched = true; break;
        }
      }
      if (!matched) { out += s[i]; afterConsonant = false; i++; }
    }
    return out;
  }

  /* --------------------------------------------------------------- stopwords */
  var STOP_EN = ("a an and are as at be been but by for from had has have how i if in into is it its of on or "
    + "that the their then there these they this to was were what when where which who why will with you your "
    + "we our us do does did can could should would about me my more most other some such no not only own same "
    + "than too very s t just don now run runs work works tell give show need needs use used using also "
    + "may many much get gets like want wants please").split(" ");

  var STOP_HI = ("का के की को और में से है हैं था थी थे पर यह वह कि जो एक लिए क्या कैसे कितना कितने कितनी कब कौन हो ने "
    + "नहीं हुआ हुई कर करने वाले साथ बारे लिये हम आप भी तो ही थी तक या एवं अपने उस इस वे वो कुछ सब बहुत अधिक कम "
    + "जैसे वैसे कहाँ क्यों द्वारा हेतु प्रति अनुसार").split(" ");

  var STOP_SA = ("च अपि इति एव हि तु न चैव सः सा तत् ते त्वम् अहम् वयम् यत् यः या एतत् किम् कथम् कुत्र कदा "
    + "अत्र तत्र अस्ति सन्ति भवति नाम अथ ततः यथा तथा एवम् उत अपि च").split(" ");

  var STOP_ALL = {};
  STOP_EN.concat(STOP_HI).concat(STOP_SA).forEach(function (w) { STOP_ALL[w] = 1; });

  /* ---------------------------------------------------------------- stemmers */
  function stemEn(w) {
    if (w.length > 4 && /ies$/.test(w)) return w.slice(0, -3) + "y";
    if (w.length > 4 && /(ses|xes|ches|shes)$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && /s$/.test(w) && !/ss$/.test(w) && !/us$/.test(w)) return w.slice(0, -1);
    if (w.length > 6 && /ingly$/.test(w)) return w.slice(0, -5);
    if (w.length > 5 && /ing$/.test(w)) return w.slice(0, -3);
    if (w.length > 5 && /edly$/.test(w)) return w.slice(0, -4);
    if (w.length > 4 && /ed$/.test(w) && !/eed$/.test(w)) return w.slice(0, -2);
    if (w.length > 5 && /tion$/.test(w)) return w.slice(0, -3);
    if (w.length > 5 && /ment$/.test(w)) return w.slice(0, -4);
    if (w.length > 5 && /ness$/.test(w)) return w.slice(0, -4);
    if (w.length > 4 && /ly$/.test(w)) return w.slice(0, -2);
    return w;
  }

  // Hindi inflection: postpositions and plural/oblique endings carry most of
  // the variation, so stripping them recovers the citation form.
  var HI_SUFFIX = ["ियों", "ियां", "ाओं", "ओं", "ें", "ों", "िय", "ता", "ती", "ते", "ना", "ने", "कर", "पन", "वाला", "वाली"];
  var SA_SUFFIX = ["त्वम्", "त्व", "तया", "स्य", "योः", "ेषु", "ानि", "म्", "ः", "ा", "ी", "े", "ान्", "तु", "ति", "न्ति", "य", "क"];

  function stemHi(w) {
    for (var i = 0; i < HI_SUFFIX.length; i++) {
      var s = HI_SUFFIX[i];
      if (w.length > s.length + 2 && w.slice(-s.length) === s) return w.slice(0, -s.length);
    }
    return w;
  }
  function stemSa(w) {
    for (var i = 0; i < SA_SUFFIX.length; i++) {
      var s = SA_SUFFIX[i];
      if (w.length > s.length + 2 && w.slice(-s.length) === s) return w.slice(0, -s.length);
    }
    return w;
  }
  function stem(w) {
    if (!w) return w;
    if (isDevanagariChar(w[0])) return stemSa(stemHi(w));
    return stemEn(w);
  }

  /* ------------------------------------------------- sandhi-aware splitting */
  var SA_PREFIX = ["अनु", "प्र", "वि", "सम्", "सं", "अधि", "उप", "निर्", "परि", "अप", "अभि", "आ", "नि", "सु", "दुर्", "प्रति", "अव", "उत्", "पुनर्"];
  var SA_TAIL = ["त्व", "ता", "मय", "वत्", "इक", "ईय", "क", "न", "ति", "नम्", "शास्त्र", "विज्ञान", "विद्या", "ज्ञान", "मान", "कार", "वाद"];

  /* Vowel coalescence rules that actually occur at Sanskrit compound joints. */
  var SANDHI_JOIN = [
    ["aa", "a", "a"], ["aa", "a", "aa"], ["aa", "aa", "a"], ["e", "a", "i"], ["e", "aa", "i"],
    ["o", "a", "u"], ["o", "aa", "u"], ["ar", "a", "r"], ["al", "a", "l"],
    ["aa", "i", "aa"], ["ii", "i", "i"], ["uu", "u", "u"], ["ai", "a", "e"], ["au", "a", "o"]
  ];

  /**
   * Split a Sanskrit compound into parts that are attested in the dictionary.
   * `dict` is a set of known surfaces. Returns [] when no split is defensible:
   * a wrong split is worse than no split.
   */
  function sandhiSplit(word, dict) {
    var w = String(word || "");
    if (!w || dict[w]) return [];
    var cands = [];
    for (var i = 2; i <= w.length - 2; i++) {
      var left = w.slice(0, i), right = w.slice(i);
      if (dict[left] && dict[right]) {
        cands.push({ parts: [left, right], score: 2 + Math.min(dict[left], 4) + Math.min(dict[right], 4), rule: "direct" });
      }
    }
    // vowel coalescence: the joined vowel must be reconstructed at the joint
    for (var r = 0; r < SANDHI_JOIN.length; r++) {
      var joined = SANDHI_JOIN[r][0], lv = SANDHI_JOIN[r][1], rv = SANDHI_JOIN[r][2];
      var at = w.indexOf(joined, 1);
      while (at > 0) {
        var l2 = w.slice(0, at) + lv, r2 = rv + w.slice(at + joined.length);
        if (dict[l2] && dict[r2]) cands.push({ parts: [l2, r2], score: 3 + Math.min(dict[l2], 4), rule: "vowel-sandhi" });
        at = w.indexOf(joined, at + 1);
      }
    }
    // prefix / suffix analysis, used when the word is a derived term
    for (var p = 0; p < SA_PREFIX.length; p++) {
      var pre = SA_PREFIX[p];
      if (w.indexOf(pre) === 0 && w.length > pre.length + 2) {
        var rest = w.slice(pre.length);
        if (dict[rest]) cands.push({ parts: [pre, rest], score: 1 + Math.min(dict[rest], 3), rule: "prefix" });
      }
    }
    for (var t = 0; t < SA_TAIL.length; t++) {
      var tail = SA_TAIL[t];
      if (w.length > tail.length + 2 && w.slice(-tail.length) === tail) {
        var head = w.slice(0, -tail.length);
        if (dict[head]) cands.push({ parts: [head, tail], score: 1 + Math.min(dict[head], 3), rule: "suffix" });
      }
    }
    cands.sort(function (a, b) { return b.score - a.score; });
    return cands.slice(0, 3);
  }

  /* ----------------------------------------------------------- normalisation */
  function normalise(text) {
    var s = String(text || "").toLowerCase()
      .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
      .replace(/[\u2013\u2014]/g, "-");
    var out = "";
    for (var i = 0; i < s.length; i++) {
      var ch = s[i], code = ch.charCodeAt(0);
      var keep = (code >= 97 && code <= 122) || (code >= 48 && code <= 57) ||
                 (code >= 0x0900 && code <= 0x097F);
      out += keep ? ch : " ";
    }
    return out.replace(/\s+/g, " ").trim();
  }

  function tokeniseRaw(text) {
    return normalise(text).split(" ").filter(Boolean);
  }

  function tokenise(text, opts) {
    opts = opts || {};
    var parts = tokeniseRaw(text), out = [];
    for (var i = 0; i < parts.length; i++) {
      var w = parts[i];
      if (!opts.keepStop && STOP_ALL[w]) continue;
      if (w.length < 2 && !isDevanagariChar(w[0])) continue;
      out.push(opts.noStem ? w : stem(w));
    }
    return out;
  }

  /* Devanagari uses danda; do not split "Rs 10,372 crore" on the comma. */
  function sentenceSplit(text) {
    var t = String(text || "");
    var parts = t.split(/(?<=[.!?।])\s+/);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var s = parts[i].trim();
      if (s) out.push(s);
    }
    return out;
  }

  ANV.lang = {
    scriptOf: scriptOf, isDevanagariChar: isDevanagariChar,
    devaToLatin: devaToLatin, latinToDeva: latinToDeva,
    stem: stem, stemEn: stemEn, stemHi: stemHi, stemSa: stemSa,
    sandhiSplit: sandhiSplit, normalise: normalise, tokenise: tokenise,
    tokeniseRaw: tokeniseRaw, sentenceSplit: sentenceSplit,
    STOP_EN: STOP_EN, STOP_HI: STOP_HI, STOP_SA: STOP_SA, STOP_ALL: STOP_ALL
  };

  if (typeof module !== "undefined" && module.exports) module.exports = ANV.lang;
})(typeof globalThis !== "undefined" ? globalThis : this);
