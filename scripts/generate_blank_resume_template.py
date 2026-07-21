#!/usr/bin/env python3
"""Generate the blank, two-page Japanese resume template used by Focusmap.

Usage:
  python3 scripts/generate_blank_resume_template.py output.pdf
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


PAGE = (2480, 3508)  # A4 at 300 DPI
MINCHO = "/System/Library/Fonts/ヒラギノ明朝 ProN.ttc"
GOTHIC = "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc"


def font(size: int, *, mincho: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(MINCHO if mincho else GOTHIC, size)


def centered(draw: ImageDraw.ImageDraw, bounds: tuple[int, int, int, int], text: str, typeface: ImageFont.FreeTypeFont) -> None:
    left, top, right, bottom = bounds
    box = draw.textbbox((0, 0), text, font=typeface)
    x = left + (right - left - (box[2] - box[0])) / 2
    y = top + (bottom - top - (box[3] - box[1])) / 2 - box[1]
    draw.text((x, y), text, fill="black", font=typeface)


def box(draw: ImageDraw.ImageDraw, left: int, top: int, right: int, bottom: int, width: int = 3) -> None:
    draw.rectangle((left, top, right, bottom), outline="black", width=width)


def line(draw: ImageDraw.ImageDraw, *coordinates: int, width: int = 3) -> None:
    draw.line(coordinates, fill="black", width=width)


def history_table(draw: ImageDraw.ImageDraw, top: int, bottom: int, *, continuation: bool) -> None:
    left, year_end, month_end, right = 240, 440, 540, 2240
    box(draw, left, top, right, bottom)
    line(draw, year_end, top, year_end, bottom)
    line(draw, month_end, top, month_end, bottom)

    header_bottom = top + 90
    line(draw, left, header_bottom, right, header_bottom)
    centered(draw, (left, top, year_end, header_bottom), "年", font(30, mincho=True))
    centered(draw, (year_end, top, month_end, header_bottom), "月", font(30, mincho=True))
    centered(draw, (month_end, top, right, header_bottom), "学 歴 ・ 職 歴（各別にまとめて書く）", font(30, mincho=True))

    if continuation:
        cursor = header_bottom
        for _ in range(6):
            cursor += 100
            line(draw, left, cursor, right, cursor)
        return

    school_bottom = header_bottom + 85
    line(draw, left, school_bottom, right, school_bottom)
    centered(draw, (month_end, header_bottom, right, school_bottom), "学歴", font(34, mincho=True))

    cursor = school_bottom
    for _ in range(2):
        cursor += 90
        line(draw, left, cursor, right, cursor)

    career_bottom = cursor + 85
    line(draw, left, career_bottom, right, career_bottom)
    centered(draw, (month_end, cursor, right, career_bottom), "職歴", font(34, mincho=True))

    cursor = career_bottom
    while cursor < bottom:
        cursor = min(cursor + 100, bottom)
        line(draw, left, cursor, right, cursor)


def labeled_box(draw: ImageDraw.ImageDraw, top: int, bottom: int, title: str) -> None:
    left, right = 240, 2240
    title_bottom = top + 90
    box(draw, left, top, right, bottom)
    line(draw, left, title_bottom, right, title_bottom)
    draw.text((left + 32, top + 25), title, fill="black", font=font(30, mincho=True))


def page_one() -> Image.Image:
    image = Image.new("RGB", PAGE, "white")
    draw = ImageDraw.Draw(image)

    draw.text((250, 235), "履 歴 書", fill="black", font=font(68, mincho=True))
    draw.text((1020, 275), "作成日：　　　年　　　月　　　日", fill="black", font=font(28, mincho=True))

    # Personal information and portrait.
    left, split, right = 240, 1600, 2240
    personal_top, personal_bottom = 400, 800
    box(draw, left, personal_top, split, personal_bottom)
    line(draw, left, 500, split, 500)
    line(draw, left, 680, split, 680)
    draw.text((285, 430), "ふりがな", fill="black", font=font(27, mincho=True))
    draw.text((285, 560), "氏　名", fill="black", font=font(34, mincho=True))
    draw.text((285, 715), "生年月日　　　　　　　　　　　　　　性別（任意）", fill="black", font=font(27, mincho=True))

    box(draw, 1740, 270, 2140, 740)
    centered(draw, (1740, 365, 2140, 455), "写真", font(38, mincho=True))
    centered(draw, (1740, 450, 2140, 610), "縦 36〜40mm\n横 24〜30mm\n胸から上", font(23))

    # Address and contact details.
    address_top, address_bottom = 800, 1160
    box(draw, left, address_top, right, address_bottom)
    line(draw, split + 180, address_top, split + 180, address_bottom)
    for y in (890, 990):
        line(draw, left, y, right, y)
    draw.text((285, 828), "ふりがな", fill="black", font=font(26, mincho=True))
    draw.text((285, 920), "現住所　〒", fill="black", font=font(30, mincho=True))
    draw.text((split + 215, 828), "電話", fill="black", font=font(27, mincho=True))
    draw.text((split + 215, 920), "E-mail", fill="black", font=font(27, mincho=True))

    contact_top, contact_bottom = 1160, 1400
    box(draw, left, contact_top, right, contact_bottom)
    line(draw, split + 180, contact_top, split + 180, contact_bottom)
    line(draw, left, 1250, right, 1250)
    draw.text((285, 1188), "ふりがな", fill="black", font=font(26, mincho=True))
    draw.text((285, 1280), "連絡先　〒", fill="black", font=font(30, mincho=True))
    draw.text((730, 1284), "（現住所以外に連絡を希望する場合のみ記入）", fill="black", font=font(22, mincho=True))
    draw.text((split + 215, 1188), "電話", fill="black", font=font(27, mincho=True))
    draw.text((split + 215, 1280), "E-mail", fill="black", font=font(27, mincho=True))

    history_table(draw, 1450, 3250, continuation=False)
    draw.text((250, 3290), "※「性別」欄：記載は任意です。未記載とすることも可能です。", fill="black", font=font(22, mincho=True))
    return image


def page_two() -> Image.Image:
    image = Image.new("RGB", PAGE, "white")
    draw = ImageDraw.Draw(image)

    history_table(draw, 120, 810, continuation=True)

    left, year_end, month_end, right = 240, 440, 540, 2240
    qualification_top, qualification_bottom = 860, 1620
    box(draw, left, qualification_top, right, qualification_bottom)
    line(draw, year_end, qualification_top, year_end, qualification_bottom)
    line(draw, month_end, qualification_top, month_end, qualification_bottom)
    header_bottom = qualification_top + 90
    line(draw, left, header_bottom, right, header_bottom)
    centered(draw, (left, qualification_top, year_end, header_bottom), "年", font(30, mincho=True))
    centered(draw, (year_end, qualification_top, month_end, header_bottom), "月", font(30, mincho=True))
    centered(draw, (month_end, qualification_top, right, header_bottom), "資 格 ・ 免 許", font(32, mincho=True))
    cursor = header_bottom
    while cursor < qualification_bottom:
        cursor = min(cursor + 110, qualification_bottom)
        line(draw, left, cursor, right, cursor)

    labeled_box(draw, 1670, 2480, "志望の動機、特技、好きな学科、アピールポイントなど")
    labeled_box(draw, 2540, 3370, "本人希望記入欄（特に給料・職種・勤務時間・勤務地・その他についての希望などがあれば記入）")
    return image


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__.strip(), file=sys.stderr)
        return 2

    destination = Path(sys.argv[1])
    destination.parent.mkdir(parents=True, exist_ok=True)
    first, second = page_one(), page_two()
    first.save(destination, "PDF", resolution=300, save_all=True, append_images=[second])
    print(destination)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
