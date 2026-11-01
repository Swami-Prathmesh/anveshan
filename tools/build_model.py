#!/usr/bin/env python3
"""
ANVESHAN v4 - build-time semantic model compiler.

Compiles the document corpus into a compact, offline model that the browser
engine can use without any network call:

  * distributional word embeddings  (PPMI co-occurrence -> randomised SVD)
  * int8-quantised vectors + per-dimension scales (base64)
  * document embeddings (tf-idf weighted centroid, unit length)
  * nearest-neighbour tables (for concept expansion)
  * distributional sense clusters for ambiguous terms (2-means on neighbours)
  * an entity gazetteer with coarse types
  * a trilingual concept lexicon (English / Hindi / Sanskrit / romanised)

Output: src/data/model.js   (a single JS file assigning window.ANV_MODEL)
"""
import base64
import json
import math
import re
import sys
import collections

import numpy as np

DIMS = 72
WINDOW = 8
MIN_DF = 2
SENSE_TERMS = 260
SENSE_K = 2

STOP = set("""a an and are as at be been but by for from had has have how i if in into is it its of on or
that the their then there these they this to was were what when where which who why will with you your
we our us do does did can could should would about me my more most other some such no not yet only own
same than too very s t just don now run runs work works tell give show need needs use used using also
may many much get gets like want wants please""".split())


def load_corpus(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def tokenise(text):
    out = []
    for w in re.findall(r"[a-z][a-z\-']{1,}|[\u0900-\u097F]{1,}", str(text).lower()):
        w = w.strip("-'")
        if len(w) < 2 or w in STOP:
            continue
        out.append(w)
    return out


def build_ppmi(docs, vocab_index, V):
    co = collections.Counter()
    total = 0
    for d in docs:
        toks = tokenise(d["t"] + " " + d["t"] + " " + " ".join(d.get("k") or []) + " " + d["b"])
        ids = [vocab_index[t] for t in toks if t in vocab_index]
        n = len(ids)
        for i in range(n):
            lo = max(0, i - WINDOW)
            hi = min(n, i + WINDOW + 1)
            for j in range(lo, hi):
                if i == j:
                    continue
                a, b = ids[i], ids[j]
                co[(a, b)] += 1.0 / abs(i - j)
                total += 1.0
    # marginal counts
    row = np.zeros(V)
    col = np.zeros(V)
    for (a, b), c in co.items():
        row[a] += c
        col[b] += c
    M = np.zeros((V, V), dtype=np.float32)
    grand = total if total else 1.0
    for (a, b), c in co.items():
        pmi = math.log((c * grand) / (row[a] * col[b] + 1e-9) + 1e-12)
        if pmi > 0:
            M[a, b] = pmi
    return M


def randomised_svd(M, k, iters=6, seed=7):
    rng = np.random.default_rng(seed)
    n = M.shape[1]
    Q = rng.standard_normal((n, k + 12)).astype(np.float32)
    for _ in range(iters):
        Q, _ = np.linalg.qr(M @ Q)
        Q, _ = np.linalg.qr(M.T @ Q)
    B = (M.T @ Q).T          # (k+p, n)
    Ub, S, Vt = np.linalg.svd(B, full_matrices=False)
    U = Q @ Ub
    return U[:, :k], S[:k], Vt[:k]


def quantise(mat):
    """int8 quantisation with a per-dimension scale, stored as base64."""
    dims = mat.shape[1]
    scale = np.abs(mat).max(axis=0) / 127.0
    scale[scale == 0] = 1.0
    q = np.clip(np.round(mat / scale), -127, 127).astype(np.int8)
    return base64.b64encode(q.tobytes()).decode("ascii"), [round(float(s), 6) for s in scale]


# ---------------------------------------------------------------- lexicon ----
# English concept -> Hindi + Sanskrit surface forms + romanised spellings.
# Curated, not machine-generated: every pair is a term a Hindi or Sanskrit
# reader would actually type when looking for the English concept.
LEXICON = [
    ("search", ["खोज", "तलाश", "खोजना"], ["अन्वेषण", "मार्गण"], ["khoj", "talash", "anveshan"]),
    ("research", ["शोध", "अनुसंधान"], ["शोध", "अनुसंधान"], ["shodh", "anusandhan"]),
    ("knowledge", ["ज्ञान"], ["ज्ञान", "विद्या"], ["gyan", "vidya"]),
    ("science", ["विज्ञान"], ["विज्ञान"], ["vigyan"]),
    ("evidence", ["प्रमाण", "सबूत"], ["प्रमाण"], ["praman", "saboot"]),
    ("truth", ["सत्य", "सच"], ["सत्य"], ["satya", "sach"]),
    ("source", ["स्रोत"], ["स्रोत"], ["srot"]),
    ("data", ["डेटा", "आंकड़े"], ["दत्तांश"], ["data", "aankde"]),
    ("information", ["सूचना", "जानकारी"], ["सूचना"], ["soochna", "jankari"]),
    ("language", ["भाषा"], ["भाषा"], ["bhasha"]),
    ("translation", ["अनुवाद"], ["अनुवाद"], ["anuvad"]),
    ("word", ["शब्द"], ["शब्द", "पद"], ["shabd", "pad"]),
    ("meaning", ["अर्थ", "मतलब"], ["अर्थ"], ["arth", "matlab"]),
    ("context", ["संदर्भ"], ["प्रसंग"], ["sandarbh", "prasang"]),
    ("question", ["प्रश्न", "सवाल"], ["प्रश्न"], ["prashn", "sawal"]),
    ("answer", ["उत्तर", "जवाब"], ["उत्तर"], ["uttar", "jawab"]),
    ("government", ["सरकार"], ["शासन"], ["sarkar", "shasan"]),
    ("policy", ["नीति"], ["नीति"], ["niti"]),
    ("law", ["कानून", "विधि"], ["विधि", "धर्म"], ["kanoon", "vidhi"]),
    ("rights", ["अधिकार"], ["अधिकार"], ["adhikar"]),
    ("freedom", ["स्वतंत्रता", "आज़ादी"], ["स्वातंत्र्य"], ["swatantrata", "azadi"]),
    ("society", ["समाज"], ["समाज"], ["samaj"]),
    ("economy", ["अर्थव्यवस्था"], ["अर्थशास्त्र"], ["arthvyavastha"]),
    ("trade", ["व्यापार"], ["वाणिज्य"], ["vyapar", "vanijya"]),
    ("industry", ["उद्योग"], ["उद्योग"], ["udyog"]),
    ("technology", ["तकनीक", "प्रौद्योगिकी"], ["तन्त्रज्ञान"], ["takneek", "praudyogiki"]),
    ("computer", ["संगणक", "कंप्यूटर"], ["संगणक"], ["sanganak", "computer"]),
    ("machine", ["यंत्र", "मशीन"], ["यंत्र"], ["yantra", "machine"]),
    ("network", ["जाल", "नेटवर्क"], ["जाल"], ["jaal", "network"]),
    ("privacy", ["गोपनीयता", "निजता"], ["गोपनीयता"], ["gopniyata", "nijata"]),
    ("security", ["सुरक्षा"], ["सुरक्षा"], ["suraksha"]),
    ("energy", ["ऊर्जा"], ["ऊर्जा", "शक्ति"], ["urja", "shakti"]),
    ("water", ["जल", "पानी"], ["जल", "अप्"], ["jal", "pani", "ap"]),
    ("agriculture", ["कृषि", "खेती"], ["कृषि"], ["krishi", "kheti"]),
    ("education", ["शिक्षा"], ["शिक्षा", "विद्या"], ["shiksha"]),
    ("university", ["विश्वविद्यालय"], ["विश्वविद्यालय"], ["vishwavidyalaya"]),
    ("health", ["स्वास्थ्य"], ["आरोग्य"], ["swasthya", "aarogya"]),
    ("medicine", ["चिकित्सा", "दवा"], ["चिकित्सा", "आयुर्वेद"], ["chikitsa", "dawa", "ayurved"]),
    ("life", ["जीवन", "जीव"], ["जीवन", "प्राण"], ["jeevan", "jiv", "pran"]),
    ("cell", ["कोशिका"], ["कोशिका"], ["koshika"]),
    ("matter", ["पदार्थ", "द्रव्य"], ["द्रव्य", "पदार्थ"], ["padarth", "dravya"]),
    ("atom", ["परमाणु"], ["परमाणु"], ["parmanu"]),
    ("light", ["प्रकाश"], ["प्रकाश", "ज्योति"], ["prakash", "jyoti"]),
    ("sound", ["ध्वनि", "आवाज़"], ["ध्वनि", "शब्द"], ["dhwani", "aawaz"]),
    ("earth", ["पृथ्वी", "धरती"], ["पृथ्वी", "भूमि"], ["prithvi", "dharti", "bhumi"]),
    ("sky", ["आकाश"], ["आकाश", "गगन"], ["akash", "gagan"]),
    ("space", ["अंतरिक्ष"], ["अंतरिक्ष", "आकाश"], ["antariksh"]),
    ("sun", ["सूर्य"], ["सूर्य", "रवि"], ["surya", "ravi"]),
    ("moon", ["चंद्र", "चाँद"], ["चन्द्र"], ["chandra", "chand"]),
    ("planet", ["ग्रह"], ["ग्रह"], ["grah"]),
    ("star", ["तारा", "नक्षत्र"], ["नक्षत्र", "तारा"], ["tara", "nakshatra"]),
    ("astronomy", ["खगोल", "खगोल विज्ञान"], ["खगोलशास्त्र"], ["khagol", "khagolvigyan"]),
    ("mathematics", ["गणित"], ["गणित"], ["ganit"]),
    ("physics", ["भौतिकी", "भौतिक शास्त्र"], ["भौतिकशास्त्र"], ["bhautiki"]),
    ("chemistry", ["रसायन"], ["रसायनशास्त्र"], ["rasayan"]),
    ("biology", ["जीव विज्ञान"], ["जीवविज्ञान"], ["jivvigyan"]),
    ("philosophy", ["दर्शन"], ["दर्शन"], ["darshan"]),
    ("history", ["इतिहास"], ["इतिहास", "पुरावृत्त"], ["itihas", "puravritta"]),
    ("geography", ["भूगोल"], ["भूगोल"], ["bhugol"]),
    ("map", ["नक्शा", "मानचित्र"], ["मानचित्र"], ["naksha", "manchitra"]),
    ("time", ["समय", "काल"], ["काल", "समय"], ["samay", "kaal"]),
    ("place", ["स्थान", "जगह"], ["स्थान", "देश"], ["sthan", "jagah"]),
    ("country", ["देश", "राष्ट्र"], ["राष्ट्र", "देश"], ["desh", "rashtra"]),
    ("city", ["शहर", "नगर"], ["नगर", "पुर"], ["shahar", "nagar"]),
    ("village", ["गाँव", "ग्राम"], ["ग्राम"], ["gaon", "gram"]),
    ("book", ["पुस्तक", "किताब"], ["पुस्तक", "ग्रन्थ"], ["pustak", "kitab", "granth"]),
    ("manuscript", ["पांडुलिपि", "हस्तलिखित"], ["पाण्डुलिपि"], ["pandulipi"]),
    ("archive", ["अभिलेख", "पुरालेख"], ["अभिलेख"], ["abhilekh"]),
    ("text", ["पाठ", "ग्रंथ"], ["पाठ", "ग्रन्थ"], ["paath", "granth"]),
    ("cause", ["कारण", "वजह"], ["कारण", "हेतु"], ["karan", "wajah", "hetu"]),
    ("effect", ["प्रभाव", "परिणाम"], ["परिणाम", "फल"], ["prabhav", "parinam", "phal"]),
    ("reason", ["तर्क", "कारण"], ["तर्क", "युक्ति"], ["tark", "yukti"]),
    ("logic", ["तर्क"], ["न्याय", "तर्क"], ["tark", "nyaya"]),
    ("doubt", ["संदेह", "शंका"], ["संशय"], ["sandesh", "shanka", "samshay"]),
    ("proof", ["प्रमाण", "सिद्धि"], ["प्रमाण", "सिद्धि"], ["praman", "siddhi"]),
    ("money", ["धन", "पैसा"], ["धन", "वित्त"], ["dhan", "paisa", "vitt"]),
    ("payment", ["भुगतान"], ["भुगतान"], ["bhugtan"]),
    ("bank", ["बैंक"], ["बैंक"], ["bank"]),
    ("identity", ["पहचान"], ["अभिज्ञान"], ["pehchan", "abhigyan"]),
    ("document", ["दस्तावेज़"], ["दस्तावेज़", "पत्र"], ["dastavez", "patra"]),
    ("certificate", ["प्रमाणपत्र"], ["प्रमाणपत्र"], ["pramanpatra"]),
    ("scheme", ["योजना"], ["योजना"], ["yojana"]),
    ("service", ["सेवा"], ["सेवा"], ["seva"]),
    ("welfare", ["कल्याण"], ["कल्याण"], ["kalyan"]),
    ("citizen", ["नागरिक"], ["नागरिक"], ["nagrik"]),
    ("population", ["जनसंख्या", "आबादी"], ["जनसंख्या"], ["jansankhya", "aabadi"]),
    ("climate", ["जलवायु"], ["जलवायु"], ["jalvayu"]),
    ("carbon", ["कार्बन"], ["कार्बन"], ["carbon"]),
    ("solar", ["सौर"], ["सौर"], ["saur"]),
    ("power", ["शक्ति", "बिजली"], ["शक्ति"], ["shakti", "bijli"]),
    ("war", ["युद्ध"], ["युद्ध"], ["yuddh"]),
    ("peace", ["शांति"], ["शान्ति"], ["shanti"]),
    ("empire", ["साम्राज्य"], ["साम्राज्य"], ["samrajya"]),
    ("king", ["राजा"], ["राजन्"], ["raja"]),
    ("art", ["कला"], ["कला"], ["kala"]),
    ("culture", ["संस्कृति"], ["संस्कृति"], ["sanskriti"]),
    ("religion", ["धर्म"], ["धर्म"], ["dharm"]),
    ("tradition", ["परंपरा"], ["परम्परा"], ["parampara"]),
    ("children", ["बच्चे", "शिशु"], ["बालक"], ["bachche", "shishu"]),
    ("women", ["महिलाएँ", "स्त्रियाँ"], ["स्त्री"], ["mahilayen", "stri"]),
    ("food", ["भोजन", "अन्न"], ["अन्न", "भोजन"], ["bhojan", "ann"]),
    ("seed", ["बीज"], ["बीज"], ["beej"]),
    ("soil", ["मिट्टी", "भूमि"], ["मृदा"], ["mitti", "mrida"]),
    ("rain", ["वर्षा", "बारिश"], ["वर्षा", "वृष्टि"], ["varsha", "barish"]),
    ("river", ["नदी"], ["नदी", "सरिता"], ["nadi", "sarita"]),
    ("mountain", ["पर्वत", "पहाड़"], ["पर्वत", "गिरि"], ["parvat", "pahad", "giri"]),
    ("forest", ["वन", "जंगल"], ["वन", "अरण्य"], ["van", "jangal", "aranya"]),
    ("ocean", ["समुद्र", "सागर"], ["समुद्र", "सागर"], ["samudra", "sagar"]),
    ("fire", ["अग्नि", "आग"], ["अग्नि"], ["agni", "aag"]),
    ("air", ["वायु", "हवा"], ["वायु"], ["vayu", "hawa"]),
    ("metal", ["धातु"], ["धातु", "लोहा"], ["dhatu", "loha"]),
    ("mineral", ["खनिज"], ["खनिज"], ["khanij"]),
    ("disease", ["रोग", "बीमारी"], ["रोग", "व्याधि"], ["rog", "bimari", "vyadhi"]),
    ("treatment", ["उपचार", "इलाज"], ["चिकित्सा", "उपचार"], ["upchar", "ilaj"]),
    ("vaccine", ["टीका"], ["टीका"], ["teeka"]),
    ("mind", ["मन"], ["मनस्", "चित्त"], ["man", "chitta"]),
    ("memory", ["स्मृति", "याद"], ["स्मृति"], ["smriti", "yaad"]),
    ("learning", ["अधिगम", "सीखना"], ["अध्ययन", "शिक्षा"], ["adhigam", "seekhna"]),
    ("model", ["मॉडल", "प्रतिरूप"], ["प्रतिमान"], ["model", "pratirup"]),
    ("intelligence", ["बुद्धिमत्ता"], ["बुद्धि", "प्रज्ञा"], ["buddhimatta", "buddhi", "pragya"]),
    ("artificial", ["कृत्रिम"], ["कृत्रिम"], ["kritrim"]),
    ("compute", ["गणना", "कंप्यूट"], ["गणनशक्ति"], ["ganana", "compute"]),
    ("research paper", ["शोध पत्र"], ["शोधपत्र"], ["shodh patra"]),
    ("discovery", ["खोज", "अविष्कार"], ["अन्वेषण", "आविष्कार"], ["khoj", "avishkar"]),
    ("unknown", ["अज्ञात"], ["अज्ञात", "अविदित"], ["agyat", "avidit"]),
    ("future", ["भविष्य"], ["भविष्य", "भविष्यत्"], ["bhavishya"]),
    ("past", ["अतीत", "भूतकाल"], ["अतीत"], ["ateet", "bhootkaal"]),
    ("change", ["परिवर्तन", "बदलाव"], ["परिवर्तन", "विकार"], ["parivartan", "badlav"]),
    ("growth", ["वृद्धि", "विकास"], ["वृद्धि", "विकास"], ["vriddhi", "vikas"]),
    ("risk", ["जोखिम", "खतरा"], ["संकट", "भय"], ["jokhim", "khatra", "sankat"]),
    ("access", ["पहुँच"], ["प्रवेश"], ["pahunch", "pravesh"]),
    ("language model", ["भाषा मॉडल"], ["भाषाप्रतिमान"], ["bhasha model"]),
    ("voice", ["आवाज़", "स्वर"], ["स्वर"], ["aawaz", "swar"]),
    ("speech", ["वाक्", "भाषण"], ["वाक्"], ["vaak", "bhashan"]),
    ("blockchain", ["ब्लॉकचेन"], ["शृंखला"], ["blockchain", "shrinkhala"]),
    ("internet", ["इंटरनेट"], ["अंतर्जाल"], ["internet", "antarjaal"]),
    ("mobile", ["मोबाइल"], ["चलभाष"], ["mobile", "chalabh"]),
    ("education policy", ["शिक्षा नीति"], ["शिक्षानीति"], ["shiksha niti"]),
    ("water resources", ["जल संसाधन"], ["जलस्रोत"], ["jal sansadhan"]),
    ("renewable", ["नवीकरणीय"], ["नवीकरणीय"], ["navikarniya"]),
    ("electricity", ["बिजली", "विद्युत"], ["विद्युत्"], ["bijli", "vidyut"]),
    ("crop", ["फ़सल"], ["सस्य"], ["fasal", "sasya"]),
    ("farmer", ["किसान"], ["कृषक"], ["kisan", "krishak"]),
    ("institution", ["संस्था"], ["संस्था"], ["sanstha"]),
    ("ministry", ["मंत्रालय"], ["मन्त्रालय"], ["mantralaya"]),
    ("commission", ["आयोग"], ["आयोग"], ["aayog"]),
    ("university research", ["विश्वविद्यालय शोध"], ["विश्वविद्यालय शोध"], ["vishwavidyalaya shodh"]),
    ("energy security", ["ऊर्जा सुरक्षा"], ["ऊर्जा सुरक्षा"], ["urja suraksha"]),
    ("public health", ["जन स्वास्थ्य"], ["जनस्वास्थ्य"], ["jan swasthya"]),
    ("inequality", ["असमानता"], ["असमता"], ["asamanata"]),
    ("measurement", ["मापन"], ["मापन", "प्रमाण"], ["maapan"]),
    ("experiment", ["प्रयोग"], ["प्रयोग"], ["prayog"]),
    ("hypothesis", ["परिकल्पना"], ["परिकल्पना"], ["parikalpana"]),
    ("simulation", ["अनुकरण"], ["अनुकरण"], ["anukaran"]),
    ("reproducibility", ["पुनरुत्पादन"], ["पुनरुत्पादन"], ["punarutpadan"]),
    ("citation", ["उद्धरण"], ["उद्धरण"], ["uddharan"]),
    ("reliability", ["विश्वसनीयता"], ["विश्वसनीयता"], ["vishwasniyata"]),
    ("uncertainty", ["अनिश्चितता"], ["अनिश्चय"], ["anishchitata"]),
    ("contradiction", ["विरोधाभास"], ["विरोध"], ["virodhabhas", "virodh"]),
    ("consensus", ["सहमति"], ["सम्मति"], ["sahmati", "sammati"]),
    ("timeline", ["समयरेखा"], ["कालक्रम"], ["samayrekha", "kaalkram"]),
    ("graph", ["आलेख", "ग्राफ"], ["आलेख"], ["aalekh", "graph"]),
    ("relationship", ["संबंध"], ["संबन्ध"], ["sambandh"]),
    ("classification", ["वर्गीकरण"], ["वर्गीकरण"], ["vargikaran"]),
    ("summary", ["सारांश"], ["सारांश"], ["saransh"]),
    ("export", ["निर्यात"], ["निर्यात"], ["niryat"]),
    ("import", ["आयात"], ["आयात"], ["aayat"]),
    ("tax", ["कर"], ["कर"], ["kar"]),
    ("budget", ["बजट"], ["बजट"], ["budget"]),
    ("employment", ["रोजगार"], ["रोजगार"], ["rojgar"]),
    ("poverty", ["गरीबी"], ["दारिद्र्य"], ["garibi", "daridrya"]),
    ("women empowerment", ["महिला सशक्तिकरण"], ["नारीशक्ति"], ["mahila sashaktikaran"]),
    ("sanitation", ["स्वच्छता"], ["शौच"], ["swachhta"]),
    ("housing", ["आवास"], ["आवास"], ["aavas"]),
    ("railway", ["रेल"], ["रेल"], ["rail"]),
    ("road", ["सड़क", "मार्ग"], ["मार्ग"], ["sadak", "marg"]),
    ("defence", ["रक्षा"], ["रक्षा"], ["raksha"]),
    ("election", ["चुनाव"], ["निर्वाचन"], ["chunav", "nirvachan"]),
    ("democracy", ["लोकतंत्र"], ["लोकतन्त्र"], ["loktantra"]),
    ("constitution", ["संविधान"], ["संविधान"], ["samvidhan"]),
    ("court", ["न्यायालय", "अदालत"], ["न्यायालय"], ["nyayalaya", "adalat"]),
    ("police", ["पुलिस"], ["पुलिस"], ["police"]),
    ("disaster", ["आपदा"], ["आपदा"], ["aapda"]),
    ("flood", ["बाढ़"], ["प्लावन"], ["badh"]),
    ("earthquake", ["भूकंप"], ["भूकम्प"], ["bhookamp"]),
    ("pollution", ["प्रदूषण"], ["प्रदूषण"], ["pradushan"]),
    ("biodiversity", ["जैव विविधता"], ["जैवविविधता"], ["jaiv vividhata"]),
    ("sanskrit", ["संस्कृत"], ["संस्कृतम्"], ["sanskrit"]),
    ("hindi", ["हिन्दी", "हिंदी"], ["हिन्दी"], ["hindi"]),
    ("india", ["भारत", "हिंदुस्तान"], ["भारतम्"], ["bharat", "hindustan"]),
]


def build_gazetteer(docs):
    PLACES = set("""india delhi mumbai kolkata chennai bengaluru bangalore hyderabad pune ahmedabad jaipur lucknow
    bhopal patna ranchi raipur chandigarh srinagar guwahati bhubaneswar thiruvananthapuram kochi goa
    uttar pradesh madhya pradesh andhra pradesh arunachal assam bihar chhattisgarh gujarat haryana
    himachal jharkhand karnataka kerala maharashtra manipur meghalaya mizoram nagaland odisha punjab
    rajasthan sikkim tamil nadu telangana tripura uttarakhand west bengal ladakh jammu kashmir
    china pakistan bangladesh nepal sri lanka myanmar bhutan afghanistan iran iraq israel turkey egypt
    russia ukraine europe germany france britain united kingdom usa america japan korea vietnam
    indonesia malaysia singapore australia canada brazil africa kenya nigeria south africa
    ganges yamuna brahmaputra godavari krishna narmada himalaya thar arabian sea bay bengal
    moon mars sun earth jupiter saturn venus mercury neptune pluto sirius andromeda""".split())
    PERSONS = set("""gandhi nehru ambedkar tagore aryabhata bhaskara sushruta charaka panini patanjali
    kalidasa kautilya chanakya ashoka akbar einstein newton bohr curie darwin turing shannon
    raman srinivasa ramanujan bose satyendra chandrasekhar sarao kalam vikram sarabhai
    hitler napoleon alexander caesar plato aristotle socrates kant hegel marx keynes""".split())
    ORG_HINT = re.compile(r"\b(ministry|department|authority|board|commission|institute|university|"
                          r"bank|corporation|ltd|limited|foundation|council|organisation|organization|"
                          r"agency|bureau|society|association|centre|center|laboratory|labs|office|"
                          r"committee|mission|programme|program|network|alliance|consortium|"
                          r"pib|uidai|npci|rbi|sebi|meity|niti|isro|drdo|icar|csir|icmr|iit|iim|iisc|"
                          r"cern|nasa|esa|who|unesco|unicef|world bank|imf|un|oecd|ieee|iso|w3c|"
                          r"openai|google|microsoft|meta|amazon|nvidia|sarvam|bhashini|indiaai|ondc|"
                          r"digilocker|aadhaar|aikosh|vishvasya|gem|myscheme|bharatnet)\b", re.I)
    LAW_HINT = re.compile(r"\b(act|rules|regulations|bill|code|amendment|ordinance|treaty|convention)\b", re.I)
    SCHEME_HINT = re.compile(r"\b(scheme|yojana|mission|programme|abhiyan|policy|framework|guidelines)\b", re.I)

    g = {}

    def add(name, typ, doc_id):
        name = str(name).strip()
        if len(name) < 3:
            return
        key = name.lower()
        e = g.setdefault(key, {"n": name, "ty": typ, "docs": []})
        if doc_id not in e["docs"]:
            e["docs"].append(doc_id)

    for d in docs:
        for e in (d.get("e") or []):
            add(e, "concept", d["id"])
        if d.get("o"):
            add(d["o"], "organization", d["id"])
        for tag in (d.get("k") or []):
            add(tag, "concept", d["id"])

    for key, e in g.items():
        low = key
        toks = set(re.findall(r"[a-z]+", low))
        if low in PLACES or (toks & PLACES):
            e["ty"] = "place"
        elif low in PERSONS or (toks & PERSONS):
            e["ty"] = "person"
        elif LAW_HINT.search(low):
            e["ty"] = "law"
        elif SCHEME_HINT.search(low):
            e["ty"] = "scheme"
        elif ORG_HINT.search(low):
            e["ty"] = "organization"
        elif len(low.split()) >= 2:
            e["ty"] = e["ty"] if e["ty"] != "concept" else "concept"
    # keep entities that actually occur, sorted by document support
    out = [v for v in g.values() if v["docs"]]
    out.sort(key=lambda v: -len(v["docs"]))
    return out[:900]


def main():
    corpus_path = sys.argv[1] if len(sys.argv) > 1 else "corpus.json"
    out_path = sys.argv[2] if len(sys.argv) > 2 else "src/data/model.js"
    docs = load_corpus(corpus_path)

    # ---- vocabulary -------------------------------------------------------
    df = collections.Counter()
    for d in docs:
        for w in set(tokenise(d["t"] + " " + " ".join(d.get("k") or []) + " " + d["b"])):
            df[w] += 1
    vocab = sorted([w for w, c in df.items() if c >= MIN_DF])
    vocab_index = {w: i for i, w in enumerate(vocab)}
    V = len(vocab)
    N = len(docs)
    idf = [round(math.log(1 + (N - df[w] + 0.5) / (df[w] + 0.5)), 4) for w in vocab]

    # ---- embeddings -------------------------------------------------------
    M = build_ppmi(docs, vocab_index, V)
    U, S, Vt = randomised_svd(M, DIMS)
    W = U * np.sqrt(np.maximum(S, 1e-6))          # word vectors
    norms = np.linalg.norm(W, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    W = (W / norms).astype(np.float32)

    # ---- document vectors (tf-idf weighted centroid) ----------------------
    D = np.zeros((N, DIMS), dtype=np.float32)
    for i, d in enumerate(docs):
        toks = tokenise(d["t"] + " " + d["t"] + " " + " ".join(d.get("k") or []) + " " + d["b"])
        vec = np.zeros(DIMS, dtype=np.float32)
        for t in toks:
            j = vocab_index.get(t)
            if j is None:
                continue
            vec += W[j] * idf[j]
        n = np.linalg.norm(vec)
        D[i] = vec / (n if n else 1.0)

    # ---- nearest neighbours ----------------------------------------------
    sims = W @ W.T
    np.fill_diagonal(sims, -9.0)
    top = np.argsort(-sims, axis=1)[:, :14]
    neighbours = [[vocab[j] for j in row if sims[row[0] if False else 0][0] == sims[0][0] or True]
                  for row in top]
    neighbours = [[vocab[int(j)] for j in row] for row in top]

    # ---- distributional senses -------------------------------------------
    senses = {}
    order = np.argsort(-np.array([df[w] for w in vocab]))
    for idx in order[:SENSE_TERMS]:
        w = vocab[int(idx)]
        if df[w] < 4:
            continue
        nb = top[idx][:24]
        vecs = W[nb]
        if len(nb) < 6:
            continue
        # 2-means on the neighbour vectors, deterministic init at the extremes
        c = np.stack([vecs[0], vecs[len(vecs) // 2]])
        for _ in range(12):
            lab = np.argmax(vecs @ c.T, axis=1)
            for k in (0, 1):
                sel = vecs[lab == k]
                if len(sel):
                    c[k] = sel.mean(axis=0) / (np.linalg.norm(sel.mean(axis=0)) or 1.0)
        groups = [[vocab[int(nb[m])] for m in range(len(nb)) if lab[m] == k] for k in (0, 1)]
        if len(groups[0]) >= 3 and len(groups[1]) >= 3:
            senses[w] = [g[:6] for g in groups]

    # ---- serialise --------------------------------------------------------
    wq, wscale = quantise(W)
    dq, dscale = quantise(D)
    model = {
        "v": 4,
        "dims": DIMS,
        "vocab": vocab,
        "idf": idf,
        "wq": wq,
        "ws": wscale,
        "dq": dq,
        "ds": dscale[0] if isinstance(dscale, list) else dscale,
        "nn": neighbours,
        "senses": senses,
        "gaz": build_gazetteer(docs),
        "lex": [{"en": e, "hi": hi, "sa": sa, "ro": ro} for (e, hi, sa, ro) in LEXICON],
        "stats": {"docs": N, "vocab": V, "dims": DIMS, "nn": 14},
    }
    js = "/* ANVESHAN v4 semantic model - compiled offline, no network, no weights from any vendor. */\n"
    js += "window.ANV_MODEL = " + json.dumps(model, ensure_ascii=False, separators=(",", ":")) + ";\n"
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(js)
    size = len(js.encode("utf-8"))
    print(f"vocab={V} dims={DIMS} docs={N} senses={len(senses)} gaz={len(model['gaz'])} "
          f"lex={len(model['lex'])} bytes={size}")
    print("sample neighbours:", {w: neighbours[vocab_index[w]][:6] for w in
                                 ["quantum", "payment", "language", "water", "empire"] if w in vocab_index})


if __name__ == "__main__":
    main()
