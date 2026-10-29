"""Offline English -> Chinese translation; JSON-lines stdin/stdout only.

Uses Argos' OpenNMT model with CTranslate2, SentencePiece and pySBD. No HTTP,
account, shell execution or language-model service is used by this worker.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import re
import sys
import threading


def normalize_pdf_text(text):
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"(?<=[A-Za-z])-\n(?=[a-z])", "", text)
    return [re.sub(r"\s+", " ", part).strip() for part in re.split(r"\n\s*\n", text) if part.strip()]


def token_chunks(tokens, limit=192):
    # Explicit chunks avoid CTranslate2's silent maximum-input truncation.
    return [tokens[start:start + limit] for start in range(0, len(tokens), limit)]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", required=True)
    args = parser.parse_args()
    output_lock = threading.Lock()

    def emit(value):
        with output_lock:
            print(json.dumps(value, ensure_ascii=False), flush=True)

    try:
        import ctranslate2
        import sentencepiece
        import pysbd
        root = Path(args.model_dir)
        metadata = json.loads((root / "metadata.json").read_text(encoding="utf-8"))
        if metadata.get("from_code") != "en" or metadata.get("to_code") != "zh":
            raise ValueError("Unsupported language package")
        tokenizer = sentencepiece.SentencePieceProcessor(model_file=str(root / "sentencepiece.model"))
        segmenter = pysbd.Segmenter(language="en", clean=False)
        translator = ctranslate2.Translator(str(root / "model"), device="cpu", compute_type="int8",
                                            inter_threads=1, intra_threads=min(4, os.cpu_count() or 1))
        prefix = metadata.get("target_prefix", "")
    except Exception as error:
        emit({"type": "startup-error", "error": f"Offline engine initialization failed: {error}"})
        return 1

    emit({"type": "ready", "engine": "CTranslate2", "computeType": "int8", "from": "en", "to": "zh"})
    cancellations = {}
    cancellation_lock = threading.Lock()

    def translate(request, canceled):
        request_id = request["id"]
        try:
            output = []
            paragraphs = normalize_pdf_text(request["text"])
            for paragraph_index, paragraph in enumerate(paragraphs):
                if paragraph_index:
                    output.append("\n\n")
                    emit({"id": request_id, "type": "delta", "delta": "\n\n"})
                for sentence in segmenter.segment(paragraph):
                    for tokens in token_chunks(tokenizer.encode(sentence, out_type=str)):
                        if canceled.is_set():
                            raise InterruptedError("Translation canceled")
                        options = {"target_prefix": [[prefix]]} if prefix else {}
                        result = translator.translate_batch([tokens], beam_size=3, replace_unknowns=True,
                                                            max_input_length=0, max_decoding_length=768, **options)
                        if canceled.is_set():
                            raise InterruptedError("Translation canceled")
                        text = tokenizer.decode(result[0].hypotheses[0])
                        if prefix and text.startswith(prefix):
                            text = text[len(prefix):]
                        text = text.strip()
                        output.append(text)
                        emit({"id": request_id, "type": "delta", "delta": text})
            text = "".join(output).strip()
            if not text:
                raise ValueError("No translated text returned")
            emit({"id": request_id, "type": "done", "translation": text})
        except InterruptedError:
            emit({"id": request_id, "type": "canceled"})
        except Exception as error:
            emit({"id": request_id, "type": "error", "error": str(error)})
        finally:
            with cancellation_lock:
                cancellations.pop(request_id, None)

    with ThreadPoolExecutor(max_workers=1) as executor:
        for line in sys.stdin:
            try:
                request = json.loads(line)
                request_id = request.get("id")
                if request.get("type") == "cancel":
                    with cancellation_lock:
                        if request_id in cancellations:
                            cancellations[request_id].set()
                    continue
                if request.get("type") != "translate" or not isinstance(request_id, str) or not isinstance(request.get("text"), str):
                    continue
                with cancellation_lock:
                    if request_id in cancellations:
                        continue
                    canceled = threading.Event()
                    cancellations[request_id] = canceled
                executor.submit(translate, request, canceled)
            except (ValueError, TypeError):
                continue
        with cancellation_lock:
            for canceled in cancellations.values():
                canceled.set()
    return 0


if __name__ == "__main__":
    sys.exit(main())
