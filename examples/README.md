# OpsCanon Examples

This folder contains small, safe examples for the self-serve workflow.

## Run The Fixture

```bash
opscanon prepare examples/raw-company-export --out work/example-ai-ready-pack --ocr-text examples/ocr-output --dashboard
opscanon review work/example-ai-ready-pack
opscanon approve work/example-ai-ready-pack --out work/example-approved-pack
opscanon build --prepared work/example-approved-pack --out work/example-company-brain
opscanon score --brain work/example-company-brain
opscanon eval --brain work/example-company-brain
```

## Included

- `raw-company-export/`: sample customer-facing, sales, security, and incident procedures.
- `ocr-output/`: sample OCR text for a binary PDF.
- `sample-ai-ready-pack/`: shortened example of prepared-pack outputs.
- `sample-company-brain/`: shortened example of brain outputs.

For a full generated example, run:

```bash
opscanon demo --out opscanon-demo
```
