# omr-diff sidecar

MusicXML semantic diff via [musicdiff](https://github.com/gregchapman-dev/musicdiff) + music21.

## Setup

```bash
cd omr-diff
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## Run

```bash
uvicorn server:app --port 8484
```

## Usage

```bash
curl -X POST http://localhost:8484/diff \
  -F old_xml=@old.musicxml \
  -F new_xml=@new.musicxml
```
