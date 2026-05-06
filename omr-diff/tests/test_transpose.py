"""Tests for the score editor transpose endpoints."""

import pytest
from fastapi.testclient import TestClient

from server import app

client = TestClient(app)

# Simple 4-bar MusicXML in C major (single voice, quarter notes C4-D4-E4-F4 per bar)
SIMPLE_C_MAJOR = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN"
  "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1"><part-name>Flute</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
    <measure number="2">
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>
"""


class TestTranspose:
    def test_transpose_down_whole_step(self):
        """Transpose C major down a whole step → Bb major pitches."""
        resp = client.post("/transpose", json={
            "musicxml": SIMPLE_C_MAJOR,
            "interval": "down_whole_step",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "transformedMusicxml" in data
        assert len(data["pitches"]) == 8
        # First pitch should be Bb3 (C4 down a whole step)
        first_pitch = data["pitches"][0]["pitch"]
        assert "B" in first_pitch and "3" in first_pitch

    def test_transpose_up_octave(self):
        """Transpose up an octave → all pitches one octave higher."""
        resp = client.post("/transpose", json={
            "musicxml": SIMPLE_C_MAJOR,
            "interval": "up_octave",
        })
        assert resp.status_code == 200
        data = resp.json()
        # First note C4 → C5
        assert "C5" in data["pitches"][0]["pitch"]
        # Last note C5 → C6
        assert "C6" in data["pitches"][7]["pitch"]

    def test_transpose_invalid_interval(self):
        """Invalid interval key returns 400."""
        resp = client.post("/transpose", json={
            "musicxml": SIMPLE_C_MAJOR,
            "interval": "up_tritone",
        })
        assert resp.status_code == 400

    def test_round_trip(self):
        """Transpose down then up returns to original pitches."""
        # Down a whole step
        resp1 = client.post("/transpose", json={
            "musicxml": SIMPLE_C_MAJOR,
            "interval": "down_whole_step",
        })
        assert resp1.status_code == 200
        intermediate = resp1.json()["transformedMusicxml"]

        # Up a whole step (back to original)
        resp2 = client.post("/transpose", json={
            "musicxml": intermediate,
            "interval": "up_whole_step",
        })
        assert resp2.status_code == 200
        pitches = resp2.json()["pitches"]
        # Should be back to C4
        assert "C4" in pitches[0]["pitch"]


class TestOctaveDisplace:
    def test_octave_up(self):
        """Octave displace up → all pitches one octave higher."""
        resp = client.post("/octave-displace", json={
            "musicxml": SIMPLE_C_MAJOR,
            "direction": "up",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "C5" in data["pitches"][0]["pitch"]

    def test_octave_down(self):
        """Octave displace down → all pitches one octave lower."""
        resp = client.post("/octave-displace", json={
            "musicxml": SIMPLE_C_MAJOR,
            "direction": "down",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "C3" in data["pitches"][0]["pitch"]

    def test_invalid_direction(self):
        resp = client.post("/octave-displace", json={
            "musicxml": SIMPLE_C_MAJOR,
            "direction": "sideways",
        })
        assert resp.status_code == 400


class TestInstrumentChange:
    def test_flute_to_trumpet_bb(self):
        """Concert flute → Trumpet in Bb: transpose up a major second."""
        resp = client.post("/instrument-change", json={
            "musicxml": SIMPLE_C_MAJOR,
            "sourceInstrument": "flute",
            "newInstrument": "trumpet_in_bb",
        })
        assert resp.status_code == 200
        data = resp.json()
        # C4 on flute → D4 written for Bb trumpet (up M2)
        assert "D4" in data["pitches"][0]["pitch"]

    def test_same_instrument_no_change(self):
        """Same instrument → no transposition."""
        resp = client.post("/instrument-change", json={
            "musicxml": SIMPLE_C_MAJOR,
            "sourceInstrument": "flute",
            "newInstrument": "violin",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "C4" in data["pitches"][0]["pitch"]

    def test_unknown_instrument(self):
        resp = client.post("/instrument-change", json={
            "musicxml": SIMPLE_C_MAJOR,
            "sourceInstrument": "flute",
            "newInstrument": "didgeridoo",
        })
        assert resp.status_code == 400
