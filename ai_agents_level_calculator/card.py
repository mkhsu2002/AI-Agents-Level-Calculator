"""AI Agents Level Calculator 9:16 ability card, 1080 x 1920 PNG.

Cyberpunk RPG ability card: neon frame with corner brackets, scanline
grid, a Clocked Empower badge, agent name, race (the agent's
platform), level hex badge, six-axis radar, neon dimension bars, and
per-field evidence status. Uses only Pillow. Text uses Noto Sans CJK
so Chinese labels (種族, 等級, 能力卡) render; Latin text renders
from the same face.
"""

import math

from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 1080, 1920

BG = (5, 7, 15)
PANEL = (10, 16, 32)
CYAN = (0, 240, 255)
MAGENTA = (255, 45, 120)
PURPLE = (167, 139, 250)
YELLOW = (255, 214, 0)
TEXT = (235, 245, 255)
MUTED = (130, 150, 180)
GRID = (0, 240, 255)
VERIFIED = (74, 222, 128)
ESTIMATED = (251, 191, 36)
MISSING = (248, 113, 113)

DIM_COLORS = {
    "IDENTITY": (0, 240, 255),
    "KNOWLEDGE": (94, 234, 212),
    "SKILL": (255, 214, 0),
    "SPAN": (167, 139, 250),
    "RELIABILITY": (255, 45, 120),
    "INTEGRITY": (74, 222, 128),
}

_CJK_BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
_CJK_REGULAR = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
_DEJAVU_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
_DEJAVU = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def _font(size, bold=False):
    # Noto Sans CJK TTC face index 3 is Traditional Chinese; the same
    # face also covers Latin, so one font draws mixed strings.
    candidates = [
        (_CJK_BOLD if bold else _CJK_REGULAR, 3),
        (_DEJAVU_BOLD if bold else _DEJAVU, None),
    ]
    for path, index in candidates:
        try:
            if index is None:
                return ImageFont.truetype(path, size)
            return ImageFont.truetype(path, size, index=index)
        except OSError:
            continue
    return ImageFont.load_default()


def _text(draw, xy, text, font, fill):
    draw.text(xy, text, font=font, fill=fill)


def _text_right(draw, x, y, text, font, fill):
    w = draw.textlength(text, font=font)
    draw.text((x - w, y), text, font=font, fill=fill)


def _text_center(draw, cx, y, text, font, fill):
    w = draw.textlength(text, font=font)
    draw.text((cx - w / 2, y), text, font=font, fill=fill)


def _hexagon(cx, cy, radius):
    return [
        (cx + radius * math.cos(-math.pi / 2 + 2 * math.pi * i / 6),
         cy + radius * math.sin(-math.pi / 2 + 2 * math.pi * i / 6))
        for i in range(6)
    ]


def _bolt(draw, cx, cy, size, fill):
    pts = [
        (cx + size * 0.15, cy - size * 0.55),
        (cx - size * 0.30, cy + size * 0.10),
        (cx - size * 0.02, cy + size * 0.10),
        (cx - size * 0.15, cy + size * 0.55),
        (cx + size * 0.30, cy - size * 0.10),
        (cx + size * 0.02, cy - size * 0.10),
    ]
    draw.polygon(pts, fill=fill)


def _radar(draw, cx, cy, radius, labels, values):
    n = len(labels)
    for ring in (0.25, 0.5, 0.75, 1.0):
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
        lx = cx + (radius + 46) * math.cos(angle)
        ly = cy + (radius + 46) * math.sin(angle)
        text = "%s %d" % (labels[i], values[i])
        font = _font(28, bold=True)
        box = draw.textbbox((0, 0), text, font=font)
        draw.text((lx - (box[2] - box[0]) / 2, ly - (box[3] - box[1]) / 2),
                  text, font=font, fill=TEXT)
    pts = []
    for i, value in enumerate(values):
        angle = -math.pi / 2 + 2 * math.pi * i / n
        r = radius * max(0.0, min(1.0, value / 100.0))
        pts.append((cx + r * math.cos(angle), cy + r * math.sin(angle)))
    if pts:
        draw.polygon(pts, fill=(255, 45, 120, 60), outline=MAGENTA)
        draw.polygon(pts, outline=CYAN)
        for x, y in pts:
            draw.ellipse([x - 8, y - 8, x + 8, y + 8], fill=CYAN)


def _frame(draw):
    # Faint grid.
    for x in range(96, WIDTH, 96):
        draw.line([(x, 24), (x, HEIGHT - 24)], fill=GRID + (10,))
    for y in range(96, HEIGHT, 96):
        draw.line([(24, y), (WIDTH - 24, y)], fill=GRID + (10,))
    # Scanlines.
    for y in range(28, HEIGHT - 24, 6):
        draw.line([(28, y), (WIDTH - 28, y)], fill=(0, 240, 255, 5))
    # Neon double frame.
    draw.rectangle([24, 24, WIDTH - 24, HEIGHT - 24], outline=CYAN, width=3)
    draw.rectangle([34, 34, WIDTH - 34, HEIGHT - 34], outline=(255, 45, 120, 160), width=1)
    # Corner brackets.
    L = 96
    W = 7
    corners = [
        ((24, 24), (1, 1)),
        ((WIDTH - 24, 24), (-1, 1)),
        ((24, HEIGHT - 24), (1, -1)),
        ((WIDTH - 24, HEIGHT - 24), (-1, -1)),
    ]
    for (x, y), (sx, sy) in corners:
        draw.line([(x, y), (x + sx * L, y)], fill=CYAN, width=W)
        draw.line([(x, y), (x, y + sy * L)], fill=CYAN, width=W)


def render_card(audit):
    """Render the audit dict from pipeline.run_audit to a PIL image."""
    result = audit["result"]
    dims = result["dimensions"]
    order = result["dimension_order"]
    labels = result["dimension_labels"]
    values = [dims[k] for k in order]
    mode = audit.get("mode", "mock")
    agent_name = audit.get("agent_name", "Agent")
    race = str(audit.get("platform", "other")).upper()

    img = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(img, "RGBA")
    _frame(draw)

    # Header: card type left, Clocked Empower badge right.
    _text(draw, (56, 56), "// AGENT ABILITY CARD", _font(34, bold=True), CYAN)
    badge_text = "CLOCKED EMPOWER"
    badge_font = _font(30, bold=True)
    badge_w = draw.textlength(badge_text, font=badge_font) + 76
    badge_x0 = WIDTH - 56 - badge_w
    draw.rounded_rectangle([badge_x0, 48, WIDTH - 56, 104], radius=8, fill=MAGENTA)
    _bolt(draw, badge_x0 + 30, 76, 34, (5, 7, 15))
    _text(draw, (badge_x0 + 52, 58), badge_text, badge_font, (5, 7, 15))
    mode_text = "LIVE AUDIT" if mode == "live" else "MOCK AUDIT - DEMO ONLY"
    _text(draw, (56, 118), mode_text, _font(26, bold=True),
          VERIFIED if mode == "live" else ESTIMATED)

    # Identity block: name left, level hex badge right.
    _text(draw, (56, 168), agent_name, _font(76, bold=True), TEXT)
    _text(draw, (56, 262), "種族  %s" % race, _font(36, bold=True), PURPLE)
    hex_cx, hex_cy, hex_r = 906, 262, 104
    draw.polygon(_hexagon(hex_cx, hex_cy, hex_r), outline=YELLOW, width=4)
    draw.polygon(_hexagon(hex_cx, hex_cy, hex_r - 12), outline=(255, 214, 0, 120), width=1)
    _text_center(draw, hex_cx, hex_cy - 58, "Lv", _font(30, bold=True), YELLOW)
    _text_center(draw, hex_cx, hex_cy - 30, str(result["level"]), _font(68, bold=True), YELLOW)
    _text_center(draw, hex_cx, hex_cy + hex_r + 12, result["title"].upper(), _font(26, bold=True), TEXT)

    # Composite + stats strip.
    _text(draw, (56, 330), "綜合 %d" % result["composite"], _font(44, bold=True), CYAN)
    stats = "XP %d   信心 %.0f%%" % (
        result["xp"], result["audit_confidence"] * 100)
    _text(draw, (56, 392), stats, _font(28), MUTED)
    prov = ("PROVISIONAL - rests on estimated or missing fields"
            if result["provisional"] else "VERIFIED - all scored fields have evidence")
    _text(draw, (56, 432), prov, _font(26, bold=True),
          ESTIMATED if result["provisional"] else VERIFIED)

    # Six-axis radar.
    _text_center(draw, WIDTH // 2, 448, "- SIX-AXIS RADAR -", _font(26, bold=True), MAGENTA)
    _radar(draw, WIDTH // 2, 830, 280, labels, values)

    # Neon dimension bars.
    y = 1200
    for key, label in zip(order, labels):
        value = dims[key]
        color = DIM_COLORS.get(key, CYAN)
        _text(draw, (64, y), label, _font(30, bold=True), TEXT)
        _text_right(draw, WIDTH - 64, y, str(value), _font(30, bold=True), color)
        draw.rectangle([64, y + 42, WIDTH - 64, y + 54], fill=(51, 65, 85))
        bar_w = int((WIDTH - 128) * max(0.0, min(1.0, value / 100.0)))
        if bar_w > 0:
            draw.rectangle([64, y + 42, 64 + bar_w, y + 54], fill=color)
        y += 56

    # Evidence per field, two columns. Value text is truncated so it
    # can never run into the right-aligned status word.
    y = 1552
    _text(draw, (56, y), "// EVIDENCE", _font(30, bold=True), CYAN)
    y += 44
    detail = result.get("field_detail", {})
    names = ("persona_items", "memory_entries", "domains", "skills",
             "goals_done", "deliveries", "pass_rate", "honesty_disclosed",
             "reasoning_examples", "platforms", "goals_total", "fixes_acknowledged")
    ev_font = _font(24)
    ev_bold = _font(24, bold=True)
    for idx, name in enumerate(names):
        entry = detail.get(name)
        if not entry:
            continue
        status = entry.get("status", "missing")
        color = VERIFIED if status == "verified" else ESTIMATED if status == "estimated" else MISSING
        col = idx % 2
        row = idx // 2
        fx = 64 + col * 500
        fy = y + row * 34
        draw.ellipse([fx, fy + 6, fx + 18, fy + 24], fill=color)
        value = entry.get("value")
        val = "-" if value is None else str(value)
        label = "%s: %s" % (name, val)
        status_w = draw.textlength(status, font=ev_bold)
        max_label_w = 500 - 28 - status_w - 24
        while draw.textlength(label, font=ev_font) > max_label_w and len(label) > 4:
            label = label[:-2] + "…"
        _text(draw, (fx + 28, fy), label, ev_font, TEXT)
        _text_right(draw, fx + 470, fy, status, ev_bold, color)

    # Footer.
    _text_center(draw, WIDTH // 2, HEIGHT - 108, "CLOCKED EMPOWER  //  WHAT LEVEL IS YOUR AI AGENT?",
                 _font(28, bold=True), MAGENTA)
    _text_center(draw, WIDTH // 2, HEIGHT - 68,
                 "Paste the AI Agents Level Calculator link to your agent and ask for its level chart.",
                 _font(22), MUTED)
    return img


def save_card(audit, path):
    render_card(audit).save(path, "PNG")
    return path
