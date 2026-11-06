"""AI Agents Level Calculator 9:16 result card, 1080 x 1920 PNG.

Draws the level, the composite score, a radar chart with one axis per
active dimension (five or six, read from config.DIMENSIONS, so the
dimension count is a one-line config change), dimension scores, and
per-field verified / estimated / missing status. Uses only Pillow.
"""

import math

from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 1080, 1920

BG = (13, 18, 32)
PANEL = (24, 33, 56)
ACCENT = (94, 234, 212)
ACCENT2 = (167, 139, 250)
TEXT = (240, 244, 248)
MUTED = (148, 163, 184)
VERIFIED = (74, 222, 128)
ESTIMATED = (251, 191, 36)
MISSING = (248, 113, 113)


def _font(size, bold=False):
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _radar(draw, cx, cy, radius, labels, values):
    n = len(labels)
    rings = [0.25, 0.5, 0.75, 1.0]
    for ring in rings:
        pts = []
        for i in range(n):
            angle = -math.pi / 2 + 2 * math.pi * i / n
            pts.append((cx + radius * ring * math.cos(angle), cy + radius * ring * math.sin(angle)))
        draw.polygon(pts, outline=(51, 65, 85))
    for i in range(n):
        angle = -math.pi / 2 + 2 * math.pi * i / n
        x = cx + radius * math.cos(angle)
        y = cy + radius * math.sin(angle)
        draw.line([(cx, cy), (x, y)], fill=(51, 65, 85))
        lx = cx + (radius + 42) * math.cos(angle)
        ly = cy + (radius + 42) * math.sin(angle)
        text = "%s %d" % (labels[i], values[i])
        font = _font(30, bold=True)
        box = draw.textbbox((0, 0), text, font=font)
        draw.text((lx - (box[2] - box[0]) / 2, ly - (box[3] - box[1]) / 2),
                  text, font=font, fill=TEXT)
    pts = []
    for i, value in enumerate(values):
        angle = -math.pi / 2 + 2 * math.pi * i / n
        r = radius * max(0.0, min(1.0, value / 100.0))
        pts.append((cx + r * math.cos(angle), cy + r * math.sin(angle)))
    if pts:
        draw.polygon(pts, fill=(94, 234, 212, 70), outline=ACCENT)
        for x, y in pts:
            draw.ellipse([x - 8, y - 8, x + 8, y + 8], fill=ACCENT)


def render_card(audit):
    """Render the audit dict from pipeline.run_audit to a PIL image."""
    result = audit["result"]
    dims = result["dimensions"]
    order = result["dimension_order"]
    labels = result["dimension_labels"]
    values = [dims[k] for k in order]

    img = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(img, "RGBA")

    draw.rectangle([0, 0, WIDTH, 150], fill=PANEL)
    draw.text((48, 44), "AI Agents Level Calculator", font=_font(56, bold=True), fill=ACCENT)
    draw.text((48, 112), "prove your level with evidence, not self-report",
              font=_font(26), fill=MUTED)

    mode = audit.get("mode", "mock")
    badge = "LIVE AUDIT" if mode == "live" else "MOCK AUDIT - DEMO ONLY"
    draw.text((WIDTH - 48 - draw.textlength(badge, font=_font(26, bold=True)), 58),
              badge, font=_font(26, bold=True), fill=VERIFIED if mode == "live" else ESTIMATED)

    y = 210
    draw.text((48, y), audit.get("agent_name", "Agent"), font=_font(64, bold=True), fill=TEXT)
    y += 92
    draw.text((48, y), "Platform: %s" % audit.get("platform", "other"),
              font=_font(30), fill=MUTED)
    y += 56
    draw.text((48, y), "Level %d - %s" % (result["level"], result["title"]),
              font=_font(48, bold=True), fill=ACCENT2)
    draw.text((WIDTH - 48 - draw.textlength("Composite %d" % result["composite"], font=_font(48, bold=True)), y),
              "Composite %d" % result["composite"], font=_font(48, bold=True), fill=TEXT)
    y += 76
    prov = "PROVISIONAL - rests on estimated or missing fields" if result["provisional"] else "VERIFIED - all scored fields have evidence"
    draw.text((48, y), prov, font=_font(28, bold=True),
              fill=ESTIMATED if result["provisional"] else VERIFIED)
    y += 44
    draw.text((48, y), "Audit confidence %.0f%%  -  XP %d  -  %d credits used" % (
        result["audit_confidence"] * 100, result["xp"], audit.get("credits_used", 0)),
        font=_font(28), fill=MUTED)

    _radar(draw, WIDTH // 2, 1020, 310, labels, values)

    y = 1430
    draw.text((48, y), "Evidence per field", font=_font(32, bold=True), fill=TEXT)
    y += 52
    detail = result.get("field_detail", {})
    shown = 0
    for name in ("persona_items", "domains", "skills", "goals_done", "deliveries", "pass_rate"):
        entry = detail.get(name)
        if not entry:
            continue
        status = entry.get("status", "missing")
        color = VERIFIED if status == "verified" else ESTIMATED if status == "estimated" else MISSING
        draw.ellipse([48, y + 8, 72, y + 32], fill=color)
        draw.text((88, y), "%s: %s  -  %s" % (name, entry.get("value"), status),
                  font=_font(28), fill=TEXT)
        y += 40
        shown += 1
        if shown >= 6:
            break

    draw.text((48, HEIGHT - 96), "What level is your AI agent?", font=_font(30, bold=True), fill=ACCENT)
    draw.text((48, HEIGHT - 56), "Paste the AI Agents Level Calculator link to your agent and ask for its level chart.",
              font=_font(24), fill=MUTED)
    return img


def save_card(audit, path):
    render_card(audit).save(path, "PNG")
    return path
