#!/usr/bin/env python3
"""
Placeholder sheet generator — Jacob Palko portfolio.

Writes minimal, dependency-free PDFs (US Letter) styled like engineering
drawing sheets. Each sheet is stamped as a placeholder so it is obvious
what still needs to be replaced with real content.

Usage:  python3 scripts/make_placeholders.py
Output: assets/resume-placeholder.pdf, assets/projects/project-0N.pdf
"""

import os

PAGE_W, PAGE_H = 612, 792          # US Letter, points
MARGIN = 48

INK = "0.10 0.11 0.12"             # near-black
ACCENT = "1.00 0.30 0.00"          # safety orange
FADE = "0.55 0.56 0.57"            # annotation grey


class Sheet:
    """Tiny streaming builder for a one-page placeholder PDF."""

    def __init__(self):
        self.ops = []

    def stroke(self, r, g, b, w):
        self.ops.append(f"{r:.2f} {g:.2f} {b:.2f} RG {w:.2f} w")

    def line(self, x1, y1, x2, y2):
        self.ops.append(f"{x1:.1f} {y1:.1f} m {x2:.1f} {y2:.1f} l S")

    def rect(self, x, y, w, h):
        self.ops.append(f"{x:.1f} {y:.1f} {w:.1f} {h:.1f} re S")

    def text(self, x, y, size, s, bold=False, rgb=INK):
        font = "/F2" if bold else "/F1"
        self.ops.append(
            f"BT {rgb} {font} {size:.1f} Tf {x:.1f} {y:.1f} Td ({_esc(s)}) Tj ET"
        )

    def watermark(self, s):
        # Rotate 45 degrees about page centre, oversized, light grey.
        cx, cy = PAGE_W / 2, PAGE_H / 2
        size = 64
        dx = -len(s) * size * 0.30
        self.ops.append(
            "BT 0.88 0.88 0.88 /F2 64 Tf "
            "0.7071 0.7071 -0.7071 0.7071 "
            f"{cx + dx:.1f} {cy - 24:.1f} Td ({_esc(s)}) Tj ET"
        )


def _esc(s: str) -> str:
    # StandardEncoding has no typographic dashes; keep the stream pure ASCII.
    s = s.replace("—", "--").replace("–", "-")
    return s.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def build(doc_no: str, title: str, subtitle: str, footer_note: str) -> bytes:
    s = Sheet()
    inner = MARGIN + 8
    frame_w, frame_h = PAGE_W - 2 * MARGIN, PAGE_H - 2 * MARGIN

    # Drawing frame + inner border
    s.stroke(0.10, 0.11, 0.12, 1.4)
    s.rect(MARGIN, MARGIN, frame_w, frame_h)
    s.stroke(0.10, 0.11, 0.12, 0.5)
    s.rect(inner, inner, frame_w - 16, frame_h - 16)

    # Centre marks (drafting convention, outside the inner border)
    cx, cy = PAGE_W / 2, PAGE_H / 2
    s.stroke(0.10, 0.11, 0.12, 0.5)
    s.line(cx, MARGIN - 14, cx, MARGIN - 4)
    s.line(cx, PAGE_H - MARGIN + 4, cx, PAGE_H - MARGIN + 14)
    s.line(MARGIN - 14, cy, MARGIN - 4, cy)
    s.line(PAGE_W - MARGIN + 4, cy, PAGE_W - MARGIN + 14, cy)

    s.watermark("PLACEHOLDER")

    # Header block
    s.stroke(0.10, 0.11, 0.12, 1.0)
    top_y = PAGE_H - inner - 120
    s.rect(inner, top_y, frame_w - 16, 120)
    s.line(inner, top_y + 38, PAGE_W - inner, top_y + 38)
    s.text(inner + 24, top_y + 62, 26, doc_no, bold=True)
    s.text(inner + 24, top_y + 96, 13, "JACOB PALKO — MECHANICAL ENGINEER", bold=True)
    s.text(inner + 24, top_y + 46, 10, subtitle, rgb=FADE)

    # Note body
    body = [
        "THIS SHEET IS A PLACEHOLDER.",
        "",
        "Replace this file with the real document at:",
        f"  assets/{doc_no.lower().replace(' ', '-')}.pdf",
        "",
        footer_note,
    ]
    y = top_y - 90
    for line in body:
        s.text(inner + 24, y, 11, line, rgb=INK if not line.startswith("Replace") else FADE)
        y -= 22

    # Title block (bottom-right, like a real drawing sheet)
    tb_w, tb_h = 300, 84
    tb_x, tb_y = PAGE_W - inner - tb_w, inner
    s.stroke(0.10, 0.11, 0.12, 1.0)
    s.rect(tb_x, tb_y, tb_w, tb_h)
    s.line(tb_x + 150, tb_y, tb_x + 150, tb_y + tb_h)
    s.line(tb_x, tb_y + 42, tb_x + tb_w, tb_y + 42)

    s.text(tb_x + 10, tb_y + 66, 8, "DRAWN", rgb=FADE)
    s.text(tb_x + 10, tb_y + 52, 11, "J. PALKO", bold=True)
    s.text(tb_x + 10, tb_y + 24, 8, "SCALE", rgb=FADE)
    s.text(tb_x + 10, tb_y + 10, 11, "1:1", bold=True)

    s.text(tb_x + 160, tb_y + 66, 8, "DWG NO.", rgb=FADE)
    s.text(tb_x + 160, tb_y + 52, 11, doc_no, bold=True)
    s.text(tb_x + 160, tb_y + 24, 8, "REV", rgb=FADE)
    s.text(tb_x + 160, tb_y + 10, 11, "A", bold=True)

    # Accent tick in the header (the only color on the sheet)
    s.stroke(1.00, 0.30, 0.00, 3.0)
    s.line(inner + 24, top_y + 16, inner + 84, top_y + 16)

    return _wrap_pdf("\n".join(s.ops))


def _wrap_pdf(content: str) -> bytes:
    stream = content.encode("latin-1")
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] "
            f"/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>"
        ).encode(),
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    ]

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for i, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"

    xref_pos = len(out)
    out += f"xref\n0 {len(objs) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for off in offsets[1:]:
        out += f"{off:010d} 00000 n \n".encode()
    out += (
        f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_pos}\n%%EOF\n"
    ).encode()
    return bytes(out)


FILES = [
    ("assets/resume-placeholder.pdf",
     "RESUME", "Curriculum vitae — placeholder sheet",
     "One page, reverse-chronological. Export as PDF/A if a job posting asks for it."),
    ("assets/projects/project-01.pdf",
     "JP-001", "Baja SAE Drivetrain — Redesign & Validation",
     "Include: problem statement, CAD renders, FEA screenshots, test data, your specific role."),
    ("assets/projects/project-02.pdf",
     "JP-002", "FSAE Upright — Topology Optimization Study",
     "Include: load cases, optimization iterations, mass reduction table, DFM notes."),
    ("assets/projects/project-03.pdf",
     "JP-003", "Compact Heat Exchanger — Test Rig Build",
     "Include: schematic, sensor list, uncertainty analysis, epsilon-NTU comparison plot."),
    ("assets/projects/project-04.pdf",
     "JP-004", "4-DOF Robotic Arm — Kinematics & Controls",
     "Include: DH parameters, workspace plot, control architecture, demo QR link."),
]


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for rel, doc_no, title, note in FILES:
        path = os.path.join(root, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(build(doc_no, title, note, note))
        print(f"wrote {rel}")


if __name__ == "__main__":
    main()
