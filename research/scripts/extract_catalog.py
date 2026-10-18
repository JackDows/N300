"""Extract constant option tables from the selected JADX source (no APK execution)."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
source = (ROOT / 'research/evidence/jadx-source/com.edifier.lib_base.handler.CommandParserHelper.java').read_text(encoding='utf-8')


def arguments(text):
    depth, quoted, escaped, start = 0, False, False, 0
    result = []
    for i, ch in enumerate(text):
        if quoted:
            if escaped: escaped = False
            elif ch == '\\': escaped = True
            elif ch == '"': quoted = False
        elif ch == '"': quoted = True
        elif ch == '(': depth += 1
        elif ch == ')':
            if depth == 0:
                result.append(text[start:i].strip())
                return result
            depth -= 1
        elif ch == ',' and depth == 0:
            result.append(text[start:i].strip())
            start = i + 1
    raise ValueError('Unbalanced constructor')


labels = {'MUSIC': '音乐', 'MONITOR': '监听', 'GAME': '游戏', 'MOVIE': '电影', 'CUSTOMIZED': '自定义', 'CLASSIC': '经典', 'CLASSICAL': '古典', 'DYNAMIC': '动感', 'POPULAR': '流行', 'ROCK': '摇滚', 'VOCAL': '人声', 'HIFI': '高保真', 'AUDIOPHILE': '自定义', 'PURE': '纯正'}
eq = source[source.index('    public final EqBean getEQBean('):]
eq = eq[:eq.index('\n    public ', 20)]
groups, audit = {}, {}
parts = re.split(r'\n            case (\d+):', eq)
for i in range(1, len(parts), 2):
    group, block = parts[i:i+2]
    items, unknown = [], False
    for match in re.finditer(r'new EqBean\(', block):
        args = arguments(block[match.end():])
        if args[0] != 'eqIndex' or len(args) < 8:
            unknown = True
            continue
        value, kind = args[2], args[7].replace('EQType.', '')
        if not value.isdecimal():
            constants = re.findall(r'\b' + re.escape(value) + r' = (\d+);', block[:match.start()])
            value = constants[-1] if constants else value
        if not value.isdecimal() or kind not in labels:
            unknown = True
        items.append({'value': int(value) if value.isdecimal() else value, 'label': labels.get(kind, kind), 'type': kind})
    audit[group] = items
    if items and not unknown and len({item['value'] for item in items}) == len(items):
        groups[group] = items

input_text = source[source.index('    public final InputSourceBean getInputSource('):]
input_text = input_text[:input_text.index('\n    public ', 20)]
input_labels = {1: '蓝牙', 2: 'AUX', 3: 'USB', 4: 'XLR', 5: '光纤', 6: '同轴', 7: 'LINE IN',
                8: 'USB 声卡', 9: 'LINE IN 1', 10: 'LINE IN 2', 11: 'AirPlay', 12: '2.4 GHz', 14: 'TF 卡'}
inputs = {}
for match in re.finditer(r'InputSourceBean.Source (\w+) = new InputSourceBean.Source\(\);', input_text):
    var = match[1]
    tail = input_text[match.end():]
    values = {}
    for method in ('InputSourceIndex', 'Value', 'Type'):
        m = re.search(r'\b' + var + r'\.set' + method + r'\((\d+)\)', tail)
        if m: values[method] = int(m[1])
    if len(values) == 3:
        inputs.setdefault(str(values['InputSourceIndex']), []).append({'value': values['Value'], 'label': input_labels.get(values['Type'], f'输入 {values["Type"]}'), 'type': values['Type']})
inputs = {group: items for group, items in inputs.items() if len({item['value'] for item in items}) == len(items) and all(item['type'] in input_labels for item in items)}

# Layout and gain units are independently checked in EqSelfViewModel,
# GainSbAdapter and CommandManager.setSingleCustomEq. Only unambiguous types.
custom = {}
for kind, count, stride, gain_scale, gain_offset, low, high in ((1, 4, 6, 1, 6, -6, 6), (2, 6, 4, 2, 6, -3, 3), (3, 6, 6, 2, 6, -3, 3), (17, 10, 4, 1, 6, -6, 6), (18, 10, 4, 1, 4, -4, 4)):
    custom[str(kind)] = {'bands': count, 'stride': stride, 'freq_offset': 2 if stride == 6 else 1, 'gain_offset': 4 if stride == 6 else 3, 'q_offset': 5 if stride == 6 else None, 'gain_scale': gain_scale, 'gain_offset_value': gain_offset, 'gain_min': low, 'gain_max': high}
catalog = {'inputs': inputs, 'eq_presets': groups, 'custom_eq': custom}
(ROOT / 'resources/settings-catalog.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding='utf-8')
(ROOT / 'research/evidence/eq-catalog-audit.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'input_groups': len(inputs), 'eq_groups': len(groups), 'speaker_eq_candidates': {k: v for k, v in audit.items() if any(i['type'] == 'MONITOR' for i in v)}, 'aux_usb_bluetooth': {k: v for k, v in inputs.items() if {i['type'] for i in v} == {1, 2, 3}}}, ensure_ascii=False, indent=2))
