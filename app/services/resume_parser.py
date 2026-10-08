from pypdf import PdfReader
from pypdf.errors import PdfReadError


class ResumeParseError(ValueError):
    """Raised when a PDF cannot be turned into resume text."""


def _open_pdf(file_path: str) -> PdfReader:

    try:
        reader = PdfReader(file_path)

    except PdfReadError as e:
        raise ResumeParseError(
            "The PDF file is corrupt or unreadable."
        ) from e

    if reader.is_encrypted:
        raise ResumeParseError(
            "Password-protected PDFs are not supported."
        )

    return reader


def extract_resume_text(file_path: str) -> str:

    reader = _open_pdf(file_path)

    pages_text = []

    try:
        for page in reader.pages:
            text = page.extract_text()

            if text:
                pages_text.append(text)

    except PdfReadError as e:
        raise ResumeParseError(
            "The PDF file is corrupt or unreadable."
        ) from e

    resume_text = "\n".join(pages_text).strip()

    if not resume_text:
        raise ResumeParseError(
            "Could not extract text from the PDF."
        )

    return resume_text
