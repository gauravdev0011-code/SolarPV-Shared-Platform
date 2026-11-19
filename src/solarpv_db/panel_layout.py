"""Read the SOLAR FARM worksheet without modifying the source workbook."""

from functools import lru_cache
from pathlib import Path
import re
from xml.etree import ElementTree as XML
from zipfile import ZipFile


def column_number(letters):
    result = 0
    for letter in letters:
        result = result * 26 + ord(letter) - ord("A") + 1
    return result


@lru_cache(maxsize=2)
def _read_layout(path, modified_ns, size):
    with ZipFile(path) as workbook:
        book = XML.fromstring(workbook.read("xl/workbook.xml"))
        if [sheet.get("name") for sheet in book.findall(".//{*}sheet")] != ["SOLAR FARM"]:
            raise ValueError("Expected the original SOLAR FARM worksheet.")
        sheet = XML.fromstring(workbook.read("xl/worksheets/sheet1.xml"))
        shared = ["".join(t.text or "" for t in item.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t"))
                  for item in XML.fromstring(workbook.read("xl/sharedStrings.xml"))]
        styles = XML.fromstring(workbook.read("xl/styles.xml"))

    red_fills = {
        index for index, fill in enumerate(styles.find("{*}fills"))
        if fill.find(".//{*}fgColor") is not None
        and fill.find(".//{*}fgColor").get("rgb", "").upper() == "FFFF0000"
    }
    formats = list(styles.find("{*}cellXfs"))
    dimensions = sheet.find("{*}sheetFormatPr")
    widths = {index: float(column.attrib["width"]) * 7
              for column in sheet.findall("{*}cols/{*}col")
              for index in range(int(column.attrib["min"]), int(column.attrib["max"]) + 1)}
    heights = {int(row.attrib["r"]): float(row.attrib["ht"]) * 4 / 3
               for row in sheet.findall(".//{*}row") if "ht" in row.attrib}
    column_offsets = [0, 0]
    for index in range(1, max(widths) + 1):
        column_offsets.append(column_offsets[-1] + widths.get(index, float(dimensions.attrib["defaultColWidth"]) * 7))
    row_offsets = [0, 0]
    for index in range(1, max(heights) + 1):
        row_offsets.append(row_offsets[-1] + heights.get(index, float(dimensions.attrib["defaultRowHeight"]) * 4 / 3))
    cells = {}
    for cell in sheet.findall(".//{*}c"):
        letters, row = re.fullmatch(r"([A-Z]+)(\d+)", cell.attrib["r"]).groups()
        cells[int(row), column_number(letters)] = cell

    panels = []
    covered_marks = set()
    # The other bordered style is used for the grey worksheet dividers.
    module_cells = {key for key, cell in cells.items()
                    if formats[int(cell.get("s", "0"))].get("borderId") in {"1", "3", "4"}}
    covered_modules = set()

    def printed_number(sheet_row, column):
        cell = cells.get((sheet_row, column))
        return cell.findtext("{*}v") if cell is not None else None

    for row in "ABCDEFGHIJKLMNOP":
        left = row <= "F"
        sheet_row = 9 + 8 * (ord(row) - ord("A" if left else "G"))
        start = 3 if left else column_number("HW")
        label = cells[sheet_row, start - 2]
        if shared[int(label.findtext("{*}v"))] != row:
            raise ValueError(f"Unexpected worksheet label for row {row}.")
        stop = column_number("HW") if left else len(column_offsets)
        columns = sorted(column for index, column in module_cells
                         if index == sheet_row - 2 and start <= column < stop)
        if not columns or columns != list(range(start, columns[-1] + 1, 2)):
            raise ValueError(f"Unexpected module spacing in row {row}.")
        for column in columns:
            offset_from_start = column - start
            expected = offset_from_start // 2 + 1
            value = printed_number(sheet_row, column)
            inferred = value is None and (row, expected) == ("E", 82)
            if inferred:
                before = printed_number(sheet_row, column - 2)
                after = printed_number(sheet_row, column + 2)
                if before != "81" or after != "83":
                    raise ValueError("Cannot infer E-82 without workbook labels 81 and 83.")
                position = int(before) + 1
            else:
                if value != str(expected):
                    raise ValueError(f"Unexpected workbook number in row {row}, position {expected}.")
                position = int(value)
            for layer, offset in (("T", -2), ("B", 2)):
                y = sheet_row + offset
                if (y, column) not in module_cells:
                    raise ValueError(f"Missing {layer} module for {row}-{position}.")
                covered_modules.add((y, column))
                cell = cells[y, column]
                style = formats[int(cell.get("s", "0"))]
                if int(style.get("borderId", "0")) == 0:
                    raise ValueError(f"Missing panel boundary at {cell.attrib['r']}.")
                marked = int(style.get("fillId", "0")) in red_fills
                if marked:
                    covered_marks.add(cell.attrib["r"])
                panels.append(dict(
                    id=f"{row}-{position:02d}-{layer}", row=row, position=position,
                    layer=layer, block="left" if left else "right",
                    cell=cell.attrib["r"], column=column, sheet_row=y,
                    source_mark=marked, inferred_number=inferred,
                    x=column_offsets[column], y=row_offsets[y], width=widths[column], height=heights[y],
                    number_y=row_offsets[sheet_row] + heights[sheet_row] / 2,
                ))
    if covered_modules != module_cells:
        raise ValueError("The workbook contains unmapped module borders.")
    all_marks = {
        cell.attrib["r"] for cell in cells.values()
        if int(formats[int(cell.get("s", "0"))].get("fillId", "0")) in red_fills
    }
    if covered_marks != all_marks:
        raise ValueError("The workbook contains unmapped red annotations.")
    return {"sheet": "SOLAR FARM", "source": path.name, "panels": panels}


SYNTHETIC_LAYOUT = "synthetic-demo"


def synthetic_layout():
    """Build an illustrative array with stable IDs and no field annotations."""
    panels = []

    def cell_column(number):
        name = ""
        while number:
            number, digit = divmod(number - 1, 26)
            name = chr(ord("A") + digit) + name
        return name

    lengths = [108] * 5 + [82] + [54] * 6 + [81] * 4
    for row, length in zip("ABCDEFGHIJKLMNOP", lengths, strict=True):
        left = row <= "F"
        index = ord(row) - ord("A" if left else "G")
        start = 3 if left else column_number("HW")
        center = 9 + index * 8
        for position in range(1, length + 1):
            column = start + 2 * (position - 1)
            for layer, offset in (("T", -2), ("B", 2)):
                sheet_row = center + offset
                panels.append(dict(
                    id=f"{row}-{position:02d}-{layer}", row=row, position=position,
                    layer=layer, block="left" if left else "right",
                    cell=f"{cell_column(column)}{sheet_row}", column=column, sheet_row=sheet_row,
                    source_mark=False, inferred_number=(row, position) == ("E", 82),
                    x=(column - 1) * 16, y=index * 158 + (12 if layer == "T" else 90),
                    width=27, height=47, number_y=index * 158 + 74,
                ))
    return {"sheet": "SOLAR FARM", "source": "Synthetic layout fixture", "panels": panels}


def read_layout(path):
    """Parse and cache the verified worksheet, refreshing when the source changes."""
    if path == SYNTHETIC_LAYOUT:
        return synthetic_layout()
    path = Path(path).resolve()
    stat = path.stat()
    return _read_layout(path, stat.st_mtime_ns, stat.st_size)
