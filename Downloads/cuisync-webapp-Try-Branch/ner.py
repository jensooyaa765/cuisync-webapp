"""Ingredient NER for the Admin page (Dish Management).

Uses the team's fine-tuned BERT model (BertForTokenClassification, labels O / B-INGREDIENT /
I-INGREDIENT) to pull the ingredients out of recipe text that the admin pastes, then compares
each one with the ingredients that already have a vector:

    existing   -> already in ingredients_items.json (has a vector, ready to use)
    suggested  -> close to an existing item ("Did you mean ...?")
    new        -> not in the dataset yet (borrows the closest vector until the vectorizer runs again)

The model can run in one of two places. The first one that is set up is used:

  1. LOCAL: put the model files in a folder named  ner_model/  next to app.py
     (config.json, model.safetensors, tokenizer.json, tokenizer_config.json)
     and install:  pip install transformers torch
     Good for running on your own computer.

  2. REMOTE: a Hugging Face Space running the NER server. Set in .env:
         NER_API_URL=https://<your-space>.hf.space
         NER_API_TOKEN=<the Space's token>
     Good for Render, where a 435 MB model + torch is too big for the free plan.

Used by app.py: init(root, item_names), status(), extract_and_match(text), NerError.
"""
import difflib
import os
import re
import threading
import time

MIN_SCORE = 0.50        # lowest confidence still accepted for an ingredient
WINDOW_WORDS = 200      # words per BERT window (BERT takes at most 512 word pieces)
MAX_CHARS = 20000       # most recipe text accepted at once
SUGGEST_CUTOFF = 0.85   # how close a name must be to an existing item to suggest it

NER_API_URL = os.environ.get("NER_API_URL", "").strip().rstrip("/")
NER_API_TOKEN = os.environ.get("NER_API_TOKEN", "").strip()
NER_API_TIMEOUT = float(os.environ.get("NER_API_TIMEOUT", "180"))  # a sleeping Space needs time to wake


class NerError(Exception):
    """A message the admin should see."""


_model_dir = None
_tokenizer = _model = _torch = None
_id2label = {}
_load_error = None
_loaded = threading.Event()
_load_lock = threading.Lock()

_existing = {}   # normalized name -> name as written in ingredients_items.json
_keys = []


# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

def init(root, item_names):
    """Call at startup and again after the dataset changes (item_names = MATCHER.items['ingredients'])."""
    global _model_dir, _existing, _keys
    folder = os.environ.get("NER_MODEL_DIR", "").strip() or os.path.join(root, "ner_model")
    _model_dir = folder if os.path.isfile(os.path.join(folder, "config.json")) else None
    _existing = {}
    for item in item_names:
        _existing.setdefault(normalize(item), item)
    _keys = list(_existing)
    # Load the local model in the background so the first click is faster
    if _model_dir and not _loaded.is_set() and _load_error is None:
        threading.Thread(target=_load_local, daemon=True).start()


def mode():
    if _model_dir:
        return "local"
    if NER_API_URL:
        return "remote"
    return None


def status():
    """Short status for the admin pages."""
    m = mode()
    if m == "local":
        if _load_error:
            return {"mode": m, "ready": False, "text": f"Local model could not load: {_load_error}"}
        return {"mode": m, "ready": _loaded.is_set(),
                "text": "Local model (ner_model/)" + ("" if _loaded.is_set() else ", loading…")}
    if m == "remote":
        return {"mode": m, "ready": True, "text": "Hugging Face Space (NER_API_URL)"}
    return {"mode": None, "ready": False,
            "text": "Not set up. Put the model in ner_model/ or set NER_API_URL in .env."}


# ---------------------------------------------------------------------------
# Normalizing: the same rules dataset_store.py uses to find an item's vector
# ---------------------------------------------------------------------------

def _singular(word):
    if len(word) > 3 and word.endswith("es") and word[:-2].endswith(("sh", "ch", "o", "x")):
        return word[:-2]
    if len(word) > 3 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        return word[:-1]
    return word


def normalize(name):
    name = re.sub(r"[^\w\s\-']", " ", str(name).lower())
    return " ".join(_singular(w) for w in name.split())


# ---------------------------------------------------------------------------
# 1. Local model (transformers + torch)
# ---------------------------------------------------------------------------

def _load_local():
    global _tokenizer, _model, _torch, _id2label, _load_error
    with _load_lock:
        if _loaded.is_set() or _load_error:
            return
        try:
            import torch
            from transformers import AutoModelForTokenClassification, AutoTokenizer
        except ImportError:
            _load_error = "the packages are missing (run: pip install transformers torch)"
            print("[CuiSync] NER:", _load_error)
            return
        try:
            _tokenizer = AutoTokenizer.from_pretrained(_model_dir)
            _model = AutoModelForTokenClassification.from_pretrained(_model_dir)
            _model.eval()
            _torch = torch
            _id2label = {int(k): v for k, v in _model.config.id2label.items()}
            _loaded.set()
            print("[CuiSync] NER model loaded from", _model_dir)
        except Exception as error:  # broken or incomplete model folder
            _load_error = str(error).splitlines()[0][:200]
            print("[CuiSync] NER model could not load:", error)


# Words, numbers and fractions stay together; punctuation is its own token ("garlic," -> "garlic" ",")
_WORD = re.compile(r"\d+/\d+|\d+(?:\.\d+)?|[^\W\d_]+(?:['\-][^\W\d_]+)*|[^\w\s]", re.UNICODE)


def _tag_words(words):
    """Give each WORD one label: the label of its first word piece."""
    encoded = _tokenizer(words, is_split_into_words=True, truncation=True, max_length=512, return_tensors="pt")
    with _torch.no_grad():
        logits = _model(**encoded).logits[0]
    best_prob, best_id = _torch.softmax(logits, dim=-1).max(dim=-1)
    labels, seen = [("O", 0.0)] * len(words), set()
    for token_index, word_index in enumerate(encoded.word_ids(0)):
        if word_index is None or word_index in seen:
            continue
        seen.add(word_index)
        labels[word_index] = (_id2label[int(best_id[token_index])], float(best_prob[token_index]))
    return labels


def _join_entities(words, labels):
    """B-INGREDIENT starts an ingredient, I-INGREDIENT continues it, O ends it."""
    entities, current, scores = [], [], []

    def close():
        if current:
            entities.append((" ".join(current), sum(scores) / len(scores)))
        current.clear()
        scores.clear()

    for word, (label, score) in zip(words, labels):
        if label.endswith("INGREDIENT") and (label.startswith("B-") or not current):
            close()
            current.append(word)
            scores.append(score)
        elif label.endswith("INGREDIENT"):
            current.append(word)
            scores.append(score)
        else:
            close()
    close()
    return entities


def _clean(name):
    name = re.sub(r"\s*-\s*", "-", name)
    name = re.sub(r"\s*'\s*", "'", name)
    return " ".join(name.split()).lower()


def _extract_local(text):
    if not _loaded.is_set():
        if _load_error:
            raise NerError(f"The NER model could not load: {_load_error}")
        _load_local()  # first click before the background load finished: wait for it
        if not _loaded.is_set():
            raise NerError(f"The NER model could not load: {_load_error}")
    found = {}
    for line in (l.strip() for l in re.split(r"[\r\n]+", text)):
        line_words = _WORD.findall(line)
        for start in range(0, len(line_words), WINDOW_WORDS):
            words = line_words[start:start + WINDOW_WORDS]
            if not words:
                continue
            for name, score in _join_entities(words, _tag_words(words)):
                name = _clean(name)
                if not name or score < MIN_SCORE or not re.search(r"[^\W\d_]", name):
                    continue
                if name not in found or score > found[name]:
                    found[name] = score
    return [{"name": n, "score": round(s, 3)} for n, s in found.items()]


# ---------------------------------------------------------------------------
# 2. Remote model (Hugging Face Space)
# ---------------------------------------------------------------------------

def _extract_remote(text):
    import requests
    headers = {"Authorization": f"Bearer {NER_API_TOKEN}"} if NER_API_TOKEN else {}
    deadline = time.monotonic() + NER_API_TIMEOUT
    while True:
        try:
            response = requests.post(NER_API_URL + "/extract", json={"text": text}, headers=headers,
                                     timeout=max(5.0, deadline - time.monotonic()))
            if response.status_code not in (502, 503, 504):  # these mean the Space is waking up
                data = response.json()
                if response.status_code != 200:
                    raise NerError(data.get("message") or f"NER service error ({response.status_code}).")
                return data.get("ingredients", [])
            problem = f"HTTP {response.status_code}"
        except (requests.ConnectionError, requests.Timeout) as error:
            problem = type(error).__name__
        except ValueError:
            raise NerError("The NER service sent an unreadable answer.")
        if time.monotonic() > deadline:
            raise NerError(f"The NER service didn't answer in time ({problem}). Please try again.")
        time.sleep(5)


# ---------------------------------------------------------------------------
# Main function
# ---------------------------------------------------------------------------

def extract_and_match(text):
    """Ingredients in the recipe text, each marked existing / suggested / new."""
    text = (text or "").strip()
    if not text:
        raise NerError("Paste the recipe text first.")
    if len(text) > MAX_CHARS:
        raise NerError(f"The recipe text is too long (over {MAX_CHARS:,} characters).")
    m = mode()
    if m == "local":
        entities = _extract_local(text)
    elif m == "remote":
        entities = _extract_remote(text)
    else:
        raise NerError(status()["text"])

    results, seen = [], set()
    for entity in entities:
        shown = " ".join(str(entity.get("name", "")).lower().split())  # as the model found it
        key = normalize(shown)                                           # only used for matching
        if not key or key in seen:
            continue
        seen.add(key)
        score = entity.get("score")
        if key in _existing:
            results.append({"name": _existing[key], "status": "existing", "score": score})
            continue
        close = difflib.get_close_matches(key, _keys, n=1, cutoff=SUGGEST_CUTOFF)
        if close:
            results.append({"name": shown, "status": "suggested", "suggestion": _existing[close[0]], "score": score})
        else:
            results.append({"name": shown, "status": "new", "score": score})
    return results
