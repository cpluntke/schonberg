# Choir library (not public)

Scores that choir admins (and the super admin) can add to their choir from the Choir admin screen
(Library section). They are **not** part of the public app build: `scripts/export-messier.sh` copies
this folder to `schonberg_library/` in the messiermarathon repo, which Flask does not serve as
static files. The server (`utils/schonberg_library.py` there) reads `index.json` and copies a score
into the choir's own scores when an admin adds it; members then get it through the choir sync.

`index.json`: `[{ id, file, title, composer, level, description, credit }]`. The `id` becomes the
piece id on members' phones (so progress made with the former built-in pieces of the same id comes
back), so never change an id once it is in use.

## Sources and licences

The compositions are all in the public domain. The editions:

| Piece | Edition | Licence |
|---|---|---|
| Fauré, *Madrigal* Op. 35 (`faure-madrigal`) | Robert Kerr for the William Byrd Singers, Manchester (Dorico, 2025); text Armand Silvestre | CC BY-SA 4.0 (the file says: "This music is in the public domain. This edition created by Robert Kerr for the William Byrd Singers, Manchester, and released and licensed under CC BY-SA 4.0.") |
| Bruckner, *Locus iste* WAB 23 | MuseScore score 1972546, via PDMX | CC0 1.0 |
| Debussy, *Trois chansons de Charles d'Orléans* 1–3 | MuseScore scores 5783791, 5757499, 5783335, via PDMX | Public Domain Mark 1.0 |
| Brahms, *Schaffe in mir, Gott* Op. 29/2 (first 26 bars) | MuseScore score 5758815, via PDMX | Public Domain Mark 1.0 |
| Ravel, *Nicolette* | James Gibb editions, MuseScore score 5783904, via PDMX | Public Domain Mark 1.0 |
| Vierne, *Kyrie* (Messe solennelle Op. 16) | Manfred Hößl (CPDL #30138), via PDMX / MuseScore | CPDL licence (free to copy, perform and distribute) |

PDMX: "A Large-Scale Public Domain MusicXML Dataset" (Long et al., Zenodo record 15571083, CC BY 4.0).
More on the raw files in `content/raw/SOURCES.md`.
