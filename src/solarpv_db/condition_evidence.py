"""Versioned technical evidence inventory, never a scientific condition rule.

No approved metric-specific protocol is configured. Quality flags and unit text
describe stored evidence; neither numeric count nor chart availability proves
scientific sufficiency. This accumulator consumes the complete selected history,
not paged or downsampled chart points. It is intentionally read-only.
"""
from collections import Counter

EVIDENCE_VERSION = 'solaris.condition-evidence-v1'


class ConditionEvidence:
    def __init__(self):
        self.counts = Counter()
        self.qualities = Counter()
        self.units = Counter()
        self.previous_time = None

    def add(self, row, seconds, numeric_usable):
        self.counts['records'] += 1
        self.qualities[row['data_quality']] += 1
        self.units[row['unit'] or None] += 1
        if row['value'] is None:
            self.counts['missing'] += 1
        elif not numeric_usable:
            self.counts['excluded_numeric'] += 1
        else:
            self.counts['recorded_numeric'] += 1
        if self.previous_time == seconds:
            self.counts['duplicate_time_records'] += 1
        self.previous_time = seconds
        if not row.get('source_reference'):
            self.counts['without_source_reference'] += 1

    def result(self):
        reasons = [{'code': 'scientific_protocol_missing', 'message':
                    'No approved metric-specific protocol defines pairing, thresholds, uncertainty or sufficient evidence. No condition classification or delta-T is calculated.'}]
        for key, message in [
            ('missing', 'Missing readings remain missing; they are not zero or interpolated.'),
            ('excluded_numeric', 'Flagged or unusable numeric readings are retained as evidence and excluded from the history chart.'),
            ('duplicate_time_records', 'Multiple records share an instant. No reference pairing or overlap resolution is inferred.'),
            ('without_source_reference', 'Some observations have no recorded source reference; provenance is not invented.'),
        ]:
            if self.counts[key]:
                reasons.append({'code': key, 'message': message})
        if not self.counts['records']:
            reasons.append({'code': 'no_records', 'message': 'No eligible recorded observations in the selected window.'})
        if len(self.units) > 1 or None in self.units:
            reasons.append({'code': 'unit_review', 'message': 'Recorded unit labels conflict or are unknown. No conversion or scientific compatibility is assumed.'})
        if self.qualities['unknown']:
            reasons.append({'code': 'quality_unknown', 'message': 'Unknown quality is not scientifically verified quality.'})
        return {'evidence_version': EVIDENCE_VERSION, 'assessment_state': 'not_assessed',
                'scientific_rule': None, 'classification': None, 'delta_t': None,
                'scientific_sufficiency': 'undetermined', 'reasons': reasons,
                'counts': {key: self.counts[key] for key in ['records', 'recorded_numeric', 'missing', 'excluded_numeric', 'duplicate_time_records', 'without_source_reference']},
                'quality_counts': {key: self.qualities[key] for key in ['good', 'suspect', 'invalid', 'unknown']},
                'unit_counts': [{'unit': unit, 'records': count} for unit, count in sorted(self.units.items(), key=lambda item: str(item[0]))],
                'scope': 'All current eligible observations in the selected asset/metric/date window, independent of table page and chart sampling. Counts describe evidence, not sufficient scientific conditions.',
                'pairing': 'Not established; equal timestamps or matching unit labels do not establish comparable acquisition conditions.',
                'required_protocol': ['approved reference and version', 'metric and quantity meaning', 'pairing and acquisition conditions', 'compatible units and reference direction', 'quality and uncertainty policy', 'minimum evidence and applicability limits', 'stable/worsening thresholds and validation evidence']}
