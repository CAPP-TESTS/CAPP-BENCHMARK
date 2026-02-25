#!/usr/bin/env python3
"""
PDF parser helper — uses pdfplumber for text extraction.
Called from Node.js via subprocess.
Usage: python3 parse_pdf.py <pdf_path>
Outputs JSON to stdout with the parsed structure.
"""

import json
import re
import sys
from pathlib import Path

try:
    import pdfplumber
except ImportError:
    sys.exit("Error: pdfplumber not installed")


def parse_cycle_time(text: str) -> int:
    text = text.strip().split("(")[0].strip()
    h = m = s = 0
    hm = re.search(r'(\d+)h', text)
    mm = re.search(r'(\d+)m', text)
    sm = re.search(r'(\d+)s', text)
    if hm: h = int(hm.group(1))
    if mm: m = int(mm.group(1))
    if sm: s = int(sm.group(1))
    return h * 3600 + m * 60 + s


def extract_field(text: str, field: str, as_float: bool = False):
    pattern = rf'{field}:\s*([\d.,]+)'
    match = re.search(pattern, text)
    if match:
        val = match.group(1).replace(",", "")
        return float(val) if as_float else val
    return None


def detect_strategy(op_text: str) -> str:
    strat_match = re.search(r'Strategy:\s*([A-Za-z]+(?:\s+[A-Za-z0-9]+)?)', op_text)
    if strat_match:
        raw = strat_match.group(1).strip()
        known = ["Adaptive", "Facing", "Contour 2D", "Contour", "Drilling",
                 "Scallop", "Bore", "Pocket", "Slot", "Trace", "Radial",
                 "Spiral", "Morphed Spiral", "Parallel", "Pencil", "Steep and Shallow"]
        for k in known:
            if raw.startswith(k):
                return k
        return raw.split()[0]

    desc_match = re.search(r'Description:\s*(?:\d+\s+)?(\w+)', op_text)
    if desc_match:
        desc_word = desc_match.group(1)
        if desc_word.lower().startswith("flat"):
            return "Flat"

    return "Unknown"


def extract_product_code(op_text: str) -> str:
    match = re.search(r'Product:\s*(.+?)(?:\n|$)', op_text)
    if match:
        product = match.group(1).strip()
        product = re.split(r'\s{2,}', product)[0].strip()
        product = re.sub(r'^fresa a punta tonda\s*', '', product, flags=re.IGNORECASE)
        product = re.split(r'\s+con\s+inserto', product, flags=re.IGNORECASE)[0].strip()
        return product
    return "N/A"


def parse_pdf(pdf_path: str) -> dict:
    result = {'name': '', 'setups': []}

    with pdfplumber.open(pdf_path) as pdf:
        full_text = ""
        for page in pdf.pages:
            t = page.extract_text()
            if t:
                full_text += t + "\n"

    # Document name
    doc_match = re.search(r'Document Path:\s*(.+)', full_text)
    if doc_match:
        result['name'] = doc_match.group(1).strip()
    else:
        result['name'] = Path(pdf_path).stem

    # Split by Setup Sheet
    setup_blocks = re.split(r'(?=Setup Sheet for Program \d+)', full_text)
    setup_blocks = [b for b in setup_blocks if b.strip() and 'Setup Sheet for Program' in b]

    for block in setup_blocks:
        setup = {'program': '', 'cycle_time_s': 0, 'n_operations': 0, 'n_tools': 0, 'operations': []}

        prog_match = re.search(r'Setup Sheet for Program (\d+)', block)
        if prog_match:
            setup['program'] = prog_match.group(1)

        nops_match = re.search(r'Number Of Operations:\s*(\d+)', block)
        if nops_match:
            setup['n_operations'] = int(nops_match.group(1))

        ntools_match = re.search(r'Number Of Tools:\s*(\d+)', block)
        if ntools_match:
            setup['n_tools'] = int(ntools_match.group(1))

        ct_match = re.search(r'Estimated Cycle Time:\s*([\dhms:]+)', block)
        if ct_match:
            setup['cycle_time_s'] = parse_cycle_time(ct_match.group(1))

        # Extract individual operations
        op_pattern = r'(Operation\s+(\d+)/(\d+)\s+(T\d+)\s+D\d+\s+L\d+.*?)(?=Operation\s+\d+/\d+|$)'
        ops = re.findall(op_pattern, block, re.DOTALL)

        for op_text, op_num, op_total, tool_t in ops:
            cutting = extract_field(op_text, 'Cutting Distance', as_float=True) or 0.0
            rapid = extract_field(op_text, 'Rapid Distance', as_float=True) or 0.0
            feedrate = extract_field(op_text, 'Maximum Feedrate', as_float=True) or 0.0

            op_ct_match = re.search(r'Estimated Cycle Time:\s*([\dhms:]+(?:\s*\([^)]*\))?)', op_text)
            op_ct = parse_cycle_time(op_ct_match.group(1)) if op_ct_match else 0

            desc_match = re.search(r'Description:\s*(.+?)(?:\s{2,}|Maximum|Minimum|$)', op_text)
            description = desc_match.group(1).strip() if desc_match else ""

            strategy = detect_strategy(op_text)
            product = extract_product_code(op_text)

            setup['operations'].append({
                'op_num': int(op_num),
                'op_total': int(op_total),
                'description': description,
                'strategy': strategy,
                'tool_t': tool_t,
                'product': product,
                'cutting_dist': cutting,
                'rapid_dist': rapid,
                'max_feedrate': feedrate,
                'cycle_time_s': op_ct,
            })

        result['setups'].append(setup)

    return result


if __name__ == '__main__':
    if len(sys.argv) != 2:
        print(json.dumps({'error': 'Usage: parse_pdf.py <pdf_path>'}), file=sys.stderr)
        sys.exit(1)

    pdf_path = sys.argv[1]
    try:
        parsed = parse_pdf(pdf_path)
        print(json.dumps(parsed))
    except Exception as e:
        print(json.dumps({'error': str(e)}), file=sys.stderr)
        sys.exit(1)
