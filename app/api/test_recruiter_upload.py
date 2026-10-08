from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfWriter

from app.main import app
from app.services import resume_upload


URL = "/api/v1/recruiter/upload-resume"

client = TestClient(app)


def make_text_pdf(text: str) -> bytes:
    """Build a minimal one-page PDF that contains real, extractable text."""

    stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode()

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n"
        + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]

    pdf = b"%PDF-1.4\n"
    offsets = []

    for number, body in enumerate(objects, start=1):
        offsets.append(len(pdf))
        pdf += f"{number} 0 obj\n".encode() + body + b"\nendobj\n"

    xref_start = len(pdf)
    pdf += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()

    for offset in offsets:
        pdf += f"{offset:010d} 00000 n \n".encode()

    pdf += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_start}\n%%EOF\n"
    ).encode()

    return pdf


def make_blank_pdf() -> bytes:
    """A valid PDF with a page but no text (like a scanned image resume)."""

    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)

    buffer = BytesIO()
    writer.write(buffer)

    return buffer.getvalue()


def upload(filename: str, contents: bytes, content_type: str):

    return client.post(
        URL,
        files={"file": (filename, contents, content_type)}
    )


@pytest.fixture(autouse=True)
def temp_resume_dir(tmp_path, monkeypatch):

    monkeypatch.setattr(resume_upload, "RESUME_DIR", tmp_path)

    return tmp_path


def test_valid_pdf(temp_resume_dir):

    response = upload(
        "resume.pdf",
        make_text_pdf("Jane Doe Python FastAPI Engineer"),
        "application/pdf"
    )

    assert response.status_code == 200

    body = response.json()

    assert body["message"] == "Resume uploaded successfully."
    assert "Jane Doe" in body["resume_text"]
    assert body["text_length"] == len(body["resume_text"])
    assert body["filename"] == f"{body['file_id']}.pdf"
    assert (temp_resume_dir / body["filename"]).exists()


def test_txt_file_rejected():

    response = upload("resume.txt", b"plain text resume", "text/plain")

    assert response.status_code == 400
    assert response.json()["detail"] == "Only PDF resumes are supported."


def test_empty_file_rejected():

    response = upload("resume.pdf", b"", "application/pdf")

    assert response.status_code == 400
    assert response.json()["detail"] == "Uploaded file is empty."


def test_file_over_5mb_rejected(temp_resume_dir):

    too_big = b"%PDF-1.4\n" + b"0" * resume_upload.MAX_RESUME_SIZE_BYTES

    response = upload("resume.pdf", too_big, "application/pdf")

    assert response.status_code == 400
    assert response.json()["detail"] == "Resume file must be smaller than 5 MB."
    assert list(temp_resume_dir.iterdir()) == []


def test_corrupt_pdf_rejected(temp_resume_dir):

    response = upload(
        "resume.pdf",
        b"this is definitely not a pdf",
        "application/pdf"
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "The PDF file is corrupt or unreadable."
    assert list(temp_resume_dir.iterdir()) == []


def test_pdf_without_text_rejected(temp_resume_dir):

    response = upload("resume.pdf", make_blank_pdf(), "application/pdf")

    assert response.status_code == 400
    assert response.json()["detail"] == "Could not extract text from the PDF."
    assert list(temp_resume_dir.iterdir()) == []
