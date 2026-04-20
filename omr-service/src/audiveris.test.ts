import { parseMusicXml } from './audiveris';

/**
 * Minimal MusicXML with a 4-measure multi-rest starting at measure 5.
 * Measures 1-4 are normal; measure 5 has <multiple-rest>4</multiple-rest>;
 * measures 6-8 are phantom (no width); measure 9 is normal again.
 */
const MULTI_REST_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <defaults>
    <page-layout>
      <page-width>1190</page-width>
      <page-height>1683</page-height>
    </page-layout>
  </defaults>
  <part-list><score-part id="P1"><part-name>Trombone</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1" width="200">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
    <measure number="2" width="200">
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
    <measure number="3" width="200">
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
    <measure number="4" width="200">
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
    <measure number="5" width="600">
      <attributes>
        <measure-style><multiple-rest>4</multiple-rest></measure-style>
      </attributes>
      <note><rest measure="yes"/><duration>4</duration><type>whole</type></note>
    </measure>
    <measure number="6">
      <note><rest measure="yes"/><duration>4</duration><type>whole</type></note>
    </measure>
    <measure number="7">
      <note><rest measure="yes"/><duration>4</duration><type>whole</type></note>
    </measure>
    <measure number="8">
      <note><rest measure="yes"/><duration>4</duration><type>whole</type></note>
    </measure>
    <measure number="9" width="200">
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;

describe('parseMusicXml', () => {
  it('collapses multi-measure rests into a single entry with multiRestCount', () => {
    const result = parseMusicXml(MULTI_REST_XML, 'Trombone');

    // Measures 1-4 normal, 5 has multiRestCount=4, 6-8 synthesized, 9 normal
    // Total unique measure numbers: 1,2,3,4,5,6,7,8,9 = 9
    expect(result.measures).toHaveLength(9);

    // Measure 5 should have multiRestCount = 4
    const m5 = result.measures.find(m => m.number === 5);
    expect(m5).toBeDefined();
    expect(m5!.multiRestCount).toBe(4);

    // Measures 6-8 should exist (synthesized from the multi-rest span)
    // but should NOT have their own multiRestCount
    for (const n of [6, 7, 8]) {
      const m = result.measures.find(m => m.number === n);
      expect(m).toBeDefined();
      expect(m!.multiRestCount).toBeUndefined();
    }

    // Measures 6-8 should share the same bounds as measure 5
    // (they're all part of the same visual block)
    for (const n of [6, 7, 8]) {
      const m = result.measures.find(m => m.number === n)!;
      expect(m.bounds).toEqual(m5!.bounds);
    }

    // Normal measures should not have multiRestCount
    for (const n of [1, 2, 3, 4, 9]) {
      const m = result.measures.find(m => m.number === n);
      expect(m).toBeDefined();
      expect(m!.multiRestCount).toBeUndefined();
    }
  });

  it('returns partName from the argument', () => {
    const result = parseMusicXml(MULTI_REST_XML, 'Trombone');
    expect(result.partName).toBe('Trombone');
  });

  it('handles XML with no multi-rests normally', () => {
    const simpleXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <defaults><page-layout><page-width>1190</page-width><page-height>1683</page-height></page-layout></defaults>
  <part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1" width="300">
      <attributes><divisions>1</divisions></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
    <measure number="2" width="300">
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;

    const result = parseMusicXml(simpleXml, 'Flute');
    expect(result.measures).toHaveLength(2);
    expect(result.measures[0].multiRestCount).toBeUndefined();
    expect(result.measures[1].multiRestCount).toBeUndefined();
  });
});
