"""
omr-diff sidecar — MusicXML semantic diff via musicdiff + music21.

POST /diff  accepts two MusicXML uploads (multipart: old_xml, new_xml)
and returns a JSON diff suitable for ChartKeeper's PartDiff format.
"""
from __future__ import annotations

import tempfile
import time
from pathlib import Path
from typing import Dict, List

import music21
from musicdiff import DetailLevel
from musicdiff.annotation import AnnScore
from musicdiff.comparison import Comparison
from fastapi import FastAPI, File, UploadFile, HTTPException

app = FastAPI(title="omr-diff", version="0.1.0")


def _build_note_to_measure(ann_score: AnnScore) -> Dict[int, int]:
    """Map note object IDs to their enclosing measure number."""
    mapping = {}  # type: Dict[int, int]
    for part in ann_score.part_list:
        for bar in part.bar_list:
            for note_id in bar.get_note_ids():
                mapping[note_id] = int(bar.measureNumber)
    return mapping


def _extract_measure(obj, note_to_measure: Dict[int, int]):
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
    changed_measures = set()
    inserted_measures = set()
    deleted_measures = set()

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

        entry = {"type": op_type, "cost": cost}
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


# ── Score Editor Endpoints (Slice 1) ──────────────────────────────────────────

from music21 import interval as m21_interval, converter
from pydantic import BaseModel


INTERVAL_MAP: Dict[str, str] = {
    "up_half_step": "m2",
    "down_half_step": "-m2",
    "up_whole_step": "M2",
    "down_whole_step": "-M2",
    "up_minor_third": "m3",
    "down_minor_third": "-m3",
    "up_major_third": "M3",
    "down_major_third": "-M3",
    "up_perfect_fourth": "P4",
    "down_perfect_fourth": "-P4",
    "up_perfect_fifth": "P5",
    "down_perfect_fifth": "-P5",
    "up_octave": "P8",
    "down_octave": "-P8",
}

# Transpositions for instruments (chromatic semitones relative to concert pitch)
# Written C sounds as concert pitch + transposition offset
INSTRUMENT_TRANSPOSITIONS: Dict[str, Dict[str, int]] = {
    "flute": {"diatonic": 0, "chromatic": 0},
    "trumpet_in_bb": {"diatonic": -1, "chromatic": -2},
    "horn_in_f": {"diatonic": -4, "chromatic": -7},
    "alto_saxophone": {"diatonic": -5, "chromatic": -9},
    "tenor_saxophone": {"diatonic": -8, "chromatic": -14},
    "clarinet_in_bb": {"diatonic": -1, "chromatic": -2},
    "violin": {"diatonic": 0, "chromatic": 0},
    "viola": {"diatonic": 0, "chromatic": 0},
    "cello": {"diatonic": 0, "chromatic": 0},
}


def _parse_interval(s: str) -> m21_interval.Interval:
    if s not in INTERVAL_MAP:
        raise ValueError(f"Unknown interval: {s}")
    return m21_interval.Interval(INTERVAL_MAP[s])


def _extract_pitches(score) -> List[Dict]:
    """Walk the parsed score, extract every pitch with measure/beat info."""
    out = []  # type: List[Dict]
    for note in score.flatten().notes:
        if note.isNote:
            out.append({
                "measure": note.measureNumber,
                "beat": float(note.beat),
                "pitch": str(note.pitch),
            })
        elif note.isChord:
            for p in note.pitches:
                out.append({
                    "measure": note.measureNumber,
                    "beat": float(note.beat),
                    "pitch": str(p),
                })
    return out


def _score_to_musicxml(score) -> str:
    """Convert a music21 score to MusicXML string."""
    from music21.musicxml.m21ToXml import GeneralObjectExporter
    exporter = GeneralObjectExporter(score)
    xml_bytes = exporter.parse()
    return xml_bytes.decode("utf-8")


class TransposeRequest(BaseModel):
    musicxml: str
    interval: str  # e.g. "down_whole_step", "up_perfect_fifth"


class TransposeResponse(BaseModel):
    transformedMusicxml: str
    pitches: List[Dict]


@app.post("/transpose", response_model=TransposeResponse)
async def transpose_endpoint(req: TransposeRequest):
    """Transpose a MusicXML score by the given interval."""
    start = time.time()
    try:
        interval_obj = _parse_interval(req.interval)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    with tempfile.NamedTemporaryFile(suffix=".musicxml", mode="w", delete=False) as f:
        f.write(req.musicxml)
        tmp_path = f.name

    try:
        score = converter.parse(tmp_path)
        transposed = score.transpose(interval_obj)
        pitches = _extract_pitches(transposed)
        xml_out = _score_to_musicxml(transposed)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Transpose failed: {e}")
    finally:
        try:
            Path(tmp_path).unlink()
        except OSError:
            pass

    return {"transformedMusicxml": xml_out, "pitches": pitches}


class OctaveDisplaceRequest(BaseModel):
    musicxml: str
    direction: str  # "up" or "down"


@app.post("/octave-displace", response_model=TransposeResponse)
async def octave_displace_endpoint(req: OctaveDisplaceRequest):
    """Displace a MusicXML score by one octave up or down."""
    if req.direction not in ("up", "down"):
        raise HTTPException(status_code=400, detail="direction must be 'up' or 'down'")

    interval_str = "P8" if req.direction == "up" else "-P8"
    interval_obj = m21_interval.Interval(interval_str)

    with tempfile.NamedTemporaryFile(suffix=".musicxml", mode="w", delete=False) as f:
        f.write(req.musicxml)
        tmp_path = f.name

    try:
        score = converter.parse(tmp_path)
        transposed = score.transpose(interval_obj)
        pitches = _extract_pitches(transposed)
        xml_out = _score_to_musicxml(transposed)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Octave displace failed: {e}")
    finally:
        try:
            Path(tmp_path).unlink()
        except OSError:
            pass

    return {"transformedMusicxml": xml_out, "pitches": pitches}


class InstrumentChangeRequest(BaseModel):
    musicxml: str
    sourceInstrument: str  # e.g. "flute"
    newInstrument: str  # e.g. "trumpet_in_bb"


@app.post("/instrument-change", response_model=TransposeResponse)
async def instrument_change_endpoint(req: InstrumentChangeRequest):
    """Re-transpose a part from one instrument's written pitch to another's."""
    if req.sourceInstrument not in INSTRUMENT_TRANSPOSITIONS:
        raise HTTPException(status_code=400, detail=f"Unknown source instrument: {req.sourceInstrument}")
    if req.newInstrument not in INSTRUMENT_TRANSPOSITIONS:
        raise HTTPException(status_code=400, detail=f"Unknown target instrument: {req.newInstrument}")

    src = INSTRUMENT_TRANSPOSITIONS[req.sourceInstrument]
    tgt = INSTRUMENT_TRANSPOSITIONS[req.newInstrument]

    # Delta: how many chromatic steps to transpose the written part
    # Written C on src sounds as C + src_chromatic. We need written pitch for tgt.
    # tgt_written = src_written + (src_chromatic - tgt_chromatic)
    chromatic_delta = src["chromatic"] - tgt["chromatic"]

    if chromatic_delta == 0:
        # Same transposition — just return as-is
        with tempfile.NamedTemporaryFile(suffix=".musicxml", mode="w", delete=False) as f:
            f.write(req.musicxml)
            tmp_path = f.name
        try:
            score = converter.parse(tmp_path)
            pitches = _extract_pitches(score)
            xml_out = _score_to_musicxml(score)
        finally:
            try:
                Path(tmp_path).unlink()
            except OSError:
                pass
        return {"transformedMusicxml": xml_out, "pitches": pitches}

    # Build a proper interval from diatonic + chromatic components
    diatonic_delta = src["diatonic"] - tgt["diatonic"]
    # GenericInterval uses 1-based counting: unison=1, second=2, etc.
    # Positive diatonic_delta means we go up, negative means down.
    if diatonic_delta >= 0:
        generic = diatonic_delta + 1
    else:
        generic = diatonic_delta - 1
    interval_obj = m21_interval.intervalFromGenericAndChromatic(
        m21_interval.GenericInterval(generic),
        chromatic_delta,
    )

    with tempfile.NamedTemporaryFile(suffix=".musicxml", mode="w", delete=False) as f:
        f.write(req.musicxml)
        tmp_path = f.name

    try:
        score = converter.parse(tmp_path)
        transposed = score.transpose(interval_obj)
        pitches = _extract_pitches(transposed)
        xml_out = _score_to_musicxml(transposed)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Instrument change failed: {e}")
    finally:
        try:
            Path(tmp_path).unlink()
        except OSError:
            pass

    return {"transformedMusicxml": xml_out, "pitches": pitches}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8484)
