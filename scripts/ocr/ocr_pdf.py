"""PaperDesk offline PDF OCR. Never downloads models or opens network sockets."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--pdf', required=True)
    parser.add_argument('--language', default='eng')
    args = parser.parse_args()
    try:
        import pymupdf
    except ImportError:
        raise RuntimeError('缺少 PyMuPDF。请在本机执行 python -m pip install -r scripts/ocr/requirements.txt')
    binary = os.environ.get('PAPERDESK_TESSERACT') or shutil.which('tesseract')
    if not binary or not Path(binary).is_file():
        raise RuntimeError('未找到 Tesseract；请安装本地 OCR 引擎并设置 PAPERDESK_TESSERACT 或加入 PATH。')
    pdf = Path(args.pdf).resolve(strict=True)
    pages = []
    with pymupdf.open(pdf) as document, tempfile.TemporaryDirectory(prefix='paperdesk-ocr-') as scratch:
        if document.needs_pass:
            raise RuntimeError('PDF 有密码，请先在本地解密后导入。')
        for index, page in enumerate(document):
            # Preserve native text on mixed PDFs, OCR only pages without usable text.
            text = page.get_text().strip()
            if len(text) < 20:
                image = Path(scratch) / f'page-{index}.png'
                page.get_pixmap(dpi=200, alpha=False).save(str(image))
                result = subprocess.run([binary, str(image), 'stdout', '-l', args.language],
                                        capture_output=True, text=True, encoding='utf-8',
                                        timeout=120, check=False)
                image.unlink(missing_ok=True)
                if result.returncode:
                    raise RuntimeError(f'第 {index + 1} 页 OCR 失败：{result.stderr.strip()}')
                text = result.stdout.strip()
            pages.append({'pageIndex': index, 'text': text})
    print(json.dumps(pages, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
