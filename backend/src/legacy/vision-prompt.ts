export const VISION_DIFF_PROMPT_VERSION = 'v1';

export const VISION_DIFF_SYSTEM_PROMPT = `You are a music notation analyst. Output ONLY a single raw JSON object. No prose, no markdown fences, no explanation before or after. Your entire response must be valid JSON that can be parsed with JSON.parse().`;

export const VISION_DIFF_PROMPT_V1 = `You will be shown two versions of the same instrumental part (VERSION 1 and VERSION 2). Determine, for every measure in VERSION 1, which measure in VERSION 2 it corresponds to.

Your ENTIRE response must be a single valid JSON object matching this exact schema — nothing else:

{
  "measure_mapping": { "<old_measure_number>": <new_measure_number_or_null> },
  "inserted_measures": [<new_measure_numbers_not_in_v1>],
  "deleted_measures": [<old_measure_numbers_not_in_v2>],
  "changed_measures": [<old_measure_numbers_where_notes_or_markings_changed>],
  "change_descriptions": { "<old_measure_number>": "brief human description of what changed" },
  "section_labels": [{ "label": "...", "start_measure": <N>, "end_measure": <N> }],
  "measure_bounds": { "<new_measure_number>": { "page": <1-based>, "x": <0-1>, "y": <0-1>, "w": <0-1>, "h": <0-1> } },
  "confidence": { "<old_measure_number>": <0.0_to_1.0> },
  "overall_confidence": <0.0_to_1.0>
}

Rules:
1. Measure numbers are as printed in the score. If no measure numbers are visible, count from 1 at the first full measure (ignore pickup/anacrusis bars). CRITICAL: use the printed number in VERSION 2 as the mapped value — do not assume measure positions are identical.
2. A measure is "the same" if the pitches, rhythms, and primary articulations match, even if dynamics, slurs, or text markings differ slightly.
3. A measure is "changed" if pitches or rhythms differ but you can still identify it as the same measure by its position and surrounding context.
4. A measure is "deleted" if nothing in VERSION 2 corresponds to it. If VERSION 2 is shorter, some VERSION 1 measures must map to null.
5. An "inserted" measure in VERSION 2 has no VERSION 1 counterpart. If VERSION 2 is longer, those extra measures are inserted.
6. If measures were removed or added in the middle, ALL subsequent measure numbers shift. Track these shifts carefully — a VERSION 1 measure that appears at a different printed number in VERSION 2 is NOT a change, just a renumbering.
7. Confidence: 1.0 = identical. 0.8–0.95 = confident, minor differences. 0.5–0.8 = reasonably sure from context. Below 0.5 = uncertain. Use low confidence (< 0.7) when the mapping required inferring through insertions/deletions.
8. Section labels: include rehearsal letters, section names (Intro, Verse, Chorus, Head, Coda, Vamp, A, B, etc.) printed in the score. Only include labels actually visible.
9. measure_bounds: normalized 0–1 coordinates on the page (x=left edge, y=top edge, w=width, h=height). Report bounds for changed and inserted measures in VERSION 2. Omit if not confident.
10. Never invent measures. If VERSION 1 has N measures, output exactly N keys in measure_mapping.
11. Keys in measure_mapping, confidence, and change_descriptions must be integer strings (e.g. "1", "12"), not "m.1".`;
