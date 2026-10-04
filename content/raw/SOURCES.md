# Raw demo scores: sources and licenses

Collected 2026-10-04. All files are compressed MusicXML (`.mxl`). Each one was checked: it unzips, contains `META-INF/container.xml` and a `score-partwise` root, and its parts, measures and `<lyric>` elements were counted.

## Where the files come from

- **CPDL (cpdl.org) could not be reached.** Cloudflare's bot check returns HTTP 403 to every request, including WebFetch.
- **IMSLP** pages and API can be read, but file downloads hit a captcha ("Bot Check"). I did not try to get past it. IMSLP has no MusicXML for Schoenberg Op. 13 anyway, only PDF scans.
- **PDMX dataset**: the main source. PDMX is "A Large-Scale Public Domain MusicXML Dataset" (Long et al., Zenodo record 15571083, dataset licensed CC BY 4.0). It mirrors MuseScore.com scores that their uploaders marked *Public Domain Mark 1.0* or *CC0*. The files were re-exported by the dataset authors with MuseScore 3.6.2. The "Source" column gives the original MuseScore score ID (`https://musescore.com/score/<id>`).
  - Many of the "Public Domain"-marked uploads appear to be ports of CPDL editions. For example, Nicolette has the credit "James Gibb editions" (a CPDL editor), and Os justi has "edited by W. Chmiak". A CPDL edition is under the CPDL licence (free to copy, perform and distribute), so either way it may be redistributed. Credit the editor where one is named.
- **music21 corpus** (github.com/cuthbertLab/music21, `music21/corpus/bach/`). The corpus licence says works are "out of copyright in the United States or licensed for use". The Bach chorales are Margaret Greentree's encodings, "used by permission".

Status of the underlying works (composer death year → EU life+70; US is pre-1931 publication):
Debussy (d. 1918), Ravel (d. 1937; *Trois chansons* published 1916), Reger (d. 1916), Brahms, Bruckner, Elgar (d. 1934) and Bach are public domain in the EU and the US.
**Vaughan Williams (d. 1958) is still in copyright in the EU/UK until the end of 2028.** *Rest* (1902) is PD in the US only, so it should not be used as EU demo content.

## Files

| File | Work | Parts (part-names) | Measures | Lyrics (per part) | Licence / copyright line | Source |
|---|---|---|---|---|---|---|
| `debussy_trois-chansons_1_dieu-quil-la-fait-bon-regarder.mxl` | Debussy, *Trois chansons de Charles d'Orléans* I (1898/1908) | 4: S, A, T, B | 29 | yes (118/118/113/106), French | MuseScore "Public Domain Mark 1.0"; no editor credit | PDMX, musescore.com/score/5783791 |
| `debussy_trois-chansons_2_quant-jai-ouy-le-tabourin.mxl` | Debussy, *Trois chansons* II | 4: Alto Solo, A, T, B (no soprano; matches the original) | 51 | yes (128/139/304/186); T and B have divisi (2–3 voices) | PD Mark 1.0 | PDMX, score/5757499 |
| `debussy_trois-chansons_3_yver-vous-nestes-quun-villain.mxl` | Debussy, *Trois chansons* III | 4: S, A, T, B | 70 | yes (156/196/175/192) | PD Mark 1.0 | PDMX, score/5783335 |
| `ravel_trois-chansons_1_nicolette.mxl` | Ravel, *Trois chansons* I, Nicolette (1915) | 4: S, A, T, B | 52 | yes (91/136/130/142), French | PD Mark 1.0; credit "James Gibb editions" (CPDL editor) | PDMX, score/5783904 |
| `ravel_trois-chansons_3_ronde.mxl` | Ravel, *Trois chansons* III, Ronde | 4: Sopranos, Contraltos, Tenors, Basses | 94 | yes (341/358/307/304) | PD Mark 1.0 | PDMX, score/5785792 |
| `bruckner_locus-iste_WAB23.mxl` | Bruckner, *Locus iste* (1869) | 4: S, A, T, B | 48 | yes (107/107/115/83), Latin | CC0 1.0; rated 4.75 by 54 MuseScore users | PDMX, score/1972546 |
| `bruckner_os-justi_WAB30.mxl` | Bruckner, *Os justi* (1879) | 4: S, A, T, B (some divisi) | 71 | yes (134/149/146/132) | PD Mark 1.0; credit "edited by W. Chmiak" | PDMX, score/5809033 |
| `brahms_schaffe-in-mir-gott_op29-2.mxl` | Brahms, *Schaffe in mir, Gott* Op. 29/2 | 5: S, A, T, B I, B II | 26 | yes (87/86/91/81/44), German | PD Mark 1.0 | PDMX, score/5758815 |
| `reger_nachtlied_op138-3.mxl` | Reger, *Nachtlied* Op. 138/3 (1914) | 6: S, A, T, B I, B II + Piano (rehearsal reduction, no lyrics) | 39 | yes (116 each voice) | PD Mark 1.0 | PDMX, score/5768414 |
| `elgar_there-is-sweet-music_op53-1.mxl` | Elgar, *There is sweet music* Op. 53/1 (1907) | 4: S, A, T, B (each part is divided: SSAA / TTBB double choir) | 47 | yes (139/133/174/205), English | PD Mark 1.0 | PDMX, score/5743813 |
| `vaughan-williams_rest.mxl` | Vaughan Williams, *Rest* (1902) | 5: S1, S2, A, T, B | 57 | yes (134/134/143/147/144) | PD Mark 1.0, **but the composer's copyright runs in the EU/UK until 2028; US-only PD** | PDMX, score/5782925 |
| `bach_chorale_bwv512_gib-dich-zufrieden.mxl` | Bach, *Gib dich zufrieden* BWV 512 (chorale harmonisation) | 4 (part-names are all "Midi_1"; order is S, A, T, B, so rename them in the app) | 14 | yes (60 per part, 2 verses) | PD Mark 1.0 | PDMX, score/5785746 |
| `bach_chorale_bwv244-62_wenn-ich-einmal-soll-scheiden.mxl` | Bach, St Matthew Passion no. 62 (Passion chorale) | 4: S, A, T, B | 15 | soprano only (52); A/T/B have none | music21 corpus; credit "PDF © 2004 Margaret Greentree, used by permission" | raw.githubusercontent.com/cuthbertLab/music21/master/music21/corpus/bach/bwv244.62.mxl |

## Not found or not downloadable

- **Schoenberg, *Friede auf Erden* Op. 13** (1907, published 1912 by Tischer & Jagenberg). It is **public domain in both the US** (published before 1931) **and the EU** (Schoenberg died 1951, so PD since 1 Jan 2022). However, no free MusicXML or MIDI was found. IMSLP has PD PDF scans: the 1912 Tischer & Jagenberg edition and the Schott 1955 urtext edition, edited by Okuljar (IMSLP lists it as PD). PDMX contains no version. CPDL could not be checked because of the Cloudflare block. A MusicXML version would have to be made from the PDF with OMR or entered by hand.
- **Webern, *Entflieht auf leichten Kähnen* Op. 2** is PD in the EU (Webern died 1945) and in the US (published 1921). IMSLP has a CC BY-SA 4.0 MIDI (`PMLP62108-entflieht.mid`) and a CC0 typeset PDF edited by Antoine Portes, but downloading them needs the captcha. Fetch the MIDI by hand in a browser if wanted.
- **Ravel, *Trois beaux oiseaux du paradis*** (Trois chansons II) is not in PDMX with lyrics.
- **Poulenc** (*Quatre motets pour le temps de Noël*, *Un soir de neige*) has MuseScore uploads marked CC0 in PDMX. They were **deliberately excluded**: Poulenc died in 1963 and these works are in copyright, so the uploaders' CC0 marks are not valid.

## Added 2026-10-04 (second pass): Vierne Kyrie and Fauré Madrigal

### `public/pieces/pd/vierne-kyrie.mxl`: Vierne, *Messe solennelle* Op. 16, I. Kyrie (published 1900)

- **Work status:** Vierne died in 1937, so the work is PD in the EU (since 2008). It was published in 1900, so it is also PD in the US.
- **Edition:** Manfred Hößl (www.Manfreds-Notenpool.de), reduced from two organs to one. It is on CPDL as **CPDL #30138**, submitted 2013-09-15, under the CPDL licence (free to copy, perform and distribute; credit the editor). Every page of the file carries the rights line "Manfred Hößl - www.Manfreds-Notenpool.de".
- **Source file:** PDMX `mxl/17/1/QmZ2WALgqTccdkU6m4aPhBXH1UGCsUihemtESckqPvj2zG.mxl`. This is the complete Mass (479 bars). It was uploaded to MuseScore by *leenders-jongenelen* as https://musescore.com/user/36264/scores/5382059 and marked CC0. PDMX flags it `license_conflict=True` because of the embedded rights line. The underlying edition is the CPDL one, so the CPDL licence applies. Credit Manfred Hößl.
- **What was changed:**
  - Bars 1–94 were cut out. The Kyrie ends at the light-heavy barline in bar 94; the Gloria starts in bar 95. No slur, tie or wedge crosses that cut.
  - Part names were changed from Dutch to English (Sopraan/Alt/Tenor/Bas/Orgel/Orgel → Soprano/Alto/Tenor/Bass/Organ/Organ Pedal). The app's voice detection read "Bas" as a tenor.
  - The title was set to "Messe solennelle, Op. 16 – I. Kyrie" and the `<rights>` line was extended with the CPDL number.
  - Credits for pages after page 6 were dropped.
  - Notes and lyrics were not touched.
- **Contents:** 6 parts, 94 bars, 4/4, C♯ minor, ♩=80 "Maestoso ma non troppo", about 4:42 at the written tempo.
  - Soprano: 168 notes, 155 with lyrics.
  - Alto: 186 notes, 162 with lyrics.
  - Tenor: 230 notes, 200 with lyrics.
  - Bass: 218 notes, 183 with lyrics.
  - Organ: 2 staves. Organ Pedal: 1 staff.
  - Every voice is monophonic, with Latin lyrics ("Kyrie eleison / Christe eleison").
- **Import check:** `importScoreFile` returns voiceTypes S/A/T/B plus two `other` parts and 11 sections of 8–9 bars each, with no errors.
- **Alternative not used:** PDMX `mxl/16/40/QmYrY97QB7n64JH5tiUMsfXMjDZSQBbFwWFQ2rGw6NLSN1.mxl`, a standalone Kyrie by the same uploader (https://musescore.com/user/36264/scores/5380279, CC0, 94 bars, SATB with two organs). It was rejected because only the alto part has lyrics.

### Fauré, *Madrigal* Op. 35: not found

- **PDMX:** no version under any title, composer or lyric search ("Madrigal" with Fauré, "Inconnues", "Silvestre", "Op. 35").
- **CPDL:** has a MusicXML/MIDI edition at `Madrigal,_Op._35_(Gabriel_Fauré)`, according to a web search. The site still returns Cloudflare 403. The web.archive.org copy is blocked by this session's egress proxy.
- **IMSLP:** has only a PDF scan of the SATB and piano version (PMLP60197, public domain).
- **Mutopia:** has Fauré songs, but not this piece.
- **Wikimedia Commons:** has only JPG images of the autograph manuscript.
- **GitHub code search:** nothing found.
- **MuseScore.com:** has uploads (for example user/21243506/scores/7158795 and user/79422424/scores/11808895), but the pages return 403 and downloads need a login.
- **To get it:** download the CPDL MusicXML by hand in a browser, or export one of the MuseScore uploads if its licence is PD/CC0.
