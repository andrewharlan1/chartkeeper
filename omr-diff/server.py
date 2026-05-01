"""
omr-diff sidecar — MusicXML semantic diff via musicdiff + music21.

POST /diff  accepts two MusicXML uploads (multipart: old_xml, new_xml)
and returns a JSON diff suitable for ChartKeeper's PartDiff format.
"""

import tempfile
import time
from pathlib import Path

import music21
from musicdiff import DetailLevel
from musicdiff.annotation import AnnScore
from musicdiff.comparison import Comparison
from fastapi import FastAPI, File, UploadFile, HTTPException

app = FastAPI(title="omr-diff", version="0.1.0")


def _build_note_to_measure(ann_score: AnnScore) -> dict[int, int]:
    """Map note object IDs to their enclosing measure number."""
    mapping: dict[int, int] = {}
    for part in ann_score.part_list:
        for bar in part.bar_list:
            for note_id in bar.get_note_ids():
                mapping[note_id] = int(bar.measureNumber)
    return mapping


def _extract_measure(obj, note_to_measure: dict[int, int]) -> int | None:
    """Pull a measure number from an AnnNote, AnnExtra, or AnnMeasure."""
    if obj is None:
        return None
    # AnnMeasure has measureNumber directly
    if hasattr(obj, "measureNumber"):
        return int(obj.measureNumber)
    # AnnNote / AnnExtra — look up via note ID mapping
    if hasattr(obj, "get_note_ids"):
        for nid in obj.get_note_ids():
            if nid in note_to_measure:
                return note_to_measure[nid]
    return None


def _run_diff(old_path: str, new_path: str) -> dict:
    """Run musicdiff on two MusicXML files. Returns structured diff dict."""
    score1 = music21.converter.parse(old_path)
    score2 = music21.converter.parse(new_path)

    if not isinstance(score1, music21.stream.Score):
        raise ValueError("old_xml did not parse as a Score")
    if not isinstance(score2, music21.stream.Score):
        raise ValueError("new_xml did not parse as a Score")

    ann1 = AnnScore(score1, DetailLevel.Default)
    ann2 = AnnScore(score2, DetailLevel.Default)

    ntm1 = _build_note_to_measure(ann1)
    ntm2 = _build_note_to_measure(ann2)

    op_list, total_cost = Comparison.annotated_scores_diff(ann1, ann2)

    operations = []
    changed_measures: set[int] = set()
    inserted_measures: set[int] = set()
    deleted_measures: set[int] = set()

    for op in op_list:
        op_type = op[0]
        orig = op[1]
        comp = op[2]
        cost = op[3]

        # Resolve measure number
        measure = (
            _extract_measure(orig, ntm1)
            or _extract_measure(comp, ntm2)
        )

        entry: dict = {"type": op_type, "cost": cost}
        if measure is not None:
            entry["measure"] = measure
        if orig is not None:
            entry["original"] = str(orig)
        if comp is not None:
            entry["compared"] = str(comp)
        operations.append(entry)

        # Categorise
        if measure is not None:
            if op_type == "insbar":
                inserted_measures.add(measure)
            elif op_type == "delbar":
                deleted_measures.add(measure)
            else:
                changed_measures.add(measure)

    changed_measures -= inserted_measures
    changed_measures -= deleted_measures

    # musicdiff models bar substitution as delbar + insbar for the same measure.
    # When a measure appears in both sets, it's actually a content change.
    substituted = inserted_measures & deleted_measures
    changed_measures |= substituted
    inserted_measures -= substituted
    deleted_measures -= substituted

    return {
        "totalEditDistance": total_cost,
        "operations": operations,
        "changedMeasures": sorted(changed_measures),
        "insertedMeasures": sorted(inserted_measures),
        "deletedMeasures": sorted(deleted_measures),
        "operationCount": len(operations),
    }


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/diff")
async def diff_endpoint(
    old_xml: UploadFile = File(..., description="Old version MusicXML"),
    new_xml: UploadFile = File(..., description="New version MusicXML"),
):
    """Compare two MusicXML files and return a structured diff."""
    start = time.time()

    with tempfile.TemporaryDirectory() as tmpdir:
        old_ext = Path(old_xml.filename or "old.musicxml").suffix or ".musicxml"
        new_ext = Path(new_xml.filename or "new.musicxml").suffix or ".musicxml"
        old_path = Path(tmpdir) / f"old{old_ext}"
        new_path = Path(tmpdir) / f"new{new_ext}"

        old_data = await old_xml.read()
        new_data = await new_xml.read()

        if not old_data or not new_data:
            raise HTTPException(status_code=400, detail="Both old_xml and new_xml must be non-empty")

        old_path.write_bytes(old_data)
        new_path.write_bytes(new_data)

        try:
            result = _run_diff(str(old_path), str(new_path))
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"Diff failed: {e}")

    result["processingMs"] = int((time.time() - start) * 1000)
    return result


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8484)
